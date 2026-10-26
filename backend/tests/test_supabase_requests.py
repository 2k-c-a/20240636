"""실제 supabase 라이브러리가 만드는 HTTP 요청을 가짜 Supabase(`httpx.MockTransport`)로 가로채 확인한다.

확인하는 것: 요청 경로·메서드·본문, 키(`apikey`)와 사용자 토큰(`Authorization`)이 올바른 곳에만 실리는지, Secret key가 한 번도 쓰이지 않는지,
A/B 사용자의 동시 요청이 섞이지 않는지(연결 풀은 공유하지만 헤더는 요청마다 따로), 쓰기는 다시 보내지 않는지, 오류 번역.
가짜 서버는 PostgREST의 RLS처럼 "토큰의 사용자 자신의 행만" 보이게 한다.
"""

import json
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import AppConfig
from app.errors import ApiError
from app.main import create_app
from app.services.auth import SupabaseTokenVerifier
from app.services.profiles import SupabaseProfileStore
from app.services.supabase import create_admin_client, create_anon_client, create_user_client
from conftest import TEST_ORIGIN, TEST_PUBLISHABLE_KEY, TEST_SECRET_KEY, TEST_URL, TOKEN_A, TOKEN_B, USER_A, USER_B, bearer
from fake_supabase import NOW, TOKENS, FakeSupabase

@pytest.fixture
def fake() -> FakeSupabase:
    return FakeSupabase()


@pytest.fixture
def config() -> AppConfig:
    return AppConfig(supabase_url=TEST_URL, supabase_publishable_key=TEST_PUBLISHABLE_KEY, app_origin=TEST_ORIGIN, supabase_secret_key=TEST_SECRET_KEY)


@pytest.fixture
def verifier(fake):
    return SupabaseTokenVerifier(fake.client())


@pytest.fixture
def store(fake):
    return SupabaseProfileStore(fake.client())


def everything_sent(fake: FakeSupabase) -> str:
    """기록한 모든 요청(주소·헤더·본문)을 한 문자열로."""
    return json.dumps(fake.requests, ensure_ascii=False)


# ------------------------------------------------------------------ 토큰 검증

def test_token_verification_asks_supabase_auth_with_the_publishable_key_and_the_user_token(fake, verifier, config):
    user = verifier.verify(config, TOKEN_A)
    assert (user.id, user.email) == (USER_A.id, USER_A.email)
    assert len(fake.requests) == 1
    request = fake.requests[0]
    assert (request["method"], request["path"]) == ("GET", "/auth/v1/user")
    assert request["headers"]["apikey"] == TEST_PUBLISHABLE_KEY
    assert request["headers"]["authorization"] == f"Bearer {TOKEN_A}"  # 공개 키가 아니라 사용자 토큰으로 묻는다


@pytest.mark.parametrize("response, expected_status, expected_code", [
    (httpx.Response(401, json={"code": "bad_jwt", "msg": "invalid JWT"}), 401, "invalid_token"),
    (httpx.Response(403, json={"code": "bad_jwt", "msg": "forbidden"}), 401, "invalid_token"),
    (httpx.Response(400, json={"code": "validation_failed", "msg": "bad"}), 401, "invalid_token"),
    (httpx.Response(404, json={"code": "user_not_found", "msg": "User from sub claim in JWT does not exist"}), 401, "invalid_token"),
    (httpx.Response(429, json={"code": "over_request_rate_limit", "msg": "slow down"}), 503, "service_unavailable"),
    (httpx.Response(500, json={"code": "unexpected_failure", "msg": "oops"}), 503, "service_unavailable"),
    (httpx.Response(502, text="bad gateway"), 503, "service_unavailable"),
    (httpx.Response(503, text="unavailable"), 503, "service_unavailable"),
    (httpx.Response(504, text="timeout"), 503, "service_unavailable"),
    (httpx.Response(200, text="이건 JSON이 아니다"), 503, "service_unavailable"),
    (httpx.Response(200, json={"unexpected": True}), 503, "service_unavailable"),
    (httpx.Response(200, json={"id": "not-a-uuid", "aud": "authenticated", "app_metadata": {}, "user_metadata": {}, "created_at": NOW}), 503, "service_unavailable"),
    (httpx.ConnectError("연결할 수 없음"), 503, "service_unavailable"),
    (httpx.ReadTimeout("시간 초과"), 503, "service_unavailable"),
    (httpx.RemoteProtocolError("프로토콜 오류"), 503, "service_unavailable"),
])
def test_token_verification_failures_map_to_401_or_503_and_never_to_access(fake, verifier, config, response, expected_status, expected_code):
    fake.auth_response = response
    with pytest.raises(ApiError) as info:
        verifier.verify(config, TOKEN_A)
    assert (info.value.status_code, info.value.code) == (expected_status, expected_code)
    assert len(fake.requests) == 1 or isinstance(response, Exception)  # 다시 보내지 않는다


