"""실제 Supabase SDK가 전송하는 댓글 요청의 사용자 토큰·게시글·작성자 필터를 검증한다."""
import json

import httpx

from app.services.comments import SupabaseCommentStore
from conftest import TOKEN_A, USER_A

POST_ID = '11111111-1111-4111-8111-111111111111'
COMMENT_ID = '22222222-2222-4222-8222-222222222222'


def test_comment_sdk_requests_keep_user_permissions(auth_config):
    requests = []
    row = {'id': COMMENT_ID, 'post_id': POST_ID, 'author_id': USER_A.id,
           'author_display_name': '앨리스', 'body': '설명', 'created_at': '2026-10-26T00:00:00Z'}

    def handle(request):
        requests.append(request)
        assert request.url.path == '/rest/v1/comments'
        return httpx.Response(200 if request.method != 'POST' else 201, json=[row])

    with httpx.Client(transport=httpx.MockTransport(handle)) as http:
        store = SupabaseCommentStore(http)
        assert str(store.list(auth_config, POST_ID, limit=21, after=None)[0].id) == COMMENT_ID
        assert store.create(auth_config, TOKEN_A, POST_ID, USER_A.id, '설명').body == '설명'
        assert store.delete(auth_config, TOKEN_A, POST_ID, COMMENT_ID, USER_A.id)
    read, create, delete = requests
    assert read.url.params['post_id'] == f'eq.{POST_ID}'
    assert read.url.params['limit'] == '21'
    assert read.headers['apikey'] == auth_config.supabase_publishable_key
    assert TOKEN_A not in read.headers.get('authorization', '')
    assert create.headers['authorization'] == f'Bearer {TOKEN_A}'
    assert json.loads(create.content) == {'post_id': POST_ID, 'author_id': USER_A.id, 'body': '설명'}
    assert delete.headers['authorization'] == f'Bearer {TOKEN_A}'
    assert delete.url.params['post_id'] == f'eq.{POST_ID}'
    assert delete.url.params['id'] == f'eq.{COMMENT_ID}'
    assert delete.url.params['author_id'] == f'eq.{USER_A.id}'
    assert all(auth_config.supabase_secret_key not in str(request.headers) for request in requests)
