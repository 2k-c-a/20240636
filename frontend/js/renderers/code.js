// 코드 영역을 그린다. "방금 실행한 연산"에 해당하는 줄을 강조한다. 현재 상태만 받아 그리며 다른 상태를 기억하지 않는다.
// 코드 문자열은 반드시 textContent로 넣는다(innerHTML 금지). 사용자·콘텐츠 문자열이 HTML로 해석되지 않는다.

/**
 * @param {Element} root  코드 영역을 담는 요소. 처음에는 비어 있어도 된다
 * @param {string[]} codeLines  소스를 줄 단위로 나눈 배열
 * @param {number[]} [activeLines]  강조할 줄 번호(1부터). 범위 밖이거나 정수가 아닌 값은 무시한다
 * @param {{label?: string, resetScroll?: boolean}} [options]
 *   label: 스크린 리더가 읽을 코드 영역 이름.
 *   resetScroll: true이면 스크롤을 맨 위·왼쪽으로 되돌린다(언어를 바꿔 다른 코드를 보여 줄 때). 기본은 현재 위치를 유지한다.
 */
export function renderCode(root, codeLines, activeLines = [], { label = '코드', resetScroll = false } = {}) {
    const doc = root.ownerDocument;
    // 줄은 1..codeLines.length만 조회하고 Set은 엄격한 비교를 하므로, 범위 밖이거나 정수가 아닌 값은 따로 거르지 않아도 무시된다.
    const active = new Set(activeLines);

    // 한 번 만든 pre를 계속 쓴다. 단계나 언어를 바꿀 때마다 새로 만들면 키보드 포커스와 스크롤 위치를 잃는다.
    let pre = root.children.length === 1 && root.children[0].localName === 'pre' ? root.children[0] : null;
    let code = pre === null ? null : pre.children[0];
    if (pre === null || code === undefined) {
        pre = doc.createElement('pre');
        pre.setAttribute('class', 'code');
        // 가로로 넘치는 긴 줄을 키보드로도 스크롤할 수 있게 한다.
        pre.setAttribute('tabindex', '0');
        code = doc.createElement('code');
        pre.appendChild(code);
        root.replaceChildren(pre);
    }
    pre.setAttribute('aria-label', label);

    let firstActive = null;
    let lastActive = null;
    const lines = codeLines.map((text, i) => {
        const isActive = active.has(i + 1);
        const line = doc.createElement('span');
        line.setAttribute('class', isActive ? 'line hl' : 'line');
        line.setAttribute('data-line', String(i + 1));

        // 색만으로 구분하지 않도록 강조된 줄 앞에 ▶ 표시를 둔다(강조되지 않은 줄에서는 CSS로 숨겨 정렬만 유지한다).
        const marker = doc.createElement('span');
        marker.setAttribute('class', 'marker');
        marker.setAttribute('aria-hidden', 'true');
        marker.textContent = '▶';
        line.appendChild(marker);

        const source = doc.createElement('span');
        source.setAttribute('class', 'src');
        source.textContent = text;
        line.appendChild(source);

        if (isActive) {
            const hint = doc.createElement('span');
            hint.setAttribute('class', 'visually-hidden');
            hint.textContent = ' (방금 실행한 줄)';
            line.appendChild(hint);
            firstActive ??= line;
            lastActive = line;
        }
        return line;
    });
    code.replaceChildren(...lines);

    if (resetScroll) {
        pre.scrollTop = 0;
        pre.scrollLeft = 0;
    }
    scrollIntoViewWithin(pre, firstActive, lastActive);
}

/**
 * 강조한 줄(first~last)이 코드 영역(pre) 안에서 가려져 있으면 그 영역만 세로로 스크롤해 보이게 한다.
 * 강조한 범위가 영역보다 크면 첫 줄이 맨 위에 오게 한다. 페이지 전체는 움직이지 않는다(scrollIntoView를 쓰지 않는다).
 * 강조한 줄이 없거나 위치 정보가 없는 환경에서는 아무것도 하지 않는다.
 */
export function scrollIntoViewWithin(pre, first, last = first) {
    if (first === null || !Number.isFinite(first.offsetTop) || !Number.isFinite(last.offsetTop) || !Number.isFinite(pre.clientHeight) || pre.clientHeight === 0) return;
    const top = first.offsetTop;
    const bottom = last.offsetTop + last.offsetHeight;
    if (bottom - top > pre.clientHeight || top < pre.scrollTop) pre.scrollTop = top;
    else if (bottom > pre.scrollTop + pre.clientHeight) pre.scrollTop = bottom - pre.clientHeight;
}
