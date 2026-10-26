import pytest
from fastapi.testclient import TestClient

from app.config import AppConfig
from app.main import create_app
from app.security import connection_sources


@pytest.mark.parametrize("path", ["/", "/api/health", "/api/no-such-path", "/api/me", "/web/html/visualizer.html", "/web/js/auth.js", "/web/no-file", "/web/../backend/.env"])
def test_common_headers_cover_success_redirect_and_errors(client, path):
    response = client.get(path, follow_redirects=False)
    assert response.headers['x-content-type-options'] == 'nosniff'
    assert response.headers['x-frame-options'] == 'DENY'
    assert response.headers['referrer-policy'] == 'no-referrer'
    assert response.headers['permissions-policy'] == 'camera=(), microphone=(), geolocation=()'
    csp = response.headers['content-security-policy']
    assert "script-src 'self'" in csp
    assert "object-src 'none'" in csp
    assert "base-uri 'none'" in csp
    assert "form-action 'self'" in csp
    assert "frame-ancestors 'none'" in csp
    assert 'unsafe-inline' not in csp and 'unsafe-eval' not in csp


def test_only_configured_auth_origin_is_permitted_and_secret_never_used(auth_config):
    with TestClient(create_app(config=auth_config)) as client:
        headers = client.get('/web/html/login.html').headers
    csp = headers['content-security-policy']
    assert "connect-src 'self' https://example-project.supabase.co wss://example-project.supabase.co;" in csp
    assert '*.supabase.co' not in csp
    assert auth_config.supabase_secret_key not in str(headers)
    assert auth_config.supabase_publishable_key not in str(headers)


def test_google_frames_are_only_allowed_on_map(client):
    assert 'frame-src https://maps.google.com https://www.google.com;' in client.get('/web/html/map.html').headers['content-security-policy']
    for path in ['/web/html/auth-callback.html', '/web/html/board.html', '/web/html/visualizer.html']:
        assert "frame-src 'none';" in client.get(path).headers['content-security-policy']


@pytest.mark.parametrize('url', ["https://example.test'; script-src *", 'https://user:password@example.test', 'file:///tmp/file', 'https://example.test:bad'])
def test_bad_connection_origin_cannot_inject_policy(url):
    config = AppConfig(supabase_url=url, supabase_publishable_key='public', app_origin='http://127.0.0.1:8000')
    assert connection_sources(config) == []


def test_local_supabase_origin_keeps_its_port():
    config = AppConfig(supabase_url='http://127.0.0.1:54321', supabase_publishable_key='public', app_origin='http://127.0.0.1:8000')
    assert connection_sources(config) == ['http://127.0.0.1:54321', 'ws://127.0.0.1:54321']


def test_unexpected_server_error_keeps_headers_without_internal_message():
    app = create_app(config=AppConfig())
    @app.get('/api/test-failure')
    def failure():
        raise RuntimeError('PRIVATE-INTERNAL-SQL')
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get('/api/test-failure')
    assert response.status_code == 500
    assert response.headers['referrer-policy'] == 'no-referrer'
    assert response.headers['x-content-type-options'] == 'nosniff'
    assert 'PRIVATE-INTERNAL-SQL' not in response.text


def test_development_docs_remain_available_with_other_headers(client):
    response = client.get('/docs')
    assert response.status_code == 200
    assert 'content-security-policy' not in response.headers
    assert response.headers['referrer-policy'] == 'no-referrer'
