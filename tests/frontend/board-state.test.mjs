// 게시판 화면 로직 검사: 초안 검사, 오류 분류, 목록 상태 전이, 글 화면 상태 전이, 정적 HTML.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ApiError, createApiClient } from '../../frontend/js/api.js';
import {
    BODY_MAX, TITLE_MAX, algorithmLabel, canLoadMore, changesFrom, classifyError, emptyList, isBusy, listQuery,
    loadingPost, reduceList, reducePost, validateDraft,
} from '../../frontend/js/board-state.js';

const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend');
const post = (n, extra = {}) => ({ id: `id-${n}`, title: `글${n}`, author_display_name: '앨리스', algorithm_id: null, created_at: '2026-10-14T05:30:00Z', version: 1, ...extra });
const err = (status, code = 'x', extra = {}) => new ApiError({ status, code, message: '서버 메시지', ...extra });

// ---------- 초안 ----------

test('초안 검사: 제목은 앞뒤 공백을 지우고 1~100자, 본문은 공백만 불가', () => {
    const ok = validateDraft({ title: '  질문  ', body: '줄1\n줄2', algorithmId: 'bfs' });
    assert.deepEqual(ok, { ok: true, value: { title: '질문', body: '줄1\n줄2', algorithm_id: 'bfs' } });
    assert.equal(validateDraft({ title: 'x', body: 'y', algorithmId: '' }).value.algorithm_id, null);
    for (const [draft, field] of [
        [{ title: '', body: 'b' }, 'title'], [{ title: '   ', body: 'b' }, 'title'], [{ title: 'x'.repeat(TITLE_MAX + 1), body: 'b' }, 'title'],
        [{ title: 't', body: '' }, 'body'], [{ title: 't', body: ' \n ' }, 'body'], [{ title: 't', body: 'x'.repeat(BODY_MAX + 1) }, 'body'],
        [{ title: 't', body: 'b', algorithmId: 'quick' }, 'algorithmId'], [{ title: 't\u0000', body: 'b' }, 'title'], [{}, 'title'], [null, 'body'],
    ]) {
        const result = validateDraft(draft);
        assert.equal(result.ok, false, JSON.stringify(draft));
        assert.ok(field in result.fields, `${JSON.stringify(draft)} → ${Object.keys(result.fields)}`);
    }
    assert.equal(validateDraft({ title: '😀'.repeat(TITLE_MAX), body: '😀'.repeat(BODY_MAX) }).ok, true, '코드 포인트 수로 센다');
});

test('수정 요청은 바뀐 필드만 담고 바뀐 것이 없으면 null', () => {
    const original = { title: '제목', body: '본문', algorithm_id: 'bfs' };
    assert.equal(changesFrom(original, { title: '제목', body: '본문', algorithm_id: 'bfs' }), null);
    assert.deepEqual(changesFrom(original, { title: '새', body: '본문', algorithm_id: 'bfs' }), { title: '새' });
    assert.deepEqual(changesFrom(original, { title: '제목', body: '본문', algorithm_id: null }), { algorithm_id: null }, '연결 제거는 null로 보낸다');
});

test('알고리즘 이름', () => {
    assert.match(algorithmLabel('bfs'), /BFS/);
    assert.equal(algorithmLabel('nope'), null);
    assert.equal(algorithmLabel(null), null);
});

// ---------- 오류 분류 ----------

test('오류 분류: 상태 코드별 종류와 쓰기 요청의 불확실한 실패', () => {
    assert.equal(classifyError(err(401)).kind, 'login');
    assert.equal(classifyError(err(403, 'profile_required')).kind, 'profile');
    assert.equal(classifyError(err(403, 'forbidden')).kind, 'forbidden');
    assert.equal(classifyError(err(404)).kind, 'gone');
    assert.equal(classifyError(err(412)).kind, 'conflict');
    assert.equal(classifyError(err(428)).kind, 'unexpected');
    assert.equal(classifyError(err(429)).kind, 'rate');
    assert.deepEqual(classifyError(err(422, 'validation_error', { fields: { title: '짧음' } })).fields, { title: '짧음' });
    assert.equal(classifyError(err(500)).kind, 'unknown');
    for (const status of [0, 503]) {
        assert.equal(classifyError(err(status), { write: false }).kind, 'unavailable');
        const written = classifyError(err(status), { write: true });
        assert.equal(written.kind, 'uncertain');
        assert.match(written.message, /자동으로 다시 보내지 않았습니다/);
    }
});