def test_a_user_without_email_is_still_verified(fake, verifier, config):
    fake.auth_response = httpx.Response(200, json={"id": USER_A.id, "aud": "authenticated", "app_metadata": {}, "user_metadata": {}, "created_at": NOW})
    user = verifier.verify(config, TOKEN_A)
    assert (user.id, user.email) == (USER_A.id, None)


# ------------------------------------------------------------------ 프로필 요청

def test_create_sends_one_insert_if_absent_request_with_only_id_and_nickname(fake, store, config):
    profile, created = store.create_if_absent(config, TOKEN_A, USER_A.id, "앨리스")
    assert created is True
    assert (str(profile.id), profile.nickname) == (USER_A.id, "앨리스")
    assert len(fake.requests) == 1
    request = fake.requests[0]
    assert (request["method"], request["path"]) == ("POST", "/rest/v1/profiles")
    assert request["query"].get("on_conflict") == "id"
    prefer = request["headers"]["prefer"]
    assert "resolution=ignore-duplicates" in prefer and "return=representation" in prefer  # ON CONFLICT DO NOTHING
    assert "merge-duplicates" not in prefer  # 덮어쓰기(upsert) 방식이 아니다
    assert request["body"] == {"id": USER_A.id, "nickname": "앨리스"}  # 시각·version 등을 보내지 않는다
    assert request["headers"]["apikey"] == TEST_PUBLISHABLE_KEY
    assert request["headers"]["authorization"] == f"Bearer {TOKEN_A}"


def test_creating_twice_returns_the_existing_row_and_sends_no_update(fake, store, config):
    first, created_first = store.create_if_absent(config, TOKEN_A, USER_A.id, "앨리스")
    second, created_second = store.create_if_absent(config, TOKEN_A, USER_A.id, "덮어쓰기시도")
    assert (created_first, created_second) == (True, False)
    assert second.nickname == "앨리스" == fake.rows[USER_A.id]["nickname"]
    assert [r["method"] for r in fake.requests] == ["POST", "POST", "GET"]  # 두 번째는 0행이라 조회로 기존 값을 읽는다
    assert all(r["method"] != "PATCH" for r in fake.requests)


def test_get_reads_only_the_callers_row_by_id(fake, store, config):
    fake.rows[USER_A.id] = {"id": USER_A.id, "nickname": "앨리스", "created_at": NOW, "updated_at": NOW}
    assert store.get(config, TOKEN_A, USER_A.id).nickname == "앨리스"
    assert store.get(config, TOKEN_B, USER_B.id) is None
    request = fake.requests[0]
    assert (request["method"], request["path"], request["query"]["id"]) == ("GET", "/rest/v1/profiles", f"eq.{USER_A.id}")
    assert request["query"]["select"] == "id,nickname,created_at,updated_at"


