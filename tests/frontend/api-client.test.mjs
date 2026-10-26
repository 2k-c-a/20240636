// api.js와 public-config.js 검사. fetch를 가짜로 바꿔 네트워크 없이 실행한다.
import test from 'node:test';
import assert from 'node:assert/strict';

import { ApiError, createApiClient } from '../../frontend/js/api.js';
import { DISABLED_CONFIG, loadPublicConfig, parsePublicConfig } from '../../frontend/js/public-config.js';

function jsonResponse(status, body, headers = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers(headers),
        json: async () => {
            if (body === undefined) throw new SyntaxError('no body');
            return body;
        },
    };
}

function errorBody(code, message = '오류', extra = {}) {
    return { error: { code, message, request_id: 'req1', ...extra } };
}

function makeClient(responses, { token = 'tok-1', refreshTo = null } = {}) {
    const calls = [];
    const queue = [...responses];
    const fetchFn = async (path, init) => {
        calls.push({ path, init });
        const next = queue.shift();
        if (next instanceof Error) throw next;
        return next;
    };
    const client = createApiClient({
        getAccessToken: async () => token,
        refreshAccessToken: async () => refreshTo,
        fetchFn,
    });
    return { client, calls };
}

test('Bearer 토큰을 보내고 JSON 본문을 돌려준다', async () => {
    const { client, calls } = makeClient([jsonResponse(200, { id: 'u1' })]);
    const { data } = await client.get('/api/me');
    assert.deepEqual(data, { id: 'u1' });
    assert.equal(calls[0].init.headers.Authorization, 'Bearer tok-1');
    assert.equal(calls[0].init.cache, 'no-store');
});

test('본문이 있으면 JSON으로 보내고 Content-Type을 붙인다', async () => {
    const { client, calls } = makeClient([jsonResponse(201, { nickname: '가나' })]);
    await client.post('/api/me/profile', { nickname: '가나' });
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
    assert.equal(calls[0].init.body, JSON.stringify({ nickname: '가나' }));
});

test('auth:false이면 토큰을 보내지 않는다', async () => {
    const { client, calls } = makeClient([jsonResponse(200, {})]);
    await client.get('/api/posts', { auth: false });
    assert.equal('Authorization' in calls[0].init.headers, false);
});

test('토큰이 다른 주소로 가지 않도록 /api/ 경로만 허용한다', async () => {
    const { client, calls } = makeClient([]);
    for (const path of ['https://evil.example/api/me', '//evil.example/api/me', '/web/html/index.html', 'api/me', undefined]) {
        await assert.rejects(client.get(path), TypeError, String(path));
    }
    assert.equal(calls.length, 0);
});

test('204는 본문 없이 성공한다', async () => {
    const { client } = makeClient([jsonResponse(204, undefined)]);
    const result = await client.delete('/api/posts/x', { headers: { 'If-Match': '"v"' } });
    assert.equal(result.data, null);
    assert.equal(result.status, 204);
});

test('오류 응답은 ApiError(상태·코드·메시지·필드·request_id)로 바뀐다', async () => {
    const { client } = makeClient([jsonResponse(422, errorBody('validation_error', '입력값을 확인해 주세요.', { fields: { nickname: '짧음' } }))]);
    await assert.rejects(client.post('/api/me/profile', { nickname: 'a' }), (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 422);
        assert.equal(error.code, 'validation_error');
        assert.deepEqual(error.fields, { nickname: '짧음' });
        assert.equal(error.requestId, 'req1');
        return true;
    });
});

test('JSON이 아닌 오류 본문도 상태 코드로 처리한다', async () => {
    const { client } = makeClient([jsonResponse(502, undefined)]);
    await assert.rejects(client.get('/api/me'), (error) => error instanceof ApiError && error.status === 502 && error.code === 'unknown');
});

test('401이면 세션을 갱신해 토큰이 바뀐 경우에만 한 번 다시 보낸다', async () => {
    const { client, calls } = makeClient(
        [jsonResponse(401, errorBody('invalid_token')), jsonResponse(200, { ok: 1 })],
        { refreshTo: 'tok-2' },
    );
    const { data } = await client.get('/api/me');
    assert.deepEqual(data, { ok: 1 });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].init.headers.Authorization, 'Bearer tok-2');
});

