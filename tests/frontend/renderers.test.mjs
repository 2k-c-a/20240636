// 코드·그래프 렌더러: 노드 상태 분류, 간선 기하, 만들어지는 DOM 구조, HTML 주입 방지.
// 브라우저가 없으므로 helpers/fake-dom.mjs의 가짜 DOM에 그린다(그 DOM은 innerHTML을 쓰면 예외를 던진다).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderCode } from '../../frontend/js/renderers/code.js';
import {
    NODE_RADIUS, buildGraphSvg, buildQueueView, buildStateList, classifyNodes, describeGraph, describeNode, edgeGeometry, listEdges,
    loopGeometry, renderGraph, renderLegend,
} from '../../frontend/js/renderers/graph.js';
import { byClass, byTag, classesOf, findAll, makeRoot } from './helpers/fake-dom.mjs';
import { loadFixture } from './helpers/load-fixture.mjs';
import { makeBfsBundle } from './helpers/bfs-bundle.mjs';

const { bundle } = await loadFixture();
const input = bundle.input;
const stepState = (index) => bundle.steps[index].state;

// ---------- renderCode ----------

test('renderCode: 줄마다 한 요소를 만들고 코드는 글자 그대로 들어간다', () => {
    const root = makeRoot();
    const lines = bundle.codes.python.lines;
    renderCode(root, lines, [], { label: 'Python 코드' });

    const pre = root.children[0];
    assert.equal(pre.localName, 'pre');
    assert.deepEqual(classesOf(pre), ['code']);
    assert.equal(pre.getAttribute('tabindex'), '0', '긴 줄을 키보드로 스크롤할 수 있어야 한다');
    assert.equal(pre.getAttribute('aria-label'), 'Python 코드');

    const rendered = byClass(root, 'line');
    assert.equal(rendered.length, lines.length);
    rendered.forEach((line, i) => {
        assert.equal(byClass(line, 'src')[0].textContent, lines[i], `${i + 1}번 줄은 들여쓰기까지 그대로`);
        assert.equal(line.getAttribute('data-line'), String(i + 1));
    });
    assert.equal(byClass(root, 'hl').length, 0, '강조할 줄이 없으면 아무 줄도 강조하지 않는다');
});

test('renderCode: 방금 실행한 줄만 강조하고, 색 외에 ▶ 표시와 스크린 리더용 문구도 붙는다', () => {
    const root = makeRoot();
    renderCode(root, bundle.codes.python.lines, [5, 6]);
    const highlighted = byClass(root, 'hl');
    assert.deepEqual(highlighted.map((line) => line.getAttribute('data-line')), ['5', '6']);
    for (const line of highlighted) {
        assert.equal(byClass(line, 'marker')[0].textContent, '▶');
        assert.equal(byClass(line, 'marker')[0].getAttribute('aria-hidden'), 'true');
        assert.match(byClass(line, 'visually-hidden')[0].textContent, /방금 실행한 줄/);
    }
    const others = byClass(root, 'line').filter((line) => !classesOf(line).includes('hl'));
    assert.equal(others.length, 8);
    for (const line of others) assert.equal(byClass(line, 'visually-hidden').length, 0, '강조되지 않은 줄에는 안내 문구가 없다');
});

test('renderCode: 범위 밖이거나 정수가 아닌 줄 번호는 무시한다', () => {
    const root = makeRoot();
    renderCode(root, ['a', 'b', 'c'], [0, 1, 3, 4, -1, 1.5, '2', null, NaN]);
    assert.deepEqual(byClass(root, 'hl').map((line) => line.getAttribute('data-line')), ['1', '3']);
});

test('renderCode: 코드에 HTML이 들어 있어도 요소가 만들어지지 않고 글자로만 보인다', () => {
    const root = makeRoot();
    const hostile = ['<img src=x onerror=alert(1)>', '</pre><script>alert(2)</script>', '&lt;b&gt; & "quotes"'];
    renderCode(root, hostile, [1]);
    assert.equal(byTag(root, 'img').length, 0);
    assert.equal(byTag(root, 'script').length, 0);
    assert.deepEqual(byClass(root, 'src').map((node) => node.textContent), hostile);
    // 요소는 root 1 + pre 1 + code 1 + 줄마다 (line, marker, src) 3개 × 3줄 + 강조한 1번 줄의 안내 1 = 13개뿐이다.
    assert.equal(findAll(root, () => true).length, 1 + 1 + 1 + 3 * 3 + 1, '코드의 내용에서 새 요소가 생기면 안 된다');
});

