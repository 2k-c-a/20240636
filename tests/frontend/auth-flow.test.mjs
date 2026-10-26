// 회원 화면 로직 검사: 입력 규칙·복귀 경로·오류 문구·인증 서비스(가짜 SDK)·프로필 보완·메뉴, 그리고 회원 화면 HTML과 번들 SDK.
// 실제 Supabase 메일·세션 검증은 하지 않는다(실제 프로젝트 확인은 docs/ACCEPTANCE.md의 10단계 항목).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    CALLBACK_PATH, GENERIC_MESSAGE, HOME_PATH, NETWORK_MESSAGE, describeAuthError, nicknameFromMetadata,
    readCallbackError, safeReturnPath, validateEmail, validateLoginPassword, validateNewPassword, validateNickname,
} from '../../frontend/js/auth-forms.js';
import { AUTH_STORAGE_KEY, AuthFailure, NEXT_STORAGE_KEY, createAuthService } from '../../frontend/js/auth.js';
import { describeAuthMenu, hasStoredSession } from '../../frontend/js/auth-menu.js';
import { describeApiError, ensureProfile } from '../../frontend/js/auth-pages.js';
import { ApiError } from '../../frontend/js/api.js';

const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend');

// ---------- 입력 규칙 ----------

test('복귀 경로: 같은 사이트의 허용된 html 경로만 통과한다', () => {
    assert.equal(safeReturnPath('/web/html/visualizer.html'), '/web/html/visualizer.html');
    assert.equal(safeReturnPath('/web/html/visualizer.html?algorithm=bfs&example=basic'), '/web/html/visualizer.html?algorithm=bfs&example=basic');
    for (const bad of [
        'https://evil.example/', '//evil.example/web/html/index.html', '/web/html/../../etc/passwd', 'javascript:alert(1)',
        '/web/html/index.html#x', '/web/html/Index.html', '/api/me', 'index.html', '/web/html/a.html?x=<script>', null, undefined, 5, '',
    ]) {
        assert.equal(safeReturnPath(bad), HOME_PATH, String(bad));
    }
});

test('복귀 경로: 로그인 직후 인증 화면으로 되돌려 보내지 않는다', () => {
    for (const page of ['login', 'signup', 'reset-password', 'auth-callback']) {
        assert.equal(safeReturnPath(`/web/html/${page}.html`), HOME_PATH, page);
    }
    assert.equal(safeReturnPath('/web/html/profile.html'), '/web/html/profile.html');
});

test('이메일 검사', () => {
    assert.deepEqual(validateEmail('  a@b.co '), { ok: true, value: 'a@b.co' });
    for (const bad of ['', '   ', 'a', 'a@b', 'a b@c.d', '@b.co', null, `${'a'.repeat(250)}@b.co`]) {
        assert.equal(validateEmail(bad).ok, false, String(bad));
    }
});

test('비밀번호: 가입·변경은 8자 이상, 로그인은 길이 규칙으로 막지 않는다', () => {
    assert.equal(validateNewPassword('1234567').ok, false);
    assert.equal(validateNewPassword('12345678').ok, true);
    assert.equal(validateNewPassword(undefined).ok, false);
    assert.equal(validateLoginPassword('a').ok, true);
    assert.equal(validateLoginPassword('').ok, false);
    assert.equal(validateNewPassword('  12345678  ').value, '  12345678  ', '비밀번호는 다듬지 않는다');
});

test('닉네임: 앞뒤 공백 제거 후 2~20자, 제어 문자 불가(API·DB와 같은 규칙)', () => {
    assert.deepEqual(validateNickname('  가나  '), { ok: true, value: '가나' });
    assert.equal(validateNickname('가').ok, false);
    assert.equal(validateNickname(' 가 ').ok, false);
    assert.equal(validateNickname('가'.repeat(20)).ok, true);
    assert.equal(validateNickname('가'.repeat(21)).ok, false);
    assert.equal(validateNickname('😀'.repeat(20)).ok, true, '코드 포인트 기준으로 센다');
    assert.equal(validateNickname('가\u0000나').ok, false);
    assert.equal(validateNickname('가\u007f나').ok, false);
    assert.equal(validateNickname(null).ok, false);
});

