"""라우터가 쓰는 의존성: 설정, 서비스, 현재 사용자.

- 서비스(토큰 검증기, 프로필 저장소, 글 저장소)와 설정은 `app.state`에 둔다. 테스트는 `create_app(...)`으로 가짜를 끼운다.
- 현재 사용자는 그 요청의 `Authorization: Bearer <토큰>`을 Supabase Auth로 확인한 결과다. 사용자 ID·권한은 이 값에서만 얻는다.
  검사 순서: 인증 설정 없음(503 `auth_not_configured`) → 헤더 없음(401 `unauthenticated`) → 형식·검증 실패(401 `invalid_token`) → 판정 불가(503 `service_unavailable`).
"""

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request
from starlette.concurrency import run_in_threadpool

from .config import AppConfig, ConfigHolder
from .errors import auth_not_configured, invalid_token, unauthenticated
from .schemas.user import VerifiedUser
from .services.auth import TokenVerifier
from .services.posts import PostStore
from .services.profiles import ProfileStore

MAX_TOKEN_LENGTH = 4096


@dataclass(frozen=True)
class Services:
    config: ConfigHolder
    verifier: TokenVerifier
    profiles: ProfileStore
    posts: PostStore


def get_services(request: Request) -> Services:
    return request.app.state.services


def get_config(services: Annotated[Services, Depends(get_services)]) -> AppConfig:
    return services.config.get()


def extract_bearer_token(authorization: str | None) -> str:
    """`Authorization` 헤더에서 토큰을 꺼낸다. 헤더가 없으면 401 unauthenticated, 형식이 틀리면 401 invalid_token."""
    if authorization is None or not authorization.strip():
        raise unauthenticated()
    scheme, _, rest = authorization.strip().partition(" ")
    token = rest.strip()
    # HTTP 헤더에 넣을 수 없는 제어 문자·비 ASCII는 외부 서비스를 부르기 전에 잘못된 토큰으로 거부한다.
    if scheme.lower() != "bearer" or not token or any(not 33 <= ord(ch) <= 126 for ch in token) or len(token) > MAX_TOKEN_LENGTH:
        raise invalid_token()
    return token


@dataclass(frozen=True)
class CurrentUser:
    """검증된 사용자와 그 요청의 토큰. 토큰은 같은 요청 안에서 사용자 권한으로 DB를 부를 때만 쓰며 기록하지 않는다."""

    user: VerifiedUser
    token: str

    def __repr__(self) -> str:  # 로그나 예외 메시지에 토큰이 새지 않게 한다
        return f"CurrentUser(user={self.user!r}, token=<숨김>)"


async def get_current_user(
    request: Request,
    services: Annotated[Services, Depends(get_services)],
) -> CurrentUser:
    config = services.config.get()
    if not config.auth_enabled:
        raise auth_not_configured()
    token = extract_bearer_token(request.headers.get("authorization"))
    user = await run_in_threadpool(services.verifier.verify, config, token)
    return CurrentUser(user=user, token=token)
