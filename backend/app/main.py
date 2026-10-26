"""백엔드 API와 기존 실습 웹페이지를 함께 제공합니다."""

import mimetypes
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from .config import AppConfig, ConfigHolder
from .dependencies import Services
from .errors import RequestIdMiddleware, register_error_handlers
from .security import SecurityHeadersMiddleware
from .routers import config as config_router
from .routers import me as me_router
from .routers import posts as posts_router
from .services.auth import SupabaseTokenVerifier, TokenVerifier
from .services.posts import PostStore, SupabasePostStore
from .services.profiles import ProfileStore, SupabaseProfileStore
from .services.supabase import LazyHttpClient

# 정적 파일의 Content-Type은 OS 설정(Windows 레지스트리)에서 읽는데, .js가 text/plain 등으로 설정된 PC에서는
# 브라우저가 ES 모듈 스크립트(type="module")를 거부하므로 고정합니다.
mimetypes.add_type("text/javascript", ".js")

# web 전체나 backend를 공개하면 .env와 소스가 노출되므로 frontend만 제공합니다.
FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"


@dataclass(frozen=True)
class Settings:
    frontend_dir: Path = FRONTEND_DIR


def create_app(
    settings: Settings | None = None,
    *,
    config: AppConfig | None = None,
    token_verifier: TokenVerifier | None = None,
    profile_store: ProfileStore | None = None,
    post_store: PostStore | None = None,
    http_client: httpx.Client | None = None,
) -> FastAPI:
    """앱을 만든다. 인자를 모두 생략하면 환경 변수와 `backend/.env`에서 설정을 처음 쓸 때 읽는다.

    config, token_verifier, profile_store, post_store, http_client는 테스트용이다(인증·DB 경계를 가짜로 바꾸거나 Supabase 요청을 가로챈다).
    http_client를 넘기지 않으면 Supabase 요청에 공유할 연결 풀을 만들고 서버가 끝날 때 닫는다.
    """
    settings = settings or Settings()
    owns_client = http_client is None
    shared_client = http_client if http_client is not None else LazyHttpClient()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        if owns_client:
            shared_client.close()

    app = FastAPI(title="알고리즘 학습 API", lifespan=lifespan)
    app.state.services = Services(
        config=ConfigHolder(config),
        verifier=token_verifier or SupabaseTokenVerifier(shared_client),
        profiles=profile_store or SupabaseProfileStore(shared_client),
        posts=post_store or SupabasePostStore(shared_client),
    )
    app.add_middleware(RequestIdMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    register_error_handlers(app)

    @app.get("/", include_in_schema=False)
    def home():
        return RedirectResponse(url="/web/html/index.html")

    @app.get("/api/health", tags=["상태"])
    def health():
        return {"status": "ok"}

    app.include_router(config_router.router)
    app.include_router(me_router.router)
    app.include_router(posts_router.router)

    # html 문서의 ../css, ../js, ../img 상대경로를 그대로 유지합니다.
    app.mount("/web", StaticFiles(directory=settings.frontend_dir), name="web")
    return app


app = create_app()
