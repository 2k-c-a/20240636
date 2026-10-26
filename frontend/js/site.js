// 공통 스크립트(ES 모듈). 모든 페이지에서 불러옵니다.
// - 현재 페이지에 해당하는 메뉴 링크에 aria-current="page"를 표시합니다.
// - 실습용 양식(data-demo-form)이 입력 내용을 전송하지 않게 막습니다.
// - 저장된 로그인 세션이 있으면(또는 회원 화면이면) 메뉴의 로그인 항목을 "내 정보·로그아웃"으로 바꿉니다.

export const DEMO_FORM_MESSAGE = '실습용 양식입니다. 입력한 내용은 전송되거나 저장되지 않습니다.';

/**
 * 메뉴 링크 중 현재 페이지를 가리키는 링크의 인덱스를 돌려줍니다. 없으면 -1입니다.
 * 쿼리와 해시는 무시하고 경로만 비교합니다.
 */
export function findCurrentLinkIndex(hrefs, currentUrl) {
    const currentPath = new URL(currentUrl).pathname;
    return hrefs.findIndex((href) => {
        try {
            return new URL(href, currentUrl).pathname === currentPath;
        } catch {
            return false;
        }
    });
}

export function markCurrentPage(doc, currentUrl) {
    const links = [...doc.querySelectorAll('nav a[href]')];
    const index = findCurrentLinkIndex(links.map((link) => link.getAttribute('href')), currentUrl);
    links.forEach((link, i) => {
        if (i === index) {
            link.setAttribute('aria-current', 'page');
        } else {
            link.removeAttribute('aria-current');
        }
    });
}

export function blockDemoForms(doc) {
    doc.querySelectorAll('form[data-demo-form]').forEach((form) => {
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const status = form.querySelector('[data-demo-status]');
            if (status) status.textContent = DEMO_FORM_MESSAGE;
        });
    });
}

function safeLocalStorage() {
    try {
        return window.localStorage;
    } catch {
        return null; // 저장소를 막은 브라우저
    }
}

if (typeof document !== 'undefined') {
    markCurrentPage(document, window.location.href);
    blockDemoForms(document);
    // 로그인 표시가 실패해도 페이지의 다른 기능에는 영향을 주지 않습니다.
    import('./auth-menu.js')
        .then((menu) => menu.mountAuthMenu(document, safeLocalStorage()))
        .catch(() => {});
}