test('CSS: pre.code가 position: relative라서, 강조된 줄의 숨김 문구가 스크롤 영역 밖으로 빠져나가 페이지를 넓히지 않는다', () => {
    // 360px에서 4·9·14단계(긴 줄이 강조된 단계)에 문서가 가로로 넘쳤던 결함의 회귀 방지. 브라우저에서만 드러나는 문제라 CSS를 직접 확인한다.
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../frontend/css/style.css'), 'utf8');
    assert.match(css, /\.visually-hidden\s*\{[^}]*position:\s*absolute/, '이 테스트는 .visually-hidden이 absolute라는 전제에 기대고 있다');
    const rule = css.match(/pre\.code\s*\{([^}]*)\}/);
    assert.ok(rule, 'pre.code 규칙이 없습니다');
    assert.match(rule[1], /position:\s*relative/);
    assert.match(rule[1], /overflow-x:\s*auto/);
});

test('CSS: 긴 코드 줄은 줄바꿈하므로, 강조된 줄이 좁은 화면에서 잘리거나 코드 영역을 가로로 밀지 않는다', () => {
    // 05단계에서 C의 for 문(들여쓰기 포함 45자)이 360px에서 37px 잘렸던 결함의 회귀 방지. 브라우저에서만 드러나므로 CSS를 직접 확인한다.
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../frontend/css/visualizer.css'), 'utf8');
    const ruleOf = (selector) => {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
        assert.ok(match, `${selector} 규칙이 없습니다`);
        return match[1];
    };
    const line = ruleOf('.viz-code pre.code .line');
    assert.match(line, /display:\s*flex/);
    assert.match(line, /align-items:\s*flex-start/, '줄이 길어져 여러 줄이 되어도 줄 번호와 ▶는 첫 줄 옆에 있다');
    const src = ruleOf('.viz-code pre.code .line .src');
    assert.match(src, /white-space:\s*pre-wrap/, '들여쓰기는 유지하고 줄바꿈을 허용한다');
    assert.match(src, /min-width:\s*0/, 'flex 항목이 내용 폭 아래로 줄어들 수 있어야 줄바꿈이 일어난다');
    assert.match(src, /overflow-wrap:\s*anywhere/);
    assert.match(ruleOf('.viz-code pre.code .line .marker'), /flex:\s*none/);
    assert.match(ruleOf('.viz-code pre.code .line::before'), /flex:\s*none/);
});

test('renderCode: 다시 그리면 이전 내용을 모두 바꾼다(쌓이지 않는다). 빈 줄도 한 줄로 그린다', () => {
    const root = makeRoot();
    renderCode(root, ['a', '', 'c'], [1]);
    renderCode(root, ['x', '', 'z', ''], [2]);
    assert.equal(root.children.length, 1);
    assert.equal(byClass(root, 'line').length, 4);
    assert.deepEqual(byClass(root, 'hl').map((l) => l.getAttribute('data-line')), ['2']);
    assert.equal(byClass(root, 'src')[1].textContent, '');
});

test('renderCode: 얼린 입력을 받아도 바꾸지 않는다', () => {
    const lines = Object.freeze(['a', 'b']);
    const active = Object.freeze([2]);
    assert.doesNotThrow(() => renderCode(makeRoot(), lines, active));
});

// ---------- 노드 상태 분류 ----------

const statusOf = (index) => Object.fromEntries(classifyNodes(input, stepState(index)).map((node) => [node.id, node.status]));

test('classifyNodes: 단계마다 노드의 상태가 손으로 계산한 값과 같다', () => {
    assert.deepEqual(statusOf(0), { A: 'undiscovered', B: 'undiscovered', C: 'undiscovered', D: 'undiscovered' });
    assert.deepEqual(statusOf(1), { A: 'discovered', B: 'undiscovered', C: 'undiscovered', D: 'undiscovered' }, '발견했지만 아직 큐에 넣기 전');
    assert.deepEqual(statusOf(2), { A: 'queued', B: 'undiscovered', C: 'undiscovered', D: 'undiscovered' });
    assert.deepEqual(statusOf(3), { A: 'current', B: 'undiscovered', C: 'undiscovered', D: 'undiscovered' });
    assert.deepEqual(statusOf(5), { A: 'current', B: 'discovered', C: 'undiscovered', D: 'undiscovered' });
    assert.deepEqual(statusOf(9), { A: 'current', B: 'queued', C: 'queued', D: 'undiscovered' });
    assert.deepEqual(statusOf(10), { A: 'processed', B: 'queued', C: 'queued', D: 'undiscovered' });
    assert.deepEqual(statusOf(14), { A: 'processed', B: 'current', C: 'queued', D: 'queued' });
    assert.deepEqual(statusOf(18), { A: 'processed', B: 'processed', C: 'processed', D: 'queued' });
    assert.deepEqual(statusOf(21), { A: 'processed', B: 'processed', C: 'processed', D: 'processed' });
});