def test_update_patches_only_the_nickname_of_the_callers_row(fake, store, config):
    fake.rows[USER_A.id] = {"id": USER_A.id, "nickname": "앨리스", "created_at": NOW, "updated_at": NOW}
    profile = store.update(config, TOKEN_A, USER_A.id, "새이름")
    assert profile.nickname == "새이름"
    request = fake.requests[0]
    assert (request["method"], request["path"], request["query"]["id"]) == ("PATCH", "/rest/v1/profiles", f"eq.{USER_A.id}")
    assert request["body"] == {"nickname": "새이름"}  # nickname만 보낸다
    assert store.update(config, TOKEN_B, USER_B.id, "없는프로필") is None  # 행이 없으면 None(만들지 않는다)


def test_the_secret_key_and_other_users_tokens_are_never_sent(fake, verifier, store, config):
    verifier.verify(config, TOKEN_A)
    store.create_if_absent(config, TOKEN_A, USER_A.id, "앨리스")
    store.get(config, TOKEN_A, USER_A.id)
    store.update(config, TOKEN_A, USER_A.id, "새이름")
    verifier.verify(config, TOKEN_B)
    sent = everything_sent(fake)
    assert TEST_SECRET_KEY not in sent and "SENTINEL-NEVER-LEAK" not in sent
    for request in fake.requests:
        assert request["headers"]["apikey"] == TEST_PUBLISHABLE_KEY
    a_requests = [r for r in fake.requests[:4]]
    assert all(TOKEN_B not in json.dumps(r) for r in a_requests)  # B의 토큰이 A의 요청에 실리지 않는다
    assert fake.violations == []


# ------------------------------------------------------------------ A/B 분리 (동시 요청)

def test_concurrent_requests_of_two_users_never_mix_tokens_or_rows(fake, verifier, store, config):
    users = [(TOKEN_A, USER_A, "앨리스"), (TOKEN_B, USER_B, "밥밥")]

    def work(index: int) -> tuple[str, str, str]:
        token, user, nickname = users[index % 2]
        assert verifier.verify(config, token).id == user.id
        profile, _ = store.create_if_absent(config, token, user.id, f"{nickname}")
        again = store.get(config, token, user.id)
        patched = store.update(config, token, user.id, nickname + str(index % 2))
        return user.id, str(profile.id), str(again.id) + "|" + str(patched.id)

    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(work, range(240)))
    for user_id, created_id, read_ids in results:
        assert created_id == user_id
        assert read_ids == f"{user_id}|{user_id}"
    assert fake.violations == []
    assert len({r["thread"] for r in fake.requests}) > 1  # 실제로 여러 스레드에서 동시에 보냈다
    for request in fake.requests:  # 모든 요청의 토큰이 그 요청이 다룬 사용자의 것이다
        token = request["headers"]["authorization"].removeprefix("Bearer ")
        assert token in TOKENS
        if request["path"] == "/rest/v1/profiles":
            target = request["query"].get("id", "").removeprefix("eq.") or request["body"]["id"]
            assert TOKENS[token].id == target
    assert fake.rows[USER_A.id]["nickname"].startswith("앨리스") and fake.rows[USER_B.id]["nickname"].startswith("밥밥")


def test_user_clients_do_not_share_headers_or_sessions(config):
    client_a = create_user_client(config, TOKEN_A)
    client_b = create_user_client(config, TOKEN_B)
    assert client_a.options.headers["Authorization"] == f"Bearer {TOKEN_A}"
    assert client_b.options.headers["Authorization"] == f"Bearer {TOKEN_B}"
    assert client_a.options.headers["apiKey"] == TEST_PUBLISHABLE_KEY == client_b.options.headers["apiKey"]
    assert client_a.options is not client_b.options and client_a.options.headers is not client_b.options.headers
    assert client_a.auth.get_session() is None and client_b.auth.get_session() is None  # 세션을 저장하지 않는다
    anon = create_anon_client(config)
    assert anon.options.headers["Authorization"] == f"Bearer {TEST_PUBLISHABLE_KEY}"  # 로그인하지 않은 클라이언트는 공개 키만 쓴다
    assert TEST_SECRET_KEY not in json.dumps([client_a.options.headers, client_b.options.headers, anon.options.headers])


