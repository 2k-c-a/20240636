"""`GET /api/me`, `POST·PATCH /api/me/profile`: 로그인한 본인의 정보와 프로필.

- 사용자 ID는 검증된 토큰에서만 얻는다. 요청 본문에 `id`·`author_id` 같은 정의되지 않은 필드가 있으면 422다.
- 검사 순서(§8.5): 인증(401/503) → 입력 검증(422) → 처리. 그래서 본문은 인증 뒤에 직접 읽는다(FastAPI의 자동 본문 검증은 인증보다 먼저 JSON 구문을 검사한다).
- 프로필이 없어도 `GET /api/me`는 200이며 nickname이 null이다.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from ..config import AppConfig
from ..dependencies import CurrentUser, Services, get_config, get_current_user, get_services
from ..errors import ApiError, validation_error
from ..schemas.error import ErrorResponse
from ..schemas.profile import Me, NicknameBody, Profile, ValidationFailure, parse_nickname_body

router = APIRouter(prefix="/api/me", tags=["내 정보"])

NO_STORE = {"Cache-Control": "no-store"}
_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorResponse, "description": "로그인이 필요하거나(`unauthenticated`) 토큰이 올바르지 않음(`invalid_token`)"},
    503: {"model": ErrorResponse, "description": "인증 설정이 없거나(`auth_not_configured`) 서비스를 확인할 수 없음(`service_unavailable`)"},
}


async def _read_nickname(request: Request) -> NicknameBody:
    """요청 본문(JSON 객체)을 읽어 검증한다. 인증을 통과한 뒤에만 부른다."""
    try:
        data = await request.json()
    except ValueError:
        raise validation_error(message="요청 본문이 올바른 JSON이 아닙니다.") from None
    if not isinstance(data, dict):
        raise validation_error(message="요청 본문은 JSON 객체여야 합니다.")
    try:
        return parse_nickname_body(data)
    except ValidationFailure as failure:
        raise validation_error(failure.fields) from None


@router.get("", summary="내 정보", response_model=Me, responses=_ERRORS)
async def read_me(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    services: Annotated[Services, Depends(get_services)],
    config: Annotated[AppConfig, Depends(get_config)],
) -> JSONResponse:
    """검증된 본인의 id·이메일과 프로필 닉네임(없으면 null). 본인 이메일만 돌려준다."""
    profile = await run_in_threadpool(services.profiles.get, config, current.token, current.user.id)
    me = Me(id=current.user.id, email=current.user.email, nickname=profile.nickname if profile else None)
    return JSONResponse(me.model_dump(mode="json"), headers=NO_STORE)


@router.post("/profile", summary="프로필 만들기(이미 있으면 그대로)", response_model=Profile, responses={**_ERRORS, 201: {"model": Profile, "description": "새로 만들었다"}, 422: {"model": ErrorResponse}})
async def create_profile(
    request: Request,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    services: Annotated[Services, Depends(get_services)],
    config: Annotated[AppConfig, Depends(get_config)],
) -> Response:
    """프로필이 없을 때만 만든다(201). 이미 있으면 현재 프로필을 그대로 돌려주고(200) 요청의 닉네임으로 덮어쓰지 않는다. 닉네임 변경은 PATCH만 한다."""
    body = await _read_nickname(request)
    profile, created = await run_in_threadpool(services.profiles.create_if_absent, config, current.token, current.user.id, body.nickname)
    return JSONResponse(profile.model_dump(mode="json"), status_code=201 if created else 200, headers=NO_STORE)


@router.patch("/profile", summary="닉네임 바꾸기", response_model=Profile, responses={**_ERRORS, 404: {"model": ErrorResponse}, 422: {"model": ErrorResponse}})
async def update_profile(
    request: Request,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    services: Annotated[Services, Depends(get_services)],
    config: Annotated[AppConfig, Depends(get_config)],
) -> Response:
    """본인 프로필의 닉네임을 바꾼다. 프로필이 없으면 404 `profile_not_found`다. 이미 쓴 글의 표시명은 바뀌지 않는다."""
    body = await _read_nickname(request)
    profile = await run_in_threadpool(services.profiles.update, config, current.token, current.user.id, body.nickname)
    if profile is None:
        raise ApiError(404, "profile_not_found", "수정할 프로필이 없습니다. 먼저 프로필을 만들어 주세요.")
    return JSONResponse(profile.model_dump(mode="json"), headers=NO_STORE)