test('metadata 닉네임은 규칙에 맞을 때만 쓰고 나머지 필드(권한·id)는 읽지 않는다', () => {
    assert.equal(nicknameFromMetadata({ nickname: ' 학생 ', role: 'admin', id: 'x' }), '학생');
    for (const bad of [null, undefined, 'x', {}, { nickname: 5 }, { nickname: 'a' }, { nickname: 'x'.repeat(30) }, { nickname: '가\n나' }]) {
        assert.equal(nicknameFromMetadata(bad), null, JSON.stringify(bad));
    }
});

// ---------- 오류 문구 ----------

test('Auth 오류는 영어 원문 대신 한국어 문구로 바뀐다', () => {
    assert.match(describeAuthError({ code: 'invalid_credentials', message: 'Invalid login credentials' }), /이메일 또는 비밀번호/);
    assert.match(describeAuthError({ code: 'email_not_confirmed' }), /이메일 확인/);
    assert.match(describeAuthError({ code: 'weak_password' }), /너무 약합니다/);
    assert.match(describeAuthError({ code: 'over_email_send_rate_limit' }), /메일 발송 횟수 제한/);
    assert.match(describeAuthError({ code: 'otp_expired' }), /만료/);
    assert.match(describeAuthError({ code: 'flow_state_not_found' }), /같은 브라우저/);
    assert.equal(describeAuthError({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }), NETWORK_MESSAGE);
    assert.equal(describeAuthError({ status: 502 }), NETWORK_MESSAGE);
    assert.match(describeAuthError({ status: 429 }), /요청이 너무 많/);
    assert.equal(describeAuthError({ code: 'something_new', message: 'secret internal detail' }), GENERIC_MESSAGE);
    assert.equal(describeAuthError(null), GENERIC_MESSAGE);
    assert.ok(!/[A-Za-z]{4,}/.test(describeAuthError({ code: 'unknown_thing', message: 'Database error saving new user' })));
});

test('콜백 주소의 오류(만료 링크 등)를 쿼리와 해시에서 읽는다', () => {
    assert.match(readCallbackError('?error=access_denied&error_code=otp_expired&error_description=x', ''), /만료/);
    assert.match(readCallbackError('', '#error=access_denied&error_code=otp_expired'), /만료/);
    assert.match(readCallbackError('?error=access_denied', ''), /만료/);
    assert.equal(readCallbackError('?error=server_error', ''), GENERIC_MESSAGE);
    assert.equal(readCallbackError('?code=abc', ''), null);
    assert.equal(readCallbackError('', ''), null);
});

test('API 오류 문구: 서버의 한국어 메시지를 쓰되 장애·인증 오류는 따로 안내한다', () => {
    assert.equal(describeApiError(new ApiError({ status: 422, code: 'validation_error', message: '입력값을 확인해 주세요.', fields: { nickname: '닉네임은 2~20자여야 합니다.' } })), '닉네임은 2~20자여야 합니다.');
    assert.match(describeApiError(new ApiError({ status: 503, code: 'service_unavailable', message: 'x' })), /일시적으로/);
    const unavailable = describeApiError(new ApiError({ status: 503, code: 'auth_not_configured', message: 'x' }));
    assert.match(unavailable, /관리자/);
    assert.doesNotMatch(unavailable, /Supabase|Publishable|APP_ORIGIN/);
    assert.match(describeApiError(new ApiError({ status: 401, code: 'invalid_token', message: 'x' })), /다시 로그인/);
    assert.equal(describeApiError(new ApiError({ status: 0, code: 'network_error', message: '서버에 연결하지 못했습니다.' })), '서버에 연결하지 못했습니다.');
    assert.equal(describeApiError(new Error('boom')), GENERIC_MESSAGE);
});

// ---------- 인증 서비스(가짜 SDK) ----------

const CONFIG = { enabled: true, url: 'https://x.supabase.co', key: 'sb_publishable_abc', appOrigin: 'http://127.0.0.1:8000' };