test('classifyNodes: 큐 위치와 검사 중인 이웃 표시', () => {
    const nodes = classifyNodes(input, stepState(9));
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    assert.equal(byId.B.queuePosition, 0, '큐의 맨 앞');
    assert.equal(byId.C.queuePosition, 1);
    assert.equal(byId.A.queuePosition, null);
    assert.equal(byId.C.isNeighbor, true);
    assert.equal(nodes.filter((n) => n.isNeighbor).length, 1);
    assert.equal(classifyNodes(input, stepState(0)).filter((n) => n.isNeighbor).length, 0);
});

test('classifyNodes: 모든 단계에서 노드마다 정확히 하나의 상태이고 snapshot과 모순되지 않는다', () => {
    for (const step of bundle.steps) {
        const nodes = classifyNodes(input, step.state);
        assert.deepEqual(nodes.map((n) => n.id), ['A', 'B', 'C', 'D']);
        for (const node of nodes) {
            assert.equal(node.status === 'processed', step.state.processed.includes(node.id), `step ${step.index} ${node.id}`);
            assert.equal(node.status === 'current', step.state.current === node.id && !step.state.processed.includes(node.id));
            if (node.status === 'undiscovered') assert.ok(!step.state.discovered.includes(node.id));
            else assert.ok(step.state.discovered.includes(node.id));
            assert.equal(node.queuePosition === null, !step.state.queue.includes(node.id));
        }
        assert.equal(nodes.filter((n) => n.status === 'current').length, step.state.current === null ? 0 : 1);
    }
});

test('describeNode: 상태와 큐 위치, 검사 중인 이웃 여부를 한국어로 설명한다', () => {
    assert.equal(describeNode({ id: 'B', status: 'queued', queuePosition: 0, isNeighbor: true }), 'B: 큐에서 대기 중 (큐 1번째), 지금 검사 중인 이웃');
    assert.equal(describeNode({ id: 'D', status: 'undiscovered', queuePosition: null, isNeighbor: false }), 'D: 아직 발견하지 않음');
});

// ---------- 간선 기하 ----------

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('edgeGeometry: 선은 두 원의 경계에서 시작하고 끝난다', () => {
    const a = { x: 50, y: 10 };
    const b = { x: 20, y: 50 };
    const edge = edgeGeometry(a, b);
    assert.equal(edge.kind, 'line');
    assert.ok(Math.abs(dist(edge.start, a) - NODE_RADIUS) < 0.05);
    assert.ok(Math.abs(dist(edge.end, b) - NODE_RADIUS) < 0.05);
    assert.match(edge.d, /^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/);
});

test('edgeGeometry: 위치가 같은 두 노드는 그릴 수 없으므로 null', () => {
    assert.equal(edgeGeometry({ x: 5, y: 5 }, { x: 5, y: 5 }), null);
});

test('edgeGeometry: 반대 방향 간선은 서로 반대쪽으로 휘어 겹치지 않는다', () => {
    const a = { x: 20, y: 50 };
    const b = { x: 80, y: 50 };
    const ab = edgeGeometry(a, b, { reverse: true });
    const ba = edgeGeometry(b, a, { reverse: true });
    assert.equal(ab.kind, 'curve');
    assert.ok(ab.control.y > 50 && ba.control.y < 50, `제어점이 중앙선의 반대쪽에 있어야 한다: ${ab.control.y}, ${ba.control.y}`);
    assert.ok(Math.abs(dist(ab.start, a) - NODE_RADIUS) < 0.05 && Math.abs(dist(ab.end, b) - NODE_RADIUS) < 0.05, '곡선도 원의 경계에서 시작하고 끝난다');
    assert.match(ab.d, /^M [\d.]+ [\d.]+ Q [\d.]+ [\d.]+ [\d.]+ [\d.]+$/);
});

