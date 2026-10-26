// 배열 알고리즘(이분 탐색, 버블 정렬)의 화면 영역(배열 칸, 상태 목록)을 그린다. 현재 상태(snapshot)만 받아 그리며 이전 상태를 기억하지 않는다.
//
// - 모든 글자는 textContent로 넣고 innerHTML을 쓰지 않는다.
// - 칸의 상태는 색뿐 아니라 테두리 모양(점선·굵은 선)과 글자 표시("left", "mid", "비교", "확정"…), 텍스트 목록으로도 알려 준다.
// - 음수는 "-1"처럼 부호를 그대로 쓴다. 칸 안의 글자는 칸 밖으로 넘치지 않도록 CSS에서 줄바꿈한다.
// - 순수 함수(classify*)와 DOM을 만드는 함수를 나누어 앞의 것은 DOM 없이 테스트한다.

function htmlEl(doc, name, className, text) {
    const element = doc.createElement(name);
    if (className) element.setAttribute('class', className);
    if (text !== undefined) element.textContent = text;
    return element;
}

const listText = (items) => (items.length > 0 ? items.join(', ') : '비어 있음');

// ---------- 순수 함수 ----------

/**
 * 이분 탐색의 칸마다 상태와 표시 글자를 정한다.
 * 상태: found(찾은 칸) > mid(중간 위치) > out(탐색 구간 밖, 이미 제외됨) > in(탐색 구간 안).
 * 표시 글자: left·right(경계, 같은 칸이면 둘 다), mid, 찾음. 결과가 -1이면 어느 칸도 찾음으로 표시하지 않는다.
 *
 * @param {{values: number[]}} input
 * @param {{left: number, right: number, mid: number|null, result: number|null}} state
 */
export function classifyBinarySearchCells(input, state) {
    return input.values.map((value, index) => {
        const tags = [];
        if (index === state.left) tags.push('left');
        if (index === state.right) tags.push('right');
        if (index === state.mid) tags.push('mid');
        const found = index === state.result; // result가 null(아직 없음)이나 -1(찾지 못함)이면 어느 칸도 같을 수 없다
        if (found) tags.push('찾음');
        let status = 'in';
        if (found) status = 'found';
        else if (index === state.mid) status = 'mid';
        else if (index < state.left || index > state.right) status = 'out';
        return { index, value, status, tags };
    });
}

/**
 * 버블 정렬의 칸마다 상태와 표시 글자를 정한다.
 * 상태: sorted(자리가 확정된 칸) > swapped(방금 교환한 두 칸) > compare(비교 중인 두 칸) > plain.
 *
 * @param {{values: number[], compareIndices: [number, number]|null, swapped: boolean, sortedFrom: number}} state
 */
export function classifyBubbleSortCells(state) {
    const compared = new Set(state.compareIndices ?? []);
    return state.values.map((value, index) => {
        const tags = [];
        let status = 'plain';
        if (index >= state.sortedFrom) {
            status = 'sorted';
            tags.push('확정');
        } else if (compared.has(index)) {
            status = state.swapped ? 'swapped' : 'compare';
            tags.push(state.swapped ? '교환됨' : '비교');
        }
        return { index, value, status, tags };
    });
}

/** 칸 하나의 설명(스크린 리더용). 예: "인덱스 3, 값 -1 (음수), mid" */
export function describeCell(cell) {
    const parts = [`인덱스 ${cell.index}`, `값 ${cell.value}${cell.value < 0 ? ' (음수)' : ''}`];
    if (cell.status === 'out') parts.push('탐색 구간 밖');
    return [parts.join(', '), ...cell.tags].join(', ');
}

// ---------- DOM ----------

/** 칸 목록. 줄이 길면 여러 줄로 감긴다. */
export function buildCells(doc, cells, label) {
    const list = htmlEl(doc, 'ol', 'array-cells');
    list.setAttribute('aria-label', label);
    for (const cell of cells) {
        const item = htmlEl(doc, 'li', `cell cell--${cell.status}${cell.value < 0 ? ' cell--negative' : ''}`);
        item.setAttribute('data-index', String(cell.index));
        item.setAttribute('aria-label', describeCell(cell));
        item.appendChild(htmlEl(doc, 'span', 'cell-index', String(cell.index)));
        item.appendChild(htmlEl(doc, 'span', 'cell-value', String(cell.value)));
        item.appendChild(htmlEl(doc, 'span', 'cell-tags', cell.tags.join(' ')));
        list.appendChild(item);
    }
    return list;
}

function buildStateList(doc, rows) {
    const list = htmlEl(doc, 'dl', 'state-list');
    for (const [term, value] of rows) {
        list.appendChild(htmlEl(doc, 'dt', undefined, term));
        list.appendChild(htmlEl(doc, 'dd', undefined, value));
    }
    return list;
}

function emptyNotice(doc) {
    return htmlEl(doc, 'p', 'array-empty', '배열이 비어 있습니다(원소가 없습니다).');
}