def test_user_clients_require_the_auth_settings(auth_config):
    with pytest.raises(RuntimeError):
        create_user_client(AppConfig(), TOKEN_A)
    with pytest.raises(RuntimeError):
        create_anon_client(AppConfig(supabase_url=TEST_URL))
    with pytest.raises(RuntimeError):
        create_admin_client(AppConfig(supabase_url=TEST_URL))  # Secret key가 없으면 관리용 클라이언트도 만들 수 없다


# ------------------------------------------------------------------ 오류 번역과 재시도

@pytest.mark.parametrize("response, status, code", [
    (httpx.Response(401, json={"code": "PGRST301", "details": None, "hint": None, "message": "JWT expired"}), 401, "invalid_token"),
    (httpx.Response(401, json={"code": "PGRST303", "details": None, "hint": None, "message": "JWT claims invalid"}), 401, "invalid_token"),
    (httpx.Response(403, json={"code": "42501", "details": None, "hint": None, "message": "permission denied for table profiles"}), 403, "forbidden"),
    (httpx.Response(400, json={"code": "23514", "details": None, "hint": None, "message": "violates check constraint \"profiles_nickname_length\""}), 422, "validation_error"),
    (httpx.Response(503, json={"code": "PGRST002", "details": None, "hint": None, "message": "schema cache"}), 503, "service_unavailable"),
    (httpx.Response(500, json={"code": "XX000", "details": None, "hint": None, "message": "internal SECRET-SQL-DETAIL"}), 500, "internal_error"),
    (httpx.Response(502, text="bad gateway"), 503, "service_unavailable"),
    (httpx.Response(401, text="Unauthorized"), 401, "invalid_token"),       # 본문이 JSON이 아니어도 상태로 번역한다
    (httpx.Response(403, text="Forbidden"), 403, "forbidden"),
    (httpx.ConnectError("연결할 수 없음"), 503, "service_unavailable"),
    (httpx.ReadTimeout("시간 초과"), 503, "service_unavailable"),
])
def test_database_errors_map_to_common_errors_without_details(fake, store, config, monkeypatch, response, status, code):
    monkeypatch.setattr("time.sleep", lambda seconds: None)  # 읽기 재시도의 대기를 건너뛴다
    fake.rest_response = response
    for call in (
        lambda: store.get(config, TOKEN_A, USER_A.id),
        lambda: store.create_if_absent(config, TOKEN_A, USER_A.id, "앨리스"),
        lambda: store.update(config, TOKEN_A, USER_A.id, "앨리스"),
    ):
        with pytest.raises(ApiError) as info:
            call()
        assert (info.value.status_code, info.value.code) == (status, code)
        assert "SECRET-SQL-DETAIL" not in info.value.message


def test_writes_are_never_retried_automatically(fake, store, config, monkeypatch):
    monkeypatch.setattr("time.sleep", lambda seconds: None)
    fake.rest_response = httpx.Response(503, text="unavailable")
    with pytest.raises(ApiError):
        store.create_if_absent(config, TOKEN_A, USER_A.id, "앨리스")
    assert [r["method"] for r in fake.requests] == ["POST"]  # 응답을 못 받았을 때 쓰기를 다시 보내지 않는다
    fake.requests.clear()
    with pytest.raises(ApiError):
        store.update(config, TOKEN_A, USER_A.id, "앨리스")
    assert [r["method"] for r in fake.requests] == ["PATCH"]


def test_a_malformed_profile_row_is_an_internal_error_not_a_crash(fake, store, config):
    fake.rest_response = httpx.Response(200, json=[{"id": USER_A.id}])  # nickname 등이 없다
    with pytest.raises(ApiError) as info:
        store.get(config, TOKEN_A, USER_A.id)
    assert info.value.code == "internal_error"


# ------------------------------------------------------------------ 앱 전체(FastAPI → supabase 라이브러리 → 가짜 Supabase)

@pytest.fixture
def stack(fake, config):
    """가짜가 아닌 실제 검증기·저장소를 쓰는 앱. Supabase만 가짜 서버로 바꾼다."""
    with TestClient(create_app(config=config, http_client=fake.client()), raise_server_exceptions=False) as client:
        yield client


