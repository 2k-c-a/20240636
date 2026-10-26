"""실제 Supabase 개발 프로젝트에 대한 게시판 API 통합 테스트(선택 실행, README.md 참고).

기본 실행에서는 건너뛴다. 테스트 전용 계정만 사용하고, 테스트가 만든 글만 UUID로 정리한다.
"""

import os
import threading

import pytest

if os.environ.get("RUN_SUPABASE_INTEGRATION") != "1":
    pytest.skip("RUN_SUPABASE_INTEGRATION=1 일 때만 실행합니다(tests/integration/README.md).", allow_module_level=True)

from fastapi.testclient import TestClient  # noqa: E402

from app.config import load_config  # noqa: E402
from app.main import create_app  # noqa: E402
from app.services.supabase import create_anon_client  # noqa: E402

# 모듈을 불러올 때 실제 설정을 읽는다(각 테스트 앞에서 환경 변수를 비우는 공통 fixture보다 먼저 실행된다).
CONFIG = load_config()
ACCOUNTS = {
    name: (os.environ.get(f"IT_USER_{name}_EMAIL"), os.environ.get(f"IT_USER_{name}_PASSWORD")) for name in ("A", "B")
}
if not CONFIG.auth_enabled or not all(ACCOUNTS["A"]):
    pytest.skip("backend/.env의 Supabase 설정과 IT_USER_A_EMAIL/IT_USER_A_PASSWORD가 필요합니다.", allow_module_level=True)
HAS_B = all(ACCOUNTS["B"])


def sign_in(name: str) -> str:
    email, password = ACCOUNTS[name]
    session = create_anon_client(CONFIG).auth.sign_in_with_password({"email": email, "password": password}).session
    assert session is not None
    return session.access_token


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def tokens():
    result = {"A": sign_in("A")}
    if HAS_B:
        result["B"] = sign_in("B")
    return result


@pytest.fixture
def api(tokens):
    app = create_app(config=CONFIG)
    with TestClient(app, raise_server_exceptions=False) as client:
        for name, token in tokens.items():
            if client.get("/api/me", headers=auth(token)).json()["nickname"] is None:
                assert client.post("/api/me/profile", json={"nickname": f"통합시험{name}"}, headers=auth(token)).status_code in (200, 201)
        yield client


@pytest.fixture
def created(api, tokens):
    """테스트가 만든 글의 ID. 끝나면 현재 ETag로 그 글만 지운다."""
    ids: list[str] = []
    yield ids
    for post_id in ids:
        current = api.get(f"/api/posts/{post_id}")
        if current.status_code == 200:
            api.delete(f"/api/posts/{post_id}", headers={**auth(tokens["A"]), "If-Match": current.headers["etag"]})


def make(api, tokens, created, title="통합시험 글", body="통합시험 본문", **extra):
    response = api.post("/api/posts", json={"title": title, "body": body, **extra}, headers=auth(tokens["A"]))
    assert response.status_code == 201, response.text
    created.append(response.json()["id"])
    return response


def test_lifecycle(api, tokens, created):
    response = make(api, tokens, created, algorithm_id="bfs")
    post = response.json()
    assert response.headers["location"] == f"/api/posts/{post['id']}"
    assert response.headers["etag"] == f'"post-{post["id"]}-v1"'
    assert post["author_display_name"]  # 작성 당시 닉네임을 DB가 복사했다

    assert api.get(f"/api/posts/{post['id']}").json()["body"] == "통합시험 본문"
    listed = api.get("/api/posts?limit=50").json()["items"]
    assert post["id"] in [item["id"] for item in listed]
    assert all("body" not in item for item in listed)

    edited = api.patch(f"/api/posts/{post['id']}", json={"title": "수정됨", "algorithm_id": None}, headers={**auth(tokens["A"]), "If-Match": response.headers["etag"]})
    assert edited.status_code == 200, edited.text
    assert (edited.json()["title"], edited.json()["algorithm_id"], edited.json()["version"]) == ("수정됨", None, 2)
    assert edited.json()["body"] == "통합시험 본문"  # 누락한 필드는 그대로

    stale = api.patch(f"/api/posts/{post['id']}", json={"title": "오래된 수정"}, headers={**auth(tokens["A"]), "If-Match": response.headers["etag"]})
    assert stale.status_code == 412
    assert api.get(f"/api/posts/{post['id']}").json()["title"] == "수정됨"

    gone = api.delete(f"/api/posts/{post['id']}", headers={**auth(tokens["A"]), "If-Match": edited.headers["etag"]})
    assert gone.status_code == 204
    assert api.get(f"/api/posts/{post['id']}").status_code == 404
    assert api.delete(f"/api/posts/{post['id']}", headers={**auth(tokens["A"]), "If-Match": edited.headers["etag"]}).status_code == 404


