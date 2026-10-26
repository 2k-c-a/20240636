"""Supabase 클라이언트 만들기와 오류 번역.

- `create_anon_client`, `create_user_client`: **Publishable key**만 쓴다. 요청마다 새로 만들고 세션을 저장하지 않는다(메모리 저장소도 클라이언트마다 따로).
  사용자 클라이언트는 그 요청의 토큰을 `Authorization`에 실어 보내므로 DB(RLS)가 그 사용자 권한으로 판단한다. 요청 사이에 공유하는 것은
  연결 풀(`httpx.Client`)뿐이며, 두 라이브러리(postgrest, auth) 모두 헤더를 요청마다 따로 실어 보낸다(tests/test_supabase_requests.py가 동시 요청으로 확인한다).
- `create_admin_client`: **Secret key**를 쓰는 서버 전용 클라이언트. RLS를 우회하므로 일반 사용자 요청 경로(라우터)에서 쓰지 않는다. 로그인(sign_in)도 하지 않는다.
- `translate_exception`: Supabase·네트워크 오류를 공통 오류(`ApiError`)로 바꾼다. 키·토큰·SQL은 담지 않는다.

Supabase 패키지는 함수 안에서 불러온다. 서버를 시작하거나 정적 페이지·`/api/health`를 제공할 때는 Supabase 패키지가 필요 없어야 한다
(인증 설정이 없어도 시각화는 계속 동작한다. tests/test_static.py가 확인한다).
"""

import logging
import threading
from functools import lru_cache
from typing import TYPE_CHECKING

import httpx

from ..config import AppConfig
from ..errors import ApiError, internal_error, invalid_token, profile_required, service_unavailable, validation_error

if TYPE_CHECKING:
    from supabase import Client

logger = logging.getLogger("app.supabase")

REQUEST_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


def create_http_client() -> httpx.Client:
    """Supabase 요청에 공유하는 연결 풀. 기본 헤더(인증 포함)를 갖지 않으므로 요청 사이에 사용자 정보가 섞이지 않는다."""
    return httpx.Client(timeout=REQUEST_TIMEOUT, follow_redirects=False)


class LazyHttpClient:
    """연결 풀을 처음 쓸 때 만든다. 앱 객체만 import하고 서버를 시작하지 않는 경우(테스트·도구)에 풀이 열린 채 남지 않게 한다."""

    def __init__(self) -> None:
        self._client: httpx.Client | None = None
        self._lock = threading.Lock()

    def get(self) -> httpx.Client:
        with self._lock:
            if self._client is None:
                self._client = create_http_client()
            return self._client

    def close(self) -> None:
        with self._lock:
            if self._client is not None:
                self._client.close()
                self._client = None


def _resolve(http_client: "httpx.Client | LazyHttpClient | None") -> httpx.Client | None:
    return http_client.get() if isinstance(http_client, LazyHttpClient) else http_client


def _require_user_config(config: AppConfig) -> tuple[str, str]:
    if not config.auth_enabled:
        raise RuntimeError("인증 설정(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)이 없습니다.")
    return config.supabase_url, config.supabase_publishable_key  # type: ignore[return-value]


def _options(headers: dict[str, str] | None, http_client: "httpx.Client | LazyHttpClient | None"):
    from supabase.lib.client_options import DEFAULT_HEADERS, SyncClientOptions
    from supabase_auth import SyncMemoryStorage

    return SyncClientOptions(
        headers={**DEFAULT_HEADERS, **(headers or {})},
        auto_refresh_token=False,
        persist_session=False,
        storage=SyncMemoryStorage(),
        httpx_client=_resolve(http_client),
    )


def create_anon_client(config: AppConfig, *, http_client: "httpx.Client | LazyHttpClient | None" = None) -> "Client":
    """로그인하지 않은 상태의 클라이언트(Publishable key). 토큰 확인과 공개 데이터 읽기에 쓴다."""
    from supabase import create_client

    url, key = _require_user_config(config)
    return create_client(url, key, _options(None, http_client))


def create_user_client(config: AppConfig, jwt: str, *, http_client: "httpx.Client | LazyHttpClient | None" = None) -> "Client":
    """그 요청의 사용자 토큰으로 DB를 부르는 클라이언트. 키는 Publishable key이고 `Authorization`에 사용자 토큰을 싣는다."""
    from supabase import create_client

    url, key = _require_user_config(config)
    return create_client(url, key, _options({"Authorization": f"Bearer {jwt}"}, http_client))


@lru_cache(maxsize=2)
def _admin_client(url: str, secret_key: str) -> "Client":
    from supabase import create_client
    from supabase.lib.client_options import SyncClientOptions
    from supabase_auth import SyncMemoryStorage

    return create_client(url, secret_key, SyncClientOptions(auto_refresh_token=False, persist_session=False, storage=SyncMemoryStorage()))


