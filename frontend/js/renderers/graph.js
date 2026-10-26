// 그래프 알고리즘(BFS, DFS)의 화면 영역(그래프 SVG, 큐 또는 호출 스택, 상태 목록)을 그린다.
// 현재 상태(snapshot)만 받아 그리며 이전 상태를 기억하지 않는다.
//
// - 모든 글자는 textContent로 넣고 innerHTML을 쓰지 않는다.
// - 노드 상태는 색뿐 아니라 모양(점선·이중 원), 글자(큐 1, 현재, 완료), 텍스트 목록으로도 알려 준다.
// - 노드 위치는 입력의 layout(0~100)을 그대로 쓴다. 렌더러가 위치를 계산하지 않는다.
// - 순수 함수(classifyNodes, edgeGeometry, loopGeometry)와 DOM을 만드는 함수를 나누어 앞의 것은 DOM 없이 테스트한다.

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const NODE_RADIUS = 7.5;
const VIEW_BOX = '-8 -8 116 120';

/** 노드 상태 이름(한국어). 화면의 범례와 툴팁에 쓴다. */
export const STATUS_LABELS = Object.freeze({
    undiscovered: '아직 발견하지 않음',
    discovered: '발견함(큐에 넣기 전)',
    queued: '큐에서 대기 중',
    stacked: '호출 스택에서 대기 중',
    current: '현재 처리 중',
    processed: '처리 완료',
});

// ---------- 순수 함수 ----------

/**
 * 노드마다 상태를 정한다. 우선순위는 처리 완료 > 현재 > 큐 대기 > 발견 > 미발견이다.
 * 검사 중인 이웃(neighbor)은 상태와 별개의 겹침 표시다.
 *
 * @param {{graph: Record<string, string[]>}} input
 * @param {{discovered: string[], processed: string[], queue: string[], current: string|null, neighbor: string|null}} snapshot
 * @returns {{id: string, status: keyof typeof STATUS_LABELS, isNeighbor: boolean, queuePosition: number|null}[]}
 */
export function classifyNodes(input, snapshot) {
    const processed = new Set(snapshot.processed);
    const discovered = new Set(snapshot.discovered);
    const queuePosition = new Map(snapshot.queue.map((node, index) => [node, index]));
    return Object.keys(input.graph).map((id) => {
        let status = 'undiscovered';
        if (processed.has(id)) status = 'processed';
        else if (snapshot.current === id) status = 'current';
        else if (queuePosition.has(id)) status = 'queued';
        else if (discovered.has(id)) status = 'discovered';
        return { id, status, isNeighbor: snapshot.neighbor === id, queuePosition: queuePosition.get(id) ?? null };
    });
}

const round = (value) => Number(value.toFixed(2));
const point = (x, y) => ({ x: round(x), y: round(y) });
const fmt = (p) => `${p.x} ${p.y}`;

/**
 * 서로 다른 두 노드를 잇는 방향 간선의 경로. 선은 두 원의 경계에서 시작하고 끝난다(화살촉이 원 안으로 들어가지 않는다).
 * 반대 방향 간선이 있으면(reverse) 서로 겹치지 않도록 각자 반대쪽으로 휘게 그린다.
 * 두 노드의 위치가 같으면 그릴 수 없으므로 null.
 */
export function edgeGeometry(from, to, { reverse = false, radius = NODE_RADIUS } = {}) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) return null;
    const ux = dx / length;
    const uy = dy / length;

    if (!reverse) {
        const start = point(from.x + ux * radius, from.y + uy * radius);
        const end = point(to.x - ux * radius, to.y - uy * radius);
        return { kind: 'line', start, end, d: `M ${fmt(start)} L ${fmt(end)}` };
    }

    // 진행 방향의 오른쪽(화면 좌표계의 시계 방향 90도)으로 제어점을 민다. 반대 방향 간선은 방향이 뒤집혀 반대쪽으로 휜다.
    const control = { x: (from.x + to.x) / 2 - uy * 9, y: (from.y + to.y) / 2 + ux * 9 };
    const toward = (origin, target) => {
        const vx = target.x - origin.x;
        const vy = target.y - origin.y;
        const l = Math.hypot(vx, vy);
        return point(origin.x + (vx / l) * radius, origin.y + (vy / l) * radius);
    };
    const start = toward(from, control);
    const end = toward(to, control);
    return { kind: 'curve', start, end, control: point(control.x, control.y), d: `M ${fmt(start)} Q ${fmt(point(control.x, control.y))} ${fmt(end)}` };
}

