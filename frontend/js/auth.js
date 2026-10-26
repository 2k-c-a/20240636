// 단일 Supabase Auth 클라이언트를 감싼 인증 모듈. 가입·로그인·복구는 브라우저 SDK가 처리하고 FastAPI는 토큰만 검증한다.
// - SDK는 `vendor/supabase.js`(전역 `supabase`)이며 이 파일보다 먼저 불러온다.
// - 상태에는 토큰·비밀번호를 두지 않는다. 토큰은 getAccessToken()으로만 얻는다.
// - 공개 설정이 없으면 status가 'disabled'이고 나머지 함수는 AuthFailure('not_configured')를 던진다.

import {
    CALLBACK_PATH, GENERIC_MESSAGE, NOT_CONFIGURED_MESSAGE,
    describeAuthError, nicknameFromMetadata, safeReturnPath, validateEmail, validateLoginPassword,
    validateNewPassword, validateNickname,
} from './auth-forms.js';
import { loadPublicConfig } from './public-config.js';

export const NEXT_STORAGE_KEY = 'algo-viz-next';
export const AUTH_STORAGE_KEY = 'algo-viz-auth';

export class AuthFailure extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'AuthFailure';
        this.code = code;
    }
}

function publicUser(user) {
    return user && typeof user.id === 'string' ? Object.freeze({ id: user.id, email: typeof user.email === 'string' ? user.email : null }) : null;
}

/** 저장소를 쓸 수 없는 환경(사생활 보호 모드 등)에서는 null을 돌려준다. */
function attempt(action) {
    try {
        return action();
    } catch {
        return null;
    }
}

/**
 * @param {object} deps
 * @param {() => Promise<object>} deps.loadConfig 공개 설정(`loadPublicConfig` 형식)
 * @param {(url: string, key: string, options: object) => object|Promise<object>} deps.createClient SDK의 createClient
 * @param {Storage|null} [deps.storage] 복귀 경로 저장소(경로만 저장한다)
 * @param {string|null} [deps.pageOrigin] 현재 페이지 origin(APP_ORIGIN과 다르면 안내한다)
 */
