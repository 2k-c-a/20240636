// 회원 화면(signup·login·reset-password·auth-callback·profile)의 DOM 연결.
// `<body data-auth-page="화면이름">`으로 어느 화면인지 정한다. 비밀번호는 입력 요소에만 두고 제출 뒤 바로 비운다.

import { ApiError, createApiClient } from './api.js';
import * as auth from './auth.js';
import { createAuthSubmitHandler } from './auth-submit.js';
import {
    GENERIC_MESSAGE, NOT_CONFIGURED_MESSAGE, readCallbackError, safeReturnPath, validateNickname,
} from './auth-forms.js';

export const RECOVERY_FLAG = 'algo-viz-recovery';

/** API 오류를 화면에 보여줄 문구로 바꾼다. 서버가 보낸 한국어 메시지를 우선 쓴다. */
export function describeApiError(error) {
    if (error instanceof ApiError) {
        if (error.status === 0) return error.message;
        if (error.code === 'auth_not_configured') return NOT_CONFIGURED_MESSAGE;
        if (error.status === 503) return '서버가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.';
        if (error.status === 401) return '로그인이 만료되었습니다. 다시 로그인해 주세요.';
        return error.fields?.nickname ?? error.message;
    }
    return GENERIC_MESSAGE;
}

/**
 * 로그인한 사용자의 프로필이 없으면 가입 때 넣은 닉네임(규칙에 맞을 때만)으로 만든다. 기존 닉네임은 덮어쓰지 않는다.
 * 닉네임이 없거나 규칙에 맞지 않으면 'needs-profile'을 돌려 사용자가 직접 입력하게 한다.
 */
export async function ensureProfile(api, getMetadataNickname) {
    const me = (await api.get('/api/me')).data;
    if (me.nickname) return { status: 'ready', nickname: me.nickname, email: me.email };
    const nickname = await getMetadataNickname();
    if (!nickname) return { status: 'needs-profile', email: me.email };
    try {
        const { data } = await api.post('/api/me/profile', { nickname });
        return { status: 'ready', nickname: data.nickname, email: me.email };
    } catch (error) {
        if (error instanceof ApiError && error.status === 422) return { status: 'needs-profile', email: me.email };
        throw error;
    }
}

// ---------- DOM 도우미 ----------

const $ = (selector) => document.querySelector(selector);

function showMessage(element, text, kind = 'error') {
    if (!element) return;
    element.textContent = text;
    element.hidden = text === '';
    element.className = kind === 'error' ? 'auth-message auth-error' : 'auth-message auth-ok';
    element.setAttribute('role', kind === 'error' ? 'alert' : 'status');
}

function setBusy(form, busy) {
    for (const control of form.querySelectorAll('input, button')) control.disabled = busy;
    form.setAttribute('aria-busy', String(busy));
}

function queryNext() {
    return safeReturnPath(new URLSearchParams(window.location.search).get('next'));
}