/** 자기 자신으로 돌아오는 간선(자기 간선)의 경로. 위쪽 공간이 좁은 노드는 아래쪽으로 고리를 그린다. */
export function loopGeometry(center, { radius = NODE_RADIUS } = {}) {
    const direction = center.y < 24 ? 1 : -1;
    const dx = radius * 0.48;
    const dy = radius * 0.88 * direction;
    const start = point(center.x - dx, center.y + dy);
    const end = point(center.x + dx, center.y + dy);
    const c1 = point(center.x - 9, center.y + 21 * direction);
    const c2 = point(center.x + 9, center.y + 21 * direction);
    return { kind: 'loop', start, end, d: `M ${fmt(start)} C ${fmt(c1)} ${fmt(c2)} ${fmt(end)}` };
}

/** 방향 간선 목록 [{from, to}] (graph의 이웃 배열 순서대로). */
export function listEdges(input) {
    return Object.entries(input.graph).flatMap(([from, tos]) => tos.map((to) => ({ from, to })));
}

/** "A → B, C · B → D · D → (이웃 없음)" 형태의 그래프 설명(그림을 볼 수 없는 사용자를 위한 텍스트 대체). */
export function describeGraph(input) {
    return Object.entries(input.graph)
        .map(([from, tos]) => `${from} → ${tos.length > 0 ? tos.join(', ') : '(이웃 없음)'}`)
        .join(' · ');
}

const listText = (items) => (items.length > 0 ? items.join(', ') : '없음');

/** 노드 하나의 설명(툴팁·접근성). 예: "B: 큐에서 대기 중 (큐 1번째), 지금 검사 중인 이웃" */
export function describeNode(node) {
    let text = `${node.id}: ${STATUS_LABELS[node.status]}`;
    if (node.status === 'queued') text += ` (큐 ${node.queuePosition + 1}번째)`;
    if (node.status === 'stacked') text += ` (스택 ${node.stackPosition + 1}번째, 바닥이 1번째)`;
    if (node.isNeighbor) text += ', 지금 검사 중인 이웃';
    return text;
}

// ---------- DOM ----------

function svgEl(doc, name, attributes = {}) {
    const element = doc.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
}

function htmlEl(doc, name, className, text) {
    const element = doc.createElement(name);
    if (className) element.setAttribute('class', className);
    if (text !== undefined) element.textContent = text;
    return element;
}

function tagText(node) {
    if (node.status === 'discovered') return '발견';
    if (node.status === 'queued') return `큐 ${node.queuePosition + 1}`;
    if (node.status === 'stacked') return `스택 ${node.stackPosition + 1}`;
    if (node.status === 'current') return '현재';
    if (node.status === 'processed') return '완료';
    return null;
}

/** 노드의 모양(바깥 원 + 본체 원)을 group에 붙인다. 그래프와 범례가 같은 모양·클래스를 쓴다. */
function appendNodeShapes(doc, group, { status, isNeighbor, cx, cy }) {
    if (isNeighbor) group.appendChild(svgEl(doc, 'circle', { class: 'ring ring--neighbor', cx, cy, r: NODE_RADIUS + 3.4 }));
    if (status === 'current') group.appendChild(svgEl(doc, 'circle', { class: 'ring ring--current', cx, cy, r: NODE_RADIUS + 2.4 }));
    group.appendChild(svgEl(doc, 'circle', { class: 'base', cx, cy, r: NODE_RADIUS }));
}

function buildMarker(doc, id, className) {
    const marker = svgEl(doc, 'marker', {
        id, class: className, viewBox: '0 0 6 6', refX: 6, refY: 3, markerWidth: 5, markerHeight: 5, markerUnits: 'userSpaceOnUse', orient: 'auto',
    });
    marker.appendChild(svgEl(doc, 'path', { d: 'M0,0 L6,3 L0,6 z' }));
    return marker;
}

