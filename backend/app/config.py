"""환경 설정. 공개해도 되는 값(URL, Publishable key, 앱 주소)과 서버 전용 값(Secret key)을 구분한다.

값은 실제 환경 변수 → `backend/.env` 순으로 찾는다(환경 변수가 우선). `.env`는 `dotenv_values`로 읽기만 하고 `os.environ`을 바꾸지 않는다.
테스트나 다른 실행 환경에서 `.env`를 읽지 않으려면 `APP_ENV_FILE`을 빈 값으로 두고, 다른 파일을 쓰려면 그 경로를 적는다.

`SUPABASE_PUBLISHABLE_KEY`에 서버 전용 키(`sb_secret_…` 또는 role이 service_role인 옛 JWT)를 잘못 넣어도 `/api/config`로 나가지 않도록,
Publishable key 형식이 아니면 설정이 잘못된 것으로 보고 인증을 끈다(값은 로그에 남기지 않는다).
"""

import base64
import json
import logging
import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import dotenv_values

logger = logging.getLogger("app.config")

BACKEND_DIR = Path(__file__).resolve().parents[1]
DEFAULT_ENV_FILE = BACKEND_DIR / ".env"
ENV_NAMES = ("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "APP_ORIGIN")


def _clean(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def _valid_http_url(value: str, *, origin_only: bool) -> bool:
    """http(s) 주소인지. origin_only이면 경로·쿼리·조각이 없어야 한다."""
    try:
        parts = urlsplit(value)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            return False
        parts.port  # 잘못된 포트 번호면 ValueError
    except ValueError:
        return False
    if parts.username or parts.password:
        return False
    if origin_only:
        return parts.path in ("", "/") and not parts.query and not parts.fragment
    return not parts.query and not parts.fragment


def _jwt_role(token: str) -> str | None:
    """서명을 검증하지 않고 JWT 본문의 role만 읽는다(형식 점검용이며 신뢰 판단에 쓰지 않는다)."""
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        role = json.loads(base64.urlsafe_b64decode(payload)).get("role")
        return role if isinstance(role, str) else None
    except (IndexError, ValueError, UnicodeDecodeError, AttributeError):
        return None


def is_publishable_key(value: str) -> bool:
    """브라우저에 줘도 되는 키인지. 새 형식(`sb_publishable_…`)이거나 role이 anon인 옛 JWT만 허용한다."""
    if value.startswith("sb_publishable_"):
        return len(value) > len("sb_publishable_")
    if value.startswith("sb_"):
        return False  # sb_secret_ 등 다른 종류
    return value.count(".") == 2 and _jwt_role(value) == "anon"


@dataclass(frozen=True)
class AppConfig:
    """검증을 마친 설정. 키는 repr에 나오지 않는다."""

    supabase_url: str | None = None
    supabase_publishable_key: str | None = field(default=None, repr=False)
    app_origin: str | None = None
    supabase_secret_key: str | None = field(default=None, repr=False)

    @property
    def auth_enabled(self) -> bool:
        return None not in (self.supabase_url, self.supabase_publishable_key, self.app_origin)

    def public(self) -> dict[str, str | bool | None]:
        """`GET /api/config` 본문. 세 값이 모두 있을 때만 값을 주고, 하나라도 없으면 모두 null이다. Secret key는 절대 넣지 않는다."""
        if not self.auth_enabled:
            return {"supabase_url": None, "supabase_publishable_key": None, "app_origin": None, "auth_enabled": False}
        return {
            "supabase_url": self.supabase_url,
            "supabase_publishable_key": self.supabase_publishable_key,
            "app_origin": self.app_origin,
            "auth_enabled": True,
        }

    @classmethod
    def from_values(cls, values: Mapping[str, str | None]) -> "AppConfig":
        """이름 → 값 목록에서 설정을 만든다. 잘못된 값은 없는 것으로 취급하고 이유(변수 이름만)를 로그에 남긴다."""
        url = _clean(values.get("SUPABASE_URL"))
        key = _clean(values.get("SUPABASE_PUBLISHABLE_KEY"))
        origin = _clean(values.get("APP_ORIGIN"))
        secret = _clean(values.get("SUPABASE_SECRET_KEY"))

        if url is not None and not _valid_http_url(url, origin_only=False):
            logger.warning("SUPABASE_URL 형식이 올바르지 않아 인증을 사용하지 않습니다(http 또는 https 주소여야 합니다).")
            url = None
        if key is not None and not is_publishable_key(key):
            logger.warning("SUPABASE_PUBLISHABLE_KEY가 Publishable key 형식이 아니어서 인증을 사용하지 않습니다(서버 전용 키를 넣지 않았는지 확인하세요).")
            key = None
        if origin is not None:
            if _valid_http_url(origin, origin_only=True):
                origin = origin.rstrip("/")
            else:
                logger.warning("APP_ORIGIN 형식이 올바르지 않아 인증을 사용하지 않습니다(예: http://127.0.0.1:8000, 경로 없이).")
                origin = None
        if url is not None:
            url = url.rstrip("/")
        config = cls(supabase_url=url, supabase_publishable_key=key, app_origin=origin, supabase_secret_key=secret)
        if not config.auth_enabled:
            missing = [name for name, value in (("SUPABASE_URL", url), ("SUPABASE_PUBLISHABLE_KEY", key), ("APP_ORIGIN", origin)) if value is None]
            logger.info("인증 설정이 모두 갖춰지지 않아 인증 기능을 끕니다. 없거나 잘못된 항목: %s", ", ".join(missing))
        return config


def load_config(environ: Mapping[str, str] | None = None) -> AppConfig:
    """환경 변수(우선)와 `.env`에서 설정을 읽는다. 아무것도 바꾸지 않는다."""
    environ = os.environ if environ is None else environ
    env_file = environ.get("APP_ENV_FILE")
    path = DEFAULT_ENV_FILE if env_file is None else (Path(env_file) if env_file.strip() else None)
    values: dict[str, str | None] = {}
    if path is not None and path.is_file():
        values.update({name: value for name, value in dotenv_values(path).items() if name in ENV_NAMES})
    # 비어 있는 환경 변수는 "설정 안 함"으로 보고 `.env`의 값을 덮어쓰지 않는다.
    values.update({name: environ[name] for name in ENV_NAMES if name in environ and environ[name].strip()})
    return AppConfig.from_values(values)


class ConfigHolder:
    """설정을 처음 쓸 때 한 번 읽어 보관한다(서버를 다시 시작해야 `.env` 변경이 반영된다). 테스트는 값을 직접 넣을 수 있다."""

    def __init__(self, config: AppConfig | None = None):
        self._config = config

    def get(self) -> AppConfig:
        if self._config is None:
            self._config = load_config()
        return self._config
