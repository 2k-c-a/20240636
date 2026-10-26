"""댓글 읽기·작성·본인 삭제. 모든 쓰기는 사용자 토큰과 DB RLS로 검사한다."""

from datetime import datetime
from typing import Protocol
from uuid import UUID

import httpx
from pydantic import BaseModel

from ..config import AppConfig
from ..errors import ApiError, post_not_found
from ..pagination import CursorPosition
from .posts import _model
from .supabase import LazyHttpClient, create_anon_client, create_user_client, translate_exception

COLUMNS = "id,post_id,author_id,author_display_name,body,created_at"


class Comment(BaseModel):
    id: UUID
    post_id: UUID
    author_id: UUID
    author_display_name: str
    body: str
    created_at: datetime


class CommentStore(Protocol):
    def list(self, config: AppConfig, post_id: str, *, limit: int, after: CursorPosition | None) -> list[Comment]: ...
    def create(self, config: AppConfig, token: str, post_id: str, user_id: str, body: str) -> Comment: ...
    def delete(self, config: AppConfig, token: str, post_id: str, comment_id: str, user_id: str) -> bool: ...


class SupabaseCommentStore:
    def __init__(self, http_client: httpx.Client | LazyHttpClient | None = None):
        self._http_client = http_client

    def list(self, config, post_id, *, limit, after):
        try:
            query = create_anon_client(config, http_client=self._http_client).table("comments").select(COLUMNS).eq("post_id", post_id)
            if after is not None:
                query = query.or_(f"created_at.lt.{after.created_at_text},and(created_at.eq.{after.created_at_text},id.lt.{after.id})")
            rows = query.order("created_at", desc=True).order("id", desc=True).limit(limit).execute().data
        except ApiError:
            raise
        except Exception as error:
            raise translate_exception(error, context="댓글 목록") from None
        return [_model(Comment, row) for row in rows]

    def create(self, config, token, post_id, user_id, body):
        try:
            rows = create_user_client(config, token, http_client=self._http_client).table("comments").insert(
                {"post_id": post_id, "author_id": user_id, "body": body}
            ).execute().data
        except ApiError:
            raise
        except Exception as error:
            if getattr(error, "code", None) == "23503":
                raise post_not_found() from None
            raise translate_exception(error, context="댓글 작성") from None
        if not rows:
            raise post_not_found()
        return _model(Comment, rows[0])

    def delete(self, config, token, post_id, comment_id, user_id):
        try:
            rows = create_user_client(config, token, http_client=self._http_client).table("comments").delete().eq(
                "id", comment_id
            ).eq("post_id", post_id).eq("author_id", user_id).execute().data
        except ApiError:
            raise
        except Exception as error:
            raise translate_exception(error, context="댓글 삭제") from None
        return bool(rows)
