"""실제 uvicorn 서버 + 실제 소켓으로 열린 가짜 Supabase 서버로 끝까지 확인한다(외부 인터넷에는 접속하지 않는다).

앱은 환경 변수로 가짜 서버 주소를 받는다. 요청은 uvicorn → FastAPI → supabase 라이브러리 → 실제 HTTP → 가짜 서버 순서로 흐른다.
마지막 테스트는 가짜 서버를 끄므로 파일의 맨 끝에 둔다.
"""

import http.client
import json
import os
import socket
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx
import pytest

from conftest import TEST_PUBLISHABLE_KEY, TEST_SECRET_KEY, TOKEN_A, TOKEN_B, USER_A, USER_B
from fake_supabase import FakeSupabase

BACKEND_DIR = Path(__file__).resolve().parents[1]


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class Stub:
    """가짜 Supabase를 실제 포트로 연다. 받은 HTTP 요청을 `FakeSupabase.handle`에 넘겨 같은 규칙으로 답한다."""

    def __init__(self, fake: FakeSupabase):
        self.fake = fake
        self.port = free_port()
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def _serve(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length) if length else b""
                request = httpx.Request(self.command, f"http://127.0.0.1:{stub.port}{self.path}", headers=list(self.headers.items()), content=body)
                response = stub.fake.handle(request)
                self.send_response(response.status_code)
                self.send_header("Content-Type", response.headers.get("content-type", "application/json"))
                self.send_header("Content-Length", str(len(response.content)))
                self.end_headers()
                self.wfile.write(response.content)

            do_GET = do_POST = do_PATCH = _serve

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", self.port), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()


class Live:
    def __init__(self, port: int, stub: Stub, log_path: Path):
        self.port, self.stub, self.log_path = port, stub, log_path

    def call(self, method: str, path: str, *, token: str | None = None, body=None, raw: bytes | None = None, headers: dict | None = None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        try:
            send = dict(headers or {})
            if token:
                send["Authorization"] = f"Bearer {token}"
            payload = raw
            if body is not None:
                payload = json.dumps(body).encode()
                send["Content-Type"] = "application/json"
            connection.request(method, path, body=payload, headers=send)
            response = connection.getresponse()
            data = response.read()
            parsed = json.loads(data) if data and response.getheader("content-type", "").startswith("application/json") else data.decode("utf-8", "replace")
            return response.status, {k.lower(): v for k, v in response.getheaders()}, parsed
        finally:
            connection.close()


@pytest.fixture(scope="module")
def live(tmp_path_factory):
    fake = FakeSupabase()
    stub = Stub(fake)
    port = free_port()
    env = {k: v for k, v in os.environ.items() if not k.startswith(("SUPABASE_", "APP_"))}
    env.update(
        APP_ENV_FILE="",
        SUPABASE_URL=f"http://127.0.0.1:{stub.port}",
        SUPABASE_PUBLISHABLE_KEY=TEST_PUBLISHABLE_KEY,
        SUPABASE_SECRET_KEY=TEST_SECRET_KEY,
        APP_ORIGIN=f"http://127.0.0.1:{port}",
    )
    log_path = tmp_path_factory.mktemp("live") / "uvicorn.log"
    with open(log_path, "wb") as log:
        proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)], cwd=BACKEND_DIR, env=env, stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 30
            while True:
                if proc.poll() is not None:
                    pytest.fail(f"uvicorn이 종료되었습니다:\n{log_path.read_text(errors='replace')}")
                try:
                    http.client.HTTPConnection("127.0.0.1", port, timeout=1).request("GET", "/api/health")
                    break
                except OSError:
                    if time.monotonic() > deadline:
                        pytest.fail("uvicorn이 시간 안에 시작되지 않았습니다")
                    time.sleep(0.2)
            yield Live(port, stub, log_path)
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
            try:
                stub.stop()
            except Exception:  # 마지막 테스트가 이미 껐을 수 있다
                pass


def test_public_config_comes_from_the_environment_and_has_no_secret(live):
    status, headers, body = live.call("GET", "/api/config")
    assert status == 200 and headers["cache-control"] == "no-store"
    assert body == {"supabase_url": f"http://127.0.0.1:{live.stub.port}", "supabase_publishable_key": TEST_PUBLISHABLE_KEY, "app_origin": f"http://127.0.0.1:{live.port}", "auth_enabled": True}
    assert TEST_SECRET_KEY not in json.dumps(body)


def test_real_server_authentication_outcomes(live):
    status, _, body = live.call("GET", "/api/me")
    assert (status, body["error"]["code"]) == (401, "unauthenticated")
    status, headers, body = live.call("GET", "/api/me", token="forged-token")
    assert (status, body["error"]["code"]) == (401, "invalid_token")
    assert body["error"]["request_id"] == headers["x-request-id"]
    status, _, body = live.call("GET", "/api/me", token=TOKEN_A)
    assert (status, body) == (200, {"id": USER_A.id, "email": USER_A.email, "nickname": None})