/** 이분 탐색 화면 영역 전체를 현재 상태로 다시 그린다. */
export function renderBinarySearch(root, input, state) {
    const doc = root.ownerDocument;
    const figure = htmlEl(doc, 'figure', 'array-figure');
    figure.appendChild(htmlEl(doc, 'p', 'array-target', `찾는 값(target): ${state.target}`));
    figure.appendChild(input.values.length === 0 ? emptyNotice(doc) : buildCells(doc, classifyBinarySearchCells(input, state), '정렬된 배열의 칸, 인덱스 순서'));

    const range = state.left <= state.right ? `인덱스 ${state.left} ~ ${state.right} (양끝 포함)` : `비어 있음 (left = ${state.left} > right = ${state.right})`;
    let result = '아직 없음';
    if (state.result === -1) result = '-1 (찾지 못함)';
    else if (state.result !== null) result = `인덱스 ${state.result}`;
    root.replaceChildren(figure, buildStateList(doc, [
        ['배열 (values, 오름차순)', listText(state.values)],
        ['찾는 값 (target)', String(state.target)],
        ['탐색 구간 (left ~ right)', range],
        ['중간 위치 (mid)', state.mid === null ? '없음' : `${state.mid} (values[${state.mid}] = ${state.values[state.mid]})`],
        ['결과 (result)', result],
    ]));
}

/** 버블 정렬 화면 영역 전체를 현재 상태로 다시 그린다. */
export function renderBubbleSort(root, input, state) {
    const doc = root.ownerDocument;
    const figure = htmlEl(doc, 'figure', 'array-figure');
    figure.appendChild(state.values.length === 0 ? emptyNotice(doc) : buildCells(doc, classifyBubbleSortCells(state), '정렬 중인 배열의 칸, 인덱스 순서'));

    const n = state.values.length;
    let compared = '없음';
    if (state.compareIndices !== null) {
        const [a, b] = state.compareIndices;
        compared = `인덱스 ${a}, ${b} (values[${a}] = ${state.values[a]}, values[${b}] = ${state.values[b]})`;
    }
    let confirmed = '없음';
    if (state.sortedFrom === 0 && n > 0) confirmed = '인덱스 0 이상 (전부 확정)';
    else if (state.sortedFrom < n) confirmed = `인덱스 ${state.sortedFrom} 이상`;
    root.replaceChildren(figure, buildStateList(doc, [
        ['배열 (values)', listText(state.values)],
        ['비교 중인 위치 (compareIndices)', compared],
        ['방금 교환했는가 (swapped)', state.swapped ? '예' : '아니오'],
        ['자리가 확정된 구간 (sortedFrom)', confirmed],
    ]));
}

// ---------- 범례 ----------

function renderCellLegend(root, items) {
    const doc = root.ownerDocument;
    const list = htmlEl(doc, 'ul', 'legend');
    for (const item of items) {
        const li = htmlEl(doc, 'li', 'legend-item');
        const sample = htmlEl(doc, 'span', `legend-cell cell cell--${item.status}`);
        sample.setAttribute('aria-hidden', 'true');
        sample.appendChild(htmlEl(doc, 'span', 'cell-value', item.sample));
        sample.appendChild(htmlEl(doc, 'span', 'cell-tags', item.tag));
        li.appendChild(sample);
        li.appendChild(htmlEl(doc, 'span', undefined, item.text));
        list.appendChild(li);
    }
    root.replaceChildren(list);
}

export function renderBinarySearchLegend(root) {
    renderCellLegend(root, [
        { status: 'in', sample: '8', tag: '', text: '탐색 구간 안의 칸: 실선 테두리 (left ~ right, 양끝 포함)' },
        { status: 'in', sample: '5', tag: 'left', text: '구간의 왼쪽·오른쪽 끝: 칸 아래에 "left", "right" (한 칸이면 둘 다)' },
        { status: 'mid', sample: '12', tag: 'mid', text: '이번에 비교하는 중간 위치: 굵은 파랑 테두리, "mid"' },
        { status: 'out', sample: '2', tag: '', text: '이미 제외된 칸: 점선 테두리와 흐린 글자' },
        { status: 'found', sample: '23', tag: '찾음', text: '찾은 칸: 진한 배경, "찾음" (결과가 -1이면 어느 칸도 찾음이 아닙니다)' },
    ]);
}

export function renderBubbleSortLegend(root) {
    renderCellLegend(root, [
        { status: 'plain', sample: '4', tag: '', text: '아직 확정되지 않은 칸: 실선 테두리' },
        { status: 'compare', sample: '5', tag: '비교', text: '지금 비교하는 이웃한 두 칸: 굵은 파랑 테두리, "비교"' },
        { status: 'swapped', sample: '1', tag: '교환됨', text: '방금 맞바꾼 두 칸: 노랑 배경, "교환됨"' },
        { status: 'sorted', sample: '8', tag: '확정', text: '패스가 끝나 자리가 확정된 칸: 진한 배경, "확정"' },
    ]);
}