/**
 * 그래프 SVG. 장식이 아니라 상태 그림이지만, 같은 정보를 아래의 텍스트 목록이 제공하므로 보조 기술에는 숨긴다.
 * 노드 상태(nodes)와 강조할 간선(activeEdge)은 알고리즘이 정해서 넘긴다. 생략하면 BFS의 규칙을 쓴다.
 */
export function buildGraphSvg(doc, input, snapshot, { nodes: classified = classifyNodes(input, snapshot), activeEdge = { from: snapshot.current, to: snapshot.neighbor } } = {}) {
    const svg = svgEl(doc, 'svg', { class: 'graph-svg', viewBox: VIEW_BOX, 'aria-hidden': 'true', focusable: 'false', preserveAspectRatio: 'xMidYMid meet' });

    const defs = svgEl(doc, 'defs');
    defs.appendChild(buildMarker(doc, 'graph-arrow', 'arrow'));
    defs.appendChild(buildMarker(doc, 'graph-arrow-active', 'arrow arrow--active'));
    svg.appendChild(defs);

    const edgeSet = new Set(listEdges(input).map(({ from, to }) => `${from}>${to}`));
    const edges = svgEl(doc, 'g', { class: 'edges' });
    for (const { from, to } of listEdges(input)) {
        const active = activeEdge !== null && activeEdge.from === from && activeEdge.to === to;
        const a = input.layout[from];
        const b = input.layout[to];
        const geometry = from === to ? loopGeometry(a) : edgeGeometry(a, b, { reverse: edgeSet.has(`${to}>${from}`) });
        if (geometry === null) continue;
        edges.appendChild(svgEl(doc, 'path', {
            class: active ? 'edge edge--active' : 'edge',
            d: geometry.d,
            'data-from': from,
            'data-to': to,
            'marker-end': `url(#${active ? 'graph-arrow-active' : 'graph-arrow'})`,
        }));
    }
    svg.appendChild(edges);

    const nodes = svgEl(doc, 'g', { class: 'nodes' });
    for (const node of classified) {
        const { x, y } = input.layout[node.id];
        const group = svgEl(doc, 'g', { class: `node node--${node.status}${node.isNeighbor ? ' node--neighbor' : ''}`, 'data-node': node.id });
        const title = svgEl(doc, 'title');
        title.textContent = describeNode(node);
        group.appendChild(title);
        appendNodeShapes(doc, group, { status: node.status, isNeighbor: node.isNeighbor, cx: x, cy: y });

        const label = svgEl(doc, 'text', { class: 'label', x, y, dy: '.35em' });
        label.textContent = node.id;
        group.appendChild(label);

        // 바깥 원(검사 중인 이웃 3.4, 현재 노드 2.4)이 있는 노드는 글자가 원과 겹치지 않도록 더 아래에 둔다.
        let tagY = y + NODE_RADIUS + (node.isNeighbor ? 8 : node.status === 'current' ? 7 : 5);
        const tag = tagText(node);
        if (tag !== null) {
            const text = svgEl(doc, 'text', { class: 'tag', x, y: tagY });
            text.textContent = tag;
            group.appendChild(text);
            tagY += 4.8;
        }
        if (node.isNeighbor) {
            const text = svgEl(doc, 'text', { class: 'tag tag--neighbor', x, y: tagY });
            text.textContent = '검사 중';
            group.appendChild(text);
        }
        nodes.appendChild(group);
    }
    svg.appendChild(nodes);
    return svg;
}

/** 큐: 앞(꺼내는 쪽)에서 뒤(넣는 쪽) 순서로 텍스트 상자를 늘어놓는다. */
export function buildQueueView(doc, snapshot) {
    const view = htmlEl(doc, 'div', 'queue-view');
    view.appendChild(htmlEl(doc, 'p', 'queue-caption', '큐 (앞에서 꺼내고, 뒤에 넣습니다)'));

    const row = htmlEl(doc, 'div', 'queue-row');
    row.appendChild(htmlEl(doc, 'span', 'queue-end', '앞'));
    const list = htmlEl(doc, 'ol', 'queue-items');
    list.setAttribute('aria-label', '큐의 내용, 앞에서 뒤 순서');
    if (snapshot.queue.length === 0) {
        list.appendChild(htmlEl(doc, 'li', 'queue-item queue-item--empty', '비어 있음'));
    } else {
        snapshot.queue.forEach((node, index) => {
            const item = htmlEl(doc, 'li', 'queue-item', node);
            item.setAttribute('data-position', String(index + 1));
            list.appendChild(item);
        });
    }
    row.appendChild(list);
    row.appendChild(htmlEl(doc, 'span', 'queue-end', '뒤'));
    view.appendChild(row);
    return view;
}

