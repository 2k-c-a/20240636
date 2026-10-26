import { gridCells } from '../grid-bfs.js';
import { INF } from '../learning-programs.js';

function element(doc, tag, text, className) {
    const e = doc.createElement(tag);
    if (text !== undefined) e.textContent = String(text);
    if (className) e.setAttribute('class', className);
    return e;
}
function paragraph(root, text) { root.append(element(root.ownerDocument, 'p', text)); }
function table(root, title, headers, rows, active = () => false) {
    const doc = root.ownerDocument, wrap = element(doc, 'div', undefined, 'learning-scroll'), t = element(doc, 'table', undefined, 'learning-table');
    t.append(element(doc, 'caption', title));
    const head = element(doc, 'tr');
    for (const header of headers) { const th = element(doc, 'th', header); th.setAttribute('scope', 'col'); head.append(th); }
    const thead = element(doc, 'thead'); thead.append(head); t.append(thead);
    const body = element(doc, 'tbody');
    rows.forEach((values, row) => {
        const tr = element(doc, 'tr');
        values.forEach((value, column) => {
            const isActive = active(row, column);
            tr.append(element(doc, column === 0 ? 'th' : 'td', `${isActive ? '▶ ' : ''}${value}`, isActive ? 'learning-active' : undefined));
        });
        body.append(tr);
    });
    t.append(body); wrap.append(t); root.append(wrap);
}