export function createAuthService({ loadConfig, createClient, storage = null, pageOrigin = null }) {
    let client = null;
    let config = null;
    let initPromise = null;
    let state = Object.freeze({ status: 'loading', user: null, recovery: false, configFailed: false, originMismatch: false });
    const listeners = new Set();

    function setState(patch) {
        state = Object.freeze({ ...state, ...patch });
        for (const listener of [...listeners]) {
            try {
                listener(state);
            } catch {
                // 한 구독자의 오류가 다른 구독자를 막지 않는다.
            }
        }
    }

    function initAuth() {
        initPromise ??= (async () => {
            config = await loadConfig();
            if (!config.enabled) {
                setState({ status: 'disabled', user: null, configFailed: config.failed === true });
                return state;
            }
            try {
                client = await createClient(config.url, config.key, {
                    auth: {
                        flowType: 'pkce',
                        detectSessionInUrl: false, // 콜백 주소는 auth-callback 화면이 직접 처리한다.
                        persistSession: true,
                        autoRefreshToken: true,
                        storageKey: AUTH_STORAGE_KEY,
                    },
                });
            } catch {
                // SDK 파일을 불러오지 못한 경우: 설정 오류와 같은 안내를 쓰되 원인은 configFailed로 알린다.
                client = null;
                setState({ status: 'disabled', user: null, configFailed: true });
                return state;
            }
            // 이 콜백 안에서 SDK를 다시 부르면 교착할 수 있어 상태만 갱신한다.
            client.auth.onAuthStateChange((event, session) => {
                // 변화마다 구독자에게 한 번만 알린다.
                let recovery = state.recovery;
                if (event === 'PASSWORD_RECOVERY') recovery = true;
                if (event === 'SIGNED_OUT') recovery = false;
                setState({ recovery, status: session?.user ? 'signed-in' : 'signed-out', user: publicUser(session?.user) });
            });
            const { data } = await client.auth.getSession();
            setState({
                status: data?.session?.user ? 'signed-in' : 'signed-out',
                user: publicUser(data?.session?.user),
                originMismatch: Boolean(pageOrigin) && pageOrigin !== config.appOrigin,
            });
            return state;
        })();
        return initPromise;
    }

    async function ready() {
        await initAuth();
        if (!client) throw new AuthFailure('not_configured', NOT_CONFIGURED_MESSAGE);
        return client;
    }

    function fail(error) {
        if (error instanceof AuthFailure) return error;
        return new AuthFailure(typeof error?.code === 'string' ? error.code : 'auth_error', describeAuthError(error));
    }

    function checked(result) {
        if (!result.ok) throw new AuthFailure('invalid_input', result.message);
        return result.value;
    }

    async function getAccessToken() {
        await initAuth();
        if (!client) return null;
        const { data } = await client.auth.getSession();
        return data?.session?.access_token ?? null;
    }

    async function refreshAccessToken() {
        await initAuth();
        if (!client) return null;
        const { data, error } = await client.auth.refreshSession();
        return error ? null : data?.session?.access_token ?? null;
    }

    function setReturnPath(path) {
        attempt(() => storage?.setItem(NEXT_STORAGE_KEY, safeReturnPath(path)));
    }

    /** 저장된 복귀 경로를 한 번만 꺼낸다. 허용되지 않는 값이면 홈이다. */
    function takeReturnPath() {
        const value = attempt(() => storage?.getItem(NEXT_STORAGE_KEY));
        attempt(() => storage?.removeItem(NEXT_STORAGE_KEY));
        return safeReturnPath(value);
    }

    async function signUp({ email, password, nickname, next }) {
        const cleanEmail = checked(validateEmail(email));
        const cleanPassword = checked(validateNewPassword(password));
        const cleanNickname = checked(validateNickname(nickname));
        const sdk = await ready();
        setReturnPath(next);
        try {
            const { data, error } = await sdk.auth.signUp({
                email: cleanEmail,
                password: cleanPassword,
                options: { data: { nickname: cleanNickname }, emailRedirectTo: `${config.appOrigin}${CALLBACK_PATH}` },
            });
            // 이미 가입한 이메일도 같은 안내로 처리해 계정 존재 여부를 드러내지 않는다.
            if (error && error.code !== 'user_already_exists') throw error;
            return { status: data?.session ? 'signed-in' : 'confirmation-pending' };
        } catch (error) {
            throw fail(error);
        }
    }

    async function signIn({ email, password }) {
        const cleanEmail = checked(validateEmail(email));
        const cleanPassword = checked(validateLoginPassword(password));
        const sdk = await ready();
        try {
            const { error } = await sdk.auth.signInWithPassword({ email: cleanEmail, password: cleanPassword });
            if (error) throw error;
        } catch (error) {
            throw fail(error);
        }
    }

    async function signOut() {
        const sdk = await ready();
        // 이 브라우저의 세션만 끝낸다(다른 기기의 로그인은 유지).
        const { error } = await sdk.auth.signOut({ scope: 'local' });
        if (error && error.name !== 'AuthSessionMissingError') throw fail(error);
        attempt(() => storage?.removeItem(NEXT_STORAGE_KEY));
    }

    async function requestPasswordReset(email) {
        const cleanEmail = checked(validateEmail(email));
        const sdk = await ready();
        try {
            const { error } = await sdk.auth.resetPasswordForEmail(cleanEmail, { redirectTo: `${config.appOrigin}${CALLBACK_PATH}` });
            if (error) throw error;
        } catch (error) {
            throw fail(error); // 성공하면 가입 여부와 상관없이 같은 안내를 보여준다.
        }
    }

    async function updatePassword(newPassword) {
        const password = checked(validateNewPassword(newPassword));
        const sdk = await ready();
        try {
            const { error } = await sdk.auth.updateUser({ password });
            if (error) throw error;
            setState({ recovery: false });
        } catch (error) {
            throw fail(error);
        }
    }

    /** 콜백의 인증 코드를 세션으로 교환한다. 성공하면 현재 사용자를 돌려준다. */
    async function exchangeCode(code) {
        if (typeof code !== 'string' || code === '' || code.length > 512) throw new AuthFailure('invalid_code', GENERIC_MESSAGE);
        const sdk = await ready();
        try {
            const { data, error } = await sdk.auth.exchangeCodeForSession(code);
            if (error) throw error;
            const user = publicUser(data?.session?.user);
            if (!user || !data?.session?.access_token) {
                throw new AuthFailure('invalid_code', '로그인을 확인하지 못했습니다. 메일의 링크를 같은 브라우저에서 다시 열거나 링크를 다시 요청해 주세요.');
            }
            return user;
        } catch (error) {
            throw fail(error);
        }
    }

    /** 가입 때 넣은 닉네임(규칙에 맞을 때만). 최초 프로필 생성에만 쓰고 권한 판단에는 쓰지 않는다. */
    async function getMetadataNickname() {
        const sdk = await ready();
        const { data } = await sdk.auth.getSession();
        return nicknameFromMetadata(data?.session?.user?.user_metadata);
    }

    function subscribeAuth(listener) {
        listeners.add(listener);
        listener(state);
        return () => listeners.delete(listener);
    }

    return {
        initAuth, getAccessToken, refreshAccessToken, subscribeAuth, signUp, signIn, signOut,
        requestPasswordReset, updatePassword, exchangeCode, getMetadataNickname, setReturnPath, takeReturnPath,
        getState: () => state,
    };
}

// ---- 브라우저용 단일 인스턴스 ----

let defaultService = null;

let sdkPromise = null;

/** 번들 SDK를 한 번만 불러온다. 로그인 상태가 필요한 페이지에서만 호출되므로 일반 페이지는 내려받지 않는다. */
function loadSdk() {
    if (typeof globalThis.supabase?.createClient === 'function') return Promise.resolve();
    sdkPromise ??= new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = new URL('./vendor/supabase.js', import.meta.url).href;
        script.onload = () => resolve();
        script.onerror = () => {
            sdkPromise = null;
            reject(new Error('Supabase SDK를 불러오지 못했습니다.'));
        };
        document.head.append(script);
    });
    return sdkPromise;
}

function browserService() {
    defaultService ??= createAuthService({
        loadConfig: () => loadPublicConfig(),
        createClient: async (url, key, options) => {
            await loadSdk();
            return globalThis.supabase.createClient(url, key, options);
        },
        storage: attempt(() => globalThis.localStorage),
        pageOrigin: globalThis.location?.origin ?? null,
    });
    return defaultService;
}

export const initAuth = () => browserService().initAuth();
export const getAccessToken = () => browserService().getAccessToken();
export const refreshAccessToken = () => browserService().refreshAccessToken();
export const subscribeAuth = (listener) => browserService().subscribeAuth(listener);
export const signUp = (input) => browserService().signUp(input);
export const signIn = (input) => browserService().signIn(input);
export const signOut = () => browserService().signOut();
export const requestPasswordReset = (email) => browserService().requestPasswordReset(email);
export const updatePassword = (password) => browserService().updatePassword(password);
export const exchangeCode = (code) => browserService().exchangeCode(code);
export const getMetadataNickname = () => browserService().getMetadataNickname();
export const setReturnPath = (path) => browserService().setReturnPath(path);
export const takeReturnPath = () => browserService().takeReturnPath();
export const getAuthState = () => browserService().getState();