/** 상태를 글자로 모두 적은 목록. 그림을 보지 못하거나 색을 구분하기 어려운 경우에도 같은 정보를 얻을 수 있다. */
export function buildStateList(doc, snapshot) {
    const list = htmlEl(doc, 'dl', 'state-list');
    const rows = [
        ['발견한 노드 (코드의 visited)', listText(snapshot.discovered)],
        ['큐 (앞 → 뒤)', listText(snapshot.queue)],
        ['현재 노드', snapshot.current ?? '없음'],
        ['검사 중인 이웃', snapshot.neighbor ?? '없음'],
        ['처리 완료 (학습용 표시, 순서대로)', listText(snapshot.processed)],
    ];
    for (const [term, value] of rows) {
        list.appendChild(htmlEl(doc, 'dt', undefined, term));
        list.appendChild(htmlEl(doc, 'dd', undefined, value));
    }
    return list;
}

/**
 * 그래프 영역 전체를 현재 상태로 다시 그린다: 그래프 그림과 설명, 큐, 상태 목록.
 * @param {Element} root  이 안을 비우고 새로 그린다
 * @param {Parameters<typeof classifyNodes>[0] & {layout: Record<string, {x: number, y: number}>}} input
 * @param {Parameters<typeof classifyNodes>[1]} snapshot
 */
export function renderGraph(root, input, snapshot) {
    const doc = root.ownerDocument;
    const figure = htmlEl(doc, 'figure', 'graph-figure');
    figure.appendChild(buildGraphSvg(doc, input, snapshot));
    figure.appendChild(htmlEl(doc, 'figcaption', 'graph-caption', `그래프(방향 간선): ${describeGraph(input)}`));
    root.replaceChildren(figure, buildQueueView(doc, snapshot), buildStateList(doc, snapshot));
}

/** 범례. 노드 모양 샘플은 그래프와 같은 클래스를 쓰므로 화면의 모양과 항상 같다. */
export function renderLegend(root) {
    renderLegendItems(root, [
        { status: 'undiscovered', text: '아직 발견하지 않은 노드: 점선 원' },
        { status: 'discovered', text: '발견했지만 큐에 넣기 전: 연한 파랑 원, "발견"' },
        { status: 'queued', text: '큐에서 차례를 기다리는 노드: 파랑 원, "큐 1"이 맨 앞' },
        { status: 'current', text: '큐에서 꺼내 처리 중인 현재 노드: 노랑 이중 원, "현재"' },
        { status: 'processed', text: '이웃 검사를 모두 마친 노드: 진한 회색 원, "완료"' },
        { status: 'undiscovered', isNeighbor: true, text: '지금 검사 중인 이웃: 주황 점선 바깥 원, "검사 중"' },
    ], '지금 검사 중인 간선: 주황색 굵은 화살표 (방향이 있는 간선)');
}

