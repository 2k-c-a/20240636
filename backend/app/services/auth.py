"""액세스 토큰 검증. Supabase Auth의 `get_user(jwt)`로 확인하며 토큰을 decode만 하고 신뢰하지 않는다.

결과는 세 가지다: 검증된 사용자 / 잘못된·만료된 토큰(`invalid_token`, 401) / 판정할 수 없음(`service_unavailable`, 503).
판정할 수 없는 경우(인증 서비스 장애·시간 초과·이상한 응답)를 허용으로 처리하지 않는다.
"""

import logging
from typing import NoReturn, Protocol
from uuid import UUID

import httpx

from ..config import AppConfig
from ..errors import ApiError, service_unavailable
from ..schemas.user import VerifiedUser
from .supabase import LazyHttpClient, create_anon_client, translate_exception

logger = logging.getLogger("app.auth")


class TokenVerifier(Protocol):
    """토큰을 검증하는 경계. 단위 테스트는 이 자리에 가짜를 끼운다."""

    def verify(self, config: AppConfig, token: str) -> VerifiedUser:
        """검증된 사용자를 돌려준다. 실패하면 `ApiError`(401 또는 503)를 던진다."""


class SupabaseTokenVerifier:
    def __init__(self, http_client: httpx.Client | LazyHttpClient | None = None):
        self._http_client = http_client
        # 로그인하지 않은 클라이언트는 요청별 상태가 없다(토큰은 get_user에 인자로 넘기고 세션을 저장하지 않는다). 설정이 같으면 재사용한다.
        self._anon: tuple[tuple[str | None, str | None], object] | None = None

    def _anon_client(self, config: AppConfig):
        key = (config.supabase_url, config.supabase_publishable_key)
        if self._anon is None or self._anon[0] != key:
            self._anon = (key, create_anon_client(config, http_client=self._http_client))
        return self._anon[1]

    def verify(self, config: AppConfig, token: str) -> VerifiedUser:
        try:
            response = self._anon_client(config).auth.get_user(token)
        except ApiError:
            raise
        except Exception as error:  # noqa: BLE001 - 어떤 실패든 "판정 불가"로 처리하고 허용하지 않는다
            translated = translate_exception(error, context="토큰 검증")
            # 토큰 검증에서는 "예상하지 못한 오류"도 서버 버그가 아니라 "유효한지 판정할 수 없음"이다(계약 §7). 허용하지 않고 503으로 알린다.
            raise (service_unavailable() if translated.status_code == 500 else translated) from None
        user = getattr(response, "user", None)
        if user is None:
            return _reject_unknown_response("사용자 정보 없음")
        try:
            user_id = str(UUID(str(user.id)))
        except (ValueError, AttributeError):
            return _reject_unknown_response("사용자 ID 형식 이상")
        email = user.email if isinstance(getattr(user, "email", None), str) and user.email else None
        return VerifiedUser(id=user_id, email=email)


def _reject_unknown_response(reason: str) -> NoReturn:
    # 인증 서비스가 성공(200)이라고 했지만 사용할 수 없는 응답이다. 사용자를 확인했다고 볼 수 없으므로 허용하지 않는다.
    logger.error("토큰 검증 응답을 해석하지 못함: %s", reason)
    raise service_unavailable()

