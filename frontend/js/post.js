// 글 화면(post.html?id=<uuid>): 상세, 본인 글의 수정·삭제.
// 버튼은 글의 작성자(author_id)가 로그인한 사용자와 같을 때만 보이지만, 이것은 편의일 뿐 권한은 서버(API·DB)가 검사한다.
// 수정·삭제는 ETag(If-Match)로 version을 확인하고, 충돌(412)·삭제됨(404)·로그인 만료(401)에서도 작성 중인 초안을 지우지 않는다.

import { ApiError } from './api.js';
import { algorithmLabel, changesFrom, classifyError, isBusy, loadingPost, reducePost, validateDraft } from './board-state.js';
import { bootBoard, fillAlgorithmSelect, formatDate, h, onAuthChange, say, setBusy, setupRelogin, showFieldErrors } from './board-common.js';
import { mountComments } from './comments.js';

const $ = (selector) => document.querySelector(selector);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 서버의 필드 이름(algorithm_id)을 화면 초안의 이름(algorithmId)으로 맞춘다. */
const renameField = (fields = {}) => Object.fromEntries(Object.entries(fields).map(([key, value]) => [key === 'algorithm_id' ? 'algorithmId' : key, value]));

const info = (error, write) => classifyError(error instanceof ApiError ? error : { status: -1 }, { write });

