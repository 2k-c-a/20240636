"""게시글별 댓글: 공개 목록, 인증된 회원의 작성·본인 삭제."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from ..config import AppConfig
from ..dependencies import CurrentUser, Services, get_config, get_current_user, get_services
from ..errors import ApiError, invalid_cursor, post_not_found, profile_required, validation_error
from ..pagination import InvalidCursor, decode_cursor, encode_cursor
from ..schemas.post import parse_uuid
from .posts import PathId, _read_json

router = APIRouter(prefix="/api/posts", tags=["댓글"])
NO_STORE = {"Cache-Control": "no-store"}


def parse_comment(data):
    if not isinstance(data, dict) or set(data) != {"body"}:
        raise validation_error({"body": "댓글 내용만 입력해 주세요."})
    body = data["body"]
    if not isinstance(body, str) or not 1 <= len(body) <= 2000 or not body.strip() or "\x00" in body or any(0xD800 <= ord(ch) <= 0xDFFF for ch in body):
        raise validation_error({"body": "댓글은 공백을 제외한 내용을 포함해 1~2,000자로 입력해 주세요."})
    return body


async def require_post(services, config, post_id):
    if await run_in_threadpool(services.posts.get, config, post_id) is None:
        raise post_not_found()


@router.get("/{post_id}/comments")
async def list_comments(
    post_id: PathId,
    services: Annotated[Services, Depends(get_services)],
    config: Annotated[AppConfig, Depends(get_config)],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: str | None = None,
):
    after = None
    if cursor is not None:
        try:
            after = decode_cursor(cursor, f"comments:{post_id}")
        except InvalidCursor:
            raise invalid_cursor() from None
    await require_post(services, config, post_id)
    rows = await run_in_threadpool(services.comments.list, config, post_id, limit=limit + 1, after=after)
    page = rows[:limit]
    next_cursor = encode_cursor(page[-1].created_at, str(page[-1].id), f"comments:{post_id}") if len(rows) > limit else None
    return JSONResponse({"items": [row.model_dump(mode="json") for row in page], "next_cursor": next_cursor}, headers=NO_STORE)


@router.post("/{post_id}/comments", status_code=201)
async def create_comment(
    post_id: PathId,
    request: Request,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    services: Annotated[Services, Depends(get_services)],
    config: Annotated[AppConfig, Depends(get_config)],
):
    body = parse_comment(await _read_json(request))
    await require_post(services, config, post_id)
    profile = await run_in_threadpool(services.profiles.get, config, current.token, current.user.id)
    if profile is None:
        raise profile_required()
    row = await run_in_threadpool(services.comments.create, config, current.token, post_id, current.user.id, body)
    return JSONResponse(row.model_dump(mode="json"), status_code=201, headers=NO_STORE)


@router.delete("/{post_id}/comments/{comment_id}", status_code=204)
async def delete_comment(
    post_id: PathId,
    comment_id: str,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    services: Annotated[Services, Depends(get_services)],
    config: Annotated[AppConfig, Depends(get_config)],
):
    if parse_uuid(comment_id) is None:
        raise validation_error({"id": "댓글 ID 형식이 올바르지 않습니다."})
    removed = await run_in_threadpool(services.comments.delete, config, current.token, post_id, comment_id, current.user.id)
    if not removed:
        raise ApiError(404, "not_found", "댓글이 없거나 삭제할 권한이 없습니다.")
    return Response(status_code=204, headers=NO_STORE)
