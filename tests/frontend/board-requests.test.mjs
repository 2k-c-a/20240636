import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfileRefresh, exclusiveWrite } from '../../frontend/js/board-requests.js';
import { validateDraft } from '../../frontend/js/board-state.js';

const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};

function profileFixture() {
    const calls = [], events = [];
    const refresh = createProfileRefresh({
        api: { get: (path, options) => {
            const wait = deferred();
            calls.push({ path, ...options, ...wait });
            return wait.promise;
        } },
        onLoading: () => events.push('loading'),
        onLoaded: (value) => events.push(value),
        onError: (error) => events.push(error.message),
    });
    return { refresh, calls, events };
}

test('계정 A의 늦은 응답은 B의 프로필을 덮어쓰지 못한다', async () => {
    const f = profileFixture();
    const a = f.refresh({ id: 'a' });
    const b = f.refresh({ id: 'b' });
    assert.equal(f.calls[0].signal.aborted, true);
    assert.equal(f.calls[1].path, '/api/me');
    f.calls[1].resolve({ data: { id: 'b', nickname: '비' } });
    await b;
    f.calls[0].resolve({ data: { id: 'a', nickname: '에이' } });
    await a;
    assert.deepEqual(f.events, ['loading', 'loading', { id: 'b', nickname: '비' }]);
});

test('로그아웃 후 늦은 프로필 응답과 오류를 모두 무시한다', async () => {
    for (const fail of [false, true]) {
        const f = profileFixture();
        const pending = f.refresh({ id: 'a' });
        await f.refresh(null);
        assert.equal(f.calls[0].signal.aborted, true);
        if (fail) f.calls[0].reject(new Error('이전 오류'));
        else f.calls[0].resolve({ data: { id: 'a', nickname: '이전 사용자' } });
        await pending;
        assert.deepEqual(f.events, ['loading', 'loading', null]);
    }
});

test('현재 프로필 요청 실패는 안내하고 다음 요청으로 복구할 수 있다', async () => {
    const f = profileFixture();
    const failed = f.refresh({ id: 'a' });
    f.calls[0].reject(new Error('연결 실패'));
    await failed;
    const recovered = f.refresh({ id: 'a' });
    f.calls[1].resolve({ data: { id: 'a', nickname: null } });
    await recovered;
    assert.deepEqual(f.events, ['loading', '연결 실패', 'loading', { id: 'a', nickname: null }]);
});

test('현재 사용자와 다른 id의 프로필 응답은 작성자 표시로 사용하지 않는다', async () => {
    const f = profileFixture();
    const pending = f.refresh({ id: 'a' });
    f.calls[0].resolve({ data: { id: 'b', nickname: '다른 사용자' } });
    await pending;
    assert.equal(typeof f.events.at(-1), 'string');
    assert.match(f.events.at(-1), /로그인 정보/);
});

test('쓰기 대기 중 중복 이벤트를 취소하고 한 번만 전송하며 완료 뒤 다시 쓸 수 있다', async () => {
    let count = 0, prevented = 0;
    const wait = deferred();
    const write = exclusiveWrite(async () => { count++; await wait.promise; });
    const event = { preventDefault() { prevented++; } };
    const pending = write(event);
    await write(event);
    assert.equal(count, 1);
    assert.equal(prevented, 2);
    wait.resolve();
    await pending;
    await write(event);
    assert.equal(count, 2);
});

test('쓰기 오류는 자동 재전송하지 않고 다음 명시적 시도를 허용한다', async () => {
    let count = 0;
    const write = exclusiveWrite(async () => { count++; throw new Error('응답 유실'); });
    await assert.rejects(write({ preventDefault() {} }), /응답 유실/);
    assert.equal(count, 1);
    await assert.rejects(write({ preventDefault() {} }), /응답 유실/);
    assert.equal(count, 2);
});

test('저장 불가 문자는 해당 입력의 오류로 표시하고 정상 이모지는 허용한다', () => {
    for (const field of ['title', 'body']) {
        for (const value of ['bad\u0000', 'bad\ud800', 'bad\udfff']) {
            const result = validateDraft({ title: '제목', body: '본문', [field]: value });
            assert.equal(result.ok, false);
            assert.ok(result.fields[field]);
        }
    }
    assert.equal(validateDraft({ title: '정상 😀', body: '안녕하세요\n😀' }).ok, true);
});
