// 공통 스크립트(ES 모듈). 모든 페이지에서 불러옵니다.
// - 현재 페이지에 해당하는 메뉴 링크에 aria-current="page"를 표시합니다.
// - 로그인 상태에 따라 오른쪽 위 계정 영역을 갱신합니다.


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


function safeLocalStorage() {
    try {
        return window.localStorage;
    } catch {
        return null; // 저장소를 막은 브라우저
    }
}

// Native disclosures support touch and keyboard; pointer hover opens the same menu.
export function mountNavigation(doc) {
    const groups = [...doc.querySelectorAll('.nav-group')];
    const closeOthers = (current) => groups.forEach((group) => { if (group !== current) group.open = false; });
    for (const group of groups) {
        group.addEventListener('pointerenter', (event) => {
            if (event.pointerType !== 'mouse') return;
            closeOthers(group);
            group.open = true;
        });
        group.addEventListener('pointerleave', () => {
            if (!group.contains(doc.activeElement)) group.open = false;
        });
        group.addEventListener('focusout', (event) => {
            if (!group.contains(event.relatedTarget)) group.open = false;
        });
        group.addEventListener('toggle', () => { if (group.open) closeOthers(group); });
        group.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                group.open = false;
                group.querySelector('summary').focus();
            }
        });
    }
    doc.addEventListener('click', (event) => {
        if (!event.target.closest('.nav-group')) closeOthers(null);
    });
}

if (typeof document !== 'undefined') {
    markCurrentPage(document, window.location.href);
    mountNavigation(document);
    // 로그인 표시가 실패해도 페이지의 다른 기능에는 영향을 주지 않습니다.
    import('./auth-menu.js')
        .then((menu) => menu.mountAuthMenu(document, safeLocalStorage()))
        .catch(() => {});
}
