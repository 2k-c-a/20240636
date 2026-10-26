"""글 API: 목록(cursor), 상세, 작성, 수정(If-Match, null/누락), 삭제, 검사 순서, 소유권, 오류 형식.

DB 경계(`PostStore`)는 메모리 가짜(tests/fake_posts.py)로 바꾼다. 실제 PostgREST 요청 모양은 tests/test_supabase_posts.py가 확인한다.
"""

import json
import base64
from datetime import timezone

import pytest

from app.errors import service_unavailable
from app.schemas.post import BODY_MAX, TITLE_MAX
from conftest import TOKEN_A, TOKEN_B, USER_A, USER_B, bearer

POSTS = "/api/posts"
MISSING_ID = "99999999-9999-4999-8999-999999999999"


def etag_of(post) -> str:
    return f'"post-{post.id}-v{post.version}"'


def make_profile(store, user=USER_A, nickname="앨리스"):
    store.create_if_absent(None, "t", user.id, nickname)


def create(client, body, token=TOKEN_A):
    return client.post(POSTS, json=body, headers=bearer(token))


def patch(client, post_id, body, etag, token=TOKEN_A):
    headers = bearer(token)
    if etag is not None:
        headers["If-Match"] = etag
    return client.patch(f"{POSTS}/{post_id}", json=body, headers=headers)


def delete(client, post_id, etag, token=TOKEN_A):
    headers = bearer(token)
    if etag is not None:
        headers["If-Match"] = etag
    return client.delete(f"{POSTS}/{post_id}", headers=headers)


def error_of(response, status, code):
    assert response.status_code == status, response.text
    error = response.json()["error"]
    assert error["code"] == code
    assert error["request_id"] == response.headers["x-request-id"]
    return error


# ------------------------------------------------------------------ 목록

def test_empty_list(auth_client):
    response = auth_client.get(POSTS)
    assert response.status_code == 200
    assert response.json() == {"items": [], "next_cursor": None}
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("algorithm", ["union-find", "dijkstra", "knapsack", "topological-sort", "two-pointers"])
def test_new_learning_algorithm_can_be_tagged_and_filtered(auth_client, store, algorithm):
    make_profile(store)
    response = create(auth_client, {"title": "새 알고리즘", "body": "학습 질문", "algorithm_id": algorithm})
    assert response.status_code == 201
    assert response.json()["algorithm_id"] == algorithm
    items = auth_client.get(POSTS, params={"algorithm": algorithm}).json()["items"]
    assert len(items) == 1
    assert items[0]["algorithm_id"] == algorithm


@pytest.mark.parametrize("created", ["0001-01-01T00:00:00+14:00", "9999-12-31T23:59:59-14:00"])
def test_out_of_range_cursor_is_400_without_database_access(auth_client, post_store, created):
    payload = {"c": created, "i": MISSING_ID, "a": None}
    cursor = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    error_of(auth_client.get(POSTS, params={"cursor": cursor}), 400, "invalid_cursor")
    assert post_store.calls == []


@pytest.mark.parametrize("method", ["POST", "PATCH"])
@pytest.mark.parametrize("field", ["title", "body"])
@pytest.mark.parametrize("value", ["bad\ud800text", "bad\udffftext"])
def test_unpaired_surrogate_is_422_before_database_access(auth_client, post_store, store, method, field, value):
    make_profile(store)
    payload = {"title": "제목", "body": "본문", field: value}
    # JSON 이스케이프로 전송하면 서버의 JSON 파서가 고립 surrogate를 문자열로 만들 수 있다.
    path = POSTS if method == "POST" else f"{POSTS}/{MISSING_ID}"
    response = auth_client.request(method, path, content=json.dumps(payload), headers={
        **bearer(TOKEN_A), "Content-Type": "application/json", "If-Match": f'"post-{MISSING_ID}-v1"',
    })
    error_of(response, 422, "validation_error")
    assert post_store.calls == []


def test_list_is_newest_first_without_body_or_email(auth_client, post_store):
    post_store.add(USER_A.id, "첫글", "비밀이 아닌 본문")
    newest = post_store.add(USER_B.id, "둘째글", "본문2", "bfs")
    items = auth_client.get(POSTS).json()["items"]
    assert [item["title"] for item in items] == ["둘째글", "첫글"]
    assert set(items[0]) == {"id", "title", "author_display_name", "algorithm_id", "created_at", "version"}
    assert items[0]["id"] == str(newest.id)
    text = json.dumps(items, ensure_ascii=False)
    assert "본문" not in text and "@" not in text and USER_A.id not in text  # 본문·이메일·작성자 ID 비공개


