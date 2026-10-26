"""프로필 저장소. 사용자의 토큰으로 Supabase DB(PostgREST)를 호출하므로 RLS가 그 사용자 권한으로 판단한다.

- 조회·생성·수정 모두 본인 행만 다룬다. `id`는 검증된 토큰에서 얻은 값을 쓰고 요청 본문의 값은 쓰지 않는다.
- 생성은 insert-if-absent(`INSERT … ON CONFLICT (id) DO NOTHING`)다. 이미 있으면 새로 만들지 않고 기존 닉네임을 그대로 둔다.
- 쓰기(생성·수정)는 자동으로 다시 보내지 않는다(응답을 받지 못했을 때 사용자가 상태를 확인하게 한다). 읽기는 라이브러리의 제한된 재시도를 따른다.
"""

from typing import Any, Protocol

import httpx
from pydantic import ValidationError

from ..config import AppConfig
from ..errors import ApiError, internal_error
from ..schemas.profile import Profile
from .supabase import LazyHttpClient, create_user_client, translate_exception

_COLUMNS = "id,nickname,created_at,updated_at"


class ProfileStore(Protocol):
    """프로필 DB 경계. 단위 테스트는 이 자리에 메모리 가짜를 끼운다. 모든 메서드는 실패하면 `ApiError`를 던진다."""

    def get(self, config: AppConfig, token: str, user_id: str) -> Profile | None: ...

    def create_if_absent(self, config: AppConfig, token: str, user_id: str, nickname: str) -> tuple[Profile, bool]:
        """(프로필, 새로 만들었는지). 이미 있으면 기존 프로필과 False를 돌려주고 닉네임을 바꾸지 않는다."""

    def update(self, config: AppConfig, token: str, user_id: str, nickname: str) -> Profile | None:
        """닉네임을 바꾼다. 프로필이 없으면 None."""


def _to_profile(row: Any) -> Profile:
    try:
        return Profile.model_validate(row)
    except ValidationError:
        raise internal_error() from None


class SupabaseProfileStore:
    def __init__(self, http_client: httpx.Client | LazyHttpClient | None = None):
        self._http_client = http_client

    def _table(self, config: AppConfig, token: str):
        return create_user_client(config, token, http_client=self._http_client).table("profiles")

    def get(self, config: AppConfig, token: str, user_id: str) -> Profile | None:
        try:
            rows = self._table(config, token).select(_COLUMNS).eq("id", user_id).limit(1).execute().data
        except ApiError:
            raise
        except Exception as error:  # noqa: BLE001
            raise translate_exception(error, context="프로필 조회") from None
        return _to_profile(rows[0]) if rows else None

    def create_if_absent(self, config: AppConfig, token: str, user_id: str, nickname: str) -> tuple[Profile, bool]:
        try:
            table = self._table(config, token)
            inserted = table.upsert({"id": user_id, "nickname": nickname}, on_conflict="id", ignore_duplicates=True).execute().data
            if inserted:
                return _to_profile(inserted[0]), True
            rows = self._table(config, token).select(_COLUMNS).eq("id", user_id).limit(1).execute().data
        except ApiError:
            raise
        except Exception as error:  # noqa: BLE001
            raise translate_exception(error, context="프로필 생성") from None
        if not rows:
            # 만들어지지도 않았고 보이지도 않는다(그 사이 삭제되었거나 권한 문제). 성공으로 꾸미지 않는다.
            raise internal_error()
        return _to_profile(rows[0]), False

    def update(self, config: AppConfig, token: str, user_id: str, nickname: str) -> Profile | None:
        try:
            rows = self._table(config, token).update({"nickname": nickname}).eq("id", user_id).execute().data
        except ApiError:
            raise
        except Exception as error:  # noqa: BLE001
            raise translate_exception(error, context="프로필 수정") from None
        return _to_profile(rows[0]) if rows else None
