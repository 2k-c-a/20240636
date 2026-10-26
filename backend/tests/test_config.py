"""공개 설정(`GET /api/config`)과 설정 읽기. Secret key와 잘못 넣은 키가 어디로도 나가지 않는지 확인한다."""

import base64
import json
import logging
import os

import pytest
from fastapi.testclient import TestClient

from app.config import AppConfig, ConfigHolder, is_publishable_key, load_config
from app.main import create_app

from conftest import TEST_ORIGIN, TEST_PUBLISHABLE_KEY, TEST_SECRET_KEY, TEST_URL

CONFIG_KEYS = {"supabase_url", "supabase_publishable_key", "app_origin", "auth_enabled"}
DISABLED = {"supabase_url": None, "supabase_publishable_key": None, "app_origin": None, "auth_enabled": False}


def jwt_with_role(role: str) -> str:
    """서명이 없는 형식 점검용 JWT(role만 다르다). 실제 키가 아니다."""
    def part(data: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")

    return f"{part({'alg': 'HS256', 'typ': 'JWT'})}.{part({'role': role})}.signature"


def test_unconfigured_server_says_so_with_null_values(client):
    response = client.get("/api/config")
    assert response.status_code == 200
    assert response.json() == DISABLED
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-request-id"]


def test_configured_server_returns_exactly_the_public_values(auth_config):
    with TestClient(create_app(config=auth_config)) as client:
        response = client.get("/api/config")
    assert response.status_code == 200
    assert response.json() == {
        "supabase_url": TEST_URL,
        "supabase_publishable_key": TEST_PUBLISHABLE_KEY,
        "app_origin": TEST_ORIGIN,
        "auth_enabled": True,
    }
    assert set(response.json()) == CONFIG_KEYS
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("missing", ["supabase_url", "supabase_publishable_key", "app_origin"])
def test_a_missing_value_disables_auth_and_exposes_nothing_partial(auth_config, missing):
    values = {"supabase_url": TEST_URL, "supabase_publishable_key": TEST_PUBLISHABLE_KEY, "app_origin": TEST_ORIGIN, "supabase_secret_key": TEST_SECRET_KEY}
    values[missing] = None
    with TestClient(create_app(config=AppConfig(**values))) as client:
        response = client.get("/api/config")
    assert response.json() == DISABLED  # 일부만 노출하지 않는다


def test_secret_key_never_appears_in_responses_or_logs(auth_config, caplog):
    caplog.set_level(logging.DEBUG)
    with TestClient(create_app(config=auth_config), raise_server_exceptions=False) as client:
        responses = [client.get(path) for path in ["/api/config", "/api/health", "/openapi.json", "/docs", "/api/me", "/api/nope"]]
        responses.append(client.post("/api/me/profile", json={"nickname": "x"}))
    for response in responses:
        assert TEST_SECRET_KEY not in response.text
        assert TEST_SECRET_KEY not in str(dict(response.headers))
    assert TEST_SECRET_KEY not in caplog.text
    assert "SENTINEL-NEVER-LEAK" not in caplog.text
    assert TEST_SECRET_KEY not in repr(auth_config)
    assert TEST_PUBLISHABLE_KEY not in repr(auth_config)  # 키는 repr에도 나오지 않는다


@pytest.mark.parametrize("wrong_key", [
    TEST_SECRET_KEY,                          # 서버 전용 새 형식 키
    "sb_secret_anything",
    jwt_with_role("service_role"),            # 옛 형식의 서버 전용 JWT
    jwt_with_role("authenticated"),           # 사용자 JWT도 공개 키가 아니다
    "plain-random-string",
    "a.b.c",
    "sb_publishable_",                        # 접두어만 있는 값
])
def test_a_wrong_kind_of_key_in_the_publishable_slot_disables_auth_and_is_never_returned(wrong_key, caplog):
    caplog.set_level(logging.DEBUG)
    config = AppConfig.from_values({"SUPABASE_URL": TEST_URL, "SUPABASE_PUBLISHABLE_KEY": wrong_key, "APP_ORIGIN": TEST_ORIGIN})
    assert not config.auth_enabled
    with TestClient(create_app(config=config)) as client:
        response = client.get("/api/config")
    assert response.json() == DISABLED
    assert wrong_key not in response.text
    assert wrong_key not in caplog.text  # 로그에는 변수 이름만 남기고 값은 남기지 않는다
    assert "SUPABASE_PUBLISHABLE_KEY" in caplog.text


@pytest.mark.parametrize("good_key", ["sb_publishable_abc123", jwt_with_role("anon")])
def test_publishable_keys_are_accepted(good_key):
    assert is_publishable_key(good_key)
    config = AppConfig.from_values({"SUPABASE_URL": TEST_URL, "SUPABASE_PUBLISHABLE_KEY": good_key, "APP_ORIGIN": TEST_ORIGIN})
    assert config.auth_enabled
    assert config.public()["supabase_publishable_key"] == good_key


@pytest.mark.parametrize("url", ["example.supabase.co", "ftp://example.supabase.co", "https://", "https://u:p@example.supabase.co", "https://example.supabase.co/?x=1", "javascript:alert(1)", "", "   "])
def test_invalid_supabase_urls_disable_auth(url):
    config = AppConfig.from_values({"SUPABASE_URL": url, "SUPABASE_PUBLISHABLE_KEY": TEST_PUBLISHABLE_KEY, "APP_ORIGIN": TEST_ORIGIN})
    assert not config.auth_enabled
    assert config.public() == DISABLED


@pytest.mark.parametrize("origin", ["127.0.0.1:8000", "http://127.0.0.1:8000/web", "http://127.0.0.1:8000/?a=1", "http://127.0.0.1:99999", "file:///etc/passwd", "http://user@127.0.0.1:8000"])
def test_invalid_app_origins_disable_auth(origin):
    config = AppConfig.from_values({"SUPABASE_URL": TEST_URL, "SUPABASE_PUBLISHABLE_KEY": TEST_PUBLISHABLE_KEY, "APP_ORIGIN": origin})
    assert not config.auth_enabled


def test_trailing_slashes_are_trimmed_and_whitespace_ignored():
    config = AppConfig.from_values({"SUPABASE_URL": f"  {TEST_URL}/  ", "SUPABASE_PUBLISHABLE_KEY": f" {TEST_PUBLISHABLE_KEY} ", "APP_ORIGIN": f"{TEST_ORIGIN}/"})
    assert config.public() == {"supabase_url": TEST_URL, "supabase_publishable_key": TEST_PUBLISHABLE_KEY, "app_origin": TEST_ORIGIN, "auth_enabled": True}


def test_environment_variables_beat_the_env_file_and_nothing_is_modified(tmp_path, monkeypatch):
    env_file = tmp_path / "test.env"
    env_file.write_text(
        f"SUPABASE_URL=https://from-file.supabase.co\nSUPABASE_PUBLISHABLE_KEY={TEST_PUBLISHABLE_KEY}\nAPP_ORIGIN=http://file.example\nSUPABASE_SECRET_KEY={TEST_SECRET_KEY}\nOTHER=1\n",
        encoding="utf-8",
    )
    before = dict(os.environ)
    config = load_config({"APP_ENV_FILE": str(env_file), "SUPABASE_URL": "https://from-env.supabase.co"})
    assert config.supabase_url == "https://from-env.supabase.co"  # 환경 변수가 우선
    assert config.app_origin == "http://file.example"             # 없는 값은 .env에서
    assert config.supabase_secret_key == TEST_SECRET_KEY
    assert dict(os.environ) == before               # os.environ을 바꾸지 않는다


def test_an_empty_env_file_setting_disables_reading_the_file(tmp_path):
    env_file = tmp_path / "never-read.env"
    env_file.write_text(f"SUPABASE_URL={TEST_URL}\nSUPABASE_PUBLISHABLE_KEY={TEST_PUBLISHABLE_KEY}\nAPP_ORIGIN={TEST_ORIGIN}\n", encoding="utf-8")
    assert load_config({"APP_ENV_FILE": ""}).public() == DISABLED
    assert load_config({"APP_ENV_FILE": str(tmp_path / "missing.env")}).public() == DISABLED
    assert load_config({"APP_ENV_FILE": str(env_file)}).auth_enabled


def test_default_app_reads_the_environment_when_first_used(monkeypatch):
    app = create_app()  # 만들 때가 아니라 처음 쓸 때 읽는다
    monkeypatch.setenv("SUPABASE_URL", TEST_URL)
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", TEST_PUBLISHABLE_KEY)
    monkeypatch.setenv("APP_ORIGIN", TEST_ORIGIN)
    with TestClient(app) as client:
        assert client.get("/api/config").json()["auth_enabled"] is True


def test_config_holder_reads_once(monkeypatch):
    calls = []
    monkeypatch.setattr("app.config.load_config", lambda: calls.append(1) or AppConfig())
    holder = ConfigHolder()
    holder.get(), holder.get(), holder.get()
    assert calls == [1]


def test_health_and_static_pages_work_without_any_auth_settings(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/web/html/index.html").status_code == 200
    assert client.get("/web/html/visualizer.html").status_code == 200
    assert client.get("/web/js/data/catalog.json").status_code == 200
    error = client.get("/api/me").json()["error"]
    assert error["code"] == "auth_not_configured"  # 인증 기능만 설정 오류를 알린다


def test_the_env_file_in_the_repository_is_not_read_during_tests(monkeypatch):
    """테스트 환경(APP_ENV_FILE 빈 값)에서는 기본 위치의 .env를 읽지 않는다."""
    monkeypatch.setattr("app.config.dotenv_values", lambda *a, **k: pytest.fail("dotenv_values가 호출되었다"))
    assert load_config().public() == DISABLED


def test_unset_env_file_setting_reads_the_default_file_but_an_empty_setting_does_not(tmp_path, monkeypatch):
    """APP_ENV_FILE이 없으면 기본 .env를 읽고, 빈 값이면 기본 파일이 있어도 읽지 않는다(테스트가 실제 .env를 읽지 않는 근거)."""
    default = tmp_path / ".env"
    default.write_text(f"SUPABASE_URL={TEST_URL}\nSUPABASE_PUBLISHABLE_KEY={TEST_PUBLISHABLE_KEY}\nAPP_ORIGIN={TEST_ORIGIN}\n", encoding="utf-8")
    monkeypatch.setattr("app.config.DEFAULT_ENV_FILE", default)
    assert load_config({}).auth_enabled
    assert load_config({"APP_ENV_FILE": ""}).public() == DISABLED
    assert load_config({"APP_ENV_FILE": "   "}).public() == DISABLED


def test_an_empty_environment_variable_does_not_override_the_env_file(tmp_path):
    env_file = tmp_path / "settings.env"
    env_file.write_text(f"SUPABASE_URL={TEST_URL}\nSUPABASE_PUBLISHABLE_KEY={TEST_PUBLISHABLE_KEY}\nAPP_ORIGIN={TEST_ORIGIN}\n", encoding="utf-8")
    config = load_config({"APP_ENV_FILE": str(env_file), "SUPABASE_PUBLISHABLE_KEY": "", "SUPABASE_URL": "   "})
    assert config.auth_enabled  # 빈 값·공백은 "설정 안 함"이므로 .env의 값이 유지된다