def test_list_needs_no_login_and_ignores_the_authorization_header(auth_client, verifier, post_store):
    post_store.add(USER_A.id)
    assert auth_client.get(POSTS).status_code == 200
    assert auth_client.get(POSTS, headers={"Authorization": "Bearer garbage"}).status_code == 200
    assert auth_client.get(POSTS, headers=bearer(TOKEN_A)).status_code == 200
    assert verifier.calls == []  # 토큰 검증조차 하지 않는다


def test_list_works_when_auth_is_not_configured():
    from fastapi.testclient import TestClient

    from app.main import create_app
    from fake_posts import FakePostStore

    store = FakePostStore()
    store.add(USER_A.id, "공개글")
    with TestClient(create_app(post_store=store)) as client:  # 인증 설정 없음
        assert client.get(POSTS).json()["items"][0]["title"] == "공개글"
        assert client.get(f"{POSTS}/{next(iter(store.rows))}").status_code == 200


def paginate(client, params=""):
    pages, cursor = [], None
    while True:
        query = f"limit=2{params}" + (f"&cursor={cursor}" if cursor else "")
        body = client.get(f"{POSTS}?{query}").json()
        pages.append([item["title"] for item in body["items"]])
        cursor = body["next_cursor"]
        if cursor is None:
            return pages


def test_cursor_pages_walk_every_post_once(auth_client, post_store):
    for n in range(5):
        post_store.add(USER_A.id, f"글{n}")
    assert paginate(auth_client) == [["글4", "글3"], ["글2", "글1"], ["글0"]]


def test_exactly_full_last_page_has_no_next_cursor(auth_client, post_store):
    for n in range(4):
        post_store.add(USER_A.id, f"글{n}")
    assert paginate(auth_client) == [["글3", "글2"], ["글1", "글0"]]


def test_cursor_handles_posts_with_the_same_timestamp(auth_client, post_store):
    from datetime import datetime

    same = datetime(2026, 10, 14, 5, 30, tzinfo=timezone.utc)
    for n in range(5):
        post_store.add(USER_A.id, f"동시{n}", created_at=same)
    seen = [title for page in paginate(auth_client) for title in page]
    assert sorted(seen) == [f"동시{n}" for n in range(5)]
    assert len(seen) == len(set(seen))  # 빠지거나 겹치지 않는다


def test_filter_and_cursor_work_together(auth_client, post_store):
    for n in range(5):
        post_store.add(USER_A.id, f"b{n}", algorithm_id="bfs" if n % 2 == 0 else "dfs")
    assert paginate(auth_client, "&algorithm=bfs") == [["b4", "b2"], ["b0"]]


def test_cursor_from_another_filter_is_400(auth_client, post_store):
    for n in range(3):
        post_store.add(USER_A.id, f"b{n}", algorithm_id="bfs")
    cursor = auth_client.get(f"{POSTS}?limit=1&algorithm=bfs").json()["next_cursor"]
    error_of(auth_client.get(f"{POSTS}?limit=1&algorithm=dfs&cursor={cursor}"), 400, "invalid_cursor")
    error_of(auth_client.get(f"{POSTS}?limit=1&cursor={cursor}"), 400, "invalid_cursor")


@pytest.mark.parametrize("cursor", ["abc", "a" * 301, "e30", "%00"])
def test_garbage_cursor_is_400(auth_client, cursor):
    error_of(auth_client.get(f"{POSTS}?cursor={cursor}"), 400, "invalid_cursor")


def test_limit_bounds(auth_client, post_store):
    for n in range(3):
        post_store.add(USER_A.id)
    assert auth_client.get(f"{POSTS}?limit=1").status_code == 200
    assert auth_client.get(f"{POSTS}?limit=50").status_code == 200
    for bad in ("0", "51", "-1", "abc", ""):
        error_of(auth_client.get(f"{POSTS}?limit={bad}"), 422, "validation_error")
    # 기본값은 20이고 저장소에는 다음 페이지 확인용으로 한 건 더 요청한다
    auth_client.get(POSTS)
    assert post_store.calls[-1][1] == 21