// ---------- 목록 ----------

const page = (items, next = null) => ({ items, next_cursor: next });

test('목록: 첫 페이지 → 더 보기 → 마지막 페이지', () => {
    let state = reduceList(emptyList(), { type: 'filter', filter: null });
    assert.equal(state.status, 'loading');
    assert.equal(canLoadMore(state), false);
    state = reduceList(state, { type: 'loaded', generation: state.generation, page: page([post(1), post(2)], 'CUR1') });
    assert.deepEqual([state.status, state.items.length, canLoadMore(state)], ['ready', 2, true]);
    assert.equal(listQuery(state), 'limit=20&cursor=CUR1');
    state = reduceList(state, { type: 'more' });
    assert.equal(state.status, 'loading');
    state = reduceList(state, { type: 'loaded', generation: state.generation, page: page([post(3)]) });
    assert.deepEqual([state.items.map((p) => p.id), state.nextCursor, canLoadMore(state)], [['id-1', 'id-2', 'id-3'], null, false]);
});

test('목록: 빈 목록은 ready이고 더 볼 것이 없다', () => {
    let state = reduceList(emptyList(), { type: 'filter', filter: null });
    state = reduceList(state, { type: 'loaded', generation: state.generation, page: page([]) });
    assert.deepEqual([state.status, state.items.length, canLoadMore(state)], ['ready', 0, false]);
});

test('목록: 읽는 중 더 보기를 또 눌러도 상태가 바뀌지 않는다(중복 클릭)', () => {
    let state = reduceList(emptyList(), { type: 'filter', filter: null });
    state = reduceList(state, { type: 'loaded', generation: state.generation, page: page([post(1)], 'C') });
    const loading = reduceList(state, { type: 'more' });
    assert.equal(reduceList(loading, { type: 'more' }), loading);
    const noNext = reduceList(emptyList(), { type: 'more' });
    assert.equal(noNext.status, 'loading', '아직 읽는 중이면 더 보기는 무시된다');
});

test('목록: 필터를 바꾸면 목록과 cursor를 버리고 이전 요청의 늦은 응답은 무시한다', () => {
    let state = reduceList(emptyList(), { type: 'filter', filter: null });
    const oldGeneration = state.generation;
    state = reduceList(state, { type: 'loaded', generation: oldGeneration, page: page([post(1)], 'OLD') });
    state = reduceList(state, { type: 'more' });
    state = reduceList(state, { type: 'filter', filter: 'bfs' });
    assert.deepEqual([state.items.length, state.nextCursor, state.filter, state.status], [0, null, 'bfs', 'loading']);
    assert.equal(listQuery(state), 'limit=20&algorithm=bfs', '필터를 바꾸면 cursor를 보내지 않는다');
    const late = reduceList(state, { type: 'loaded', generation: oldGeneration, page: page([post(9)], 'LATE') });
    assert.equal(late, state, '이전 세대의 응답은 반영되지 않는다');
    const failedLate = reduceList(state, { type: 'failed', generation: oldGeneration, error: { message: 'x' } });
    assert.equal(failedLate, state);
});

test('목록: 필터와 cursor를 함께 보낸다', () => {
    let state = reduceList(emptyList(), { type: 'filter', filter: 'dfs' });
    state = reduceList(state, { type: 'loaded', generation: state.generation, page: page([post(1)], 'C2') });
    assert.equal(listQuery(state, 5), 'limit=5&algorithm=dfs&cursor=C2');
});

