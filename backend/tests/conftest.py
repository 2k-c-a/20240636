"""테스트 공통 설정. 실제 .env나 Supabase에는 접근하지 않는다."""

import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _env_without_supabase() -> dict[str, str]:
    """Supabase·앱 설정 환경 변수를 뺀 환경. `.env` 파일도 읽지 않게 한다(APP_ENV_FILE을 빈 값으로)."""
    env = {k: v for k, v in os.environ.items() if not k.startswith(("SUPABASE_", "APP_"))}
    env["APP_ENV_FILE"] = ""
    return env


@pytest.fixture(autouse=True)
def no_supabase_env(monkeypatch):
    """Supabase 설정이 없는 상태를 기본으로 하고 실제 backend/.env를 읽지 않게 한다."""
    for name in list(os.environ):
        if name.startswith(("SUPABASE_", "APP_")):
            monkeypatch.delenv(name)
    monkeypatch.setenv("APP_ENV_FILE", "")


@pytest.fixture
def client():
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def live_server(tmp_path_factory):
    """실제 Uvicorn 프로세스를 띄우고 포트를 돌려준다. Supabase 환경변수는 넘기지 않는다."""
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]

    log_path = tmp_path_factory.mktemp("uvicorn") / "uvicorn.log"
    with open(log_path, "wb") as log:
        proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
            cwd=BACKEND_DIR,
            env=_env_without_supabase(),
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        try:
            deadline = time.monotonic() + 20
            while True:
                if proc.poll() is not None:
                    pytest.fail(f"uvicorn이 종료되었습니다:\n{log_path.read_text(errors='replace')}")
                try:
                    urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1).close()
                    break
                except OSError:
                    if time.monotonic() > deadline:
                        pytest.fail(f"uvicorn이 시간 안에 시작되지 않았습니다:\n{log_path.read_text(errors='replace')}")
                    time.sleep(0.2)
            yield port
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()


# ---------------------------------------------------------------------------------------------
# 인증·프로필 테스트용 공통 도구. 인증(Supabase Auth)과 DB 경계는 가짜로 바꾸고, 설정 값은 표식 문자열을 쓴다.
# ---------------------------------------------------------------------------------------------
from datetime import datetime, timedelta, timezone  # noqa: E402

from app.config import AppConfig  # noqa: E402
from app.errors import ApiError  # noqa: E402
from app.schemas.profile import Profile  # noqa: E402
from app.schemas.user import VerifiedUser  # noqa: E402

TEST_URL = "https://example-project.supabase.co"
TEST_PUBLISHABLE_KEY = "sb_publishable_TESTKEY0123456789abcdef"
TEST_SECRET_KEY = "sb_secret_SENTINEL-NEVER-LEAK-0123456789abcdef"
TEST_ORIGIN = "http://127.0.0.1:8000"

USER_A = VerifiedUser(id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email="a@example.test")
USER_B = VerifiedUser(id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", email="b@example.test")
TOKEN_A = "token-for-user-a.SENTINEL-A"
TOKEN_B = "token-for-user-b.SENTINEL-B"


@pytest.fixture
def auth_config() -> AppConfig:
    """인증이 켜진 설정. Secret key도 넣어 두어 어디에도 새지 않는지 함께 확인한다."""
    return AppConfig(
        supabase_url=TEST_URL,
        supabase_publishable_key=TEST_PUBLISHABLE_KEY,
        app_origin=TEST_ORIGIN,
        supabase_secret_key=TEST_SECRET_KEY,
    )


class FakeVerifier:
    """토큰 → 사용자(또는 던질 오류) 표. 호출 기록을 남긴다."""

    def __init__(self, table=None):
        self.table = dict(table or {TOKEN_A: USER_A, TOKEN_B: USER_B})
        self.calls: list[str] = []

    def verify(self, config, token):
        self.calls.append(token)
        outcome = self.table.get(token)
        if outcome is None:
            from app.errors import invalid_token

            raise invalid_token()
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


class FakeProfileStore:
    """메모리 프로필 저장소. 실제 DB의 규칙(이미 있으면 덮어쓰지 않음, 없으면 수정 불가)을 흉내 내고 호출 기록을 남긴다."""

    def __init__(self):
        self.rows: dict[str, Profile] = {}
        self.calls: list[tuple] = []
        self.fail_with: BaseException | None = None
        self._clock = datetime(2026, 10, 14, 5, 30, tzinfo=timezone.utc)

    def _now(self) -> datetime:
        self._clock += timedelta(seconds=1)
        return self._clock

    def _maybe_fail(self):
        if self.fail_with is not None:
            raise self.fail_with

    def get(self, config, token, user_id):
        self.calls.append(("get", token, user_id))
        self._maybe_fail()
        return self.rows.get(user_id)

    def create_if_absent(self, config, token, user_id, nickname):
        self.calls.append(("create", token, user_id, nickname))
        self._maybe_fail()
        if user_id in self.rows:
            return self.rows[user_id], False
        now = self._now()
        self.rows[user_id] = Profile(id=user_id, nickname=nickname, created_at=now, updated_at=now)
        return self.rows[user_id], True

    def update(self, config, token, user_id, nickname):
        self.calls.append(("update", token, user_id, nickname))
        self._maybe_fail()
        row = self.rows.get(user_id)
        if row is None:
            return None
        self.rows[user_id] = row.model_copy(update={"nickname": nickname, "updated_at": self._now()})
        return self.rows[user_id]


@pytest.fixture
def verifier() -> FakeVerifier:
    return FakeVerifier()


@pytest.fixture
def store() -> FakeProfileStore:
    return FakeProfileStore()


@pytest.fixture
def post_store():
    from fake_posts import FakePostStore

    return FakePostStore()


@pytest.fixture
def auth_client(auth_config, verifier, store, post_store):
    """인증이 켜져 있고 토큰 검증기·프로필·글 저장소가 가짜인 앱의 클라이언트(서버 오류를 예외로 올리지 않고 응답으로 받는다)."""
    app = create_app(config=auth_config, token_verifier=verifier, profile_store=store, post_store=post_store)
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