def test_unknown_algorithm_filter_is_422(auth_client):
    error = error_of(auth_client.get(f"{POSTS}?algorithm=quick-sort"), 422, "validation_error")
    assert "algorithm" in error["fields"]


def test_algorithm_filter_is_a_whitelist_not_a_query_fragment(auth_client, post_store):
    for bad in ("bfs,id.eq.1", "bfs)&select=*", "%27%20OR%201=1"):
        error_of(auth_client.get(f"{POSTS}?algorithm={bad}"), 422, "validation_error")
    assert post_store.calls == []


# ------------------------------------------------------------------ 상세

def test_detail_has_the_etag_and_all_fields(auth_client, post_store):
    post = post_store.add(USER_A.id, "제목", "첫 줄\n둘째 줄", "dfs")
    response = auth_client.get(f"{POSTS}/{post.id}")
    assert response.status_code == 200
    assert response.headers["etag"] == f'"post-{post.id}-v1"'
    body = response.json()
    assert set(body) == {"id", "author_id", "author_display_name", "title", "body", "algorithm_id", "version", "created_at", "updated_at"}
    assert body["body"] == "첫 줄\n둘째 줄"
    assert "email" not in json.dumps(body)


def test_detail_unknown_or_malformed_id(auth_client):
    error_of(auth_client.get(f"{POSTS}/{MISSING_ID}"), 404, "not_found")
    for bad in ("123", "not-a-uuid", "0B4E7A5E-3F0D-4C53-9B8E-6F1C2A9D7E11", "0b4e7a5e3f0d4c539b8e6f1c2a9d7e11"):
        error_of(auth_client.get(f"{POSTS}/{bad}"), 422, "validation_error")


# ------------------------------------------------------------------ 작성

def test_create_returns_201_with_location_and_etag(auth_client, store, post_store):
    make_profile(store)
    response = create(auth_client, {"title": "  BFS 질문  ", "body": "줄바꿈\n보존\n", "algorithm_id": "bfs"})
    assert response.status_code == 201
    body = response.json()
    assert response.headers["location"] == f"/api/posts/{body['id']}"
    assert response.headers["etag"] == f'"post-{body["id"]}-v1"'
    assert (body["title"], body["body"], body["algorithm_id"], body["version"]) == ("BFS 질문", "줄바꿈\n보존\n", "bfs", 1)
    assert body["author_id"] == USER_A.id  # 작성자는 검증된 토큰의 사용자
    assert auth_client.get(response.headers["location"]).json()["title"] == "BFS 질문"


def test_create_without_algorithm_stores_null(auth_client, store):
    make_profile(store)
    assert create(auth_client, {"title": "t", "body": "b"}).json()["algorithm_id"] is None
    assert create(auth_client, {"title": "t", "body": "b", "algorithm_id": None}).json()["algorithm_id"] is None


def test_create_uses_the_token_user_never_the_body(auth_client, store, post_store):
    make_profile(store)
    response = create(auth_client, {"title": "t", "body": "b", "author_id": USER_B.id})
    error = error_of(response, 422, "validation_error")
    assert "author_id" in error["fields"]
    assert not [c for c in post_store.calls if c[0] == "create"]


@pytest.mark.parametrize("field", ["author_display_name", "version", "id", "created_at", "updated_at", "is_admin"])
def test_create_rejects_server_controlled_fields(auth_client, store, field):
    make_profile(store)
    error = error_of(create(auth_client, {"title": "t", "body": "b", field: "x"}), 422, "validation_error")
    assert field in error["fields"]


@pytest.mark.parametrize(
    "body, field",
    [
        ({"body": "b"}, "title"),
        ({"title": "t"}, "body"),
        ({"title": "", "body": "b"}, "title"),
        ({"title": "   ", "body": "b"}, "title"),
        ({"title": "x" * (TITLE_MAX + 1), "body": "b"}, "title"),
        ({"title": 5, "body": "b"}, "title"),
        ({"title": None, "body": "b"}, "title"),
        ({"title": "a\x00b", "body": "b"}, "title"),
        ({"title": "t", "body": ""}, "body"),
        ({"title": "t", "body": " \n\t "}, "body"),
        ({"title": "t", "body": "x" * (BODY_MAX + 1)}, "body"),
        ({"title": "t", "body": ["b"]}, "body"),
        ({"title": "t", "body": None}, "body"),
        ({"title": "t", "body": "a\x00b"}, "body"),
        ({"title": "t", "body": "b", "algorithm_id": "quick-sort"}, "algorithm_id"),
        ({"title": "t", "body": "b", "algorithm_id": 3}, "algorithm_id"),
        ({"title": "t", "body": "b", "algorithm_id": ""}, "algorithm_id"),
    ],
)
def test_create_validation(auth_client, store, post_store, body, field):
    make_profile(store)
    error = error_of(create(auth_client, body), 422, "validation_error")
    assert field in error["fields"]
    assert not [c for c in post_store.calls if c[0] == "create"]


