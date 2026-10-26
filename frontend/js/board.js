// 게시판 목록 화면(board.html): 목록·필터·더 보기·글쓰기.
// 비회원은 읽기만 한다. 글쓰기 폼은 로그인한 회원 중 프로필(닉네임)이 있는 사람에게만 보이며, 이것은 편의일 뿐 권한은 서버(API·DB)가 검사한다.

import { ApiError } from './api.js';
import {
    algorithmLabel, canLoadMore, classifyError, emptyList, listQuery, reduceList, validateDraft,
} from './board-state.js';
import {
    bootBoard, fillAlgorithmSelect, formatDate, h, onAuthChange, say, setBusy, setupRelogin, showFieldErrors,
} from './board-common.js';
import { createRequestGate } from './request-gate.js';
import { createProfileRefresh, exclusiveWrite } from './board-requests.js';

const $ = (selector) => document.querySelector(selector);

async function main() {
    const filter = $('#board-filter');
    const list = $('#board-list');
    const more = $('#board-more');
    const status = $('#board-status');
    const retry = $('#board-retry');
    const writeGate = $('#board-write-gate');
    const form = $('#board-form');
    const formMessage = $('#board-form-message');
    const relogin = $('#relogin-form');
    fillAlgorithmSelect(filter, { includeAll: true });
    fillAlgorithmSelect(form.elements.algorithm);

    const { auth, user: initialUser, api } = await bootBoard();
    let user = initialUser;
    let nickname = null; // 프로필이 있으면 닉네임
    let state = emptyList(new URLSearchParams(location.search).get('algorithm'));
    if (state.filter && !algorithmLabel(state.filter)) state = emptyList(null); // 주소의 알 수 없는 필터는 무시
    filter.value = state.filter ?? '';
    const gate = createRequestGate();

    // ---------- 목록 ----------
    function renderItem(post) {
        const link = h('a', { href: `post.html?id=${encodeURIComponent(post.id)}`, text: post.title });
        const meta = h('p', { class: 'board-meta' });
        meta.append(
            h('span', { text: post.author_display_name }),
            h('span', { text: formatDate(post.created_at) }),
        );
        const label = algorithmLabel(post.algorithm_id);
        if (label) meta.append(h('span', { class: 'board-tag', text: label }));
        return h('li', { class: 'board-item' }, h('h3', {}, link), meta);
    }

    function render() {
        list.replaceChildren(...state.items.map(renderItem));
        list.setAttribute('aria-busy', String(state.status === 'loading'));
        more.hidden = !canLoadMore(state);
        more.disabled = state.status === 'loading';
        retry.hidden = state.status !== 'error';
        if (state.status === 'loading') {
            say(status, state.items.length ? '다음 글을 불러오는 중입니다…' : '글을 불러오는 중입니다…');
        } else if (state.status === 'error') {
            say(status, state.error.message, 'error');
        } else if (state.items.length === 0) {
            say(status, state.filter ? '이 알고리즘의 글이 아직 없습니다.' : '아직 글이 없습니다. 첫 글을 써 보세요.');
        } else {
            say(status, canLoadMore(state) ? '' : '마지막 글입니다.');
        }
    }

    async function load() {
        const request = gate.begin();
        const { generation } = state;
        try {
            const { data } = await api.get(`/api/posts?${listQuery(state)}`, { auth: false, signal: request.signal, retries: 2 });
            if (request.isCurrent()) state = reduceList(state, { type: 'loaded', generation, page: data });
        } catch (error) {
            if (error?.name === 'AbortError' || !request.isCurrent()) return;
            state = reduceList(state, { type: 'failed', generation, error: classifyError(error instanceof ApiError ? error : { status: -1 }) });
        }
        render();
    }

    function dispatch(action) {
        const before = state;
        state = reduceList(state, action);
        render();
        if (state !== before && state.status === 'loading') void load();
    }

    filter.addEventListener('change', () => {
        const next = filter.value || null;
        const url = new URL(location.href);
        if (next) url.searchParams.set('algorithm', next);
        else url.searchParams.delete('algorithm');
        history.replaceState(null, '', url);
        dispatch({ type: 'filter', filter: next });
    });
    more.addEventListener('click', () => dispatch({ type: 'more' }));
    retry.addEventListener('click', () => dispatch({ type: 'retry' }));
    dispatch({ type: 'filter', filter: state.filter });

    // ---------- 글쓰기 ----------
    function renderGate() {
        form.hidden = true;
        writeGate.replaceChildren();
        if (!user) {
            writeGate.append(
                '글을 쓰려면 ', h('a', { href: 'login.html?next=/web/html/board.html', text: '로그인' }),
                '이 필요합니다. 계정이 없다면 ', h('a', { href: 'signup.html', text: '회원가입' }), '을 해 주세요.',
            );
        } else if (nickname === null) {
            writeGate.append('글을 쓰려면 먼저 ', h('a', { href: 'profile.html?next=/web/html/board.html', text: '프로필(닉네임)' }), '을 만들어 주세요.');
        } else {
            writeGate.append(`${nickname} 님으로 글을 씁니다.`);
            form.hidden = false;
        }
    }

    const loadProfile = createProfileRefresh({
        api,
        onLoading: () => { nickname = null; renderGate(); },
        onLoaded: (profile) => { nickname = profile?.nickname ?? null; renderGate(); },
        onError: (error) => { form.hidden = true; writeGate.textContent = classifyError(error).message; },
    });
    const refreshProfile = () => loadProfile(user);

    form.addEventListener('submit', exclusiveWrite(async () => {
        const draft = { title: form.elements.title.value, body: form.elements.body.value, algorithmId: form.elements.algorithm.value };
        const checked = validateDraft(draft);
        showFieldErrors(form, checked.ok ? {} : checked.fields, { algorithm: 'algorithmId' });
        if (!checked.ok) {
            say(formMessage, '입력값을 확인해 주세요.', 'error');
            return;
        }
        setBusy(form, true);
        say(formMessage, '저장하는 중입니다…');
        try {
            await api.post('/api/posts', checked.value);
            form.reset();
            say(formMessage, '글을 올렸습니다.', 'ok');
            relogin.hidden = true;
            // 필터를 걸어 둔 채라면 새 글이 안 보일 수 있으므로 필터를 풀고 처음부터 다시 읽는다.
            filter.value = '';
            history.replaceState(null, '', location.pathname);
            dispatch({ type: 'filter', filter: null });
        } catch (error) {
            const info = classifyError(error instanceof ApiError ? error : { status: -1 }, { write: true });
            // 초안은 입력창에 그대로 남아 있다. 어떤 오류에서도 지우지 않는다.
            if (info.kind === 'validation') showFieldErrors(form, info.fields, { algorithm: 'algorithm_id' });
            if (info.kind === 'login') relogin.hidden = false;
            if (info.kind === 'profile') await refreshProfile();
            say(formMessage, info.message, 'error');
        } finally {
            setBusy(form, false);
        }
    }));

    if (auth) {
        setupRelogin(relogin, auth, async () => {
            await refreshProfile();
            say(formMessage, '다시 로그인했습니다. 내용을 확인하고 다시 올려 주세요.', 'ok');
            const target = form.hidden ? writeGate : formMessage;
            target.setAttribute('tabindex', '-1');
            target.focus();
        });
        onAuthChange(auth, (next) => {
            const changed = next?.id !== user?.id;
            user = next;
            if (changed) void refreshProfile();
        });
    }
    await refreshProfile();
}

main().catch(() => {
    const status = $('#board-status');
    if (status) say(status, '게시판을 불러오지 못했습니다. 새로고침해 주세요.', 'error');
});