test('목록: 읽기에 실패해도 이미 읽은 글은 남고 다시 시도할 수 있다', () => {
    let state = reduceList(emptyList(), { type: 'filter', filter: null });
    state = reduceList(state, { type: 'loaded', generation: state.generation, page: page([post(1)], 'C') });
    state = reduceList(state, { type: 'more' });
    state = reduceList(state, { type: 'failed', generation: state.generation, error: { message: '연결 실패' } });
    assert.deepEqual([state.status, state.items.length, state.error.message], ['error', 1, '연결 실패']);
    assert.equal(canLoadMore(state), false, '오류 중에는 더 보기를 막는다');
    state = reduceList(state, { type: 'retry' });
    assert.equal(state.status, 'loading');
    assert.equal(listQuery(state), 'limit=20&cursor=C', '실패한 같은 위치부터 다시 읽는다');
    state = reduceList(state, { type: 'loaded', generation: state.generation, page: page([post(2)]) });
    assert.equal(state.items.length, 2);
});

test('목록: 같은 글이 두 번 오면(페이지 사이에 새 글이 생긴 경우) 중복으로 넣지 않는다', () => {
    let state = reduceList(emptyList(), { type: 'filter', filter: null });
    state = reduceList(state, { type: 'loaded', generation: state.generation, page: page([post(1), post(2)], 'C') });
    state = reduceList(state, { type: 'more' });
    state = reduceList(state, { type: 'loaded', generation: state.generation, page: page([post(2), post(3)]) });
    assert.deepEqual(state.items.map((p) => p.id), ['id-1', 'id-2', 'id-3']);
});

test('목록: 응답이 없을 때(loading이 아닐 때) 도착한 응답은 무시한다', () => {
    const state = reduceList(emptyList(), { type: 'filter', filter: null });
    const ready = reduceList(state, { type: 'loaded', generation: state.generation, page: page([post(1)]) });
    assert.equal(reduceList(ready, { type: 'loaded', generation: ready.generation, page: page([post(2)]) }), ready);
});

// ---------- 글 화면 ----------

const detail = (extra = {}) => ({ ...post(1), author_id: 'u1', body: '본문', updated_at: '2026-10-14T05:30:00Z', ...extra });
const viewing = (extra) => reducePost(loadingPost(), { type: 'loaded', post: detail(extra) });
const editing = () => reducePost(viewing(), { type: 'edit' });
const saving = (draft) => {
    let state = editing();
    if (draft) state = reducePost(state, { type: 'draft', draft });
    return reducePost(state, { type: 'save' });
};

test('글 화면: 읽기 → 수정 시작은 현재 글로 초안을 채운다', () => {
    const state = editing();
    assert.equal(state.phase, 'editing');
    assert.deepEqual(state.draft, { title: '글1', body: '본문', algorithmId: '' });
});

test('글 화면: 저장 성공이면 새 글로 바뀌고 초안은 사라진다', () => {
    let state = saving({ title: '새 제목' });
    assert.equal(state.phase, 'saving');
    assert.equal(isBusy(state), true);
    state = reducePost(state, { type: 'saved', post: detail({ title: '새 제목', version: 2 }) });
    assert.deepEqual([state.phase, state.post.title, state.draft], ['viewing', '새 제목', null]);
});

test('글 화면: 412 충돌이면 최신 글을 보여 주되 초안은 그대로다', () => {
    const latest = detail({ title: '남이 바꾼 제목', version: 2 });
    let state = saving({ title: '내 초안', body: '내가 쓰던 본문' });
    state = reducePost(state, { type: 'save-failed', kind: 'conflict', message: '충돌', latest });
    assert.equal(state.phase, 'conflict');
    assert.equal(state.draft.title, '내 초안');
    assert.equal(state.draft.body, '내가 쓰던 본문');
    assert.equal(state.conflictWith.title, '남이 바꾼 제목');
    assert.equal(state.post.version, 1, '화면의 기준 글은 사용자가 선택하기 전에는 바뀌지 않는다');
    // 최신 글을 기준으로 삼아도 초안은 유지된다
    state = reducePost(state, { type: 'use-latest' });
    assert.deepEqual([state.phase, state.post.version, state.draft.title], ['editing', 2, '내 초안']);
    // 다시 저장할 수 있다
    assert.equal(reducePost(state, { type: 'save' }).phase, 'saving');
});