def test_create_accepts_boundaries(auth_client, store):
    make_profile(store)
    assert create(auth_client, {"title": "x" * TITLE_MAX, "body": "y" * BODY_MAX}).status_code == 201
    assert create(auth_client, {"title": "😀" * TITLE_MAX, "body": "😀" * BODY_MAX}).status_code == 201  # 코드 포인트 수로 센다
    assert create(auth_client, {"title": "t", "body": "b"}).status_code == 201


def test_create_not_json_or_not_object(auth_client, store):
    make_profile(store)
    error_of(auth_client.post(POSTS, content=b"{bad", headers={**bearer(TOKEN_A), "Content-Type": "application/json"}), 422, "validation_error")
    error_of(create(auth_client, ["a"]), 422, "validation_error")
    error_of(auth_client.post(POSTS, headers=bearer(TOKEN_A)), 422, "validation_error")


def test_create_without_profile_is_403_profile_required(auth_client, post_store):
    error_of(create(auth_client, {"title": "t", "body": "b"}), 403, "profile_required")
    assert not [c for c in post_store.calls if c[0] == "create"]


def test_create_validation_comes_before_profile_check(auth_client):
    error_of(create(auth_client, {"title": "", "body": "b"}), 422, "validation_error")  # 프로필이 없어도 422가 먼저


def test_create_requires_login_before_anything_else(auth_client, verifier):
    error_of(auth_client.post(POSTS, json={"title": "", "body": ""}), 401, "unauthenticated")
    error_of(auth_client.post(POSTS, json={}, headers=bearer("bad-token")), 401, "invalid_token")


def test_create_with_unreachable_auth_service_is_503(auth_client, verifier, store):
    make_profile(store)
    verifier.table[TOKEN_A] = service_unavailable()
    error_of(create(auth_client, {"title": "t", "body": "b"}), 503, "service_unavailable")


# ------------------------------------------------------------------ 수정

def seeded(post_store, store, **kwargs):
    make_profile(store)
    post_store.nicknames[USER_A.id] = "앨리스"
    return post_store.add(USER_A.id, kwargs.pop("title", "원래 제목"), kwargs.pop("body", "원래 본문"), kwargs.pop("algorithm_id", "bfs"), **kwargs)


def test_patch_changes_only_given_fields_and_bumps_version(auth_client, store, post_store):
    post = seeded(post_store, store)
    response = patch(auth_client, post.id, {"title": "  새 제목  "}, etag_of(post))
    assert response.status_code == 200
    body = response.json()
    assert (body["title"], body["body"], body["algorithm_id"], body["version"]) == ("새 제목", "원래 본문", "bfs", 2)
    assert response.headers["etag"] == f'"post-{post.id}-v2"'
    assert post_store.calls[-1][4] == {"title": "새 제목"}  # 누락된 필드는 저장소에 전달하지 않는다


def test_patch_algorithm_null_removes_the_link_and_missing_keeps_it(auth_client, store, post_store):
    post = seeded(post_store, store)
    kept = patch(auth_client, post.id, {"title": "x"}, etag_of(post)).json()
    assert kept["algorithm_id"] == "bfs"
    removed = patch(auth_client, post.id, {"algorithm_id": None}, f'"post-{post.id}-v2"')
    assert removed.status_code == 200
    assert removed.json()["algorithm_id"] is None
    assert post_store.calls[-1][4] == {"algorithm_id": None}
    changed = patch(auth_client, post.id, {"algorithm_id": "dfs"}, f'"post-{post.id}-v3"')
    assert changed.json()["algorithm_id"] == "dfs"