/** 범례 목록(노드 모양 샘플 + 간선 샘플). 노드 모양 샘플은 그래프와 같은 클래스를 쓰므로 화면의 모양과 항상 같다. */
function renderLegendItems(root, items, edgeText) {
    const doc = root.ownerDocument;
    const list = htmlEl(doc, 'ul', 'legend');
    for (const item of items) {
        const li = htmlEl(doc, 'li', 'legend-item');
        const swatch = svgEl(doc, 'svg', { class: 'legend-swatch', viewBox: '-13 -13 26 26', 'aria-hidden': 'true', focusable: 'false' });
        const group = svgEl(doc, 'g', { class: `node node--${item.status}${item.isNeighbor ? ' node--neighbor' : ''}` });
        appendNodeShapes(doc, group, { status: item.status, isNeighbor: Boolean(item.isNeighbor), cx: 0, cy: 0 });
        swatch.appendChild(group);
        li.appendChild(swatch);
        li.appendChild(htmlEl(doc, 'span', undefined, item.text));
        list.appendChild(li);
    }
    const edgeItem = htmlEl(doc, 'li', 'legend-item');
    const edgeSwatch = svgEl(doc, 'svg', { class: 'legend-swatch', viewBox: '-13 -13 26 26', 'aria-hidden': 'true', focusable: 'false' });
    // 화살촉(marker)은 그래프 SVG의 defs에 있는 것을 문서 안에서 id로 참조한다.
    edgeSwatch.appendChild(svgEl(doc, 'path', { class: 'edge edge--active', d: 'M -11 0 L 8 0', 'marker-end': 'url(#graph-arrow-active)' }));
    edgeItem.appendChild(edgeSwatch);
    edgeItem.appendChild(htmlEl(doc, 'span', undefined, edgeText));
    list.appendChild(edgeItem);
    root.replaceChildren(list);
}

// ============================================================================
// DFS (재귀): 노드 상태는 호출 스택(frames)으로 정해지고, 큐 대신 호출 스택을 보여 준다.
// ============================================================================

/**
 * DFS 노드 상태. 우선순위는 처리 완료 > 현재 > 호출 스택에서 대기 > 발견 > 미발견이다.
 * 검사 중인 이웃은 check-neighbor 단계에서만 있으며 꼭대기 frame의 nextNeighborIndex - 1번째 이웃이다.
 *
 * @param {{graph: Record<string, string[]>}} input
 * @param {{frames: {node: string, nextNeighborIndex: number}[], discovered: string[], processed: string[], current: string|null}} snapshot
 * @param {string} operation  이 상태를 만든 operation
 */
export function classifyDfsNodes(input, snapshot, operation) {
    const processed = new Set(snapshot.processed);
    const discovered = new Set(snapshot.discovered);
    const stackPosition = new Map(snapshot.frames.map((frame, index) => [frame.node, index]));
    const neighbor = checkedNeighbor(input, snapshot, operation);
    return Object.keys(input.graph).map((id) => {
        let status = 'undiscovered';
        if (processed.has(id)) status = 'processed';
        else if (snapshot.current === id) status = 'current';
        else if (stackPosition.has(id)) status = 'stacked';
        else if (discovered.has(id)) status = 'discovered';
        return { id, status, isNeighbor: neighbor === id, stackPosition: stackPosition.get(id) ?? null };
    });
}

/** check-neighbor 단계에서 방금 검사한 이웃. 그 밖의 단계에서는 null. */
export function checkedNeighbor(input, snapshot, operation) {
    if (operation !== 'check-neighbor') return null;
    const top = snapshot.frames[snapshot.frames.length - 1];
    return top === undefined ? null : input.graph[top.node][top.nextNeighborIndex - 1] ?? null;
}

/**
 * 강조할 간선. 이웃을 검사하는 단계는 현재 노드 → 검사한 이웃, 호출하는 단계(call)는 호출한 노드 → 새로 호출된 노드이다.
 * 둘 다 아니면 null.
 */
export function dfsActiveEdge(input, snapshot, operation) {
    if (operation === 'check-neighbor') {
        const neighbor = checkedNeighbor(input, snapshot, operation);
        return neighbor === null ? null : { from: snapshot.current, to: neighbor };
    }
    if (operation === 'call' && snapshot.frames.length >= 2) {
        return { from: snapshot.frames[snapshot.frames.length - 2].node, to: snapshot.current };
    }
    return null;
}