def test_real_server_profile_flow_and_validation(live):
    status, _, created = live.call("POST", "/api/me/profile", token=TOKEN_A, body={"nickname": "  앨리스  "})
    assert status == 201 and created["nickname"] == "앨리스" and created["id"] == USER_A.id
    assert created["created_at"].endswith("Z")
    status, _, again = live.call("POST", "/api/me/profile", token=TOKEN_A, body={"nickname": "덮어쓰기"})
    assert (status, again["nickname"]) == (200, "앨리스")
    status, _, changed = live.call("PATCH", "/api/me/profile", token=TOKEN_A, body={"nickname": "새이름"})
    assert (status, changed["nickname"]) == (200, "새이름")
    assert live.call("PATCH", "/api/me/profile", token=TOKEN_B, body={"nickname": "프로필없음"})[0] == 404
    status, _, error = live.call("POST", "/api/me/profile", token=TOKEN_B, body={"nickname": "가"})
    assert status == 422 and error["error"]["fields"] == {"nickname": "닉네임은 2~20자여야 합니다."}
    status, _, error = live.call("POST", "/api/me/profile", token=TOKEN_B, body={"nickname": "밥밥", "id": USER_A.id})
    assert status == 422 and error["error"]["fields"] == {"id": "허용되지 않는 항목입니다."}
    assert live.call("POST", "/api/me/profile", raw=b"{bad", headers={"Content-Type": "application/json"})[0] == 401  # 인증이 먼저
    assert live.call("POST", "/api/me/profile", token=TOKEN_B, raw=b"{bad", headers={"Content-Type": "application/json"})[0] == 422
    assert live.stub.fake.rows[USER_A.id]["nickname"] == "새이름"
    assert USER_B.id not in live.stub.fake.rows


def test_real_server_keeps_two_users_apart_under_concurrent_requests(live):
    def work(index: int):
        token, user = (TOKEN_A, USER_A) if index % 2 == 0 else (TOKEN_B, USER_B)
        status, _, body = live.call("GET", "/api/me", token=token)
        assert (status, body["id"]) == (200, user.id), (index, body)
        return user.id

    live.call("POST", "/api/me/profile", token=TOKEN_B, body={"nickname": "밥밥"})
    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(work, range(120)))
    assert results.count(USER_A.id) == results.count(USER_B.id) == 60
    assert live.stub.fake.violations == []


def test_what_the_real_server_sent_to_supabase(live):
    sent = json.dumps(live.stub.fake.requests, ensure_ascii=False)
    assert TEST_SECRET_KEY not in sent and "SENTINEL-NEVER-LEAK" not in sent
    for request in live.stub.fake.requests:
        assert request["headers"]["apikey"] == TEST_PUBLISHABLE_KEY
        assert request["headers"]["authorization"].removeprefix("Bearer ") in {TOKEN_A, TOKEN_B, "forged-token"}
    assert any(r["method"] == "POST" and r["headers"]["prefer"].count("ignore-duplicates") for r in live.stub.fake.requests)
    assert all(r["method"] != "DELETE" for r in live.stub.fake.requests)


def test_server_log_has_no_tokens_or_keys(live):
    log = live.log_path.read_text(errors="replace")
    for secret in (TEST_SECRET_KEY, "SENTINEL-NEVER-LEAK", TOKEN_A, TOKEN_B, "SENTINEL-A", "SENTINEL-B", "forged-token"):
        assert secret not in log, secret


def test_static_pages_and_health_do_not_depend_on_supabase(live):
    assert live.call("GET", "/api/health")[2] == {"status": "ok"}
    assert live.call("GET", "/web/html/visualizer.html")[0] == 200


def test_supabase_outage_gives_503_for_auth_only_and_learning_pages_keep_working(live):
    live.stub.stop()  # 이 뒤로는 가짜 Supabase가 없다(마지막 테스트)
    status, _, body = live.call("GET", "/api/me", token=TOKEN_A)
    assert (status, body["error"]["code"]) == (503, "service_unavailable")
    assert live.call("POST", "/api/me/profile", token=TOKEN_A, body={"nickname": "앨리스"})[0] == 503
    assert live.call("GET", "/api/health")[0] == 200
    assert live.call("GET", "/web/html/visualizer.html")[0] == 200
    assert live.call("GET", "/web/js/data/catalog.json")[0] == 200
    assert live.call("GET", "/api/config")[2]["auth_enabled"] is True  # 설정은 그대로 알려 준다