@pytest.mark.parametrize("body, field", [
    ({"title": None}, "title"), ({"body": None}, "body"), ({"title": ""}, "title"), ({"body": "  "}, "body"),
    ({"title": "x" * 101}, "title"), ({"body": "x" * 10_001}, "body"), ({"algorithm_id": "nope"}, "algorithm_id"),
    ({"algorithm_id": 1}, "algorithm_id"), ({"author_id": "x"}, "author_id"), ({"version": 9}, "version"),
    ({"title": "ok", "author_display_name": "해커"}, "author_display_name"),
])
def test_patch_validation(auth_client, store, post_store, body, field):
    post = seeded(post_store, store)
    error = error_of(patch(auth_client, post.id, body, etag_of(post)), 422, "validation_error")
    assert field in error["fields"]
    assert not [c for c in post_store.calls if c[0] == "update"]
    assert post_store.rows[str(post.id)].version == 1


@pytest.mark.parametrize("body", [{}, [], "text", 5, None])
def test_patch_with_no_changes_or_wrong_shape_is_422(auth_client, store, post_store, body):
    post = seeded(post_store, store)
    error_of(patch(auth_client, post.id, body, etag_of(post)), 422, "validation_error")
    assert post_store.rows[str(post.id)].version == 1


def test_patch_without_if_match_is_428(auth_client, store, post_store):
    post = seeded(post_store, store)
    error_of(patch(auth_client, post.id, {"title": "x"}, None), 428, "precondition_required")
    error_of(delete(auth_client, post.id, None), 428, "precondition_required")
    assert post_store.calls == []


@pytest.mark.parametrize("etag", ["*", "W/\"post-x-v1\"", "v1", "1", '"1"', "garbage", '"post-0b4e7a5e-3f0d-4c53-9b8e-6f1c2a9d7e11-v0"', '"post-0b4e7a5e-3f0d-4c53-9b8e-6f1c2a9d7e11-v1", "post-0b4e7a5e-3f0d-4c53-9b8e-6f1c2a9d7e11-v2"'])
def test_malformed_if_match_is_422(auth_client, store, post_store, etag):
    post = seeded(post_store, store)
    error = error_of(patch(auth_client, post.id, {"title": "x"}, etag), 422, "validation_error")
    assert "If-Match" in error["fields"]
    error_of(delete(auth_client, post.id, etag), 422, "validation_error")
    assert post_store.calls == []


def test_patch_with_old_version_is_412_and_changes_nothing(auth_client, store, post_store):
    post = seeded(post_store, store)
    assert patch(auth_client, post.id, {"title": "첫 수정"}, etag_of(post)).status_code == 200
    stale = patch(auth_client, post.id, {"title": "오래된 화면의 수정"}, etag_of(post))
    error = error_of(stale, 412, "precondition_failed")
    assert "첫 수정" not in json.dumps(error, ensure_ascii=False)  # 현재 글 내용을 넣지 않는다
    assert post_store.rows[str(post.id)].title == "첫 수정"
    assert post_store.rows[str(post.id)].version == 2


def test_same_version_twice_only_one_succeeds(auth_client, store, post_store):
    post = seeded(post_store, store)
    results = [patch(auth_client, post.id, {"title": f"수정{n}"}, etag_of(post)).status_code for n in range(2)]
    assert sorted(results) == [200, 412]


def test_if_match_for_another_post_is_412_after_existence_and_ownership(auth_client, store, post_store):
    mine = seeded(post_store, store)
    other = post_store.add(USER_B.id, "남의 글")
    foreign_etag = etag_of(other)
    error_of(patch(auth_client, mine.id, {"title": "x"}, foreign_etag), 412, "precondition_failed")
    error_of(patch(auth_client, MISSING_ID, {"title": "x"}, foreign_etag), 404, "not_found")
    error_of(patch(auth_client, other.id, {"title": "x"}, etag_of(mine)), 403, "forbidden")  # 남의 글: ETag가 틀려도 403
    assert post_store.rows[str(mine.id)].version == 1  # 다른 글의 version 숫자만 맞았다고 허용하지 않는다


def test_patch_other_users_post_is_403(auth_client, store, post_store):
    post = seeded(post_store, store)
    error_of(patch(auth_client, post.id, {"title": "탈취"}, etag_of(post), token=TOKEN_B), 403, "forbidden")
    assert post_store.rows[str(post.id)].title == "원래 제목"


def test_patch_missing_post_is_404(auth_client, store):
    make_profile(store)
    error_of(patch(auth_client, MISSING_ID, {"title": "x"}, f'"post-{MISSING_ID}-v1"'), 404, "not_found")