def test_full_stack_profile_flow_for_two_users(stack, fake):
    assert stack.post("/api/me/profile", json={"nickname": "앨리스"}, headers=bearer(TOKEN_A)).status_code == 201
    again = stack.post("/api/me/profile", json={"nickname": "덮어쓰기"}, headers=bearer(TOKEN_A))
    assert again.status_code == 200 and again.json()["nickname"] == "앨리스"
    assert stack.post("/api/me/profile", json={"nickname": "밥밥"}, headers=bearer(TOKEN_B)).status_code == 201
    assert stack.patch("/api/me/profile", json={"nickname": "밥2"}, headers=bearer(TOKEN_B)).json()["nickname"] == "밥2"
    assert stack.get("/api/me", headers=bearer(TOKEN_A)).json() == {"id": USER_A.id, "email": USER_A.email, "nickname": "앨리스"}
    assert stack.get("/api/me", headers=bearer(TOKEN_B)).json() == {"id": USER_B.id, "email": USER_B.email, "nickname": "밥2"}
    assert stack.patch("/api/me/profile", json={"nickname": "해킹", "id": USER_A.id}, headers=bearer(TOKEN_B)).status_code == 422
    assert fake.rows[USER_A.id]["nickname"] == "앨리스"
    assert fake.violations == []
    assert TEST_SECRET_KEY not in everything_sent(fake)


def test_full_stack_rejects_unknown_tokens_and_survives_an_outage(stack, fake):
    assert stack.get("/api/me", headers=bearer("forged")).status_code == 401
    fake.auth_response = httpx.ConnectError("끊김")
    response = stack.get("/api/me", headers=bearer(TOKEN_A))
    assert response.status_code == 503 and response.json()["error"]["code"] == "service_unavailable"
    assert not any(r["path"].startswith("/rest/") for r in fake.requests)  # 확인하지 못했으면 DB에 가지 않는다
    fake.auth_response = None
    assert stack.get("/api/me", headers=bearer(TOKEN_A)).status_code == 200  # 복구되면 바로 동작한다


def test_routes_never_use_the_admin_client(stack, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("일반 사용자 요청이 관리용(Secret key) 클라이언트를 만들었다")

    monkeypatch.setattr("app.services.supabase.create_admin_client", forbidden)
    monkeypatch.setattr("app.services.supabase._admin_client", forbidden)
    assert stack.post("/api/me/profile", json={"nickname": "앨리스"}, headers=bearer(TOKEN_A)).status_code == 201
    assert stack.get("/api/me", headers=bearer(TOKEN_A)).status_code == 200
    assert stack.patch("/api/me/profile", json={"nickname": "새이름"}, headers=bearer(TOKEN_A)).status_code == 200
    assert stack.get("/api/config").status_code == 200


def test_user_clients_neither_persist_nor_refresh_sessions_and_do_not_share_storage(config):
    client_a = create_user_client(config, TOKEN_A)
    client_b = create_user_client(config, TOKEN_B)
    for client in (client_a, client_b):
        assert client.options.persist_session is False
        assert client.options.auto_refresh_token is False
    assert client_a.options.storage is not client_b.options.storage  # 세션 저장소를 공유하지 않는다
    anon = create_anon_client(config)
    assert anon.options.persist_session is False and anon.options.auto_refresh_token is False
    assert anon.options.storage is not client_a.options.storage


def test_the_connection_pool_is_closed_on_shutdown_only_when_the_app_created_it(config):
    app = create_app(config=config)
    pool = app.state.services.verifier._http_client.get()  # 연결 풀은 처음 쓸 때 만들어진다
    with TestClient(app):
        assert not pool.is_closed
    assert pool.is_closed  # 앱이 만든 연결 풀은 서버가 끝날 때 닫는다
    mine = httpx.Client()
    with TestClient(create_app(config=config, http_client=mine)):
        pass
    assert not mine.is_closed  # 밖에서 받은 연결 풀은 닫지 않는다
    mine.close()
