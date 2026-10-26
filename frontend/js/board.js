// 게시판 목록 화면: 목록·필터·더 보기. 작성은 compose.js가 담당한다.
// 누구나 읽을 수 있으며, 작성 버튼으로 별도 페이지에 이동한다.

import { ApiError } from './api.js';
import {
    algorithmLabel, canLoadMore, classifyError, emptyList, listQuery, reduceList,
} from './board-state.js';
import {
    bootBoard, fillAlgorithmSelect, formatDate, h, say,
} from './board-common.js';
import { createRequestGate } from './request-gate.js';

const $ = (selector) => document.querySelector(selector);

async function main() {
    const filter = $('#board-filter');
    const list = $('#board-list');
    const more = $('#board-more');
    const status = $('#board-status');
    const retry = $('#board-retry');
    fillAlgorithmSelect(filter, { includeAll: true });


    const { api } = await bootBoard();
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

}

main().catch(() => { say($('#board-status'), '게시판을 불러오지 못했습니다. 새로고침해 주세요.', 'error'); });
