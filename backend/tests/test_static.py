"""정적 웹 제공, 리다이렉트, 상태 확인, 비밀 파일 비공개를 검증한다."""

import asyncio
import http.client
import os
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import pytest

from app.main import FRONTEND_DIR, Settings, create_app

BACKEND_DIR = Path(__file__).resolve().parents[1]
HOME = "/web/html/index.html"


class _AssetRefs(HTMLParser):
    """페이지가 불러오는 자산(스타일·스크립트·이미지·오디오·파비콘)의 상대경로를 모은다."""

    def __init__(self):
        super().__init__()
        self.refs: list[str] = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "link" and attrs.get("href"):
            self.refs.append(attrs["href"])
        elif tag in ("script", "source", "img") and attrs.get("src"):
            self.refs.append(attrs["src"])
        if attrs.get("data-hover-image"):
            self.refs.append(attrs["data-hover-image"])


def local_asset_urls(page_url: str, html: str) -> list[str]:
    parser = _AssetRefs()
    parser.feed(html)
    return [
        urljoin(page_url, ref)
        for ref in parser.refs
        if not urlsplit(ref).scheme and not urlsplit(ref).netloc
    ]


def home_asset_urls() -> list[str]:
    html = (FRONTEND_DIR / "html" / "index.html").read_text(encoding="utf-8")
    return local_asset_urls(HOME, html)


