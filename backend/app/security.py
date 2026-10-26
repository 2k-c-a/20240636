"""학습 화면·인증 콜백의 리소스 범위와 공통 HTTP 보안 헤더."""

import re
from urllib.parse import urlsplit

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import AppConfig


def connection_sources(config: AppConfig | None) -> list[str]:
    if config is None or not config.auth_enabled or not config.supabase_url:
        return []
    try:
        url = urlsplit(config.supabase_url)
        if url.scheme not in ("https", "http") or url.username or url.password or not url.hostname:
            return []
        host = url.hostname.encode("idna").decode("ascii")
        if ":" in host:
            host = f"[{host}]"
        if not re.fullmatch(r"[a-zA-Z0-9.-]+|\[[0-9a-fA-F:]+\]", host):
            return []
        authority = host + (f":{url.port}" if url.port else "")
    except (ValueError, UnicodeError):
        return []
    return [f"{url.scheme}://{authority}", f"{'wss' if url.scheme == 'https' else 'ws'}://{authority}"]


def security_headers(config: AppConfig | None = None, *, map_page: bool = False) -> dict[str, str]:
    connections = " ".join(["'self'", *connection_sources(config)])
    frames = "https://maps.google.com https://www.google.com" if map_page else "'none'"
    policy = (
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
        f"connect-src {connections}; frame-src {frames}; "
        "media-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; "
        "form-action 'self'; frame-ancestors 'none'"
    )
    return {
        "Content-Security-Policy": policy,
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    }


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        # 실제 비밀 키를 정책에 쓰지 않는다. 외부 연결 주소는 설정된 URL의 origin만 사용한다.
        config = scope["app"].state.services.config.get() if path.startswith("/web/") and path.endswith(".html") else None
        values = security_headers(config, map_page=path == "/web/html/map.html")
        # FastAPI 개발 문서는 CDN과 생성된 inline script를 사용하므로 사이트 CSP와 분리한다.
        if path in ("/docs", "/redoc", "/docs/oauth2-redirect"):
            values.pop("Content-Security-Policy")

        async def send_secure(message: Message) -> None:
            if message["type"] == "http.response.start":
                replaced = {key.lower().encode() for key in values}
                headers = [(key, value) for key, value in message.get("headers", []) if key.lower() not in replaced]
                headers.extend((key.encode("ascii"), value.encode("ascii")) for key, value in values.items())
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_secure)