function memoryStorage() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        map,
    };
}

/** 호출을 기록하고 미리 정한 결과를 돌려주는 가짜 SDK. */
function fakeSdk(overrides = {}) {
    const calls = [];
    let listener = null;
    let session = overrides.session ?? null;
    const record = (name, result) => async (...args) => {
        calls.push({ name, args });
        const value = typeof result === 'function' ? result(...args) : result;
        if (value instanceof Error) throw value;
        return value;
    };
    const auth = {
        onAuthStateChange: (fn) => { listener = fn; return { data: { subscription: { unsubscribe() {} } } }; },
        getSession: record('getSession', () => ({ data: { session } })),
        signUp: record('signUp', overrides.signUp ?? { data: { session: null, user: { id: 'u1' } }, error: null }),
        signInWithPassword: record('signInWithPassword', overrides.signIn ?? { data: {}, error: null }),
        signOut: record('signOut', overrides.signOut ?? { error: null }),
        resetPasswordForEmail: record('resetPasswordForEmail', overrides.reset ?? { data: {}, error: null }),
        updateUser: record('updateUser', overrides.update ?? { data: {}, error: null }),
        exchangeCodeForSession: record('exchangeCodeForSession', overrides.exchange ?? { data: { session: null }, error: null }),
        refreshSession: record('refreshSession', overrides.refresh ?? { data: { session: null }, error: null }),
    };
    return {
        client: { auth },
        calls,
        emit: (event, next) => { session = next ?? null; listener(event, session); },
        setSession: (next) => { session = next; },
        callsOf: (name) => calls.filter((c) => c.name === name),
    };
}

async function makeService(sdkOverrides = {}, { config = CONFIG, pageOrigin = CONFIG.appOrigin } = {}) {
    const sdk = fakeSdk(sdkOverrides);
    const storage = memoryStorage();
    let created = null;
    const service = createAuthService({
        loadConfig: async () => config,
        createClient: (url, key, options) => { created = { url, key, options }; return sdk.client; },
        storage,
        pageOrigin,
    });
    await service.initAuth();
    return { service, sdk, storage, created: () => created };
}

const SESSION = { access_token: 'access-1', user: { id: 'u1', email: 'a@b.co', user_metadata: { nickname: '학생' } } };

test('설정이 없으면 disabled이고 인증 함수는 not_configured로 실패한다', async () => {
    const { service, created } = await makeService({}, { config: { enabled: false } });
    assert.equal(service.getState().status, 'disabled');
    assert.equal(service.getState().configFailed, false);
    assert.equal(created(), null, 'SDK 클라이언트를 만들지 않는다');
    assert.equal(await service.getAccessToken(), null);
    await assert.rejects(service.signIn({ email: 'a@b.co', password: 'x' }), (e) => e instanceof AuthFailure && e.code === 'not_configured');
});

test('설정을 읽지 못한 경우를 구분해 알린다', async () => {
    const { service } = await makeService({}, { config: { enabled: false, failed: true } });
    assert.equal(service.getState().configFailed, true);
});

test('SDK를 불러오지 못하면 disabled + configFailed로 끝나고 예외를 던지지 않는다', async () => {
    const service = createAuthService({ loadConfig: async () => CONFIG, createClient: async () => { throw new Error('load failed'); } });
    await service.initAuth();
    assert.deepEqual({ status: service.getState().status, failed: service.getState().configFailed }, { status: 'disabled', failed: true });
});

test('클라이언트는 PKCE·세션 저장·고정 저장 키로 한 번만 만든다', async () => {
    const { created, service } = await makeService();
    await service.initAuth();
    assert.equal(created().url, CONFIG.url);
    assert.equal(created().key, CONFIG.key);
    assert.deepEqual({ ...created().options.auth }, {
        flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true, storageKey: AUTH_STORAGE_KEY,
    });
});