async function main() {
    const id = new URLSearchParams(location.search).get('id') ?? '';
    const status = $('#post-status');
    const view = $('#post-view');
    const actions = $('#post-actions');
    const confirmBox = $('#delete-confirm');
    const form = $('#post-form');
    const formMessage = $('#post-form-message');
    const conflict = $('#conflict-box');
    const relogin = $('#relogin-form');
    fillAlgorithmSelect(form.elements.algorithm);

    if (!UUID.test(id)) {
        say(status, '글 주소가 올바르지 않습니다. 목록에서 글을 선택해 주세요.', 'error');
        return;
    }

    const { auth, user: initialUser, api } = await bootBoard();
    let user = initialUser;
    let state = loadingPost();
    let etag = null;
    let commentsMounted = false;

    const isOwner = () => Boolean(user && state.post && state.post.author_id === user.id);

    // ---------- 그리기 ----------
    function renderPost() {
        const post = state.post;
        view.hidden = !post;
        if (!post) return;
        $('#post-title').textContent = post.title;
        $('#post-author').textContent = post.author_display_name;
        $('#post-date').textContent = formatDate(post.created_at);
        $('#post-date').setAttribute('datetime', post.created_at);
        $('#post-edited').textContent = post.version > 1 ? `(수정됨 ${formatDate(post.updated_at)})` : '';
        const label = algorithmLabel(post.algorithm_id);
        $('#post-algorithm').textContent = label ?? '';
        $('#post-algorithm').hidden = !label;
        $('#post-body').textContent = post.body;
    }

    function render() {
        renderPost();
        const phase = state.phase;
        $('#comments-section').hidden = !state.post || ['gone', 'removed'].includes(phase);
        // 삭제된 글(gone)이어도 사용자가 쓰던 초안은 복사해 둘 수 있도록 보여 준다(저장만 막는다).
        const editing = ['editing', 'saving', 'conflict', 'relogin', 'gone'].includes(phase) && state.draft;
        form.hidden = !editing;
        if (editing) {
            if (form.elements.title.value !== state.draft.title) form.elements.title.value = state.draft.title;
            if (form.elements.body.value !== state.draft.body) form.elements.body.value = state.draft.body;
            if (form.elements.algorithm.value !== state.draft.algorithmId) form.elements.algorithm.value = state.draft.algorithmId;
            showFieldErrors(form, state.fields, { algorithm: 'algorithmId' });
            setBusy(form, phase === 'saving');
            if (phase === 'gone') form.querySelector('button[type="submit"]').disabled = true;
        }
        actions.hidden = !(isOwner() && ['viewing', 'confirming-delete'].includes(phase));
        $('#post-edit').disabled = phase !== 'viewing';
        $('#post-delete').disabled = phase !== 'viewing';
        confirmBox.hidden = phase !== 'confirming-delete' && phase !== 'deleting';
        setBusy(confirmBox, phase === 'deleting');
        relogin.hidden = phase !== 'relogin';
        conflict.hidden = phase !== 'conflict' || !state.conflictWith;
        if (!conflict.hidden) {
            $('#conflict-title').textContent = state.conflictWith.title;
            $('#conflict-body').textContent = state.conflictWith.body;
        }
        $('#conflict-use-latest').hidden = conflict.hidden;

        const isError = ['gone', 'load-error', 'conflict', 'relogin'].includes(phase) || Object.keys(state.fields).length > 0 || state.message.includes('못');
        if (phase === 'loading') say(status, '글을 불러오는 중입니다…');
        else say(status, state.message, isError ? 'error' : (state.message.endsWith('했습니다.') && !state.message.includes('못') ? 'ok' : 'info'));
        formMessage.hidden = true;
        $('#post-retry').hidden = phase !== 'load-error';
        $('#post-list-link').hidden = !['gone', 'removed', 'load-error'].includes(phase);
        view.setAttribute('aria-busy', String(isBusy(state)));
    }

    function dispatch(action) {
        state = reducePost(state, action);
        render();
    }

    // ---------- 읽기 ----------
    async function fetchPost() {
        const response = await api.get(`/api/posts/${id}`, { auth: false, retries: 2 });
        return { post: response.data, etag: response.headers.get('ETag') };
    }

    async function load() {
        try {
            const result = await fetchPost();
            etag = result.etag;
            dispatch({ type: 'loaded', post: result.post });
            if (!commentsMounted) {
                mountComments({ id, api, auth, user });
                commentsMounted = true;
            }
            document.title = `${result.post.title} | 알고리즘 실행 시각화`;
        } catch (error) {
            const failure = info(error, false);
            dispatch({ type: 'load-failed', kind: failure.kind, message: failure.message });
        }
    }

    // ---------- 수정 ----------
    $('#post-edit').addEventListener('click', () => dispatch({ type: 'edit' }));
    $('#post-cancel').addEventListener('click', () => dispatch({ type: 'cancel-edit' }));
    form.addEventListener('input', () => {
        dispatch({ type: 'draft', draft: { title: form.elements.title.value, body: form.elements.body.value, algorithmId: form.elements.algorithm.value } });
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!['editing', 'conflict'].includes(state.phase)) return;
        const checked = validateDraft(state.draft);
        if (!checked.ok) {
            state = { ...state, fields: checked.fields, message: '입력값을 확인해 주세요.' };
            render();
            return;
        }
        const changes = changesFrom(state.post, checked.value);
        if (!changes) {
            say(status, '바뀐 내용이 없습니다.');
            return;
        }
        dispatch({ type: 'save' });
        try {
            const response = await api.patch(`/api/posts/${id}`, changes, { headers: { 'If-Match': etag } });
            etag = response.headers.get('ETag');
            dispatch({ type: 'saved', post: response.data });
        } catch (error) {
            const failure = info(error, true);
            if (failure.kind === 'conflict') {
                // 최신 글을 다시 읽어 비교할 수 있게 한다. 읽기에 실패해도 초안은 그대로다.
                let latest = null;
                try {
                    const result = await fetchPost();
                    latest = { ...result.post, etag: result.etag };
                } catch {
                    latest = null;
                }
                dispatch({ type: 'save-failed', kind: 'conflict', message: latest ? failure.message : `${failure.message} 최신 글을 불러오지 못했습니다. 새로고침한 뒤 초안을 다시 확인해 주세요.`, latest });
            } else {
                dispatch({ type: 'save-failed', kind: failure.kind, message: failure.message, fields: renameField(failure.fields) });
            }
        }
    });

    $('#conflict-use-latest').addEventListener('click', () => {
        if (state.conflictWith?.etag) etag = state.conflictWith.etag; // 다음 저장은 최신 version을 기준으로 한다(초안은 그대로)
        dispatch({ type: 'use-latest' });
    });

    // ---------- 삭제 ----------
    $('#post-delete').addEventListener('click', () => dispatch({ type: 'ask-delete' }));
    $('#delete-cancel').addEventListener('click', () => dispatch({ type: 'cancel-delete' }));
    $('#delete-confirm-button').addEventListener('click', async () => {
        if (state.phase !== 'confirming-delete') return;
        dispatch({ type: 'delete' });
        try {
            await api.delete(`/api/posts/${id}`, { headers: { 'If-Match': etag } });
            dispatch({ type: 'deleted' });
        } catch (error) {
            const failure = info(error, true);
            let latest = null;
            if (failure.kind === 'conflict') {
                try {
                    const result = await fetchPost();
                    etag = result.etag;
                    latest = result.post;
                } catch {
                    latest = null;
                }
            }
            dispatch({ type: 'delete-failed', kind: failure.kind, message: failure.message, latest });
        }
    });

    $('#post-retry').addEventListener('click', () => {
        state = loadingPost();
        render();
        void load();
    });

    if (auth) {
        setupRelogin(relogin, auth, () => {
            dispatch({ type: 'relogged' });
            status.focus();
        });
        onAuthChange(auth, (next) => {
            user = next;
            render();
        });
    }
    render();
    await load();
}

main().catch(() => {
    say($('#post-status'), '글을 불러오지 못했습니다. 새로고침해 주세요.', 'error');
});
