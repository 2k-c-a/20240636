"""프로필 API: 만들기(insert-if-absent), 닉네임 변경, 입력 검증, 검사 순서, A/B 분리.

DB 경계(`ProfileStore`)는 메모리 가짜로 바꾼다. 실제 PostgREST 요청 모양은 tests/test_supabase_requests.py가 확인한다.
"""

import json
import re
from pathlib import Path

import pytest

from app.errors import service_unavailable
from app.schemas.profile import NicknameBody, parse_nickname_body, ValidationFailure
from conftest import TOKEN_A, TOKEN_B, USER_A, USER_B, bearer

PROFILE = "/api/me/profile"
SQL = Path(__file__).resolve().parents[2] / "supabase" / "migrations" / "202610140001_profiles_posts.sql"


def post(client, body, token=TOKEN_A, **kwargs):
    return client.post(PROFILE, json=body, headers=bearer(token), **kwargs)


def patch(client, body, token=TOKEN_A, **kwargs):
    return client.patch(PROFILE, json=body, headers=bearer(token), **kwargs)


def fields_of(response) -> dict:
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "validation_error"
    return response.json()["error"]["fields"]


# ------------------------------------------------------------------ 만들기와 변경

def test_post_creates_the_profile_for_the_verified_user(auth_client, store):
    response = post(auth_client, {"nickname": "앨리스"})
    assert response.status_code == 201
    body = response.json()
    assert set(body) == {"id", "nickname", "created_at", "updated_at"}  # 이메일 등 다른 정보는 없다
    assert (body["id"], body["nickname"]) == (USER_A.id, "앨리스")
    assert body["created_at"].endswith("Z") and body["updated_at"].endswith("Z")
    assert response.headers["cache-control"] == "no-store"
    assert store.calls == [("create", TOKEN_A, USER_A.id, "앨리스")]


def test_post_again_returns_the_existing_profile_and_never_overwrites_the_nickname(auth_client, store):
    first = post(auth_client, {"nickname": "앨리스"})
    second = post(auth_client, {"nickname": "다른이름"})
    third = post(auth_client, {"nickname": "또다른이름"})
    assert [first.status_code, second.status_code, third.status_code] == [201, 200, 200]
    assert second.json() == first.json() == third.json()
    assert store.rows[USER_A.id].nickname == "앨리스"
    assert auth_client.get("/api/me", headers=bearer(TOKEN_A)).json()["nickname"] == "앨리스"


def test_patch_changes_the_nickname_of_an_existing_profile(auth_client, store):
    created = post(auth_client, {"nickname": "앨리스"}).json()
    changed = patch(auth_client, {"nickname": "새이름"})
    assert changed.status_code == 200
    body = changed.json()
    assert (body["id"], body["nickname"], body["created_at"]) == (USER_A.id, "새이름", created["created_at"])
    assert body["updated_at"] > created["updated_at"]
    assert auth_client.get("/api/me", headers=bearer(TOKEN_A)).json()["nickname"] == "새이름"


def test_patch_without_a_profile_is_404_profile_not_found(auth_client, store):
    response = patch(auth_client, {"nickname": "새이름"})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "profile_not_found"
    assert store.rows == {}  # PATCH가 프로필을 만들지 않는다


def test_me_has_a_profile_nickname_or_null(auth_client):
    assert auth_client.get("/api/me", headers=bearer(TOKEN_A)).json()["nickname"] is None
    post(auth_client, {"nickname": "앨리스"})
    me = auth_client.get("/api/me", headers=bearer(TOKEN_A))
    assert me.json() == {"id": USER_A.id, "email": USER_A.email, "nickname": "앨리스"}
    assert me.headers["cache-control"] == "no-store"


# ------------------------------------------------------------------ A/B 분리

def test_a_and_b_only_ever_touch_their_own_profile(auth_client, store):
    assert post(auth_client, {"nickname": "앨리스"}, TOKEN_A).status_code == 201
    assert post(auth_client, {"nickname": "밥밥"}, TOKEN_B).status_code == 201
    assert patch(auth_client, {"nickname": "밥2"}, TOKEN_B).status_code == 200
    assert store.rows[USER_A.id].nickname == "앨리스"
    assert store.rows[USER_B.id].nickname == "밥2"
    for call in store.calls:
        op, token, user_id, *_ = call
        assert (token, user_id) in {(TOKEN_A, USER_A.id), (TOKEN_B, USER_B.id)}, call
    assert auth_client.get("/api/me", headers=bearer(TOKEN_A)).json()["nickname"] == "앨리스"


