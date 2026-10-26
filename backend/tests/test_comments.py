"""댓글의 인증·입력·게시글 경계와 페이지네이션, 사용자 권한을 검증한다."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4
import json

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.services.comments import Comment
from conftest import TOKEN_A, TOKEN_B, USER_A, USER_B, bearer


class MemoryComments:
    def __init__(self):
        self.rows = []

    def list(self, config, post_id, *, limit, after):
        rows = [r for r in self.rows if str(r.post_id) == post_id]
        if after:
            rows = [r for r in rows if (r.created_at, str(r.id)) < (after.created_at, after.id)]
        return sorted(rows, key=lambda r: (r.created_at, str(r.id)), reverse=True)[:limit]

    def create(self, config, token, post_id, user_id, body):
        row = Comment(id=uuid4(), post_id=post_id, author_id=user_id, author_display_name="테스트 회원", body=body,
                      created_at=datetime(2026, 10, 26, tzinfo=timezone.utc) + timedelta(seconds=len(self.rows)))
        self.rows.append(row)
        return row

    def delete(self, config, token, post_id, comment_id, user_id):
        for row in self.rows:
            if (str(row.post_id), str(row.id), str(row.author_id)) == (post_id, comment_id, user_id):
                self.rows.remove(row)
                return True
        return False


@pytest.fixture
def comments_client(auth_config, verifier, store, post_store):
    store.create_if_absent(None, "test", USER_A.id, "앨리스")
    store.create_if_absent(None, "test", USER_B.id, "보브")
    app = create_app(config=auth_config, token_verifier=verifier, profile_store=store,
                     post_store=post_store, comment_store=MemoryComments())
    with TestClient(app) as client:
        yield client


def make_post(client):
    return client.post('/api/posts', json={"title": "질문", "body": "설명"}, headers=bearer(TOKEN_A)).json()['id']


def test_public_read_authenticated_write_and_own_delete(comments_client):
    client = comments_client
    path = f'/api/posts/{make_post(client)}/comments'
    assert client.get(path).json() == {"items": [], "next_cursor": None}
    assert client.post(path, json={"body": "댓글"}).status_code == 401
    response = client.post(path, json={"body": "<script>alert(1)</script>\n설명"}, headers=bearer(TOKEN_A))
    assert response.status_code == 201
    row = response.json()
    assert row['author_id'] == USER_A.id
    assert 'email' not in row
    assert client.get(path).json()['items'][0]['body'] == row['body']
    assert client.delete(f"{path}/{row['id']}", headers=bearer(TOKEN_B)).status_code == 404
    assert len(client.get(path).json()['items']) == 1
    assert client.delete(f"{path}/{row['id']}", headers=bearer(TOKEN_A)).status_code == 204
    assert client.get(path).json()['items'] == []


@pytest.mark.parametrize('body', ['', ' \n\t', '가'*2001, None, 12, '\x00', '\ud800'])
def test_invalid_comments_rejected(comments_client, body):
    path = f'/api/posts/{make_post(comments_client)}/comments'
    assert comments_client.post(path, content=json.dumps({"body": body}), headers={**bearer(TOKEN_A), "Content-Type": "application/json"}).status_code == 422
    assert comments_client.get(path).json()['items'] == []


def test_no_impersonation_unknown_fields_or_cross_post_delete(comments_client):
    client = comments_client
    first, second = make_post(client), make_post(client)
    path = f'/api/posts/{first}/comments'
    assert client.post(path, json={"body": "텍스트", "author_id": USER_B.id}, headers=bearer(TOKEN_A)).status_code == 422
    row = client.post(path, json={"body": "😀"*2000}, headers=bearer(TOKEN_A)).json()
    assert client.delete(f"/api/posts/{second}/comments/{row['id']}", headers=bearer(TOKEN_A)).status_code == 404
    assert len(client.get(path).json()['items']) == 1


def test_paging_cursor_bound_to_post(comments_client):
    client = comments_client
    first, second = make_post(client), make_post(client)
    path = f'/api/posts/{first}/comments'
    for i in range(3):
        assert client.post(path, json={"body": f"의견{i}"}, headers=bearer(TOKEN_A)).status_code == 201
    page = client.get(path, params={"limit": 2}).json()
    assert [r['body'] for r in page['items']] == ['의견2', '의견1']
    rest = client.get(path, params={"cursor": page['next_cursor']}).json()
    assert [r['body'] for r in rest['items']] == ['의견0']
    assert rest['next_cursor'] is None
    assert client.get(f'/api/posts/{second}/comments', params={"cursor": page['next_cursor']}).status_code == 400
    assert client.get(path, params={"cursor": 'bad'}).status_code == 400


def test_missing_post_profile_and_invalid_paths(comments_client, store):
    client = comments_client
    path = f'/api/posts/{make_post(client)}/comments'
    store.rows.pop(USER_A.id)
    assert client.post(path, json={"body": "의견"}, headers=bearer(TOKEN_A)).status_code == 403
    assert client.get('/api/posts/99999999-9999-4999-8999-999999999999/comments').status_code == 404
    assert client.get('/api/posts/invalid/comments').status_code == 422
    assert client.get(path, params={"limit": 100}).status_code == 422
