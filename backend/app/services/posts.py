"""글 저장소. 읽기는 Publishable key(비로그인), 쓰기는 사용자의 토큰으로 Supabase를 부르므로 RLS가 권한을 판단한다.

- 목록은 `(created_at DESC, id DESC)` 키셋 페이지네이션이다. 한 건 더 읽어 다음 페이지가 있는지 알고, 본문은 읽지 않는다.
- 수정·삭제는 DB의 `update_post`·`delete_post` RPC 하나로 처리한다(소유자·version 확인과 변경이 한 문장). 결과 문자열만 번역한다.
- 쓰기(작성·수정·삭제)는 자동으로 다시 보내지 않는다. 읽기도 이 코드에서는 재시도하지 않는다.
- 사용자 입력으로 SQL·컬럼·테이블 이름을 만들지 않는다. 필터 값은 호출자가 검증한 시각·UUID·허용 목록의 ID뿐이다.
"""

from dataclasses import dataclass
from typing import Any, Literal, Protocol

import httpx
from pydantic import ValidationError

from ..config import AppConfig
from ..errors import ApiError, internal_error
from ..pagination import CursorPosition
from ..schemas.post import PostDetail, PostSummary
from .supabase import LazyHttpClient, create_anon_client, create_user_client, translate_exception

SUMMARY_COLUMNS = "id,title,author_display_name,algorithm_id,created_at,version"
DETAIL_COLUMNS = "id,author_id,author_display_name,title,body,algorithm_id,version,created_at,updated_at"

MutationResult = Literal["ok", "not_found", "forbidden", "version_conflict"]
_RESULTS = ("ok", "not_found", "forbidden", "version_conflict")


@dataclass(frozen=True)
class UpdateOutcome:
    result: MutationResult
    post: PostDetail | None = None  # result가 ok일 때만


class PostStore(Protocol):
    """글 DB 경계. 단위 테스트는 이 자리에 메모리 가짜를 끼운다. 모든 메서드는 실패하면 `ApiError`를 던진다."""

    def list(self, config: AppConfig, *, limit: int, algorithm: str | None, after: CursorPosition | None) -> list[PostSummary]:
        """최신순으로 최대 `limit`건. 호출자는 다음 페이지 확인을 위해 limit+1을 넘긴다."""

    def get(self, config: AppConfig, post_id: str) -> PostDetail | None: ...

    def create(self, config: AppConfig, token: str, user_id: str, title: str, body: str, algorithm_id: str | None) -> PostDetail: ...

    def update(self, config: AppConfig, token: str, post_id: str, expected_version: int, changes: dict[str, Any]) -> UpdateOutcome:
        """`changes`에 있는 필드만 바꾼다(없는 필드는 변경 없음, `algorithm_id: None`은 연결 제거)."""

    def delete(self, config: AppConfig, token: str, post_id: str, expected_version: int) -> MutationResult: ...


def _model(model, row: Any):
    try:
        return model.model_validate(row)
    except ValidationError:
        raise internal_error() from None


def _single_row(data: Any) -> dict[str, Any]:
    """RPC 결과는 항상 한 줄이다. 아니면 서버 쪽 계약 위반이다."""
    if isinstance(data, dict):
        return data
    if isinstance(data, list) and len(data) == 1 and isinstance(data[0], dict):
        return data[0]
    raise internal_error()


def _result_of(row: dict[str, Any]) -> MutationResult:
    result = row.get("result")
    if result not in _RESULTS:
        raise internal_error()
    return result


class SupabasePostStore:
    def __init__(self, http_client: httpx.Client | LazyHttpClient | None = None):
        self._http_client = http_client

    def _anon(self, config: AppConfig):
        return create_anon_client(config, http_client=self._http_client)

    def _user(self, config: AppConfig, token: str):
        return create_user_client(config, token, http_client=self._http_client)

    def list(self, config: AppConfig, *, limit: int, algorithm: str | None, after: CursorPosition | None) -> list[PostSummary]:
        try:
            query = self._anon(config).table("posts").select(SUMMARY_COLUMNS)
            if algorithm is not None:
                query = query.eq("algorithm_id", algorithm)
            if after is not None:
                created, post_id = after.created_at_text, after.id
                query = query.or_(f"created_at.lt.{created},and(created_at.eq.{created},id.lt.{post_id})")
            rows = query.order("created_at", desc=True).order("id", desc=True).limit(limit).execute().data
        except ApiError:
            raise
        except Exception as error:  # noqa: BLE001
            raise translate_exception(error, context="글 목록 조회") from None
        return [_model(PostSummary, row) for row in rows]

    def get(self, config: AppConfig, post_id: str) -> PostDetail | None:
        try:
            rows = self._anon(config).table("posts").select(DETAIL_COLUMNS).eq("id", post_id).limit(1).execute().data
        except ApiError:
            raise
        except Exception as error:  # noqa: BLE001
            raise translate_exception(error, context="글 조회") from None
        return _model(PostDetail, rows[0]) if rows else None

    def create(self, config: AppConfig, token: str, user_id: str, title: str, body: str, algorithm_id: str | None) -> PostDetail:
        row = {"author_id": user_id, "title": title, "body": body, "algorithm_id": algorithm_id}
        try:
            rows = self._user(config, token).table("posts").insert(row).execute().data
        except ApiError:
            raise
        except Exception as error:  # noqa: BLE001
            raise translate_exception(error, context="글 작성") from None
        if not rows:
            raise internal_error()
        return _model(PostDetail, rows[0])

    def update(self, config: AppConfig, token: str, post_id: str, expected_version: int, changes: dict[str, Any]) -> UpdateOutcome:
        params: dict[str, Any] = {"p_id": post_id, "p_expected_version": expected_version}
        if "title" in changes:
            params["p_title"] = changes["title"]
        if "body" in changes:
            params["p_body"] = changes["body"]
        if "algorithm_id" in changes:
            params["p_algorithm_id"] = changes["algorithm_id"]
            params["p_set_algorithm_id"] = True
        try:
            data = self._user(config, token).rpc("update_post", params).execute().data
        except ApiError:
            raise
        except Exception as error:  # noqa: BLE001
            raise translate_exception(error, context="글 수정") from None
        row = _single_row(data)
        result = _result_of(row)
        if result != "ok":
            return UpdateOutcome(result)
        return UpdateOutcome(result, _model(PostDetail, {key: value for key, value in row.items() if key != "result"}))

    def delete(self, config: AppConfig, token: str, post_id: str, expected_version: int) -> MutationResult:
        try:
            data = self._user(config, token).rpc("delete_post", {"p_id": post_id, "p_expected_version": expected_version}).execute().data
        except ApiError:
            raise
        except Exception as error:  # noqa: BLE001
            raise translate_exception(error, context="글 삭제") from None
        return _result_of(_single_row(data))
