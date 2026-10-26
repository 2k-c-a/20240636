// 메뉴의 로그인 항목(`li[data-auth-menu]`). 로그인 상태이면 "내 정보"와 "로그아웃"으로 바꾼다.
// 로그인한 적이 없는 방문자의 일반 페이지는 SDK와 설정을 내려받지 않는다(저장된 세션이 있을 때만 확인).

import { AUTH_STORAGE_KEY } from './auth.js';

/** 상태에 맞는 메뉴 모양. 로그인 확인이 끝나기 전·설정이 없을 때는 로그인 링크를 그대로 둔다. */
export function describeAuthMenu(state) {
    return state?.status === 'signed-in' ? { kind: 'account' } : { kind: 'login' };
}

/** 이 브라우저에 저장된 세션이 있는지만 본다(내용은 읽지 않는다). */
export function hasStoredSession(storage) {
    try {
        return storage?.getItem(AUTH_STORAGE_KEY) != null;
    } catch {
        return false;
    }
}

function renderLogin(doc, item) {
    const link = doc.createElement('a');
    link.href = 'login.html';
    link.textContent = '로그인';
    item.replaceChildren(link);
}

function renderAccount(doc, item, onSignOut) {
    const link = doc.createElement('a');
    link.href = 'profile.html';
    link.textContent = '내 정보';
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'auth-menu-signout';
    button.textContent = '로그아웃';
    button.addEventListener('click', onSignOut);
    item.replaceChildren(link, button);
}

/** 인증 모듈을 필요할 때만 불러와 메뉴를 갱신한다. 인증 화면(`body[data-auth-page]`)에서는 항상 확인한다. */
export async function mountAuthMenu(doc, storage) {
    const item = doc.querySelector('[data-auth-menu]');
    if (!item) return;
    if (!doc.body?.hasAttribute('data-auth-page') && !hasStoredSession(storage)) return;
    const auth = await import('./auth.js');
    const render = (state) => {
        if (describeAuthMenu(state).kind === 'account') {
            renderAccount(doc, item, async () => {
                try {
                    await auth.signOut();
                } catch {
                    return; // 실패하면 로그인 상태가 그대로이므로 메뉴도 그대로 둔다.
                }
                // 로그인이 필요한 화면(내 정보 등)에 남지 않도록 홈으로 이동한다.
                if (doc.body?.hasAttribute('data-requires-auth')) doc.defaultView?.location.assign('index.html');
            });
        } else {
            renderLogin(doc, item);
        }
    };
    auth.subscribeAuth(render);
    await auth.initAuth();
}
