"""`/api/posts`: 글 목록·상세(누구나), 작성·수정·삭제(로그인한 회원).

검사 순서(CONTRACTS §8.5)
- POST: 인증(401/503) → 입력 검증(422) → 프로필 확인(403 `profile_required`) → 저장
- PATCH·DELETE: 경로 UUID 형식(422) → 인증 → `If-Match` 없음(428) → `If-Match` 형식·본문 검증(422) → RPC(404 → 403 → 412 → 성공)
본문은 인증 뒤에 직접 읽는다(FastAPI의 자동 본문 검증은 인증보다 먼저 JSON 구문을 검사한다).
읽기 API는 `Authorization` 헤더가 와도 무시한다.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from ..config import AppConfig
from ..dependencies import CurrentUser, Services, get_config, get_current_user, get_services
from ..errors import (
    forbidden, invalid_cursor, post_not_found, precondition_failed, precondition_required, profile_required, validation_error,
)
from ..pagination import InvalidCursor, decode_cursor, encode_cursor
from ..schemas.error import ErrorResponse
from ..schemas.post import (
    ALGORITHM_IDS, MESSAGE_ALGORITHM, PostDetail, PostList, PostValidationFailure, format_etag, parse_create, parse_etag, parse_patch,
    parse_uuid,
)

router = APIRouter(prefix="/api/posts", tags=["게시판"])

NO_STORE = {"Cache-Control": "no-store"}
DEFAULT_LIMIT = 20
MAX_LIMIT = 50
_AUTH_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorResponse, "description": "로그인이 필요하거나(`unauthenticated`) 토큰이 올바르지 않음(`invalid_token`)"},
    503: {"model": ErrorResponse, "description": "인증 설정이 없거나 서비스를 확인할 수 없음(`auth_not_configured`·`service_unavailable`)"},
}
_WRITE_ERRORS: dict[int | str, dict[str, Any]] = {
    **_AUTH_ERRORS,
    403: {"model": ErrorResponse, "description": "본인 글이 아님(`forbidden`)"},
    404: {"model": ErrorResponse, "description": "글이 없거나 이미 삭제됨(`not_found`)"},
    412: {"model": ErrorResponse, "description": "`If-Match`의 version이 현재와 다름(`precondition_failed`)"},
    422: {"model": ErrorResponse, "description": "입력값 오류(`validation_error`)"},
    428: {"model": ErrorResponse, "description": "`If-Match` 없음(`precondition_required`)"},
}


def _detail_response(post: PostDetail, status_code: int = 200, headers: dict[str, str] | None = None) -> JSONResponse:
    response_headers = {**NO_STORE, "ETag": format_etag(post.id, post.version), **(headers or {})}
    return JSONResponse(post.model_dump(mode="json"), status_code=status_code, headers=response_headers)


def valid_post_id(post_id: str) -> str:
    """경로의 글 ID(소문자 하이픈 UUID). 수정·삭제에서는 인증 의존성보다 앞에 선언해 인증보다 먼저 검사한다."""
    parsed = parse_uuid(post_id)
    if parsed is None:
        raise validation_error({"id": "글 ID 형식이 올바르지 않습니다."})
    return parsed


PathId = Annotated[str, Depends(valid_post_id)]


async def _read_json(request: Request) -> Any:
    try:
        return await request.json()
    except ValueError:
        raise validation_error(message="요청 본문이 올바른 JSON이 아닙니다.") from None


def _parse(parser, data: Any):
    try:
        return parser(data)
    except PostValidationFailure as failure:
        raise validation_error(failure.fields) from None


def _if_match(request: Request) -> tuple[str, int]:
    """`If-Match`를 읽는다. 없으면 428, 형식이 다르면 422(`*`·여러 값·약한 ETag 포함)."""
    values = request.headers.getlist("if-match")
    if not values:
        raise precondition_required()
    parsed = parse_etag(values[0]) if len(values) == 1 else None
    if parsed is None:
        raise validation_error({"If-Match": 'If-Match는 글의 ETag 하나("post-<id>-v<번호>")여야 합니다.'})
    return parsed


def _expected_version(path_id: str, etag: tuple[str, int]) -> int:
    """ETag의 글 ID가 경로와 다르면 어떤 version과도 맞을 수 없는 0을 보낸다.

    그러면 RPC가 글의 존재(404)와 소유권(403)을 먼저 가려 주고, 둘 다 통과한 경우에만 412가 된다(§8.4).
    """
    etag_id, version = etag
    return version if etag_id == path_id else 0


@router.get("", summary="글 목록(최신순)", response_model=PostList, responses={400: {"model": ErrorResponse}, 422: {"model": ErrorResponse}, 503: {"model": ErrorResponse}})
async def list_posts(
    services: Annotated[Services, Depends(get_services)],
    config: Annotated[AppConfig, Depends(get_config)],
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT, description="한 번에 가져올 글 수")] = DEFAULT_LIMIT,
    cursor: Annotated[str | None, Query(description="이전 응답의 next_cursor. 필터를 바꾸면 쓰지 않는다")] = None,
    algorithm: Annotated[str | None, Query(description="알고리즘 ID로 거르기")] = None,
) -> JSONResponse:
    """본문 전문을 제외한 요약 목록. `next_cursor`가 null이면 마지막 페이지다."""
    if algorithm is not None and algorithm not in ALGORITHM_IDS:
        raise validation_error({"algorithm": MESSAGE_ALGORITHM})
    after = None
    if cursor is not None:
        try:
            after = decode_cursor(cursor, algorithm)
        except InvalidCursor:
            raise invalid_cursor() from None
    rows = await run_in_threadpool(services.posts.list, config, limit=limit + 1, algorithm=algorithm, after=after)
    page = rows[:limit]
    next_cursor = encode_cursor(page[-1].created_at, str(page[-1].id), algorithm) if len(rows) > limit else None
    return JSONResponse(PostList(items=page, next_cursor=next_cursor).model_dump(mode="json"), headers=NO_STORE)


@router.get("/{post_id}", summary="글 상세", response_model=PostDetail, responses={404: {"model": ErrorResponse}, 422: {"model": ErrorResponse}, 503: {"model": ErrorResponse}})
async def read_post(
    post_id: PathId,
    services: Annotated[Services, Depends(get_services)],
    config: Annotated[AppConfig, Depends(get_config)],
) -> JSONResponse:
    """글 상세. 응답의 `ETag`를 수정·삭제의 `If-Match`에 쓴다."""
    post = await run_in_threadpool(services.posts.get, config, post_id)
    if post is None:
        raise post_not_found()
    return _detail_response(post)


@router.post(
    "", summary="글 쓰기", response_model=PostDetail, status_code=201,
    responses={**_AUTH_ERRORS, 403: {"model": ErrorResponse, "description": "프로필이 없음(`profile_required`)"}, 422: {"model": ErrorResponse}},
)
async def create_post(
    request: Request,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    services: Annotated[Services, Depends(get_services)],
    config: Annotated[AppConfig, Depends(get_config)],
) -> JSONResponse:
    """작성자는 검증된 토큰의 사용자다. 작성 당시의 닉네임은 DB가 프로필에서 복사한다."""
    values = _parse(parse_create, await _read_json(request))
    profile = await run_in_threadpool(services.profiles.get, config, current.token, current.user.id)
    if profile is None:
        raise profile_required()
    post = await run_in_threadpool(
        services.posts.create, config, current.token, current.user.id, values["title"], values["body"], values["algorithm_id"],
    )
    return _detail_response(post, 201, {"Location": f"/api/posts/{post.id}"})


@router.patch("/{post_id}", summary="글 고치기", response_model=PostDetail, responses=_WRITE_ERRORS)
async def update_post(
    path_id: PathId,
    request: Request,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    services: Annotated[Services, Depends(get_services)],
    config: Annotated[AppConfig, Depends(get_config)],
) -> JSONResponse:
    """`If-Match`에 글의 ETag가 필요하다. 본문의 누락된 필드는 그대로 두고, `algorithm_id: null`은 연결을 없앤다."""
    etag = _if_match(request)
    changes = _parse(parse_patch, await _read_json(request))
    outcome = await run_in_threadpool(services.posts.update, config, current.token, path_id, _expected_version(path_id, etag), changes)
    if outcome.result == "not_found":
        raise post_not_found()
    if outcome.result == "forbidden":
        raise forbidden()
    if outcome.result == "version_conflict" or outcome.post is None:
        raise precondition_failed()
    return _detail_response(outcome.post)


@router.delete("/{post_id}", summary="글 지우기", status_code=204, responses=_WRITE_ERRORS)
async def delete_post(
    path_id: PathId,
    request: Request,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    services: Annotated[Services, Depends(get_services)],
    config: Annotated[AppConfig, Depends(get_config)],
) -> Response:
    etag = _if_match(request)
    result = await run_in_threadpool(services.posts.delete, config, current.token, path_id, _expected_version(path_id, etag))
    if result == "not_found":
        raise post_not_found()
    if result == "forbidden":
        raise forbidden()
    if result != "ok":
        raise precondition_failed()
    return Response(status_code=204, headers=NO_STORE)