test('loopGeometry: 자기 간선은 노드 위(공간이 좁으면 아래)에 고리를 그린다', () => {
    const middle = loopGeometry({ x: 50, y: 50 });
    assert.equal(middle.kind, 'loop');
    assert.ok(middle.start.y < 50 && middle.end.y < 50, '위쪽에 그린다');
    assert.ok(Math.abs(dist(middle.start, { x: 50, y: 50 }) - NODE_RADIUS) < 0.1, '노드 경계에서 시작한다');
    assert.match(middle.d, /^M [\d.]+ [\d.]+ C /);
    const top = loopGeometry({ x: 50, y: 10 });
    assert.ok(top.start.y > 10, '위쪽 공간이 없으면 아래쪽에 그린다');
});

test('listEdges, describeGraph', () => {
    assert.deepEqual(listEdges(input), [{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }, { from: 'B', to: 'D' }, { from: 'C', to: 'D' }]);
    assert.equal(describeGraph(input), 'A → B, C · B → D · C → D · D → (이웃 없음)');
});

// ---------- 그래프 SVG ----------

const svgOf = (index, graphInput = input) => buildGraphSvg(makeRoot().ownerDocument, graphInput, graphInput === input ? stepState(index) : bundle.steps[index].state);

test('그래프 SVG: 간선은 입력의 방향 간선과 일대일이며 모두 화살촉이 있다(공유 자식 D로 두 간선이 들어간다)', () => {
    const svg = svgOf(0);
    assert.equal(svg.getAttribute('aria-hidden'), 'true', '같은 정보를 텍스트 목록이 주므로 보조 기술에는 숨긴다');
    const edges = byTag(svg, 'path').filter((p) => classesOf(p).includes('edge'));
    assert.deepEqual(edges.map((e) => `${e.getAttribute('data-from')}>${e.getAttribute('data-to')}`), ['A>B', 'A>C', 'B>D', 'C>D']);
    for (const edge of edges) assert.match(edge.getAttribute('marker-end'), /^url\(#graph-arrow(-active)?\)$/);
    assert.equal(edges.filter((e) => e.getAttribute('data-to') === 'D').length, 2, 'D로 들어오는 간선은 둘');
    assert.equal(byTag(svg, 'marker').length, 2);
    // 마커 id가 문서 안에서 서로 다르다
    assert.deepEqual(byTag(svg, 'marker').map((m) => m.getAttribute('id')), ['graph-arrow', 'graph-arrow-active']);
});

test('그래프 SVG: 지금 검사 중인 간선(현재 → 이웃)만 강조한다', () => {
    const expectedActive = { 4: 'A>B', 7: 'A>C', 12: 'B>D', 17: 'C>D' };
    for (const step of bundle.steps) {
        const active = byClass(svgOf(step.index), 'edge--active').map((e) => `${e.getAttribute('data-from')}>${e.getAttribute('data-to')}`);
        const expected = step.operation === 'check-neighbor' ? [expectedActive[step.index]] : (step.state.neighbor !== null ? [`${step.state.current}>${step.state.neighbor}`] : []);
        assert.deepEqual(active, expected, `step ${step.index}(${step.operation})`);
    }
    for (const index of [4, 7, 12, 17]) {
        const edge = byClass(svgOf(index), 'edge--active')[0];
        assert.equal(edge.getAttribute('marker-end'), 'url(#graph-arrow-active)');
    }
});

test('그래프 SVG: 노드는 상태별 클래스와 글자 표시(큐 1, 현재, 완료, 검사 중)를 가진다', () => {
    const groupsAt = (index) => Object.fromEntries(byClass(svgOf(index), 'node').map((g) => [g.getAttribute('data-node'), g]));
    const tagsOf = (group) => byClass(group, 'tag').map((t) => t.textContent);

    const at9 = groupsAt(9);
    assert.deepEqual(classesOf(at9.A), ['node', 'node--current']);
    assert.deepEqual(tagsOf(at9.A), ['현재']);
    assert.deepEqual(classesOf(at9.B), ['node', 'node--queued']);
    assert.deepEqual(tagsOf(at9.B), ['큐 1']);
    assert.deepEqual(classesOf(at9.C), ['node', 'node--queued', 'node--neighbor']);
    assert.deepEqual(tagsOf(at9.C), ['큐 2', '검사 중']);
    assert.deepEqual(tagsOf(at9.D), [], '미발견 노드는 글자 표시가 없다(점선 원)');

    const at10 = groupsAt(10);
    assert.deepEqual(tagsOf(at10.A), ['완료']);
    assert.deepEqual(tagsOf(groupsAt(5).B), ['발견', '검사 중']);

    // 노드 글자는 노드 ID 그대로
    for (const [id, group] of Object.entries(at9)) assert.equal(byClass(group, 'label')[0].textContent, id);
    // 툴팁(<title>)은 접근 가능한 설명이다
    assert.equal(byTag(at9.C, 'title')[0].textContent, 'C: 큐에서 대기 중 (큐 2번째), 지금 검사 중인 이웃');
});

test('그래프 SVG: 현재 노드는 이중 원, 검사 중인 이웃은 점선 바깥 원이다(색만으로 구분하지 않는다)', () => {
    const rings = (index, id) => byClass(byClass(svgOf(index), 'node').find((g) => g.getAttribute('data-node') === id), 'ring').map((r) => classesOf(r)[1]);
    assert.deepEqual(rings(4, 'A'), ['ring--current']);
    assert.deepEqual(rings(4, 'B'), ['ring--neighbor']);
    assert.deepEqual(rings(4, 'C'), []);
    assert.deepEqual(rings(10, 'A'), [], '처리 완료 노드에는 바깥 원이 없다');
});

test('그래프 SVG: layout의 위치를 그대로 쓴다', () => {
    const svg = svgOf(0);
    for (const group of byClass(svg, 'node')) {
        const base = byClass(group, 'base')[0];
        const { x, y } = input.layout[group.getAttribute('data-node')];
        assert.equal(Number(base.getAttribute('cx')), x);
        assert.equal(Number(base.getAttribute('cy')), y);
        assert.equal(Number(base.getAttribute('r')), NODE_RADIUS);
    }
});

test('그래프 SVG: 사이클·반대 방향 간선·자기 간선이 있는 그래프도 그린다', () => {
    const cyclic = makeBfsBundle({ A: ['B', 'A'], B: ['A', 'C'], C: [] }, 'A', { A: { x: 20, y: 50 }, B: { x: 80, y: 50 }, C: { x: 50, y: 90 } });
    for (const step of cyclic.steps) {
        const svg = buildGraphSvg(makeRoot().ownerDocument, cyclic.input, step.state);
        const edges = byTag(svg, 'path').filter((p) => classesOf(p).includes('edge'));
        assert.equal(edges.length, 4);
        const byEdge = Object.fromEntries(edges.map((e) => [`${e.getAttribute('data-from')}>${e.getAttribute('data-to')}`, e.getAttribute('d')]));
        assert.match(byEdge['A>A'], /^M [\d. -]+ C /, '자기 간선은 고리');
        assert.match(byEdge['A>B'], / Q /, '반대 방향 간선이 있으면 곡선');
        assert.match(byEdge['B>A'], / Q /);
        assert.notEqual(byEdge['A>B'], byEdge['B>A']);
        assert.match(byEdge['B>C'], / L /, '반대 방향이 없으면 직선');
    }
});

test('그래프 SVG: 위치가 같은 노드 쌍의 간선은 건너뛰고 예외를 내지 않는다', () => {
    const overlapping = { directed: true, graph: { A: ['B'], B: [] }, start: 'A', layout: { A: { x: 10, y: 10 }, B: { x: 10, y: 10 } } };
    const svg = buildGraphSvg(makeRoot().ownerDocument, overlapping, { discovered: [], processed: [], queue: [], current: null, neighbor: null });
    assert.equal(byTag(svg, 'path').filter((p) => classesOf(p).includes('edge')).length, 0);
});

// ---------- 큐 / 상태 목록 ----------

test('큐: 앞에서 뒤 순서로 보이고 비면 "비어 있음"이다', () => {
    const doc = makeRoot().ownerDocument;
    const at9 = buildQueueView(doc, stepState(9));
    assert.deepEqual(byClass(at9, 'queue-end').map((e) => e.textContent), ['앞', '뒤']);
    assert.deepEqual(byClass(at9, 'queue-item').map((e) => e.textContent), ['B', 'C']);
    assert.equal(byClass(at9, 'queue-items')[0].getAttribute('aria-label'), '큐의 내용, 앞에서 뒤 순서');

    const empty = buildQueueView(doc, stepState(3));
    assert.deepEqual(byClass(empty, 'queue-item').map((e) => e.textContent), ['비어 있음']);
    assert.ok(classesOf(byClass(empty, 'queue-item')[0]).includes('queue-item--empty'));
});

test('상태 목록: 발견·큐·현재·이웃·처리 완료를 글자로 모두 적는다', () => {
    const doc = makeRoot().ownerDocument;
    const rows = (index) => {
        const list = buildStateList(doc, stepState(index));
        const terms = byTag(list, 'dt').map((n) => n.textContent);
        const values = byTag(list, 'dd').map((n) => n.textContent);
        return Object.fromEntries(terms.map((term, i) => [term, values[i]]));
    };
    assert.deepEqual(rows(0), {
        '발견한 노드 (코드의 visited)': '없음', '큐 (앞 → 뒤)': '없음', '현재 노드': '없음', '검사 중인 이웃': '없음', '처리 완료 (학습용 표시, 순서대로)': '없음',
    });
    assert.deepEqual(rows(9), {
        '발견한 노드 (코드의 visited)': 'A, B, C', '큐 (앞 → 뒤)': 'B, C', '현재 노드': 'A', '검사 중인 이웃': 'C', '처리 완료 (학습용 표시, 순서대로)': '없음',
    });
    assert.equal(rows(18)['처리 완료 (학습용 표시, 순서대로)'], 'A, B, C');
});

// ---------- renderGraph / renderLegend ----------

test('renderGraph: 그림, 그래프 설명, 큐, 상태 목록을 한 번에 그리고 다시 그리면 바꿔 넣는다', () => {
    const root = makeRoot();
    renderGraph(root, input, stepState(9));
    assert.deepEqual(root.children.map((c) => c.localName), ['figure', 'div', 'dl']);
    assert.equal(byClass(root, 'graph-caption')[0].textContent, '그래프(방향 간선): A → B, C · B → D · C → D · D → (이웃 없음)');
    const firstSvg = byTag(root, 'svg')[0];

    renderGraph(root, input, stepState(10));
    assert.equal(root.children.length, 3, '쌓이지 않는다');
    assert.notEqual(byTag(root, 'svg')[0], firstSvg, '이전 그림을 재사용하지 않고 새로 그린다');
    assert.equal(byClass(root, 'node--processed').length, 1);
});

test('renderGraph: 22개 단계 전부를 그려도 얼린 snapshot을 바꾸지 않고, HTML 주입 API를 한 번도 쓰지 않는다', () => {
    const before = JSON.stringify(bundle);
    for (const step of bundle.steps) {
        const root = makeRoot();
        assert.doesNotThrow(() => renderGraph(root, input, step.state), `step ${step.index}`); // innerHTML을 쓰면 가짜 DOM이 예외를 던진다
        assert.equal(byClass(root, 'node').length, 4);
    }
    assert.equal(JSON.stringify(bundle), before);
});

test('renderGraph: 노드 ID에 HTML이 있어도(계약상 불가능하지만) 글자로만 그린다', () => {
    const odd = { directed: true, graph: { '<b>': ['"x"'], '"x"': [] }, start: '<b>', layout: { '<b>': { x: 20, y: 20 }, '"x"': { x: 80, y: 80 } } };
    const root = makeRoot();
    renderGraph(root, odd, { discovered: ['<b>'], processed: [], queue: ['<b>'], current: null, neighbor: null });
    assert.equal(byTag(root, 'b').length, 0);
    assert.deepEqual(byClass(root, 'label').map((n) => n.textContent), ['<b>', '"x"']);
});

test('renderLegend: 모든 노드 상태와 검사 중인 이웃·간선의 모양 샘플이 있고, 그래프와 같은 클래스를 쓴다', () => {
    const root = makeRoot();
    renderLegend(root);
    const items = byClass(root, 'legend-item');
    assert.equal(items.length, 7);
    const usedClasses = new Set(byClass(root, 'node').flatMap((g) => classesOf(g)));
    for (const status of ['undiscovered', 'discovered', 'queued', 'current', 'processed']) assert.ok(usedClasses.has(`node--${status}`), status);
    assert.ok(usedClasses.has('node--neighbor'));
    assert.equal(byClass(root, 'edge--active').length, 1);
    for (const item of items) assert.match(item.textContent, /[가-힣]/);
    renderLegend(root);
    assert.equal(byClass(root, 'legend-item').length, 7, '다시 그려도 쌓이지 않는다');
});