def test_same_version_concurrent_updates_only_one_wins(api, tokens, created):
    response = make(api, tokens, created)
    post_id, etag = response.json()["id"], response.headers["etag"]
    statuses: list[int] = []
    barrier = threading.Barrier(4)

    def attempt(n: int):
        with TestClient(create_app(config=CONFIG), raise_server_exceptions=False) as client:
            barrier.wait()
            statuses.append(client.patch(f"/api/posts/{post_id}", json={"title": f"동시 {n}"}, headers={**auth(tokens["A"]), "If-Match": etag}).status_code)

    threads = [threading.Thread(target=attempt, args=(n,)) for n in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert sorted(statuses) == [200, 412, 412, 412]
    assert api.get(f"/api/posts/{post_id}").json()["version"] == 2


def test_pagination_walks_without_duplicates(api, tokens, created):
    for n in range(3):
        make(api, tokens, created, title=f"페이지 시험 {n}")
    seen, cursor = [], None
    for _ in range(200):
        page = api.get("/api/posts", params={"limit": 2, **({"cursor": cursor} if cursor else {})}).json()
        seen += [(item["created_at"], item["id"]) for item in page["items"]]
        cursor = page["next_cursor"]
        if cursor is None:
            break
    ids = [post_id for _, post_id in seen]
    assert len(ids) == len(set(ids))
    assert seen == sorted(seen, reverse=True)
    assert set(created) <= set(ids)


def test_validation_is_enforced_before_the_database(api, tokens):
    assert api.post("/api/posts", json={"title": " ", "body": "b"}, headers=auth(tokens["A"])).status_code == 422
    assert api.post("/api/posts", json={"title": "t", "body": "b", "author_id": "x"}, headers=auth(tokens["A"])).status_code == 422
    assert api.post("/api/posts", json={"title": "t", "body": "b"}).status_code == 401


@pytest.mark.skipif(not HAS_B, reason="IT_USER_B_EMAIL/IT_USER_B_PASSWORD 필요")
def test_other_users_cannot_change_or_delete(api, tokens, created):
    response = make(api, tokens, created)
    post_id, etag = response.json()["id"], response.headers["etag"]
    assert api.patch(f"/api/posts/{post_id}", json={"title": "탈취"}, headers={**auth(tokens["B"]), "If-Match": etag}).status_code == 403
    assert api.delete(f"/api/posts/{post_id}", headers={**auth(tokens["B"]), "If-Match": etag}).status_code == 403
    assert api.get(f"/api/posts/{post_id}").json()["title"] == "통합시험 글"


@pytest.mark.skipif(os.environ.get("IT_EXPECT_RPC_ONLY") != "1", reason="migration 4 적용 후 IT_EXPECT_RPC_ONLY=1 로 실행")
def test_direct_data_api_writes_are_rejected(api, tokens, created):
    """RPC를 거치지 않은 직접 PATCH/DELETE는 version 검사를 우회하므로 migration 4가 거부해야 한다."""
    import httpx

    post_id = make(api, tokens, created).json()["id"]
    headers = {"apikey": CONFIG.supabase_publishable_key, "Authorization": f"Bearer {tokens['A']}", "Content-Type": "application/json", "Prefer": "return=representation"}
    url = f"{CONFIG.supabase_url}/rest/v1/posts?id=eq.{post_id}"
    patched = httpx.patch(url, json={"title": "직접 수정"}, headers=headers)
    assert patched.status_code in (401, 403), patched.text
    deleted = httpx.delete(url, headers=headers)
    assert deleted.status_code in (401, 403), deleted.text
    assert api.get(f"/api/posts/{post_id}").json()["title"] == "통합시험 글"