test('글 화면: 충돌 상태에서 바로 다시 저장은 허용하지만 최신 글 없이는 use-latest가 동작하지 않는다', () => {
    let state = saving({ title: '내 초안' });
    state = reducePost(state, { type: 'save-failed', kind: 'conflict', message: '충돌', latest: null });
    assert.equal(reducePost(state, { type: 'use-latest' }), state);
    assert.equal(state.draft.title, '내 초안');
});

test('글 화면: 404면 삭제됨 상태가 되고 초안은 남는다', () => {
    const state = reducePost(saving({ title: '내 초안' }), { type: 'save-failed', kind: 'gone', message: '삭제됨' });
    assert.deepEqual([state.phase, state.draft.title], ['gone', '내 초안']);
    // 삭제된 뒤에도 초안을 닫기 전에는 남아 있고, 닫아도 삭제됨 안내는 유지된다
    const closed = reducePost(state, { type: 'cancel-edit' });
    assert.deepEqual([closed.phase, closed.draft, closed.message], ['gone', null, '삭제됨']);
});

test('글 화면: 401이면 같은 페이지에서 다시 로그인하고 초안으로 돌아온다', () => {
    let state = reducePost(saving({ title: '내 초안', body: '긴 본문' }), { type: 'save-failed', kind: 'login', message: '만료' });
    assert.equal(state.phase, 'relogin');
    assert.equal(state.draft.body, '긴 본문');
    state = reducePost(state, { type: 'draft', draft: { body: '로그인 화면에서도 고친 본문' } });
    state = reducePost(state, { type: 'relogged' });
    assert.deepEqual([state.phase, state.draft.body], ['editing', '로그인 화면에서도 고친 본문']);
});

test('글 화면: 검증 오류·불확실한 실패·권한 오류는 수정 화면으로 돌아오며 초안을 지우지 않는다', () => {
    for (const [kind, extra] of [['validation', { fields: { title: '짧음' } }], ['uncertain', {}], ['forbidden', {}], ['unknown', {}]]) {
        const state = reducePost(saving({ title: '내 초안' }), { type: 'save-failed', kind, message: '안내', ...extra });
        assert.equal(state.phase, 'editing', kind);
        assert.equal(state.draft.title, '내 초안', kind);
        assert.equal(state.message, '안내');
        assert.deepEqual(state.fields, extra.fields ?? {});
    }
});

test('글 화면: 충돌 중 다시 저장했다 실패하면 충돌 화면으로 돌아온다', () => {
    let state = reducePost(saving({ title: '초안' }), { type: 'save-failed', kind: 'conflict', message: '충돌', latest: detail({ version: 2 }) });
    state = reducePost(state, { type: 'save' });
    state = reducePost(state, { type: 'save-failed', kind: 'uncertain', message: '응답 없음' });
    assert.equal(state.phase, 'conflict');
    assert.equal(state.draft.title, '초안');
});

test('글 화면: 수정을 취소하면 초안을 버린다(사용자의 선택일 때만)', () => {
    const state = reducePost(editing(), { type: 'cancel-edit' });
    assert.deepEqual([state.phase, state.draft], ['viewing', null]);
});

test('글 화면: 요청 중에는 모든 조작이 막히고 엉뚱한 단계의 동작은 무시된다', () => {
    const busy = saving();
    assert.equal(isBusy(busy), true);
    for (const type of ['edit', 'save', 'ask-delete', 'delete', 'cancel-edit']) assert.equal(reducePost(busy, { type }), busy, type);
    assert.equal(reducePost(viewing(), { type: 'save' }).phase, 'viewing');
    assert.equal(reducePost(viewing(), { type: 'delete' }).phase, 'viewing', '확인 없이는 삭제하지 않는다');
});

test('글 화면: 삭제는 확인을 거치고 성공하면 removed', () => {
    let state = reducePost(viewing(), { type: 'ask-delete' });
    assert.equal(state.phase, 'confirming-delete');
    assert.equal(reducePost(state, { type: 'cancel-delete' }).phase, 'viewing');
    state = reducePost(state, { type: 'delete' });
    assert.equal(isBusy(state), true);
    state = reducePost(state, { type: 'deleted' });
    assert.deepEqual([state.phase, state.post], ['removed', null]);
});