test('저장된 세션이 있으면 signed-in이며 상태에는 토큰이 없다', async () => {
    const { service } = await makeService({ session: SESSION });
    const state = service.getState();
    assert.equal(state.status, 'signed-in');
    assert.deepEqual({ ...state.user }, { id: 'u1', email: 'a@b.co' });
    assert.ok(!JSON.stringify(state).includes('access-1'));
    assert.equal(await service.getAccessToken(), 'access-1');
});

test('페이지 주소가 APP_ORIGIN과 다르면 originMismatch로 알린다', async () => {
    const { service } = await makeService({}, { pageOrigin: 'http://localhost:8000' });
    assert.equal(service.getState().originMismatch, true);
});

test('구독자는 즉시 현재 상태를 받고 이후 변화를 받으며, 해제하면 받지 않는다', async () => {
    const { service, sdk } = await makeService();
    const seen = [];
    const off = service.subscribeAuth((s) => seen.push(s.status));
    sdk.emit('SIGNED_IN', SESSION);
    sdk.emit('SIGNED_OUT', null);
    off();
    sdk.emit('SIGNED_IN', SESSION);
    assert.deepEqual(seen, ['signed-out', 'signed-in', 'signed-out']);
});

test('한 구독자가 예외를 던져도 다른 구독자는 계속 받는다', async () => {
    const { service, sdk } = await makeService();
    const seen = [];
    service.subscribeAuth((s) => { if (s.status === 'signed-in') throw new Error('x'); });
    service.subscribeAuth((s) => seen.push(s.status));
    sdk.emit('SIGNED_IN', SESSION);
    assert.deepEqual(seen, ['signed-out', 'signed-in']);
});

test('복구 링크로 들어오면 PASSWORD_RECOVERY로 recovery가 켜지고 로그아웃하면 꺼진다', async () => {
    const { service, sdk } = await makeService();
    assert.equal(service.getState().recovery, false);
    sdk.emit('PASSWORD_RECOVERY', SESSION);
    assert.equal(service.getState().recovery, true);
    sdk.emit('SIGNED_OUT', null);
    assert.equal(service.getState().recovery, false);
});

test('가입: 확인 대기와 즉시 로그인을 구분하고 닉네임은 metadata로, 콜백은 APP_ORIGIN 기준으로 보낸다', async () => {
    const pending = await makeService();
    const result = await pending.service.signUp({ email: ' a@b.co ', password: 'password1', nickname: ' 학생 ', next: '/web/html/visualizer.html' });
    assert.deepEqual(result, { status: 'confirmation-pending' });
    const [{ args: [request] }] = pending.sdk.callsOf('signUp');
    assert.equal(request.email, 'a@b.co');
    assert.deepEqual(request.options.data, { nickname: '학생' });
    assert.equal(request.options.emailRedirectTo, `${CONFIG.appOrigin}${CALLBACK_PATH}`);
    assert.equal(pending.storage.map.get(NEXT_STORAGE_KEY), '/web/html/visualizer.html');

    const immediate = await makeService({ signUp: { data: { session: SESSION, user: SESSION.user }, error: null } });
    assert.deepEqual(await immediate.service.signUp({ email: 'a@b.co', password: 'password1', nickname: '학생' }), { status: 'signed-in' });
});

test('가입: 이미 가입한 이메일도 같은 확인 대기 안내로 처리한다(계정 존재 여부 비노출)', async () => {
    const { service } = await makeService({ signUp: { data: {}, error: { code: 'user_already_exists', message: 'User already registered' } } });
    assert.deepEqual(await service.signUp({ email: 'a@b.co', password: 'password1', nickname: '학생' }), { status: 'confirmation-pending' });
});

test('가입: 잘못된 입력은 SDK를 부르기 전에 한국어로 거절한다', async () => {
    const { service, sdk } = await makeService();
    for (const input of [
        { email: 'bad', password: 'password1', nickname: '학생' },
        { email: 'a@b.co', password: 'short', nickname: '학생' },
        { email: 'a@b.co', password: 'password1', nickname: '가' },
    ]) {
        await assert.rejects(service.signUp(input), (e) => e instanceof AuthFailure && e.code === 'invalid_input' && /[가-힣]/.test(e.message));
    }
    assert.equal(sdk.callsOf('signUp').length, 0);
});

