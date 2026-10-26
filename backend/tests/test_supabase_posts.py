"""`SupabasePostStore`가 실제 supabase 라이브러리로 보내는 HTTP 요청의 모양과 응답 번역을 가짜 PostgREST(`httpx.MockTransport`)로 확인한다.

확인: 목록 쿼리(정렬·limit·키셋 필터·본문 제외), 읽기는 Publishable key만 쓰고 쓰기는 사용자 토큰을 싣는지, RPC 인자(누락 필드는 보내지 않음, null은 set 플래그와 함께),
결과 번역, SQLSTATE 번역(profile_required 등), 쓰기를 다시 보내지 않는지, Secret key를 쓰지 않는지.
"""

import json
from datetime import datetime, timezone

import httpx
import pytest

from app.config import AppConfig
from app.errors import ApiError
from app.pagination import CursorPosition
from app.services.posts import SupabasePostStore
from conftest import TEST_ORIGIN, TEST_PUBLISHABLE_KEY, TEST_SECRET_KEY, TEST_URL, TOKEN_A, USER_A

POST_ID = "0b4e7a5e-3f0d-4c53-9b8e-6f1c2a9d7e11"
WHEN = "2026-10-14T05:30:00.123456+00:00"
DETAIL = {
    "id": POST_ID, "author_id": USER_A.id, "author_display_name": "앨리스", "title": "제목", "body": "본문", "algorithm_id": "bfs",
    "version": 2, "created_at": WHEN, "updated_at": WHEN,
}


class FakePostgrest:
    def __init__(self, responder):
        self.requests: list[dict] = []
        self.responder = responder

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handle))

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append({
            "method": request.method, "path": request.url.path, "query": request.url.params.multi_items(),
            "headers": {k.lower(): v for k, v in request.headers.items()},
            "body": json.loads(request.content) if request.content else None,
        })
        result = self.responder(request)
        if isinstance(result, Exception):
            raise result
        return result


@pytest.fixture
def config() -> AppConfig:
    return AppConfig(supabase_url=TEST_URL, supabase_publishable_key=TEST_PUBLISHABLE_KEY, app_origin=TEST_ORIGIN, supabase_secret_key=TEST_SECRET_KEY)


def store_with(responder):
    fake = FakePostgrest(responder)
    return SupabasePostStore(fake.client()), fake


def ok(body, status=200):
    return lambda request: httpx.Response(status, json=body)


def pg_error(status, code, message="m"):
    return lambda request: httpx.Response(status, json={"code": code, "message": message, "details": None, "hint": None})


def all_sent(fake) -> str:
    return json.dumps(fake.requests, ensure_ascii=False)


# ------------------------------------------------------------------ 목록

def test_list_query_shape_first_page(config):
    store, fake = store_with(ok([]))
    assert store.list(config, limit=21, algorithm=None, after=None) == []
    request = fake.requests[0]
    assert (request["method"], request["path"]) == ("GET", "/rest/v1/posts")
    query = dict(request["query"])
    assert query["select"] == "id,title,author_display_name,algorithm_id,created_at,version"  # 본문(body)을 읽지 않는다
    assert query["order"] == "created_at.desc,id.desc"
    assert query["limit"] == "21"
    assert "or" not in query and "algorithm_id" not in query


def test_list_keyset_filter_and_algorithm(config):
    store, fake = store_with(ok([]))
    after = CursorPosition(datetime(2026, 10, 14, 5, 30, 0, 123456, tzinfo=timezone.utc), POST_ID)
    store.list(config, limit=3, algorithm="bfs", after=after)
    query = dict(fake.requests[0]["query"])
    assert query["algorithm_id"] == "eq.bfs"
    assert query["or"] == f"(created_at.lt.{WHEN},and(created_at.eq.{WHEN},id.lt.{POST_ID}))"


def test_list_reads_with_the_publishable_key_only(config):
    store, fake = store_with(ok([]))
    store.list(config, limit=1, algorithm=None, after=None)
    headers = fake.requests[0]["headers"]
    assert headers["apikey"] == TEST_PUBLISHABLE_KEY
    assert TOKEN_A not in all_sent(fake) and TEST_SECRET_KEY not in all_sent(fake)