def test_patch_check_order(auth_client, post_store, store):
    post = seeded(post_store, store)
    etag = etag_of(post)
    # 경로 UUID 형식(422)은 인증보다 먼저
    error_of(auth_client.patch(f"{POSTS}/bad-id", json={}), 422, "validation_error")
    # 인증(401)은 If-Match 없음(428)보다 먼저
    error_of(auth_client.patch(f"{POSTS}/{post.id}", json={"title": "x"}), 401, "unauthenticated")
    # If-Match 없음(428)은 본문 검증(422)보다 먼저
    error_of(patch(auth_client, post.id, {"title": ""}, None), 428, "precondition_required")
    # If-Match 형식(422)·본문(422)은 RPC(404/403/412)보다 먼저
    error_of(patch(auth_client, MISSING_ID, {"title": ""}, etag), 422, "validation_error")
    error_of(patch(auth_client, post.id, {"title": ""}, etag, token=TOKEN_B), 422, "validation_error")
    # 여기서부터 RPC: 404 → 403 → 412
    error_of(patch(auth_client, MISSING_ID, {"title": "x"}, etag, token=TOKEN_B), 404, "not_found")
    error_of(patch(auth_client, post.id, {"title": "x"}, f'"post-{post.id}-v9"', token=TOKEN_B), 403, "forbidden")
    error_of(patch(auth_client, post.id, {"title": "x"}, f'"post-{post.id}-v9"'), 412, "precondition_failed")


def test_author_display_name_does_not_change_when_editing(auth_client, store, post_store):
    post = seeded(post_store, store)
    body = patch(auth_client, post.id, {"title": "바꿈"}, etag_of(post)).json()
    assert body["author_display_name"] == "앨리스"
    assert body["author_id"] == USER_A.id


# ------------------------------------------------------------------ 삭제

def test_delete_returns_204_without_body(auth_client, store, post_store):
    post = seeded(post_store, store)
    response = delete(auth_client, post.id, etag_of(post))
    assert response.status_code == 204
    assert response.content == b""
    assert str(post.id) not in post_store.rows
    error_of(auth_client.get(f"{POSTS}/{post.id}"), 404, "not_found")


def test_delete_with_old_version_other_user_and_missing(auth_client, store, post_store):
    post = seeded(post_store, store)
    patch(auth_client, post.id, {"title": "v2"}, etag_of(post))
    error_of(delete(auth_client, post.id, etag_of(post)), 412, "precondition_failed")
    error_of(delete(auth_client, post.id, f'"post-{post.id}-v2"', token=TOKEN_B), 403, "forbidden")
    assert str(post.id) in post_store.rows
    assert delete(auth_client, post.id, f'"post-{post.id}-v2"').status_code == 204
    error_of(delete(auth_client, post.id, f'"post-{post.id}-v2"'), 404, "not_found")  # 이미 삭제됨
    error_of(delete(auth_client, MISSING_ID, f'"post-{MISSING_ID}-v1"'), 404, "not_found")


def test_delete_requires_login(auth_client, post_store, store):
    post = seeded(post_store, store)
    error_of(auth_client.delete(f"{POSTS}/{post.id}", headers={"If-Match": etag_of(post)}), 401, "unauthenticated")
    assert str(post.id) in post_store.rows


# ------------------------------------------------------------------ 장애와 오류 형식

def test_database_outage_is_503_and_never_leaks_internals(auth_client, post_store, store):
    post = seeded(post_store, store)
    post_store.fail_with = service_unavailable()
    for response in (
        auth_client.get(POSTS), auth_client.get(f"{POSTS}/{post.id}"),
        create(auth_client, {"title": "t", "body": "b"}),
        patch(auth_client, post.id, {"title": "x"}, etag_of(post)),
        delete(auth_client, post.id, etag_of(post)),
    ):
        error_of(response, 503, "service_unavailable")
        text = response.text
        assert TOKEN_A not in text and "sb_" not in text and "SELECT" not in text


def test_unexpected_exception_is_500_internal_error_without_details(auth_client, post_store):
    post_store.fail_with = RuntimeError("password=secret SELECT * FROM posts")
    response = auth_client.get(POSTS)
    error_of(response, 500, "internal_error")
    assert "secret" not in response.text and "SELECT" not in response.text


def test_method_not_allowed_and_unknown_route_use_the_common_error_format(auth_client):
    error_of(auth_client.put(POSTS, json={}), 405, "method_not_allowed")
    error_of(auth_client.get("/api/posts/a/b"), 404, "not_found")
