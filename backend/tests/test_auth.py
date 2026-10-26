"""현재 사용자 확인: 토큰 누락·형식 오류·만료/위조·검증 서비스 장애, A/B 사용자 문맥 분리, 토큰이 로그에 남지 않는지.

인증(Supabase Auth)은 가짜 검증기로 바꿔서 확인한다. 실제 `SupabaseTokenVerifier`가 HTTP를 어떻게 해석하는지는 tests/test_supabase_requests.py에 있다.
"""

import logging

import pytest

from app.errors import ApiError, service_unavailable
from conftest import TOKEN_A, TOKEN_B, USER_A, USER_B, bearer


def error_of(response) -> dict:
    return response.json()["error"]


def test_missing_authorization_is_401_unauthenticated(auth_client, verifier):
    response = auth_client.get("/api/me")
    assert response.status_code == 401
    assert error_of(response)["code"] == "unauthenticated"
    assert response.headers["www-authenticate"] == "Bearer"
    assert verifier.calls == []  # 헤더가 없으면 검증 서비스를 부르지 않는다


@pytest.mark.parametrize("header", ["Basic dXNlcjpwYXNz", "Bearer", "Bearer ", "Bearer a b", "Token abc", "abc", "Bearer " + "x" * 5000])
def test_malformed_authorization_is_401_invalid_token(auth_client, verifier, header):
    response = auth_client.get("/api/me", headers={"Authorization": header})
    assert response.status_code == 401
    assert error_of(response)["code"] == "invalid_token"
    assert verifier.calls == []


@pytest.mark.parametrize("token", ["abc\x00def", "abc\x1fdef", "abc\x7fdef", "abc\x80def", "토큰"])
def test_non_printable_or_non_ascii_bearer_is_rejected_before_verification(token):
    from app.dependencies import extract_bearer_token

    with pytest.raises(ApiError) as failure:
        extract_bearer_token(f"Bearer {token}")
    assert (failure.value.status_code, failure.value.code) == (401, "invalid_token")


@pytest.mark.parametrize("token", [b"abc\x00def", b"abc\x7fdef", b"abc\x80def"])
def test_invalid_bearer_bytes_never_reach_auth_or_profile_store(auth_client, verifier, store, token):
    response = auth_client.get("/api/me", headers=[(b"Authorization", b"Bearer " + token)])
    assert response.status_code == 401
    assert error_of(response)["code"] == "invalid_token"
    assert verifier.calls == []
    assert store.calls == []


@pytest.mark.parametrize("scheme", ["Bearer", "bearer", "BEARER"])
def test_scheme_is_case_insensitive(auth_client, scheme):
    response = auth_client.get("/api/me", headers={"Authorization": f"{scheme} {TOKEN_A}"})
    assert response.status_code == 200


def test_expired_or_forged_token_is_401_invalid_token(auth_client, verifier):
    for token in ["expired.token.value", "forged.token.value", TOKEN_A[:-1]]:
        response = auth_client.get("/api/me", headers=bearer(token))
        assert response.status_code == 401, token
        assert error_of(response)["code"] == "invalid_token"
        assert "www-authenticate" in response.headers
    assert len(verifier.calls) == 3


def test_verification_service_down_is_503_and_never_allows_access(auth_client, verifier, store):
    verifier.table[TOKEN_A] = service_unavailable()
    response = auth_client.get("/api/me", headers=bearer(TOKEN_A))
    assert response.status_code == 503
    assert error_of(response)["code"] == "service_unavailable"
    assert store.calls == []  # 판정할 수 없으면 DB에 접근하지 않는다
    # 쓰기 요청도 마찬가지다
    assert auth_client.post("/api/me/profile", json={"nickname": "앨리스"}, headers=bearer(TOKEN_A)).status_code == 503
    assert store.calls == []


def test_unexpected_verifier_failure_is_a_clean_500_without_details(auth_client, verifier, store):
    verifier.table[TOKEN_A] = RuntimeError("내부 사정 SECRET-INTERNAL-DETAIL")
    response = auth_client.get("/api/me", headers=bearer(TOKEN_A))
    assert response.status_code == 500
    assert error_of(response)["code"] == "internal_error"
    assert "SECRET-INTERNAL-DETAIL" not in response.text
    assert store.calls == []


def test_unconfigured_auth_is_503_auth_not_configured_with_or_without_a_token(client):
    for headers in [{}, bearer(TOKEN_A)]:
        response = client.get("/api/me", headers=headers)
        assert response.status_code == 503
        assert error_of(response)["code"] == "auth_not_configured"
    assert client.post("/api/me/profile", json={"nickname": "앨리스"}, headers=bearer(TOKEN_A)).status_code == 503
    assert client.patch("/api/me/profile", json={"nickname": "앨리스"}, headers=bearer(TOKEN_A)).status_code == 503