test('글 화면: 삭제 실패 — 404는 삭제됨, 412는 최신 글로 돌아가 다시 확인, 401은 다시 로그인', () => {
    const deleting = () => reducePost(reducePost(viewing(), { type: 'ask-delete' }), { type: 'delete' });
    assert.equal(reducePost(deleting(), { type: 'delete-failed', kind: 'gone', message: '없음' }).phase, 'gone');
    const conflict = reducePost(deleting(), { type: 'delete-failed', kind: 'conflict', message: '충돌', latest: detail({ version: 3, title: '최신' }) });
    assert.deepEqual([conflict.phase, conflict.post.version, conflict.post.title], ['viewing', 3, '최신']);
    const login = reducePost(deleting(), { type: 'delete-failed', kind: 'login', message: '만료' });
    assert.equal(login.phase, 'relogin');
    assert.equal(login.post.title, '글1', '삭제하려던 글은 그대로 보인다');
    assert.equal(reducePost(login, { type: 'relogged' }).phase, 'viewing');
    const uncertain = reducePost(deleting(), { type: 'delete-failed', kind: 'uncertain', message: '응답 없음' });
    assert.deepEqual([uncertain.phase, uncertain.message], ['viewing', '응답 없음']);
});

test('글 화면: 읽기 실패는 404와 그 밖을 구분한다', () => {
    assert.equal(reducePost(loadingPost(), { type: 'load-failed', kind: 'gone', message: '없음' }).phase, 'gone');
    assert.equal(reducePost(loadingPost(), { type: 'load-failed', kind: 'unavailable', message: '연결 실패' }).phase, 'load-error');
});

// ---------- API 클라이언트: 읽기 재시도 ----------

function sequence(responses) {
    const calls = [];
    const queue = [...responses];
    const fetchFn = async (path, init) => {
        calls.push({ path, init });
        const next = queue.shift();
        if (next instanceof Error) throw next;
        return next;
    };
    return { fetchFn, calls };
}
const res = (status, body = {}) => ({ ok: status < 300, status, headers: new Headers(), json: async () => body });
const errBody = (code) => ({ error: { code, message: 'm', request_id: 'r' } });

test('API: GET은 네트워크 오류·503일 때 지정한 횟수까지만 다시 시도한다', async () => {
    const { fetchFn, calls } = sequence([new TypeError('x'), res(503, errBody('service_unavailable')), res(200, { ok: 1 })]);
    const api = createApiClient({ getAccessToken: async () => null, fetchFn });
    const { data } = await api.get('/api/posts', { auth: false, retries: 2, retryDelayMs: 1 });
    assert.deepEqual(data, { ok: 1 });
    assert.equal(calls.length, 3);
});

test('API: 재시도 횟수를 넘으면 마지막 오류를 던지고, 4xx·기본값은 다시 시도하지 않는다', async () => {
    const down = sequence([res(503, errBody('service_unavailable')), res(503, errBody('service_unavailable')), res(200)]);
    await assert.rejects(createApiClient({ getAccessToken: async () => null, fetchFn: down.fetchFn }).get('/api/posts', { retries: 1, retryDelayMs: 1 }), (e) => e.status === 503);
    assert.equal(down.calls.length, 2);
    const notFound = sequence([res(404, errBody('not_found')), res(200)]);
    await assert.rejects(createApiClient({ getAccessToken: async () => null, fetchFn: notFound.fetchFn }).get('/api/posts/x', { retries: 3, retryDelayMs: 1 }), (e) => e.status === 404);
    assert.equal(notFound.calls.length, 1);
    const plain = sequence([res(503, errBody('service_unavailable')), res(200)]);
    await assert.rejects(createApiClient({ getAccessToken: async () => null, fetchFn: plain.fetchFn }).get('/api/posts'), (e) => e.status === 503);
    assert.equal(plain.calls.length, 1);
});