def asgi_get(app, path: str) -> tuple[int, bytes]:
    """클라이언트가 경로를 정규화하지 않도록 ASGI scope를 직접 만들어 호출한다."""
    sent = []
    request_sent = False

    async def receive():
        # 실제 서버처럼 요청 본문을 한 번 전달한 뒤에는 연결이 끊길 때까지 대기한다.
        nonlocal request_sent
        if not request_sent:
            request_sent = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await asyncio.Event().wait()

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "GET",
        "scheme": "http", "path": path, "raw_path": path.encode(), "root_path": "",
        "query_string": b"", "headers": [(b"host", b"testserver")],
        "client": ("127.0.0.1", 50000), "server": ("testserver", 80),
    }
    asyncio.run(app(scope, receive, send))
    status = next(m["status"] for m in sent if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return status, body


def live_get(port: int, path: str) -> tuple[int, http.client.HTTPResponse, bytes]:
    """http.client는 경로를 그대로 보낸다(.. 와 %2e%2e 를 정규화하지 않는다)."""
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    try:
        conn.request("GET", path)
        resp = conn.getresponse()
        return resp.status, resp, resp.read()
    finally:
        conn.close()


# 비밀 파일과 백엔드 소스에 닿으려는 경로. 모두 공개되지 않아야 한다.
SECRET_PATHS = [
    "/web/backend/.env",
    "/web/.env",
    "/web/../backend/.env",
    "/web/%2e%2e/backend/.env",
    "/web/..%2fbackend%2f.env",
    "/web/..%5cbackend%5c.env",
    "/web/..\\backend\\.env",
    "/web/html/../../backend/.env",
    "/web/html/..%2f..%2fbackend%2f.env",
    "/web/../backend/app/main.py",
    "/backend/.env",
    "/.env",
    "/web/C:/Windows/win.ini",
]


# ---------- 인프로세스 ----------

def test_root_redirects_to_home(client):
    resp = client.get("/", follow_redirects=False)
    assert resp.status_code == 307
    assert resp.headers["location"] == HOME


def test_root_lands_on_home_page(client):
    resp = client.get("/")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/html")
    assert "<html" in resp.text


def test_health(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


@pytest.mark.parametrize(
    ("url", "content_types"),
    [
        (HOME, ("text/html",)),
        ("/web/css/style.css", ("text/css",)),
        # ES 모듈로 불러오는 스크립트는 JavaScript MIME이어야 브라우저가 실행한다.
        ("/web/js/comments.js", ("text/javascript",)),
        ("/web/js/compose.js", ("text/javascript",)),
        ("/web/js/site.js", ("text/javascript",)),
        ("/web/js/map.js", ("text/javascript",)),
        ("/web/js/trace-contract.js", ("text/javascript",)),
        ("/web/js/trace-validator.js", ("text/javascript",)),
        ("/web/js/trace-loader.js", ("text/javascript",)),
        ("/web/html/visualizer.html", ("text/html",)),
        ("/web/css/visualizer.css", ("text/css",)),
        ("/web/js/visualizer.js", ("text/javascript",)),
        ("/web/js/player-state.js", ("text/javascript",)),
        ("/web/js/controls.js", ("text/javascript",)),
        ("/web/js/language-select.js", ("text/javascript",)),
        ("/web/js/select-options.js", ("text/javascript",)),
        ("/web/js/focus-guard.js", ("text/javascript",)),
        ("/web/js/playback.js", ("text/javascript",)),
        ("/web/js/request-gate.js", ("text/javascript",)),
        ("/web/js/renderers/array.js", ("text/javascript",)),
        ("/web/js/renderers/index.js", ("text/javascript",)),
        ("/web/js/data/dfs/basic.json", ("application/json",)),
        ("/web/js/data/binary-search/basic.json", ("application/json",)),
        ("/web/js/data/bubble-sort/basic.json", ("application/json",)),
        ("/web/js/renderers/code.js", ("text/javascript",)),
        ("/web/js/renderers/graph.js", ("text/javascript",)),
        ("/web/js/data/catalog.json", ("application/json",)),
        ("/web/js/data/bfs/diamond.json", ("application/json",)),
        ("/web/img/favicon.svg", ("image/svg+xml",)),
        ("/web/img/favicon-32.png", ("image/png",)),
        ("/web/img/favicon-16.png", ("image/png",)),
        ("/web/img/apple-touch-icon.png", ("image/png",)),
    ],
)
def test_static_assets_are_served(client, url, content_types):
    resp = client.get(url)
    assert resp.status_code == 200
    assert resp.headers["content-type"].split(";")[0] in content_types
    on_disk = FRONTEND_DIR / url.removeprefix("/web/")
    assert resp.content == on_disk.read_bytes()


def test_home_page_asset_paths_resolve(client):
    urls = home_asset_urls()
    # 파싱이 실패해 빈 목록을 통과시키지 않도록 알려진 자산을 확인한다.
    assert "/web/css/style.css" in urls
    assert "/web/js/site.js" in urls
    assert not any("bgm" in url for url in urls)
    assert all(url.startswith("/web/") for url in urls)
    for url in urls:
        assert client.get(url).status_code == 200, url


def test_works_without_supabase_settings(client):
    """Supabase 환경변수가 없어도 정적 웹과 health가 동작한다."""
    assert client.get("/api/health").status_code == 200
    assert client.get(HOME).status_code == 200


def test_importing_app_does_not_load_supabase():
    """서버 시작 경로가 Supabase 패키지·설정에 의존하지 않는다."""
    code = (
        "import sys; import app.main; "
        "loaded = [n for n in ('supabase', 'supabase_auth', 'postgrest') if n in sys.modules]; "
        "assert not loaded, f'Supabase 패키지를 불러왔습니다: {loaded}'"
    )
    env = {k: v for k, v in os.environ.items() if not k.startswith("SUPABASE_")}
    result = subprocess.run(
        [sys.executable, "-c", code], cwd=BACKEND_DIR, env=env,
        capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("path", SECRET_PATHS)
def test_secret_paths_are_not_served(tmp_path, path):
    """frontend 밖의 파일은 경로 조작으로도 읽을 수 없다. 합성 디렉터리에 표식 값을 둔다."""
    sentinel = b"SENTINEL-SECRET-VALUE"
    (tmp_path / "frontend" / "html").mkdir(parents=True)
    (tmp_path / "frontend" / "html" / "index.html").write_text("<html></html>", encoding="utf-8")
    (tmp_path / "backend" / "app").mkdir(parents=True)
    (tmp_path / "backend" / ".env").write_bytes(b"KEY=" + sentinel)
    (tmp_path / "backend" / "app" / "main.py").write_bytes(b"# " + sentinel)
    (tmp_path / ".env").write_bytes(b"KEY=" + sentinel)

    app = create_app(Settings(frontend_dir=tmp_path / "frontend"))
    status, body = asgi_get(app, path)
    assert status == 404
    assert sentinel not in body


def test_factory_serves_the_given_frontend_dir(tmp_path):
    (tmp_path / "page.txt").write_text("custom", encoding="utf-8")
    status, body = asgi_get(create_app(Settings(frontend_dir=tmp_path)), "/web/page.txt")
    assert (status, body) == (200, b"custom")


# ---------- 실제 Uvicorn 프로세스 ----------

def test_live_root_redirect_and_health(live_server):
    status, resp, _ = live_get(live_server, "/")
    assert status == 307
    assert resp.getheader("location") == HOME
    status, _, body = live_get(live_server, "/api/health")
    assert status == 200
    assert body == b'{"status":"ok"}'


def test_live_home_page_and_relative_assets(live_server):
    status, resp, body = live_get(live_server, HOME)
    assert status == 200
    assert resp.getheader("content-type").startswith("text/html")
    assert b"<html" in body
    urls = home_asset_urls()
    assert "/web/css/style.css" in urls
    for url in urls:
        assert live_get(live_server, url)[0] == 200, url


@pytest.mark.parametrize("path", SECRET_PATHS)
def test_live_secret_paths_are_not_served(live_server, path):
    status, _, body = live_get(live_server, path)
    assert status == 404
    assert b"SUPABASE_" not in body