def test_error_body_has_the_common_shape_and_request_id_matches_the_header(auth_client):
    response = auth_client.get("/api/me")
    error = error_of(response)
    assert set(error) == {"code", "message", "request_id"}
    assert error["request_id"] == response.headers["x-request-id"]
    assert len(error["request_id"]) == 32
    assert response.headers["cache-control"] == "no-store"
    assert error["message"].strip()


def test_client_supplied_request_id_is_ignored(auth_client):
    response = auth_client.get("/api/me", headers={"X-Request-ID": "client-chosen-id"})
    assert response.headers["x-request-id"] != "client-chosen-id"
    assert error_of(response)["request_id"] == response.headers["x-request-id"]


def test_each_request_gets_its_own_request_id(auth_client):
    ids = {auth_client.get("/api/health").headers["x-request-id"] for _ in range(5)}
    assert len(ids) == 5


def test_user_id_and_email_come_from_the_verified_token_for_each_user(auth_client, store):
    a = auth_client.get("/api/me", headers=bearer(TOKEN_A))
    b = auth_client.get("/api/me", headers=bearer(TOKEN_B))
    assert a.json() == {"id": USER_A.id, "email": USER_A.email, "nickname": None}
    assert b.json() == {"id": USER_B.id, "email": USER_B.email, "nickname": None}  # 프로필이 없어도 200
    assert [(call[0], call[2]) for call in store.calls] == [("get", USER_A.id), ("get", USER_B.id)]


def test_alternating_users_never_share_context(auth_client, store):
    """A, B, A, B 순서로 요청해도 매번 그 요청의 토큰과 사용자 ID로만 저장소를 부른다(앞 요청의 사용자가 남지 않는다)."""
    for _ in range(3):
        for token, user in [(TOKEN_A, USER_A), (TOKEN_B, USER_B)]:
            response = auth_client.get("/api/me", headers=bearer(token))
            assert response.json()["id"] == user.id
    for _, token, user_id, *_ in store.calls:
        assert (token, user_id) in {(TOKEN_A, USER_A.id), (TOKEN_B, USER_B.id)}


def test_a_request_without_a_token_after_a_logged_in_one_is_still_rejected(auth_client):
    assert auth_client.get("/api/me", headers=bearer(TOKEN_A)).status_code == 200
    assert auth_client.get("/api/me").status_code == 401  # 전역 로그인 상태가 남지 않는다


def test_the_token_is_never_logged_or_returned(auth_client, verifier, caplog):
    caplog.set_level(logging.DEBUG)
    verifier.table["broken.SENTINEL-TOKEN"] = service_unavailable()
    verifier.table["crash.SENTINEL-TOKEN"] = RuntimeError("boom")
    responses = [
        auth_client.get("/api/me", headers=bearer(TOKEN_A)),
        auth_client.get("/api/me", headers=bearer("forged.SENTINEL-TOKEN")),
        auth_client.get("/api/me", headers=bearer("broken.SENTINEL-TOKEN")),
        auth_client.get("/api/me", headers=bearer("crash.SENTINEL-TOKEN")),
        auth_client.post("/api/me/profile", json={"nickname": "앨리스"}, headers=bearer(TOKEN_A)),
        auth_client.patch("/api/me/profile", json={"nickname": "?"}, headers=bearer(TOKEN_B)),
    ]
    for response in responses:
        assert "SENTINEL-TOKEN" not in response.text
        assert "SENTINEL-A" not in response.text and "SENTINEL-B" not in response.text
        assert "SENTINEL" not in str(dict(response.headers))
    assert "SENTINEL" not in caplog.text


def test_current_user_repr_hides_the_token():
    from app.dependencies import CurrentUser

    assert "SENTINEL-X" not in repr(CurrentUser(user=USER_A, token="abc.SENTINEL-X"))


def test_api_error_class_carries_status_code_and_headers():
    error = ApiError(418, "teapot", "차를 끓이는 중", headers={"X-Test": "1"})
    assert (error.status_code, error.code, error.headers) == (418, "teapot", {"X-Test": "1"})


def test_a_success_response_without_a_usable_user_is_never_trusted(monkeypatch, auth_config):
    """인증 서비스가 200이라고 해도 사용할 수 있는 사용자 정보가 없으면 확인했다고 볼 수 없으므로 503이다(허용하지 않는다)."""
    from types import SimpleNamespace

    from app.services.auth import SupabaseTokenVerifier

    bad_responses = [
        None,
        SimpleNamespace(user=None),
        SimpleNamespace(user=SimpleNamespace(id="not-a-uuid", email="a@example.test")),
        SimpleNamespace(user=SimpleNamespace(id=None, email=None)),
    ]
    for response in bad_responses:
        client = SimpleNamespace(auth=SimpleNamespace(get_user=lambda token, r=response: r))
        monkeypatch.setattr("app.services.auth.create_anon_client", lambda config, http_client=None, c=client: c)
        with pytest.raises(ApiError) as info:
            SupabaseTokenVerifier().verify(auth_config, TOKEN_A)
        assert (info.value.status_code, info.value.code) == (503, "service_unavailable")