test('갱신 후에도 401이면 더 보내지 않고 오류로 끝낸다', async () => {
    const { client, calls } = makeClient(
        [jsonResponse(401, errorBody('invalid_token')), jsonResponse(401, errorBody('invalid_token')), jsonResponse(200, {})],
        { refreshTo: 'tok-2' },
    );
    await assert.rejects(client.get('/api/me'), (error) => error.status === 401);
    assert.equal(calls.length, 2);
});

test('갱신이 안 되거나 토큰이 그대로면 다시 보내지 않는다', async () => {
    for (const refreshTo of [null, 'tok-1']) {
        const { client, calls } = makeClient([jsonResponse(401, errorBody('invalid_token')), jsonResponse(200, {})], { refreshTo });
        await assert.rejects(client.get('/api/me'), (error) => error.status === 401);
        assert.equal(calls.length, 1, `refreshTo=${refreshTo}`);
    }
});

test('503과 네트워크 오류는 다시 보내지 않는다(쓰기 요청의 중복 방지)', async () => {
    const unavailable = makeClient([jsonResponse(503, errorBody('service_unavailable')), jsonResponse(200, {})], { refreshTo: 'tok-2' });
    await assert.rejects(unavailable.client.post('/api/me/profile', { nickname: '가나' }), (error) => error.status === 503);
    assert.equal(unavailable.calls.length, 1);

    const offline = makeClient([new TypeError('Failed to fetch'), jsonResponse(200, {})], { refreshTo: 'tok-2' });
    await assert.rejects(offline.client.post('/api/me/profile', { nickname: '가나' }), (error) => error instanceof ApiError && error.status === 0 && error.code === 'network_error');
    assert.equal(offline.calls.length, 1);
});

test('사용자가 취소한 요청(AbortError)은 ApiError로 바꾸지 않는다', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const { client } = makeClient([abort]);
    await assert.rejects(client.get('/api/me'), (error) => error.name === 'AbortError');
});

test('성공 응답의 본문이 깨져 있으면 invalid_response 오류다', async () => {
    const { client } = makeClient([jsonResponse(200, undefined)]);
    await assert.rejects(client.get('/api/me'), (error) => error.code === 'invalid_response');
});

// ---------- 공개 설정 ----------

const ENABLED = { supabase_url: 'https://x.supabase.co', supabase_publishable_key: 'sb_publishable_abc', app_origin: 'http://127.0.0.1:8000', auth_enabled: true };

test('공개 설정: 세 값이 모두 있어야 활성이다', () => {
    assert.deepEqual({ ...parsePublicConfig(ENABLED) }, { enabled: true, url: ENABLED.supabase_url, key: ENABLED.supabase_publishable_key, appOrigin: ENABLED.app_origin });
    for (const broken of [
        null, 'x', {}, { ...ENABLED, auth_enabled: false }, { ...ENABLED, supabase_url: null },
        { ...ENABLED, supabase_publishable_key: '' }, { ...ENABLED, app_origin: 5 },
    ]) {
        assert.equal(parsePublicConfig(broken), DISABLED_CONFIG);
    }
});

test('공개 설정: 응답의 다른 필드(예: 비밀 값)는 결과에 옮기지 않는다', () => {
    const config = parsePublicConfig({ ...ENABLED, supabase_secret_key: 'sb_secret_nope' });
    assert.deepEqual(Object.keys(config).sort(), ['appOrigin', 'enabled', 'key', 'url']);
});

test('공개 설정: 서버 오류나 네트워크 오류는 비활성 + failed로 알린다', async () => {
    const down = await loadPublicConfig(async () => jsonResponse(503, {}));
    assert.deepEqual({ ...down }, { ...DISABLED_CONFIG, failed: true });
    const offline = await loadPublicConfig(async () => { throw new TypeError('x'); });
    assert.equal(offline.failed, true);
    assert.equal(offline.enabled, false);
});

test('공개 설정: 설정이 없는 서버(auth_enabled:false)는 failed가 아니다', async () => {
    const config = await loadPublicConfig(async () => jsonResponse(200, { auth_enabled: false, supabase_url: null, supabase_publishable_key: null, app_origin: null }));
    assert.equal(config.enabled, false);
    assert.equal(config.failed, undefined);
});