test('API: 쓰기(POST·PATCH·DELETE)는 retries를 줘도 다시 보내지 않는다', async () => {
    for (const method of ['post', 'patch', 'delete']) {
        const { fetchFn, calls } = sequence([new TypeError('x'), res(200)]);
        const api = createApiClient({ getAccessToken: async () => 't', fetchFn });
        const call = method === 'delete' ? api.delete('/api/posts/x', { retries: 3, retryDelayMs: 1 }) : api[method]('/api/posts', {}, { retries: 3, retryDelayMs: 1 });
        await assert.rejects(call, (e) => e.status === 0);
        assert.equal(calls.length, 1, method);
    }
});

test('API: 재시도 대기 중 취소하면 중단된다', async () => {
    const controller = new AbortController();
    const { fetchFn, calls } = sequence([res(503, errBody('service_unavailable')), res(200)]);
    const api = createApiClient({ getAccessToken: async () => null, fetchFn });
    const pending = api.get('/api/posts', { retries: 2, retryDelayMs: 50, signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    await assert.rejects(pending, (e) => e.name === 'AbortError');
    assert.equal(calls.length, 1);
});

// ---------- 정적 HTML·소스 ----------

const html = (name) => readFileSync(join(FRONTEND, 'html', `${name}.html`), 'utf8');
const js = (name) => readFileSync(join(FRONTEND, 'js', `${name}.js`), 'utf8');

test('게시판 페이지: 공통 구성, 상태 알림 영역, 입력의 레이블 연결', () => {
    for (const name of ['board', 'post']) {
        const source = html(name);
        assert.match(source, new RegExp(`<body data-board-page="${name}"`));
        assert.match(source, new RegExp(`<script type="module" src="\\.\\./js/${name}\\.js">`));
        assert.match(source, /<link rel="stylesheet" href="\.\.\/css\/board\.css">/);
        assert.match(source, /role="status"/);
        for (const input of source.match(/<(input|textarea|select)[^>]*>/g) ?? []) {
            const id = input.match(/id="([^"]+)"/)?.[1];
            assert.ok(id && source.includes(`for="${id}"`), `${name}: ${input}`);
        }
        for (const form of source.match(/<form[^>]*>/g) ?? []) assert.match(form, /method="post"/);
        for (const password of source.match(/<input[^>]*type="password"[^>]*>/g) ?? []) assert.match(password, /autocomplete="current-password"/);
    }
});

test('게시판 페이지: 다시 로그인 폼이 같은 페이지 안에 있다(초안 보존)', () => {
    for (const name of ['board', 'post']) assert.match(html(name), /id="relogin-form"/);
});

test('사용자 글은 textContent로만 넣는다(HTML로 해석하는 API를 쓰지 않는다)', () => {
    for (const name of ['board', 'post', 'board-common']) {
        const source = js(name);
        for (const banned of [/\.innerHTML/, /\.outerHTML/, /insertAdjacentHTML/, /document\.write/, /\beval\(/, /new Function/, /dangerouslySet/]) {
            assert.ok(!banned.test(source), `${name}.js: ${banned}`);
        }
    }
    assert.match(js('post'), /\$\('#post-body'\)\.textContent = post\.body/);
    assert.match(readFileSync(join(FRONTEND, 'css/board.css'), 'utf8'), /\.board-body\s*\{[^}]*white-space:\s*pre-wrap/);
});

test('게시판 소스는 토큰·비밀번호를 기록하거나 저장하지 않는다', () => {
    for (const name of ['board', 'post', 'board-common', 'board-state']) {
        const source = js(name);
        assert.ok(!/console\./.test(source), `${name}: console`);
        assert.ok(!/(localStorage|sessionStorage)\.setItem/.test(source), `${name}: 저장소 쓰기`);
    }
});

test('수정·삭제는 If-Match를 보내고 오류가 나도 초안 입력창을 비우지 않는다', () => {
    const source = js('post');
    assert.equal((source.match(/'If-Match': etag/g) ?? []).length, 2);
    assert.ok(!/form\.reset\(\)/.test(source), '글 수정 화면은 입력창을 reset하지 않는다');
});
