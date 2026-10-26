// 회원 화면의 순수 함수 모음(DOM·네트워크 없음). 입력 검사, 복귀 경로, 오류 안내 문구.
// 비밀번호나 토큰을 저장하거나 기록하지 않는다.

export const HOME_PATH = '/web/html/index.html';
export const CALLBACK_PATH = '/web/html/auth-callback.html';
export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 20;
export const PASSWORD_MIN = 8;

// docs/CONTRACTS.md §7의 정규식과 같다.
const RETURN_PATH = /^\/web\/html\/[a-z0-9-]+\.html(\?[A-Za-z0-9=&_-]*)?$/;
// 로그인 직후 다시 인증 화면으로 돌려보내지 않는다.
const AUTH_PAGES = new Set(['login', 'signup', 'reset-password', 'auth-callback']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 같은 사이트의 허용된 경로만 돌려주고, 아니면 홈을 돌려준다. */
export function safeReturnPath(value) {
    if (typeof value !== 'string' || !RETURN_PATH.test(value)) return HOME_PATH;
    const page = value.slice('/web/html/'.length).split('?')[0].replace(/\.html$/, '');
    return AUTH_PAGES.has(page) ? HOME_PATH : value;
}

export function validateEmail(value) {
    const email = typeof value === 'string' ? value.trim() : '';
    if (!email) return { ok: false, message: '이메일을 입력해 주세요.' };
    if (email.length > 254 || !EMAIL.test(email)) return { ok: false, message: '이메일 형식이 올바르지 않습니다.' };
    return { ok: true, value: email };
}

/** 가입·변경용. 로그인에서는 길이 규칙으로 막지 않는다(validateLoginPassword). */
export function validateNewPassword(value) {
    if (typeof value !== 'string' || value.length < PASSWORD_MIN) {
        return { ok: false, message: `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.` };
    }
    return { ok: true, value };
}

export function validateLoginPassword(value) {
    if (typeof value !== 'string' || value === '') return { ok: false, message: '비밀번호를 입력해 주세요.' };
    return { ok: true, value };
}

/** 앞뒤 공백을 제거한 뒤 2~20자(코드 포인트 기준), 제어 문자 불가. DB·API 규칙과 같다. */
export function validateNickname(value) {
    const nickname = typeof value === 'string' ? value.trim() : '';
    const length = [...nickname].length;
    if (length < NICKNAME_MIN || length > NICKNAME_MAX) {
        return { ok: false, message: `닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자여야 합니다.` };
    }
    if (/[\u0000-\u001f\u007f]/.test(nickname)) return { ok: false, message: '닉네임에 쓸 수 없는 문자가 있습니다.' };
    return { ok: true, value: nickname };
}

/** Auth metadata의 닉네임은 신뢰하지 않는 입력이다. 규칙에 맞을 때만 값을, 아니면 null을 돌려준다. */
export function nicknameFromMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') return null;
    const result = validateNickname(metadata.nickname);
    return result.ok ? result.value : null;
}

const MESSAGES = {
    invalid_credentials: '이메일 또는 비밀번호가 올바르지 않습니다.',
    email_not_confirmed: '이메일 확인이 끝나지 않았습니다. 받은 편지함의 확인 메일을 열어 주세요.',
    weak_password: '비밀번호가 너무 약합니다. 더 길고 추측하기 어려운 비밀번호를 사용해 주세요.',
    same_password: '이전과 다른 비밀번호를 입력해 주세요.',
    over_email_send_rate_limit: '메일 발송 횟수 제한에 걸렸습니다. 잠시 후 다시 시도해 주세요.',
    over_request_rate_limit: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
    over_sms_send_rate_limit: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
    signup_disabled: '지금은 새 회원가입을 받지 않습니다.',
    email_address_invalid: '사용할 수 없는 이메일 주소입니다.',
    validation_failed: '입력값을 확인해 주세요.',
    otp_expired: '링크가 만료되었거나 이미 사용되었습니다. 처음부터 다시 요청해 주세요.',
    flow_state_expired: '링크가 만료되었습니다. 처음부터 다시 요청해 주세요.',
    flow_state_not_found: '이 링크는 요청을 시작한 브라우저에서만 열 수 있습니다. 같은 브라우저에서 링크를 열거나 처음부터 다시 요청해 주세요.',
    session_expired: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
    session_not_found: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
    reauthentication_needed: '보안을 위해 다시 로그인한 뒤 시도해 주세요.',
};
export const NETWORK_MESSAGE = '서버에 연결하지 못했습니다. 네트워크를 확인하고 잠시 후 다시 시도해 주세요.';
export const GENERIC_MESSAGE = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
export const NOT_CONFIGURED_MESSAGE = '지금은 회원 기능을 사용할 수 없습니다. 잠시 뒤 다시 시도하거나 관리자에게 문의해 주세요.';

/**
 * Supabase Auth 오류를 사용자에게 보여줄 한국어 문구로 바꾼다.
 * 원문 메시지는 영어이고 내부 정보를 담을 수 있어 그대로 보여주지 않는다.
 */
export function describeAuthError(error) {
    if (!error || typeof error !== 'object') return GENERIC_MESSAGE;
    if (typeof error.code === 'string' && MESSAGES[error.code]) return MESSAGES[error.code];
    const name = typeof error.name === 'string' ? error.name : '';
    if (name === 'AuthRetryableFetchError' || name === 'TypeError' || error.status === 0) return NETWORK_MESSAGE;
    if (typeof error.status === 'number' && error.status >= 500) return NETWORK_MESSAGE;
    if (error.status === 429) return MESSAGES.over_request_rate_limit;
    if (name === 'AuthSessionMissingError') return MESSAGES.session_not_found;
    return GENERIC_MESSAGE;
}

/** 콜백 주소의 쿼리·해시에 담긴 오류(만료 링크 등)를 읽는다. 없으면 null. */
export function readCallbackError(search, hash) {
    const params = new URLSearchParams(search);
    const hashParams = new URLSearchParams(typeof hash === 'string' ? hash.replace(/^#/, '') : '');
    const code = params.get('error_code') ?? hashParams.get('error_code');
    const error = params.get('error') ?? hashParams.get('error');
    if (!code && !error) return null;
    if (code && MESSAGES[code]) return MESSAGES[code];
    if ((error ?? '') === 'access_denied') return MESSAGES.otp_expired;
    return GENERIC_MESSAGE;
}