def create_admin_client(config: AppConfig) -> "Client":
    """서버 전용 관리용 클라이언트(Secret key, RLS 우회). 일반 사용자 요청 경로에서 쓰지 않는다."""
    if not config.supabase_url or not config.supabase_secret_key:
        raise RuntimeError("관리용 Supabase 설정(SUPABASE_URL, SUPABASE_SECRET_KEY)이 없습니다.")
    return _admin_client(config.supabase_url, config.supabase_secret_key)


# PostgREST가 JWT 자체가 잘못되었다고 알리는 코드(PGRST301 서명·만료, PGRST302 익명 불가, PGRST303 claims)
_POSTGREST_JWT_CODES = {"PGRST301", "PGRST302", "PGRST303"}


# CHECK 제약 이름 → (필드, 메시지). 이름을 알 수 없는 23514(예: 트리거의 immutable_column)는 필드를 지어내지 않는다.
_CHECK_FIELDS = (
    ("profiles_nickname_", "nickname", "닉네임 규칙에 맞지 않습니다."),
    ("posts_title_", "title", "제목은 1~100자이며 앞뒤 공백이 없어야 합니다."),
    ("posts_body_", "body", "본문은 1~10,000자이며 공백만으로 이루어질 수 없습니다."),
    ("posts_algorithm_id_", "algorithm_id", "알 수 없는 알고리즘입니다."),
)


def _check_violation(error: Exception, context: str) -> ApiError:
    """SQLSTATE 23514를 제약 이름으로 구분한다. 제약 이름은 PostgREST 메시지에 `violates check constraint "<이름>"`으로 들어 있다."""
    text = f"{getattr(error, 'message', '')} {getattr(error, 'details', '')}"
    for prefix, field, message in _CHECK_FIELDS:
        if f'"{prefix}' in text:
            return validation_error({field: message})
    if "immutable_column" in text:
        return ApiError(403, "forbidden", "바꿀 수 없는 항목은 수정할 수 없습니다.")
    logger.error("%s: 알 수 없는 CHECK 위반 %s", context, type(error).__name__)
    return internal_error()


def translate_exception(error: Exception, *, context: str) -> ApiError:
    """Supabase·네트워크 예외를 공통 오류로 바꾼다. 판정할 수 없는 경우는 허용하지 않고 503으로 돌려준다.

    context는 로그에 남길 작업 이름이다. 예외 메시지는 기록하지 않고 종류만 남긴다.
    """
    from postgrest.exceptions import APIError
    from supabase_auth.errors import (
        AuthApiError,
        AuthError,
        AuthInvalidCredentialsError,
        AuthInvalidJwtError,
        AuthSessionMissingError,
    )

    kind = type(error).__name__
    if isinstance(error, APIError):
        code = str(error.code or "")
        # 본문을 해석하지 못하면 라이브러리가 HTTP 상태를 code로 쓴다("401" 등). 상태만으로도 안전하게 번역한다.
        if code in _POSTGREST_JWT_CODES or code == "401":
            return invalid_token()
        if code == "23514":
            return _check_violation(error, context)
        if code == "P0001" and "profile_required" in f"{getattr(error, 'message', '')}":
            return profile_required()
        if code in ("42501", "403"):
            return ApiError(403, "forbidden", "이 작업을 할 권한이 없습니다.")
        # HTTP 상태는 세 자리, SQLSTATE는 다섯 자리다(22023·23505처럼 숫자만인 SQLSTATE를 HTTP 5xx로 오해하지 않는다).
        # 40001(직렬화 실패)·40P01(교착)은 다시 시도하면 되는 일시 오류다.
        is_http = len(code) == 3 and code.isdigit()
        if (is_http and (int(code) >= 500 or int(code) == 429)) or code in ("PGRST002", "PGRST003", "40001", "40P01"):
            logger.warning("%s: Supabase 일시 장애 code=%s", context, code)
            return service_unavailable()
        logger.error("%s: 예상하지 못한 데이터베이스 오류 %s code=%s", context, kind, code)
        return internal_error()
    if isinstance(error, AuthApiError):
        if error.status in (400, 401, 403, 404):
            return invalid_token()
        logger.warning("%s: 인증 서비스 응답 %s", context, error.status)
        return service_unavailable()
    if isinstance(error, (AuthInvalidJwtError, AuthSessionMissingError, AuthInvalidCredentialsError)):
        # 라이브러리가 토큰 자체가 잘못되었거나 세션이 없다고 판정한 경우다. 서비스 장애가 아니므로 401로 돌려준다.
        return invalid_token()
    if isinstance(error, (AuthError, httpx.HTTPError)):
        logger.warning("%s: 인증·데이터 서비스에 연결하지 못함(%s)", context, kind)
        return service_unavailable()
    logger.error("%s: 예상하지 못한 오류 %s", context, kind)
    return internal_error()