function graph(root, input, { current = -1, done = [], distance = null } = {}) {
    const doc = root.ownerDocument, ns = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 320 250'); svg.setAttribute('class', 'learning-graph'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '방향 그래프. 간선과 노드별 값은 아래 텍스트와 표에도 표시됩니다.');
    const positions = Array.from({ length: input.n }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI * 2 / input.n; return { x: 160 + 108 * Math.cos(a), y: 120 + 88 * Math.sin(a) }; });
    const defs = doc.createElementNS(ns, 'defs'), marker = doc.createElementNS(ns, 'marker'), arrow = doc.createElementNS(ns, 'path');
    for (const [name, value] of Object.entries({ id: 'learning-arrow', viewBox: '0 0 10 10', refX: '8', refY: '5', markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse' })) marker.setAttribute(name, value);
    arrow.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z'); arrow.setAttribute('fill', '#526476'); marker.append(arrow); defs.append(marker); svg.append(defs);
    for (const [a, b, weight] of input.edges) {
        const from = positions[a], to = positions[b], dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy) || 1;
        const line = doc.createElementNS(ns, 'line');
        for (const [name, value] of Object.entries({ x1: from.x + dx / len * 21, y1: from.y + dy / len * 21, x2: to.x - dx / len * 24, y2: to.y - dy / len * 24, stroke: '#526476', 'stroke-width': '2', 'marker-end': 'url(#learning-arrow)' })) line.setAttribute(name, String(value));
        svg.append(line);
        if (weight !== undefined) { const text = doc.createElementNS(ns, 'text'); text.setAttribute('x', String((from.x + to.x) / 2)); text.setAttribute('y', String((from.y + to.y) / 2 - 5)); text.setAttribute('class', 'learning-edge-label'); text.textContent = String(weight); svg.append(text); }
    }
    positions.forEach(({ x, y }, i) => {
        const circle = doc.createElementNS(ns, 'circle');
        for (const [name, value] of Object.entries({ cx: x, cy: y, r: 20, fill: i === current ? '#fff0a8' : done.includes(i) ? '#d7e8f5' : '#fff', stroke: '#25435b', 'stroke-width': i === current ? 4 : 2 })) circle.setAttribute(name, String(value));
        svg.append(circle);
        const text = doc.createElementNS(ns, 'text'); text.setAttribute('x', String(x)); text.setAttribute('y', String(y + 5)); text.setAttribute('text-anchor', 'middle'); text.textContent = `${i === current ? '▶' : ''}${i}`; svg.append(text);
        if (distance) { const label = doc.createElementNS(ns, 'text'); label.setAttribute('x', String(x)); label.setAttribute('y', String(y + 36)); label.setAttribute('text-anchor', 'middle'); label.setAttribute('class', 'learning-edge-label'); label.textContent = `거리 ${distance[i] === INF ? '∞' : distance[i]}`; svg.append(label); }
    });
    root.append(svg);
    paragraph(root, `방향 간선: ${input.edges.map(([a, b, w]) => `${a} → ${b}${w === undefined ? '' : ` (가중치 ${w})`}`).join(' · ') || '없음'}`);
}

export function renderLearning(root, id, input, state, context = {}) {
    const s = state.vars; root.replaceChildren();
    if (id === 'union-find') {
        paragraph(root, 'parent[x]를 따라가 자기 자신이 부모인 노드가 집합의 루트입니다. result의 1은 같은 집합, 0은 다른 집합입니다.');
        table(root, '부모 포인터와 랭크', ['노드', '부모', '랭크', '표시'], s.parent.map((p, i) => [i, p, s.rank[i], `${p === i ? '루트' : '부모로 연결'}${i === s.x ? ' · x' : ''}${i === s.y ? ' · y' : ''}`]), r => r === s.x || r === s.y);
        table(root, '연산과 조회 결과', ['순서', '종류', '두 노드', '결과'], input.operations.map(([kind, a, b], i) => [i, kind ? '같은 집합?' : '합치기', `${a}, ${b}`, s.result[i] < 0 ? '—' : s.result[i] ? '1: 같음' : '0: 다름']), r => r === s.k);
    } else if (id === 'dijkstra') {
        graph(root, input, { current: s.u, done: s.done.flatMap((value, i) => value ? [i] : []), distance: s.dist });
        table(root, '최단 거리 표', ['노드', '거리', '확정', '이전 노드'], s.dist.map((d, i) => [i, d === INF ? '∞ (도달 전/불가)' : d, s.done[i] ? '확정' : '미확정', s.parent[i] < 0 ? '없음' : s.parent[i]]), r => r === s.u || r === s.v);
        paragraph(root, '작은 그래프의 최소 선택 원리를 보여 주는 배열 기반 구현입니다. 우선순위 큐를 쓰는 구현과 시간복잡도가 다릅니다.');
    } else if (id === 'knapsack') {
        table(root, '물건은 각각 한 번만 선택', ['물건', '무게', '가치'], input.weights.map((w, i) => [i + 1, w, input.values[i]]), r => r + 1 === s.i);
        table(root, 'dp[i][c]: 앞의 i개 물건으로 용량 c에서 얻는 최대 가치', ['물건 수 / 용량', ...Array.from({ length: s.width }, (_, c) => c)], Array.from({ length: s.n + 1 }, (_, i) => [i, ...s.dp.slice(i * s.width, (i + 1) * s.width)]), (r, c) => r === s.i && c === s.c + 1);
        paragraph(root, context.operation === 'finish'
            ? `계산 완료: 최종 최대 가치=${s.dp[s.n * s.width + s.cap]}. 반복 종료 변수 i=${s.i}, c=${s.c}는 마지막 계산 칸 다음의 경계입니다.`
            : `현재 물건 수 i=${s.i}, 용량 c=${s.c}. 선택 후보=${s.candidate}. 마지막 칸의 현재 값=${s.dp[s.n * s.width + s.cap]}.`);
        paragraph(root, '표는 모두 0으로 준비합니다. 현재 칸은 이전 행의 같은 용량(미선택), 남은 용량 칸+현재 가치(선택)를 비교합니다.');
    } else if (id === 'topological-sort') {
        graph(root, input, { current: s.current, done: s.order.slice(0, s.count) });
        table(root, '선행 조건 수', ['노드', '남은 진입 차수'], s.indegree.map((value, i) => [i, value]), r => r === s.v || r === s.current);
        paragraph(root, `처리 가능한 큐 (앞 → 뒤): ${s.queue.slice(s.head, s.tail).join(', ') || '비어 있음'}`);
        paragraph(root, `결과 순서: ${s.order.slice(0, s.count).join(' → ') || '아직 없음'} (${s.count}/${s.n}개)`);
        if (context.operation === 'finish' && s.count !== s.n) paragraph(root, '사이클이 있어 모든 노드를 처리하지 못했습니다. 남은 진입 차수를 확인하세요.');
    } else {
        table(root, '연속 구간 [left, right)', ['인덱스', ...s.values.map((_, i) => i)], [['값', ...s.values], ['구간', ...s.values.map((_, i) => i >= s.left && i < s.right ? '선택됨' : '구간 밖')]], (_r, c) => c > 0 && c - 1 >= s.left && c - 1 < s.right);
        paragraph(root, `left=${s.left}, right=${s.right} (미포함), 현재 합=${s.sum}, 목표=${s.target}, 찾은 구간 수=${s.count}`);
        paragraph(root, '양의 정수 배열만 지원합니다. 오른쪽을 늘리면 합이 증가하고 왼쪽을 빼면 합이 감소하므로 두 포인터가 뒤로 가지 않습니다.');
    }
}

export function renderLearningLegend(root) {
    root.replaceChildren();
    paragraph(root, '▶와 굵은 테두리는 현재 검사·변경과 관련된 칸 또는 노드입니다. 색만으로 상태를 구분하지 않습니다.');
    paragraph(root, '노드와 배열 인덱스는 0부터 시작합니다. −1/—는 아직 결과가 없음을, ∞는 아직 경로를 모름을 뜻합니다.');
}

export function renderGrid(root, input, state) {
    root.replaceChildren();
    const doc = root.ownerDocument, { cells, path, goalDistance } = gridCells(input, state), board = element(doc, 'div', undefined, `learning-grid grid-cols-${input.grid.cols}`);
    board.setAttribute('role', 'list'); board.setAttribute('aria-label', '격자 미로, 행 우선 순서');
    for (const cell of cells) {
        const tags = cell.wall ? ['벽'] : [cell.name, cell.start ? '시작' : '', cell.goal ? '도착' : '', cell.current ? '▶현재' : cell.queued ? '큐' : cell.done ? '처리 완료' : '', cell.distance === null ? '미방문' : `거리 ${cell.distance}`].filter(Boolean);
        const div = element(doc, 'div', `(${cell.r},${cell.c}) ${tags.join(' · ')}`, `learning-cell${cell.wall ? ' wall' : cell.current ? ' learning-active' : path.includes(cell.name) ? ' path' : ''}`);
        div.setAttribute('role', 'listitem'); board.append(div);
    }
    root.append(board);
    paragraph(root, `큐 (앞 → 뒤): ${state.queue.join(', ') || '비어 있음'}`);
    paragraph(root, goalDistance === null ? '도착점은 아직 발견되지 않았습니다. 끝까지 발견되지 않으면 경로가 없습니다.' : `최단 이동 횟수 ${goalDistance}: ${path.join(' → ')}`);
    paragraph(root, '격자의 상·하·좌·우 이동을 방향 간선 두 개씩으로 표현한 BFS 응용입니다. 처음 발견한 칸의 거리만 표시합니다.');
}

export function renderGridLegend(root) {
    root.replaceChildren();
    paragraph(root, '점선 회색 칸은 벽입니다. ▶현재와 굵은 테두리는 큐에서 꺼낸 칸, 이중 테두리는 발견된 최단 경로입니다.');
    paragraph(root, '시작·도착·큐·처리 완료를 글자로 구분합니다. 거리 0은 시작점이며 숫자는 최소 이동 횟수입니다. 미방문 칸의 거리는 아직 표시하지 않습니다.');
}