def test_list_parses_summaries(config):
    row = {k: DETAIL[k] for k in ("id", "title", "author_display_name", "algorithm_id", "created_at", "version")}
    store, _ = store_with(ok([row]))
    [item] = store.list(config, limit=1, algorithm=None, after=None)
    assert (str(item.id), item.title, item.version) == (POST_ID, "제목", 2)


def test_unexpected_row_shape_is_500_not_a_crash(config):
    store, _ = store_with(ok([{"id": "not-a-uuid"}]))
    with pytest.raises(ApiError) as caught:
        store.list(config, limit=1, algorithm=None, after=None)
    assert caught.value.status_code == 500


# ------------------------------------------------------------------ 상세

def test_get_by_id(config):
    store, fake = store_with(ok([DETAIL]))
    post = store.get(config, POST_ID)
    assert post.body == "본문"
    query = dict(fake.requests[0]["query"])
    assert query["id"] == f"eq.{POST_ID}" and query["limit"] == "1"
    assert "author_id" in query["select"] and "body" in query["select"]


def test_get_missing_is_none(config):
    store, _ = store_with(ok([]))
    assert store.get(config, POST_ID) is None


# ------------------------------------------------------------------ 작성

def test_create_inserts_only_allowed_columns_with_the_user_token(config):
    store, fake = store_with(ok([DETAIL], 201))
    post = store.create(config, TOKEN_A, USER_A.id, "제목", "본문", "bfs")
    assert str(post.id) == POST_ID
    request = fake.requests[0]
    assert (request["method"], request["path"]) == ("POST", "/rest/v1/posts")
    assert request["body"] == {"author_id": USER_A.id, "title": "제목", "body": "본문", "algorithm_id": "bfs"}
    assert request["headers"]["authorization"] == f"Bearer {TOKEN_A}"
    assert request["headers"]["apikey"] == TEST_PUBLISHABLE_KEY
    assert TEST_SECRET_KEY not in all_sent(fake)


def test_create_profile_required_from_the_trigger_is_403(config):
    store, _ = store_with(pg_error(400, "P0001", "profile_required"))
    with pytest.raises(ApiError) as caught:
        store.create(config, TOKEN_A, USER_A.id, "t", "b", None)
    assert (caught.value.status_code, caught.value.code) == (403, "profile_required")


def test_create_check_violation_maps_to_the_right_field(config):
    cases = {
        "posts_title_trimmed": "title", "posts_body_not_blank": "body", "posts_algorithm_id_allowed": "algorithm_id",
    }
    for constraint, field in cases.items():
        store, _ = store_with(pg_error(400, "23514", f'new row for relation "posts" violates check constraint "{constraint}"'))
        with pytest.raises(ApiError) as caught:
            store.create(config, TOKEN_A, USER_A.id, "t", "b", None)
        assert (caught.value.status_code, list(caught.value.fields)) == (422, [field])


def test_create_is_not_retried_after_a_server_error(config):
    store, fake = store_with(pg_error(503, "503", "unavailable"))
    with pytest.raises(ApiError) as caught:
        store.create(config, TOKEN_A, USER_A.id, "t", "b", None)
    assert caught.value.status_code == 503
    assert len(fake.requests) == 1


def test_create_network_error_is_503_and_not_retried(config):
    store, fake = store_with(lambda request: httpx.ConnectError("boom"))
    with pytest.raises(ApiError) as caught:
        store.create(config, TOKEN_A, USER_A.id, "t", "b", None)
    assert caught.value.status_code == 503
    assert len(fake.requests) == 1


def test_expired_jwt_is_401(config):
    store, _ = store_with(pg_error(401, "PGRST301", "JWT expired"))
    with pytest.raises(ApiError) as caught:
        store.create(config, TOKEN_A, USER_A.id, "t", "b", None)
    assert (caught.value.status_code, caught.value.code) == (401, "invalid_token")


# ------------------------------------------------------------------ 수정·삭제 RPC

def rpc_row(result, **extra):
    row = {key: None for key in ("id", "author_id", "author_display_name", "title", "body", "algorithm_id", "version", "created_at", "updated_at")}
    row.update(extra)
    row["result"] = result
    return [row]