@pytest.mark.parametrize("extra", [
    {"id": USER_B.id}, {"author_id": USER_B.id}, {"user_id": USER_B.id}, {"role": "admin"}, {"created_at": "2000-01-01T00:00:00Z"}, {"email": "x@example.test"}, {"version": 99},
])
def test_a_body_naming_another_user_or_extra_fields_is_rejected_and_touches_nothing(auth_client, store, extra):
    for send in (post, patch):
        response = send(auth_client, {"nickname": "앨리스", **extra})
        assert list(fields_of(response)) == list(extra)
        assert fields_of(response)[next(iter(extra))] == "허용되지 않는 항목입니다."
    assert store.calls == []  # 저장소를 부르지 않았다


# ------------------------------------------------------------------ 입력 검증

@pytest.mark.parametrize("nickname, stored", [
    ("앨리스", "앨리스"),
    ("  앨리스  ", "앨리스"),            # 앞뒤 공백은 지운다
    ("\t앨리스\n", "앨리스"),
    ("ab", "ab"),                        # 최소 2자
    ("가" * 20, "가" * 20),              # 최대 20자
    ("😀" * 20, "😀" * 20),              # 이모지도 한 글자로 센다
    ("a b", "a b"),                      # 가운데 공백은 허용
    ("앨리스", "앨리스"),                 # 같은 닉네임이 이미 있어도 된다(중복 허용)
])
def test_valid_nicknames_are_stored_trimmed(auth_client, store, nickname, stored):
    response = post(auth_client, {"nickname": nickname})
    assert response.status_code == 201, response.text
    assert response.json()["nickname"] == stored


@pytest.mark.parametrize("nickname, message", [
    ("", "닉네임은 2~20자여야 합니다."),
    ("가", "닉네임은 2~20자여야 합니다."),
    ("   ", "닉네임은 2~20자여야 합니다."),                 # 공백만
    (" 가 ", "닉네임은 2~20자여야 합니다."),                  # 지우면 1자
    ("가" * 21, "닉네임은 2~20자여야 합니다."),
    ("😀" * 21, "닉네임은 2~20자여야 합니다."),
    ("a\nb", "닉네임에 줄바꿈 같은 제어 문자를 쓸 수 없습니다."),
    ("a\tb", "닉네임에 줄바꿈 같은 제어 문자를 쓸 수 없습니다."),
    ("a" + chr(127) + "b", "닉네임에 줄바꿈 같은 제어 문자를 쓸 수 없습니다."),
    ("a" + chr(0) + "b", "닉네임에 줄바꿈 같은 제어 문자를 쓸 수 없습니다."),
    (123, "닉네임은 문자열이어야 합니다."),
    (None, "닉네임은 문자열이어야 합니다."),
    (["a", "b"], "닉네임은 문자열이어야 합니다."),
    (True, "닉네임은 문자열이어야 합니다."),
])
def test_invalid_nicknames_are_422_with_a_korean_message_and_never_reach_the_store(auth_client, store, nickname, message):
    for send in (post, patch):
        assert fields_of(send(auth_client, {"nickname": nickname})) == {"nickname": message}
    assert store.calls == []


def test_missing_nickname_and_non_object_bodies_are_422(auth_client, store):
    assert fields_of(post(auth_client, {})) == {"nickname": "닉네임을 입력해 주세요."}
    for content in [b"[]", json.dumps([{"nickname": "앨리스"}]).encode(), json.dumps("앨리스").encode(), b"5", b"null", b"true"]:
        response = auth_client.post(PROFILE, content=content, headers={**bearer(TOKEN_A), "Content-Type": "application/json"})
        assert response.status_code == 422, content
        assert response.json()["error"]["message"] == "요청 본문은 JSON 객체여야 합니다."
    assert store.calls == []


def test_invalid_json_and_missing_body_are_422(auth_client, store):
    for content in [b"{not json", b"", b"\xff\xfe"]:
        response = auth_client.post(PROFILE, content=content, headers={**bearer(TOKEN_A), "Content-Type": "application/json"})
        assert response.status_code == 422, content
        assert response.json()["error"]["code"] == "validation_error"
    assert auth_client.post(PROFILE, headers=bearer(TOKEN_A)).status_code == 422  # 본문 없음
    assert store.calls == []