function go(path) {
    window.location.assign(path.replace(/^\/web\/html\//, ''));
}

const api = createApiClient({ getAccessToken: auth.getAccessToken, refreshAccessToken: auth.refreshAccessToken });

function guardConfigured(state, form, messageEl) {
    if (state.status !== 'disabled') return true;
    showMessage(messageEl, state.configFailed ? '회원 기능 설정을 불러오지 못했습니다. 서버가 켜져 있는지 확인해 주세요.' : NOT_CONFIGURED_MESSAGE);
    if (form) setBusy(form, true);
    return false;
}

function warnOrigin(state) {
    const box = $('#origin-warning');
    if (box) box.hidden = !state.originMismatch;
}

/** 폼 제출 공통 처리: 중복 제출 방지, 오류 표시, 끝나면 비밀번호 비우기. */
function onSubmit(form, messageEl, handler) {
    form.addEventListener('submit', createAuthSubmitHandler({
        form, message: messageEl, handler,
        showMessage: (element, value, kind) => showMessage(element,
            value instanceof Error ? (value instanceof ApiError ? describeApiError(value) : value.message || GENERIC_MESSAGE) : value, kind),
    }));
}

async function afterLogin(next) {
    const result = await ensureProfile(api, auth.getMetadataNickname);
    go(result.status === 'ready' ? next : `/web/html/profile.html?next=${encodeURIComponent(safeReturnPath(next))}`);
}

// ---------- 화면별 ----------

async function initSignup() {
    const form = $('#signup-form');
    const message = $('#signup-message');
    const state = await auth.initAuth();
    warnOrigin(state);
    if (!guardConfigured(state, form, message)) return;
    onSubmit(form, message, async (data) => {
        if (data.get('password') !== data.get('password2')) throw new Error('비밀번호 확인이 일치하지 않습니다.');
        const result = await auth.signUp({
            email: data.get('email'), password: data.get('password'), nickname: data.get('nickname'), next: queryNext(),
        });
        if (result.status === 'signed-in') {
            await afterLogin(auth.takeReturnPath());
            return;
        }
        form.hidden = true;
        $('#signup-done').hidden = false;
        $('#signup-done').focus();
    });
}

async function initLogin() {
    const form = $('#login-form');
    const message = $('#login-message');
    const state = await auth.initAuth();
    warnOrigin(state);
    if (!guardConfigured(state, form, message)) return;
    if (state.status === 'signed-in') {
        form.hidden = true;
        $('#login-signed-in').hidden = false;
        return;
    }
    onSubmit(form, message, async (data) => {
        await auth.signIn({ email: data.get('email'), password: data.get('password') });
        await afterLogin(queryNext());
    });
}

async function initReset() {
    const requestForm = $('#reset-request-form');
    const updateForm = $('#reset-update-form');
    const message = $('#reset-message');
    const state = await auth.initAuth();
    warnOrigin(state);
    if (!guardConfigured(state, requestForm, message)) return;
    let recovering = false;
    try {
        recovering = window.sessionStorage.getItem(RECOVERY_FLAG) === '1';
    } catch {
        recovering = false;
    }
    if (recovering && state.status === 'signed-in') {
        requestForm.hidden = true;
        updateForm.hidden = false;
        onSubmit(updateForm, message, async (data) => {
            if (data.get('password') !== data.get('password2')) throw new Error('비밀번호 확인이 일치하지 않습니다.');
            await auth.updatePassword(data.get('password'));
            try {
                window.sessionStorage.removeItem(RECOVERY_FLAG);
            } catch {
                // 표시용 플래그라 실패해도 무방하다.
            }
            updateForm.hidden = true;
            $('#reset-updated').hidden = false;
            $('#reset-updated').focus();
        });
        return;
    }
    onSubmit(requestForm, message, async (data) => {
        await auth.requestPasswordReset(data.get('email'));
        requestForm.hidden = true;
        // 가입 여부와 상관없이 같은 안내를 쓴다.
        $('#reset-sent').hidden = false;
        $('#reset-sent').focus();
    });
}

async function initCallback() {
    const status = $('#callback-status');
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const urlError = readCallbackError(window.location.search, window.location.hash);
    // 인증 코드·토큰이 주소창과 기록에 남지 않도록 읽은 즉시 지운다.
    window.history.replaceState(null, '', window.location.pathname);

    const fail = (text) => {
        status.textContent = text;
        status.className = 'auth-message auth-error';
        status.setAttribute('role', 'alert');
        $('#callback-links').hidden = false;
    };
    if (urlError) return fail(urlError);
    if (!code) return fail('유효한 인증 링크가 아닙니다. 메일의 링크를 다시 열거나 처음부터 다시 요청해 주세요.');

    const state = await auth.initAuth();
    if (state.status === 'disabled') return fail(NOT_CONFIGURED_MESSAGE);
    try {
        await auth.exchangeCode(code);
    } catch (error) {
        return fail(error.message);
    }
    if (auth.getAuthState().recovery) {
        try {
            window.sessionStorage.setItem(RECOVERY_FLAG, '1');
        } catch {
            // 저장소를 쓸 수 없어도 비밀번호 변경 화면으로는 이동한다.
        }
        go('/web/html/reset-password.html');
        return;
    }
    try {
        await afterLogin(auth.takeReturnPath());
    } catch (error) {
        // 로그인은 됐지만 프로필 확인에 실패한 경우: 내 정보 화면에서 다시 시도하게 한다.
        status.textContent = `${describeApiError(error)} 로그인은 완료되었습니다.`;
        $('#callback-links').hidden = false;
    }
}

async function initProfile() {
    const form = $('#profile-form');
    const message = $('#profile-message');
    const intro = $('#profile-intro');
    const state = await auth.initAuth();
    if (!guardConfigured(state, form, message)) return;
    if (state.status !== 'signed-in') {
        form.hidden = true;
        $('#profile-login-required').hidden = false;
        return;
    }
    let hasProfile = false;
    try {
        const me = (await api.get('/api/me')).data;
        $('#profile-email').textContent = me.email ?? '';
        hasProfile = Boolean(me.nickname);
        form.elements.nickname.value = me.nickname ?? (await auth.getMetadataNickname()) ?? '';
    } catch (error) {
        showMessage(message, describeApiError(error));
        form.hidden = true;
        return;
    }
    form.hidden = false;
    const introText = () => (hasProfile
        ? '닉네임을 바꿔도 이미 쓴 글의 표시 이름은 바뀌지 않습니다.'
        : '게시판에 글을 쓰려면 닉네임을 정해 프로필을 만들어 주세요.');
    intro.textContent = introText();
    onSubmit(form, message, async (data) => {
        const nickname = validateNickname(data.get('nickname'));
        if (!nickname.ok) throw new Error(nickname.message);
        await api[hasProfile ? 'patch' : 'post']('/api/me/profile', { nickname: nickname.value });
        hasProfile = true;
        intro.textContent = introText();
        showMessage(message, '저장했습니다.', 'ok');
        const next = new URLSearchParams(window.location.search).get('next');
        if (next) go(safeReturnPath(next));
    });
}

const PAGES = { signup: initSignup, login: initLogin, 'reset-password': initReset, 'auth-callback': initCallback, profile: initProfile };

if (typeof document !== 'undefined') {
    const init = PAGES[document.body?.dataset.authPage];
    if (init) {
        init().catch(() => {
            showMessage(document.querySelector('[data-auth-status]'), GENERIC_MESSAGE);
        });
    }
}