/** 호출 스택: 꼭대기(가장 나중에 호출한 것)를 맨 위에 두고 바닥으로 내려간다. 각 칸에 "다음에 볼 이웃"을 적는다. */
export function buildStackView(doc, input, snapshot) {
    const view = htmlEl(doc, 'div', 'stack-view');
    view.appendChild(htmlEl(doc, 'p', 'stack-caption', '호출 스택 (맨 위가 지금 실행 중인 호출입니다)'));
    const list = htmlEl(doc, 'ol', 'stack-items');
    list.setAttribute('aria-label', '호출 스택의 내용, 위(꼭대기)에서 아래(바닥) 순서');
    if (snapshot.frames.length === 0) {
        list.appendChild(htmlEl(doc, 'li', 'stack-item stack-item--empty', '비어 있음'));
    } else {
        snapshot.frames.map((frame, index) => ({ frame, index })).reverse().forEach(({ frame, index }) => {
            const neighbors = input.graph[frame.node];
            const next = frame.nextNeighborIndex < neighbors.length ? `다음에 볼 이웃: ${neighbors[frame.nextNeighborIndex]}` : '검사할 이웃 없음';
            const item = htmlEl(doc, 'li', index === snapshot.frames.length - 1 ? 'stack-item stack-item--top' : 'stack-item');
            item.setAttribute('data-depth', String(index + 1));
            item.appendChild(htmlEl(doc, 'strong', 'stack-node', frame.node));
            item.appendChild(htmlEl(doc, 'span', 'stack-detail', ` ${next} (nextNeighborIndex = ${frame.nextNeighborIndex})`));
            list.appendChild(item);
        });
    }
    view.appendChild(list);
    return view;
}

/** DFS 상태를 글자로 모두 적은 목록. */
export function buildDfsStateList(doc, input, snapshot, operation) {
    const list = htmlEl(doc, 'dl', 'state-list');
    const stack = snapshot.frames.length > 0 ? snapshot.frames.map((frame) => frame.node).join(' → ') : '비어 있음';
    const rows = [
        ['발견한 노드 (코드의 visited)', listText(snapshot.discovered)],
        ['호출 스택 (바닥 → 꼭대기)', stack],
        ['현재 노드 (꼭대기)', snapshot.current ?? '없음'],
        ['검사 중인 이웃', checkedNeighbor(input, snapshot, operation) ?? '없음'],
        ['처리 완료 (학습용 표시, 순서대로)', listText(snapshot.processed)],
    ];
    for (const [term, value] of rows) {
        list.appendChild(htmlEl(doc, 'dt', undefined, term));
        list.appendChild(htmlEl(doc, 'dd', undefined, value));
    }
    return list;
}

/**
 * DFS 화면 영역 전체를 현재 상태로 다시 그린다: 그래프 그림과 설명, 호출 스택, 상태 목록.
 * @param {{operation?: string}} [context]  이 상태를 만든 operation. 검사 중인 이웃과 강조할 간선을 알려면 필요하다.
 */
export function renderDfsGraph(root, input, snapshot, { operation = 'initial' } = {}) {
    const doc = root.ownerDocument;
    const figure = htmlEl(doc, 'figure', 'graph-figure');
    figure.appendChild(buildGraphSvg(doc, input, snapshot, {
        nodes: classifyDfsNodes(input, snapshot, operation),
        activeEdge: dfsActiveEdge(input, snapshot, operation),
    }));
    figure.appendChild(htmlEl(doc, 'figcaption', 'graph-caption', `그래프(방향 간선): ${describeGraph(input)}`));
    root.replaceChildren(figure, buildStackView(doc, input, snapshot), buildDfsStateList(doc, input, snapshot, operation));
}

/** DFS 범례. 노드 모양 샘플은 그래프와 같은 클래스를 쓰므로 화면의 모양과 항상 같다. */
export function renderDfsLegend(root) {
    renderLegendItems(root, [
        { status: 'undiscovered', text: '아직 발견하지 않은 노드: 점선 원' },
        { status: 'stacked', text: '호출 스택에서 돌아오기를 기다리는 노드: 굵은 파랑 원, "스택 1"이 맨 아래' },
        { status: 'current', text: '지금 실행 중인 호출의 노드(스택 꼭대기): 노랑 이중 원, "현재"' },
        { status: 'processed', text: '이웃 검사를 모두 마친 노드: 진한 회색 원, "완료"' },
        { status: 'undiscovered', isNeighbor: true, text: '지금 검사 중인 이웃: 주황 점선 바깥 원, "검사 중"' },
    ], '지금 검사하거나 호출하는 간선: 주황색 굵은 화살표 (방향이 있는 간선)');
}