def test_check_order_is_authentication_before_validation(auth_client, store):
    """인증 → 입력 검증 → 처리. 로그인하지 않은 요청은 본문이 틀려도 401이다."""
    for send in (auth_client.post, auth_client.patch):
        assert send(PROFILE, json={"nickname": "x"}).status_code == 401
        assert send(PROFILE, content=b"{not json", headers={"Content-Type": "application/json"}).status_code == 401
        assert send(PROFILE, json={"id": USER_B.id}, headers={"Authorization": "Bearer forged"}).status_code == 401
    assert store.calls == []
    # 로그인한 요청은 본문이 틀리면 그때 422다
    assert auth_client.post(PROFILE, content=b"{not json", headers={**bearer(TOKEN_A), "Content-Type": "application/json"}).status_code == 422


def test_store_failures_become_common_errors(auth_client, store):
    store.fail_with = service_unavailable()
    assert post(auth_client, {"nickname": "앨리스"}).status_code == 503
    assert patch(auth_client, {"nickname": "앨리스"}).status_code == 503
    assert auth_client.get("/api/me", headers=bearer(TOKEN_A)).json()["error"]["code"] == "service_unavailable"
    store.fail_with = RuntimeError("DB 내부 SECRET-DB-DETAIL")
    response = post(auth_client, {"nickname": "앨리스"})
    assert response.status_code == 500
    assert "SECRET-DB-DETAIL" not in response.text


# ------------------------------------------------------------------ API와 DB의 규칙이 같다

PYTHON_WHITESPACE = {c for c in range(0x110000) if chr(c).isspace()}


def sql_whitespace_class() -> set[int]:
    """migration의 공백 문자 클래스에 적힌 문자 코드 집합."""
    text = SQL.read_text(encoding="utf-8")
    match = re.search(r"nickname !~ '\^\[([^\]]+)\]'", text)
    assert match, "migration에서 닉네임 공백 클래스를 찾지 못했다"
    codes: set[int] = set()
    for first, last in re.findall(r"\\u([0-9a-f]{4})(?:-\\u([0-9a-f]{4}))?", match.group(1)):
        codes |= set(range(int(first, 16), int(last or first, 16) + 1))
    return codes


def test_the_api_whitespace_rule_is_exactly_the_database_rule():
    assert sql_whitespace_class() == PYTHON_WHITESPACE  # API가 지우는 공백 = DB가 거부하는 앞뒤 공백


@pytest.mark.parametrize("code", sorted(PYTHON_WHITESPACE))
def test_every_whitespace_the_database_rejects_is_trimmed_by_the_api(code):
    ch = chr(code)
    assert parse_nickname_body({"nickname": ch + "ab" + ch}).nickname == "ab"


@pytest.mark.parametrize("code", [0x200B, 0xFEFF, 0x180E])
def test_invisible_characters_that_are_not_whitespace_are_kept_like_in_the_database(code):
    assert chr(code) not in {chr(c) for c in PYTHON_WHITESPACE}
    assert parse_nickname_body({"nickname": chr(code) + "ab"}).nickname == chr(code) + "ab"


def test_validation_failure_is_raised_with_field_messages():
    with pytest.raises(ValidationFailure) as info:
        parse_nickname_body({"nickname": "가", "id": "x"})
    assert info.value.fields == {"nickname": "닉네임은 2~20자여야 합니다.", "id": "허용되지 않는 항목입니다."}
    assert NicknameBody(nickname=" 앨리스 ").nickname == "앨리스"


def test_the_user_id_comes_from_the_token_even_if_body_validation_were_lenient(auth_client, store, monkeypatch):
    """방어층 분리: 본문 검증이 정의되지 않은 필드(id)를 걸러 주지 못해도 저장소에는 토큰의 사용자 ID만 전달된다."""
    monkeypatch.setattr("app.routers.me.parse_nickname_body", lambda data: NicknameBody(nickname=data["nickname"]))
    assert post(auth_client, {"nickname": "앨리스", "id": USER_B.id, "author_id": USER_B.id}, TOKEN_A).status_code == 201
    assert patch(auth_client, {"nickname": "새이름", "id": USER_B.id}, TOKEN_A).status_code == 200
    assert [call[2] for call in store.calls] == [USER_A.id, USER_A.id]
    assert USER_B.id not in store.rows
