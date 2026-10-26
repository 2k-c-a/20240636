"""공통 오류 형식과 요청 ID: `/api/` 아래만 새 형식을 쓰고, 정적 파일 응답은 그대로 두며, 처리하지 못한 예외도 내용을 새기지 않는다."""

import logging

from fastapi.testclient import TestClient

from app.main import create_app


def test_unknown_api_path_uses_the_common_error_shape(client):
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "not_found"
    assert error["request_id"] == response.headers["x-request-id"]


def test_wrong_method_on_an_api_path_is_a_405_in_the_common_shape(client):
    response = client.post("/api/health")
    assert response.status_code == 405
    assert response.json()["error"]["code"] == "method_not_allowed"
    assert "allow" in response.headers


def test_static_404_keeps_its_original_response_but_still_has_a_request_id(client):
    response = client.get("/web/html/nope.html")
    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}  # 정적 파일 응답은 기존 형식 그대로
    assert response.headers["x-request-id"]


def test_every_kind_of_response_has_a_request_id(client):
    for path in ["/", "/api/health", "/api/config", "/web/html/index.html", "/web/js/visualizer.js", "/api/nope", "/web/nope"]:
        assert client.get(path, follow_redirects=False).headers.get("x-request-id"), path


def test_unhandled_exception_returns_a_generic_500_and_logs_only_the_kind(caplog):
    app = create_app()

    @app.get("/api/boom")
    def boom():
        raise RuntimeError("SECRET-EXCEPTION-MESSAGE token=SENTINEL")

    caplog.set_level(logging.DEBUG)
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/api/boom?key=SENTINEL-QUERY")
    assert response.status_code == 500
    error = response.json()["error"]
    assert error["code"] == "internal_error"
    assert error["request_id"] == response.headers["x-request-id"]
    assert "SECRET-EXCEPTION-MESSAGE" not in response.text
    # 우리 코드가 남긴 기록에는 예외 종류와 request_id만 있고 메시지는 없다
    own = [r for r in caplog.records if r.name.startswith("app.")]
    assert any("RuntimeError" in r.getMessage() and error["request_id"] in r.getMessage() for r in own)
    assert all("SECRET-EXCEPTION-MESSAGE" not in r.getMessage() for r in own)


def test_validation_error_handler_uses_the_common_shape():
    app = create_app()

    @app.get("/api/number/{value}")
    def number(value: int):
        return {"value": value}

    with TestClient(app) as client:
        response = client.get("/api/number/abc")
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert "value" in error["fields"]
    assert error["request_id"] == response.headers["x-request-id"]