def test_update_sends_only_the_changed_fields(config):
    store, fake = store_with(ok(rpc_row("ok", **DETAIL)))
    outcome = store.update(config, TOKEN_A, POST_ID, 1, {"title": "새 제목"})
    assert outcome.result == "ok" and outcome.post.version == 2
    request = fake.requests[0]
    assert (request["method"], request["path"]) == ("POST", "/rest/v1/rpc/update_post")
    assert request["body"] == {"p_id": POST_ID, "p_expected_version": 1, "p_title": "새 제목"}  # 누락 필드는 보내지 않는다
    assert request["headers"]["authorization"] == f"Bearer {TOKEN_A}"


def test_update_algorithm_null_sets_the_flag(config):
    store, fake = store_with(ok(rpc_row("ok", **{**DETAIL, "algorithm_id": None})))
    outcome = store.update(config, TOKEN_A, POST_ID, 1, {"algorithm_id": None})
    assert outcome.post.algorithm_id is None
    assert fake.requests[0]["body"] == {"p_id": POST_ID, "p_expected_version": 1, "p_algorithm_id": None, "p_set_algorithm_id": True}


def test_update_all_fields(config):
    store, fake = store_with(ok(rpc_row("ok", **DETAIL)))
    store.update(config, TOKEN_A, POST_ID, 7, {"title": "t", "body": "b", "algorithm_id": "dfs"})
    assert fake.requests[0]["body"] == {
        "p_id": POST_ID, "p_expected_version": 7, "p_title": "t", "p_body": "b", "p_algorithm_id": "dfs", "p_set_algorithm_id": True,
    }


@pytest.mark.parametrize("result", ["not_found", "forbidden", "version_conflict"])
def test_update_failure_results_carry_no_post(config, result):
    store, _ = store_with(ok(rpc_row(result)))
    outcome = store.update(config, TOKEN_A, POST_ID, 1, {"title": "t"})
    assert (outcome.result, outcome.post) == (result, None)


@pytest.mark.parametrize("payload", [[], [{"result": "ok"}, {"result": "ok"}], [{"result": "weird"}], {"unexpected": 1}, [{"title": "x"}]])
def test_unexpected_rpc_result_is_500(config, payload):
    store, _ = store_with(ok(payload))
    with pytest.raises(ApiError) as caught:
        store.update(config, TOKEN_A, POST_ID, 1, {"title": "t"})
    assert caught.value.status_code == 500
    with pytest.raises(ApiError) as caught:
        store.delete(config, TOKEN_A, POST_ID, 1)
    assert caught.value.status_code == 500


def test_delete_sends_id_and_expected_version(config):
    store, fake = store_with(ok([{"result": "ok"}]))
    assert store.delete(config, TOKEN_A, POST_ID, 3) == "ok"
    request = fake.requests[0]
    assert (request["method"], request["path"]) == ("POST", "/rest/v1/rpc/delete_post")
    assert request["body"] == {"p_id": POST_ID, "p_expected_version": 3}


@pytest.mark.parametrize("result", ["not_found", "forbidden", "version_conflict"])
def test_delete_results(config, result):
    store, _ = store_with(ok([{"result": result}]))
    assert store.delete(config, TOKEN_A, POST_ID, 1) == result


def test_rpc_database_errors_are_translated(config):
    for status, code, expected in [(400, "22023", 500), (403, "42501", 403), (503, "503", 503), (409, "40001", 503), (400, "23505", 500)]:
        store, _ = store_with(pg_error(status, code, "rpc_required" if code == "42501" else "x"))
        with pytest.raises(ApiError) as caught:
            store.update(config, TOKEN_A, POST_ID, 1, {"title": "t"})
        assert caught.value.status_code == expected, code


def test_writes_are_never_retried_and_never_use_the_secret_key(config):
    store, fake = store_with(lambda request: httpx.ReadTimeout("slow"))
    for action in (
        lambda: store.update(config, TOKEN_A, POST_ID, 1, {"title": "t"}),
        lambda: store.delete(config, TOKEN_A, POST_ID, 1),
    ):
        with pytest.raises(ApiError) as caught:
            action()
        assert caught.value.status_code == 503
    assert len(fake.requests) == 2
    assert TEST_SECRET_KEY not in all_sent(fake)