test('가입: 허용되지 않는 복귀 경로는 저장하지 않고 홈으로 바꾼다', async () => {
    const { service, storage } = await makeService();
    await service.signUp({ email: 'a@b.co', password: 'password1', nickname: '학생', next: 'https://evil.example/' });
    assert.equal(storage.map.get(NEXT_STORAGE_KEY), HOME_PATH);
});

test('가입: Supabase 오류는 한국어 문구의 AuthFailure로 바뀌고 원문이 노출되지 않는다', async () => {
    const { service } = await makeService({ signUp: { data: {}, error: { code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' } } });
    await assert.rejects(service.signUp({ email: 'a@b.co', password: 'password1', nickname: '학생' }), (e) => {
        assert.equal(e.code, 'over_email_send_rate_limit');
        assert.ok(!/rate limit exceeded/.test(e.message));
        return true;
    });
});

test('로그인: 틀린 자격 증명은 이메일·비밀번호 중 무엇이 틀렸는지 알리지 않는다', async () => {
    const { service } = await makeService({ signIn: { data: {}, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } } });
    await assert.rejects(service.signIn({ email: 'a@b.co', password: 'whatever' }), /이메일 또는 비밀번호가 올바르지 않습니다/);
});

test('로그인: 기존 비밀번호는 길이 규칙으로 막지 않고 Auth가 판정한다', async () => {
    const { service, sdk } = await makeService();
    await service.signIn({ email: 'a@b.co', password: 'a' });
    assert.equal(sdk.callsOf('signInWithPassword').length, 1);
});

test('로그인: 네트워크 장애는 연결 안내로 알린다', async () => {
    const { service } = await makeService({ signIn: new TypeError('Failed to fetch') });
    await assert.rejects(service.signIn({ email: 'a@b.co', password: 'x' }), (e) => e.message === NETWORK_MESSAGE);
});

test('로그아웃은 이 브라우저의 세션만 끝내고 저장된 복귀 경로를 지운다', async () => {
    const { service, sdk, storage } = await makeService({ session: SESSION });
    storage.setItem(NEXT_STORAGE_KEY, '/web/html/profile.html');
    await service.signOut();
    assert.deepEqual(sdk.callsOf('signOut')[0].args, [{ scope: 'local' }]);
    assert.equal(storage.map.has(NEXT_STORAGE_KEY), false);
});

test('로그아웃: 이미 세션이 없다는 오류는 성공으로 본다', async () => {
    const { service } = await makeService({ signOut: { error: { name: 'AuthSessionMissingError', message: 'x' } } });
    await service.signOut();
});

test('비밀번호 복구 요청: 콜백 주소를 보내고 형식이 틀린 이메일은 거절한다', async () => {
    const { service, sdk } = await makeService();
    await service.requestPasswordReset('a@b.co');
    assert.deepEqual(sdk.callsOf('resetPasswordForEmail')[0].args, ['a@b.co', { redirectTo: `${CONFIG.appOrigin}${CALLBACK_PATH}` }]);
    await assert.rejects(service.requestPasswordReset('nope'), AuthFailure);
});

test('비밀번호 변경: 8자 미만은 거절하고, 성공하면 recovery를 끈다', async () => {
    const { service, sdk } = await makeService({ session: SESSION });
    sdk.emit('PASSWORD_RECOVERY', SESSION);
    await assert.rejects(service.updatePassword('short'), AuthFailure);
    assert.equal(sdk.callsOf('updateUser').length, 0);
    await service.updatePassword('new-password-1');
    assert.deepEqual(sdk.callsOf('updateUser')[0].args, [{ password: 'new-password-1' }]);
    assert.equal(service.getState().recovery, false);
});

test('비밀번호 변경: Supabase가 약한 비밀번호를 거부하면 이유를 한국어로 보여준다', async () => {
    const { service } = await makeService({ session: SESSION, update: { data: {}, error: { code: 'weak_password', message: 'Password should contain...' } } });
    await assert.rejects(service.updatePassword('password1'), /너무 약합니다/);
});

test('콜백 코드 교환: 성공하면 사용자, 만료·다른 브라우저면 한국어 안내로 실패한다', async () => {
    const ok = await makeService({ exchange: { data: { session: SESSION }, error: null } });
    assert.deepEqual({ ...(await ok.service.exchangeCode('code-1')) }, { id: 'u1', email: 'a@b.co' });

    const wrongBrowser = await makeService({ exchange: { data: {}, error: { code: 'flow_state_not_found', message: 'invalid flow state' } } });
    await assert.rejects(wrongBrowser.service.exchangeCode('code-1'), /같은 브라우저/);

    const expired = await makeService({ exchange: { data: {}, error: { code: 'otp_expired', message: 'x' } } });
    await assert.rejects(expired.service.exchangeCode('code-1'), /만료/);

    await assert.rejects(ok.service.exchangeCode(''), AuthFailure);
    await assert.rejects(ok.service.exchangeCode('x'.repeat(600)), AuthFailure);
    assert.equal(ok.sdk.callsOf('exchangeCodeForSession').length, 1);
});

test('콜백의 성공 응답에 사용할 세션이 없으면 로그인을 완료했다고 처리하지 않는다', async () => {
    for (const data of [{}, { user: SESSION.user }, { session: { user: SESSION.user } }, { session: { access_token: 'token' } }]) {
        const { service } = await makeService({ exchange: { data, error: null } });
        await assert.rejects(service.exchangeCode('code-1'), (error) => error instanceof AuthFailure && error.code === 'invalid_code');
    }
});

test('metadata 닉네임: 규칙에 맞을 때만 돌려주고 id·권한 필드는 읽지 않는다', async () => {
    const valid = await makeService({ session: SESSION });
    assert.equal(await valid.service.getMetadataNickname(), '학생');
    const invalid = await makeService({ session: { ...SESSION, user: { ...SESSION.user, user_metadata: { nickname: 'x', role: 'admin', author_id: 'someone' } } } });
    assert.equal(await invalid.service.getMetadataNickname(), null);
});

test('복귀 경로는 한 번만 꺼내지고 저장소가 오염돼도 홈으로 돌아간다', async () => {
    const { service, storage } = await makeService();
    service.setReturnPath('/web/html/profile.html');
    assert.equal(service.takeReturnPath(), '/web/html/profile.html');
    assert.equal(service.takeReturnPath(), HOME_PATH);
    storage.setItem(NEXT_STORAGE_KEY, 'https://evil.example/');
    assert.equal(service.takeReturnPath(), HOME_PATH);
});

test('저장소를 쓸 수 없어도(예외) 인증 서비스는 동작한다', async () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    const sdk = fakeSdk();
    const service = createAuthService({ loadConfig: async () => CONFIG, createClient: () => sdk.client, storage: broken });
    await service.initAuth();
    assert.equal(await service.signUp({ email: 'a@b.co', password: 'password1', nickname: '학생' }).then((r) => r.status), 'confirmation-pending');
    assert.equal(service.takeReturnPath(), HOME_PATH);
});

test('세션 갱신: 성공하면 새 토큰, 실패하면 null', async () => {
    const ok = await makeService({ refresh: { data: { session: { access_token: 'access-2', user: SESSION.user } }, error: null } });
    assert.equal(await ok.service.refreshAccessToken(), 'access-2');
    const failed = await makeService({ refresh: { data: { session: null }, error: { message: 'x' } } });
    assert.equal(await failed.service.refreshAccessToken(), null);
});

// ---------- 프로필 보완 ----------

function fakeApi(handlers) {
    const calls = [];
    const call = (method) => async (path, body) => {
        calls.push({ method, path, body });
        const result = handlers[`${method} ${path}`];
        if (result instanceof Error) throw result;
        return { data: typeof result === 'function' ? result(body) : result };
    };
    return { api: { get: call('GET'), post: call('POST') }, calls };
}

test('프로필이 이미 있으면 가입 metadata로 덮어쓰지 않는다', async () => {
    const { api, calls } = fakeApi({ 'GET /api/me': { id: 'u1', email: 'a@b.co', nickname: '기존' } });
    const result = await ensureProfile(api, async () => '다른이름');
    assert.deepEqual(result, { status: 'ready', nickname: '기존', email: 'a@b.co' });
    assert.deepEqual(calls.map((c) => c.method), ['GET']);
});

test('프로필이 없고 metadata 닉네임이 유효하면 프로필을 만든다', async () => {
    const { api, calls } = fakeApi({
        'GET /api/me': { id: 'u1', email: 'a@b.co', nickname: null },
        'POST /api/me/profile': (body) => ({ nickname: body.nickname }),
    });
    const result = await ensureProfile(api, async () => '학생');
    assert.equal(result.status, 'ready');
    assert.deepEqual(calls[1], { method: 'POST', path: '/api/me/profile', body: { nickname: '학생' } });
    assert.deepEqual(Object.keys(calls[1].body), ['nickname'], '사용자 id 등은 보내지 않는다');
});

test('metadata 닉네임이 없거나 서버가 거부하면 사용자에게 프로필 입력을 요구한다', async () => {
    const none = fakeApi({ 'GET /api/me': { email: 'a@b.co', nickname: null } });
    assert.equal((await ensureProfile(none.api, async () => null)).status, 'needs-profile');
    assert.deepEqual(none.calls.map((c) => c.method), ['GET']);

    const rejected = fakeApi({
        'GET /api/me': { email: 'a@b.co', nickname: null },
        'POST /api/me/profile': new ApiError({ status: 422, code: 'validation_error', message: 'x' }),
    });
    assert.equal((await ensureProfile(rejected.api, async () => '학생')).status, 'needs-profile');
});

test('프로필 생성 중 서버 장애(503)는 삼키지 않고 호출자에게 전달한다', async () => {
    const { api } = fakeApi({
        'GET /api/me': { email: 'a@b.co', nickname: null },
        'POST /api/me/profile': new ApiError({ status: 503, code: 'service_unavailable', message: 'x' }),
    });
    await assert.rejects(ensureProfile(api, async () => '학생'), (e) => e.status === 503);
});

// ---------- 메뉴 ----------

test('메뉴: 로그인 상태일 때만 내 정보·로그아웃으로 바뀐다', () => {
    assert.deepEqual(describeAuthMenu({ status: 'signed-in' }), { kind: 'account' });
    for (const status of ['loading', 'signed-out', 'disabled']) assert.deepEqual(describeAuthMenu({ status }), { kind: 'login' });
    assert.deepEqual(describeAuthMenu(undefined), { kind: 'login' });
});

test('메뉴: 저장된 세션이 있을 때만 인증 모듈을 확인한다', () => {
    assert.equal(hasStoredSession(memoryStorage()), false);
    const storage = memoryStorage();
    storage.setItem(AUTH_STORAGE_KEY, '{}');
    assert.equal(hasStoredSession(storage), true);
    assert.equal(hasStoredSession(null), false);
    assert.equal(hasStoredSession({ getItem: () => { throw new Error('blocked'); } }), false);
});

// ---------- 정적 파일 ----------

const AUTH_HTML = ['signup', 'login', 'reset-password', 'auth-callback', 'profile'];
const html = (name) => readFileSync(join(FRONTEND, 'html', `${name}.html`), 'utf8');

test('번들 SDK: 고정 버전·해시가 vendor/README.md의 기록과 같다', () => {
    const readme = readFileSync(join(FRONTEND, 'js/vendor/README.md'), 'utf8');
    const sha = createHash('sha256').update(readFileSync(join(FRONTEND, 'js/vendor/supabase.js'))).digest('hex');
    assert.ok(readme.includes(sha), 'README의 SHA-256이 실제 파일과 다릅니다');
    assert.match(readme, /\*\*\d+\.\d+\.\d+\*\*/);
    assert.match(readme, /MIT/);
    assert.match(readFileSync(join(FRONTEND, 'js/vendor/supabase.js'), 'utf8'), /^var supabase=/);
});

test('회원 화면: data-auth-page, 레이블 연결, 비밀번호 autocomplete, POST, 초기값 없음', () => {
    for (const name of AUTH_HTML) {
        const source = html(name);
        assert.match(source, new RegExp(`<body data-auth-page="${name}"`), name);
        assert.match(source, /<script type="module" src="\.\.\/js\/auth-pages\.js">/, name);
        assert.match(source, /<link rel="stylesheet" href="\.\.\/css\/auth\.css">/, name);
        for (const form of source.match(/<form[^>]*>/g) ?? []) assert.match(form, /method="post"/, `${name}: 입력이 주소창에 실릴 수 있음`);
        for (const input of source.match(/<input[^>]*>/g) ?? []) {
            const id = input.match(/id="([^"]+)"/)?.[1];
            assert.ok(id && source.includes(`for="${id}"`), `${name}: ${input}에 레이블이 없습니다`);
            if (/type="password"/.test(input)) {
                assert.match(input, /autocomplete="(new-password|current-password)"/, `${name}: 비밀번호 autocomplete`);
                assert.ok(!/\svalue=/.test(input), `${name}: 비밀번호에 초기값이 있습니다`);
            }
        }
    }
});

test('회원 화면: 가입·재설정 폼의 새 비밀번호는 new-password, 로그인은 current-password', () => {
    assert.match(html('login'), /id="password"[^>]*autocomplete="current-password"/);
    assert.match(html('signup'), /id="password"[^>]*autocomplete="new-password"/);
    assert.match(html('reset-password'), /id="password"[^>]*autocomplete="new-password"/);
});

test('회원 화면: 상태 안내 영역에 role이 있어 스크린 리더가 읽는다', () => {
    for (const name of AUTH_HTML) assert.match(html(name), /role="(status|alert)"/, name);
});

test('내 정보 화면만 로그인이 필요한 화면(data-requires-auth)으로 표시한다', () => {
    assert.match(html('profile'), /data-requires-auth/);
    for (const name of AUTH_HTML.filter((n) => n !== 'profile')) assert.ok(!/data-requires-auth/.test(html(name)), name);
});

test('일반 페이지는 SDK를 직접 불러오지 않는다(로그인한 적이 있을 때만 동적으로 불러옴)', () => {
    for (const file of readdirSync(join(FRONTEND, 'html'))) {
        assert.ok(!/vendor\/supabase\.js/.test(readFileSync(join(FRONTEND, 'html', file), 'utf8')), file);
    }
});

test('프런트엔드 소스에 비밀 키·토큰을 둘 만한 문자열이 없다', () => {
    const files = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) walk(path);
            else if (/\.(js|html|css|json)$/.test(entry.name) && !path.includes(`${join('js', 'vendor')}`)) files.push(path);
        }
    };
    walk(FRONTEND);
    for (const path of files) {
        const text = readFileSync(path, 'utf8');
        assert.ok(!/sb_secret_/.test(text), `${path}: sb_secret_`);
        assert.ok(!/service_role/.test(text), `${path}: service_role`);
        assert.ok(!/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(text), `${path}: JWT처럼 보이는 문자열`);
    }
});

test('콜백 화면은 읽은 즉시 주소의 인증 코드를 지운다(replaceState가 교환보다 먼저)', () => {
    const source = readFileSync(join(FRONTEND, 'js/auth-pages.js'), 'utf8');
    const callback = source.slice(source.indexOf('async function initCallback'), source.indexOf('async function initProfile'));
    assert.ok(callback.indexOf('replaceState') > 0);
    assert.ok(callback.indexOf('replaceState') < callback.indexOf('exchangeCode('));
});

test('프런트엔드 소스는 비밀번호·토큰을 console이나 저장소에 쓰지 않는다', () => {
    for (const name of ['auth.js', 'auth-pages.js', 'auth-forms.js', 'auth-menu.js', 'api.js', 'public-config.js']) {
        const text = readFileSync(join(FRONTEND, 'js', name), 'utf8');
        assert.ok(!/console\./.test(text), `${name}: console 사용`);
        assert.ok(!/sessionStorage\.setItem\([^)]*(password|token)/i.test(text), name);
    }
});
