// 게시판 화면(board.js, post.js)이 함께 쓰는 DOM 도우미와 인증 준비.
// 글의 제목·본문·닉네임은 항상 textContent로만 넣는다(HTML로 해석하지 않는다). 줄바꿈은 CSS(white-space: pre-wrap)로 보여 준다.

import { ApiError, createApiClient } from './api.js';
import { hasStoredSession } from './auth-menu.js';
import { ALGORITHMS, algorithmLabel, classifyError } from './board-state.js';
import { createAuthSubmitHandler } from './auth-submit.js';

/** 요소 만들기. children은 문자열(텍스트) 또는 노드. */
export function h(tag, attrs = {}, ...children) {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
        if (value === false || value == null) continue;
        if (name === 'class') element.className = value;
        else if (name === 'text') element.textContent = value;
        else element.setAttribute(name, value === true ? '' : String(value));
    }
    for (const child of children) element.append(child);
    return element;
}

export function formatDate(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}

export function fillAlgorithmSelect(select, { includeAll = false, allLabel = '전체', noneLabel = '선택 안 함' } = {}) {
    select.replaceChildren(h('option', { value: '', text: includeAll ? allLabel : noneLabel }));
    for (const { id, label } of ALGORITHMS) select.append(h('option', { value: id, text: label }));
}

export function setBusy(container, busy) {
    for (const control of container.querySelectorAll('input, textarea, select, button')) control.disabled = busy;
    container.setAttribute('aria-busy', String(busy));
}

/** 안내 영역(role=status/alert)에 문구를 쓴다. 오류는 alert로 바꿔 스크린 리더가 바로 읽게 한다. */
export function say(element, text, kind = 'info') {
    element.textContent = text;
    element.hidden = text === '';
    element.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    element.className = `board-message board-${kind}`;
}

/** 필드별 오류를 입력 옆에 표시한다. fields: 이름 → 메시지(서버와 화면의 이름이 달라 map으로 연결). */
export function showFieldErrors(form, fields, map = {}) {
    for (const note of form.querySelectorAll('[data-field-error]')) {
        const key = note.getAttribute('data-field-error');
        const message = fields[key] ?? fields[map[key]];
        note.textContent = message ?? '';
        note.hidden = !message;
        const input = form.querySelector(`#${note.getAttribute('data-for')}`);
        if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
    }
}

/**
 * 인증을 준비한다. 이 브라우저에 로그인 세션이 있을 때만 인증 모듈(SDK 포함)을 불러오므로 비회원의 읽기는 가볍다.
 * 반환: { auth, user, api } — 비회원이면 auth는 null이고 api는 토큰 없이 읽기만 한다.
 */
export async function bootBoard() {
    let storage = null;
    try {
        storage = window.localStorage;
    } catch {
        storage = null;
    }
    if (!hasStoredSession(storage)) {
        return { auth: null, user: null, api: createApiClient({ getAccessToken: async () => null }) };
    }
    const auth = await import('./auth.js');
    const state = await auth.initAuth();
    const api = createApiClient({ getAccessToken: auth.getAccessToken, refreshAccessToken: auth.refreshAccessToken });
    return { auth, user: state.status === 'signed-in' ? state.user : null, api };
}

/** 로그인 상태가 바뀌면 호출된다(로그아웃 등). */
export function onAuthChange(auth, listener) {
    return auth ? auth.subscribeAuth((state) => listener(state.status === 'signed-in' ? state.user : null)) : () => {};
}

/**
 * 같은 페이지에서 다시 로그인하는 폼(401). 다른 페이지로 이동하지 않으므로 작성 중인 내용은 메모리에 그대로 남는다.
 * 로그인에 성공하면 onDone을 부른다(요청을 자동으로 다시 보내지 않는다).
 */
export function setupRelogin(form, auth, onDone) {
    const message = form.querySelector('[data-relogin-message]');
    form.addEventListener('submit', createAuthSubmitHandler({
        form, message,
        showMessage: (element, value, kind) => say(element, value instanceof Error ? value.message : value, kind),
        handler: async (data) => {
            await auth.signIn({ email: data.get('email'), password: data.get('password') });
            form.reset();
            form.hidden = true;
            await onDone();
        },
    }));
}

/** 오류를 화면 안내로 바꾸는 얇은 도우미. ApiError가 아니면 일반 오류로 본다. */
export function explain(error, options) {
    return classifyError(error instanceof ApiError ? error : { status: -1 }, options);
}

export { algorithmLabel };
