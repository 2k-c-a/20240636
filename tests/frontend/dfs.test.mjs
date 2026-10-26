// DFS(재귀): 등록된 예제의 의미, 검증기의 전이 규칙(일부러 망가뜨린 trace를 거부하는지), 무작위 그래프에서 빌더와 검증기의 일치, 화면 표시.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBundle } from '../../scripts/trace-builders.mjs';
import { validateBundle } from '../../frontend/js/trace-validator.js';
import { buildStackView, checkedNeighbor, classifyDfsNodes, dfsActiveEdge, renderDfsGraph, renderDfsLegend } from '../../frontend/js/renderers/graph.js';
import { byClass, byTag, findAll, makeRoot } from './helpers/fake-dom.mjs';
import { loadFixture, rawFixture } from './helpers/load-fixture.mjs';
import { makeRng } from './helpers/rng.mjs';

const raw = (name) => rawFixture(`dfs/${name}.json`);
const opsOf = (bundle) => bundle.steps.map((step) => step.operation);
const count = (bundle, operation) => bundle.steps.filter((step) => step.operation === operation).length;

function renumber(bundle) {
    bundle.steps.forEach((step, i) => { step.index = i; });
    return bundle;
}

function assertRejected(bundle, pattern, label = '') {
    const result = validateBundle(bundle);
    assert.equal(result.valid, false, `${label} 거부되어야 합니다`);
    assert.ok(result.errors.some((message) => pattern.test(message)), `${label} 기대한 오류(${pattern})가 없습니다.\n실제 오류:\n${result.errors.join('\n')}`);
}

// ---------- 등록된 예제의 의미 ----------

test('dfs/basic: 발견은 전위 순서, 처리는 후위 순서이고 최대 호출 깊이는 3이다', () => {
    const bundle = raw('basic');
    const last = bundle.steps.at(-1);
    assert.deepEqual(last.state.discovered, ['A', 'B', 'D', 'E', 'C', 'F']);
    assert.deepEqual(last.state.processed, ['D', 'E', 'B', 'F', 'C', 'A']);
    assert.equal(Math.max(...bundle.steps.map((step) => step.state.frames.length)), 3);
    assert.deepEqual(validateBundle(bundle), { valid: true, errors: [] });
});

test('dfs/basic: 호출 스택은 call에서 한 칸 쌓이고 return에서 한 칸 빠지며, 마지막 return이 스택을 비운다', () => {
    const bundle = raw('basic');
    bundle.steps.forEach((step, i) => {
        if (i === 0) return;
        const delta = step.state.frames.length - bundle.steps[i - 1].state.frames.length;
        const expected = step.operation === 'call' ? 1 : step.operation === 'return' ? -1 : 0;
        assert.equal(delta, expected, `step ${i}(${step.operation})`);
    });
    assert.equal(count(bundle, 'call'), count(bundle, 'return'), '호출한 만큼 돌아온다');
    assert.equal(count(bundle, 'call'), 6, '노드마다 한 번씩 호출한다');
    assert.deepEqual(bundle.steps.at(-1).state.frames, []);
    assert.equal(bundle.steps.at(-1).state.current, null);
    // step 1부터 마지막 직전까지 호출 스택이 비지 않는다(탐색 중에는 항상 어떤 호출이 실행 중이다)
    assert.ok(bundle.steps.slice(1, -1).every((step) => step.state.frames.length > 0));
});

test('dfs/basic: nextNeighborIndex는 이웃을 검사할 때마다 1씩 늘고, 돌아온 뒤에도 그대로 이어진다', () => {
    const bundle = raw('basic');
    // B(step 4~)는 이웃 D, E가 있다. D에서 돌아온 뒤(step 10) B의 nextNeighborIndex는 1이고, 다음 검사(step 11)에서 2가 된다.
    const indexOfB = (step) => step.state.frames.find((frame) => frame.node === 'B')?.nextNeighborIndex;
    assert.equal(indexOfB(bundle.steps[5]), 0);
    assert.equal(indexOfB(bundle.steps[6]), 1);
    assert.equal(indexOfB(bundle.steps[10]), 1, 'D에서 돌아온 뒤에도 유지');
    assert.equal(indexOfB(bundle.steps[11]), 2);
    assert.equal(bundle.steps[11].operation, 'check-neighbor');
    assert.equal(bundle.steps[12].operation, 'call', 'E는 아직 발견하지 않아 호출한다');
});

test('dfs/cycle: 되돌아가는 간선(C→A)은 이미 발견한 노드라 호출하지 않고 건너뛰며, 탐색은 끝난다', () => {
    const bundle = raw('cycle');
    const skipped = bundle.steps[9];
    assert.equal(skipped.operation, 'check-neighbor');
    assert.deepEqual(skipped.state.frames.map((frame) => frame.node), ['A', 'B', 'C']);
    assert.equal(checkedNeighbor({ graph: bundle.input.graph }, skipped.state, 'check-neighbor'), 'A');
    assert.ok(skipped.state.discovered.includes('A'));
    assert.equal(bundle.steps[10].operation, 'check-neighbor', '건너뛴 뒤에는 다음 이웃(D)을 검사한다');
    assert.equal(count(bundle, 'call'), 4, '노드마다 한 번만 호출한다(A를 다시 호출하지 않는다)');
    assert.deepEqual(bundle.steps.at(-1).state.discovered, ['A', 'B', 'C', 'D']);
    assert.deepEqual(validateBundle(bundle), { valid: true, errors: [] });
});

test('dfs/disconnected: 시작 노드에서 도달할 수 없는 노드는 발견도 처리도 되지 않는다', () => {
    const bundle = raw('disconnected');
    const last = bundle.steps.at(-1).state;
    assert.deepEqual(last.discovered, ['A', 'B']);
    assert.deepEqual(last.processed, ['B', 'A']);
    for (const unreachable of ['C', 'D']) {
        assert.ok(!bundle.steps.some((step) => step.state.discovered.includes(unreachable) || step.state.frames.some((frame) => frame.node === unreachable)), `${unreachable}는 한 번도 나타나지 않는다`);
    }
    assert.deepEqual(validateBundle(bundle), { valid: true, errors: [] });
});

test('한 노드만 있는 그래프, 자기 간선, 깊은 사슬, 이웃 순서가 이름 순서가 아닌 그래프도 규칙을 통과한다', () => {
    const layout = (graph) => Object.fromEntries(Object.keys(graph).map((node, i) => [node, { x: 5 + i * 8, y: 10 + i * 7 }]));
    const cases = {
        single: [{ A: [] }, 'A'],
        selfLoop: [{ A: ['A', 'B'], B: ['B', 'A'] }, 'A'],
        chain: [{ A: ['B'], B: ['C'], C: ['D'], D: ['E'], E: ['F'], F: ['G'], G: ['H'], H: [] }, 'A'],
        reverseOrder: [{ A: ['C', 'B'], B: ['C'], C: ['B'] }, 'A'],
        startNotFirst: [{ A: [], B: ['A', 'C'], C: [] }, 'B'],
    };
    for (const [name, [graph, start]] of Object.entries(cases)) {
        const bundle = buildBundle({ algorithmId: 'dfs', id: 'test', version: 1, input: { directed: true, graph, start, layout: layout(graph) } });
        assert.deepEqual(validateBundle(bundle), { valid: true, errors: [] }, name);
    }
    const chain = buildBundle({ algorithmId: 'dfs', id: 'test', version: 1, input: { directed: true, graph: cases.chain[0], start: 'A', layout: layout(cases.chain[0]) } });
    assert.equal(Math.max(...chain.steps.map((step) => step.state.frames.length)), 8, '사슬의 호출 깊이는 노드 수와 같다');
});

test('무작위 그래프 300개: 빌더가 만든 trace는 모두 규칙을 통과하고 입력에서 따로 계산한 전위·후위와 같다', () => {
    const rng = makeRng(2026);
    for (let round = 0; round < 300; round += 1) {
        const n = 1 + Math.floor(rng() * 8);
        const nodes = 'ABCDEFGH'.slice(0, n).split('');
        const graph = Object.fromEntries(nodes.map((node) => {
            const neighbors = [];
            for (const other of nodes) if (rng() < 0.15 && neighbors.length < 3) neighbors.push(other);
            for (let i = neighbors.length - 1; i > 0; i -= 1) { const j = Math.floor(rng() * (i + 1)); [neighbors[i], neighbors[j]] = [neighbors[j], neighbors[i]]; }
            return [node, neighbors];
        }));
        const start = nodes[Math.floor(rng() * n)];
        const input = { directed: true, graph, start, layout: Object.fromEntries(nodes.map((node, i) => [node, { x: 5 + i * 11, y: 10 + (i % 3) * 30 }])) };
        const bundle = buildBundle({ algorithmId: 'dfs', id: 'fuzz', version: 1, input });
        const result = validateBundle(bundle);
        assert.deepEqual(result, { valid: true, errors: [] }, `${JSON.stringify(graph)} start=${start}`);

        // 검증기와 별개로 여기서도 전위·후위를 직접 계산해 비교한다.
        const pre = [];
        const post = [];
        const visit = (node) => { pre.push(node); for (const next of graph[node]) if (!pre.includes(next)) visit(next); post.push(node); };
        visit(start);
        const last = bundle.steps.at(-1).state;
        assert.deepEqual([last.discovered, last.processed], [pre, post]);
    }
});

// ---------- 검증기: 일부러 망가뜨린 trace를 거부한다 ----------

test('검증기: 이웃 검사 규칙 위반을 거부한다(호출 노드, 발견 기록, nextNeighborIndex, 이미 발견한 이웃)', () => {
    const wrongNode = raw('basic');
    wrongNode.steps[4].state.frames[1].node = 'C';
    wrongNode.steps[4].state.current = 'C';
    assertRejected(wrongNode, /방금 검사한 이웃 B만 호출할 수 있습니다 \(C\)/, '검사하지 않은 이웃을 호출');

    const noDiscover = raw('basic');
    noDiscover.steps[2].state.discovered = [];
    assertRejected(noDiscover, /discovered 끝에 방금 호출한 노드 "A"만 추가해야 합니다/, '발견 기록 누락');

    const jump = raw('basic');
    jump.steps[3].state.frames[0].nextNeighborIndex = 2;
    assertRejected(jump, /nextNeighborIndex만 0에서 1로 1 늘려야 합니다/, '인덱스 2칸 증가');

    const noIncrement = raw('basic');
    noIncrement.steps[3].state.frames[0].nextNeighborIndex = 0;
    assertRejected(noIncrement, /nextNeighborIndex만 0에서 1로 1 늘려야 합니다/, '인덱스가 늘지 않음');

    const revisit = raw('cycle');
    // step 9는 이미 발견한 A를 검사한다. 그다음을 call로 바꾸면 이미 발견한 노드를 다시 호출하는 것이다.
    revisit.steps[10].operation = 'call';
    revisit.steps[10].eventId = 'call-neighbor';
    revisit.steps[10].lines = structuredClone(revisit.steps[4].lines);
    assertRejected(revisit, /이미 발견했으므로 건너뛰고 다음 이웃 검사로 이어져야 합니다/, '이미 발견한 노드를 호출');
});

test('검증기: 이미 처리를 마친 노드를 다시 호출하면 두 규칙(이웃 검사 다음 연산, 호출 규칙)이 각각 같은 오류를 보고한다', () => {
    // A → B, C / B → C 에서 C는 B 아래에서 이미 처리를 마쳤다. A가 C를 검사한 다음에는 호출하지 않고 처리 완료로 가야 한다.
    const graph = { A: ['B', 'C'], B: ['C'], C: [] };
    const bundle = buildBundle({ algorithmId: 'dfs', id: 'test', version: 1, input: { directed: true, graph, start: 'A', layout: { A: { x: 50, y: 10 }, B: { x: 25, y: 50 }, C: { x: 75, y: 50 } } } });
    assert.deepEqual(validateBundle(bundle), { valid: true, errors: [] });
    const check = bundle.steps.findIndex((step, i) => step.operation === 'check-neighbor' && step.state.frames.length === 1 && step.state.frames[0].nextNeighborIndex === 2 && i > 3);
    const callTemplate = bundle.steps.find((step) => step.eventId === 'call-neighbor');
    const returnTemplate = bundle.steps.at(-1);
    const before = bundle.steps[check].state;
    const call = { ...structuredClone(callTemplate), state: { frames: [{ node: 'A', nextNeighborIndex: 2 }, { node: 'C', nextNeighborIndex: 0 }], discovered: [...before.discovered], processed: [...before.processed], current: 'C' } };
    const back = { ...structuredClone(returnTemplate), state: { frames: [{ node: 'A', nextNeighborIndex: 2 }], discovered: [...before.discovered], processed: [...before.processed], current: 'A' } };
    bundle.steps = [...bundle.steps.slice(0, check + 1), call, back];
    renumber(bundle);
    assertRejected(bundle, /이미 발견했고 남은 이웃이 없으므로 처리 완료로 이어져야 합니다\. 다음 step은 process여야 합니다 \(call\)/, '이웃 검사 다음 연산 규칙');
    assertRejected(bundle, /이미 발견한 노드 C는 다시 호출하지 않습니다/, '호출 규칙');
});

test('검증기: 처리·복귀 규칙 위반을 거부한다(이웃을 다 보기 전 처리, process 없는 return, 스택이 줄지 않는 return)', () => {
    const early = raw('basic');
    // step 3(A의 첫 이웃 검사)을 process로 바꾼다: 이웃을 하나만 보고 처리를 마칠 수 없다.
    early.steps[3].operation = 'process';
    early.steps[3].eventId = 'process';
    early.steps[3].lines = structuredClone(early.steps[9].lines);
    early.steps[3].state = { frames: [{ node: 'A', nextNeighborIndex: 0 }], discovered: ['A'], processed: ['A'], current: 'A' };
    assertRejected(early, /이웃 2개 중 0개만 검사했습니다/, '이웃을 다 보기 전에 처리');

    const noProcess = raw('basic');
    noProcess.steps.splice(9, 1); // D의 process를 없앤다
    renumber(noProcess);
    assertRejected(noProcess, /return은 process 바로 다음에만 올 수 있습니다/, 'process 없는 return');

    const noPop = raw('basic');
    noPop.steps[10].state.frames = structuredClone(noPop.steps[9].state.frames);
    noPop.steps[10].state.current = 'D';
    assertRejected(noPop, /frames의 꼭대기 frame 하나만 빼야 합니다/, '스택이 줄지 않는 return');

    const wrongTop = raw('basic');
    wrongTop.steps[7].state.current = 'B';
    assertRejected(wrongTop, /current: 호출 스택의 꼭대기 노드와 같아야 합니다/, 'current가 꼭대기가 아님');

    const processedNotTop = raw('basic');
    processedNotTop.steps[9].state.processed = ['A'];
    assertRejected(processedNotTop, /A는 처리를 마쳤는데 호출 스택의 꼭대기가 아닙니다/, '아직 스택에 있는 노드를 처리 완료로 표시');
});

test('검증기: 시작·종료 규칙과 최종 결과(독립 계산)를 어긴 trace를 거부한다', () => {
    const notCall = raw('basic');
    notCall.steps[1].operation = 'discover';
    assertRejected(notCall, /첫 연산은 시작 노드 A의 호출\(call\)이어야 합니다/, '첫 연산이 call이 아님');

    const stackLeft = raw('basic');
    stackLeft.steps.pop(); // 마지막 return을 없애면 process로 끝난다
    assertRejected(stackLeft, /마지막 step은 return이어야 합니다/, '마지막이 return이 아님');

    const stackNotEmpty = raw('basic');
    stackNotEmpty.steps.at(-1).state.frames = [{ node: 'A', nextNeighborIndex: 2 }];
    stackNotEmpty.steps.at(-1).state.current = 'A';
    assertRejected(stackNotEmpty, /호출 스택에 1개가 남아 있습니다/, '끝났는데 스택이 남음');

    const wrongPost = raw('basic');
    wrongPost.steps.at(-1).state.processed = ['A', 'B', 'C', 'D', 'E', 'F'];
    assertRejected(wrongPost, /processed가 DFS 처리\(후위\) 순서와 다릅니다/, '처리 순서가 후위가 아님');

    const extra = raw('disconnected');
    extra.steps.at(-1).state.discovered = ['A', 'B', 'C'];
    assertRejected(extra, /discovered가 DFS 결과와 다릅니다/, '도달할 수 없는 노드를 발견했다고 함');
});

test('검증기: 상태의 모양과 불변식을 어기면 거부한다(중복, 스택에 같은 노드 두 번, 없는 노드, 범위 밖 인덱스, 키 누락)', () => {
    const dup = raw('basic');
    dup.steps[5].state.discovered = ['A', 'A'];
    assertRejected(dup, /discovered\[1\]: A가 중복되었습니다/, 'discovered 중복');

    const twice = raw('basic');
    twice.steps[7].state.frames[2].node = 'A';
    twice.steps[7].state.current = 'A';
    assertRejected(twice, /A가 호출 스택에 두 번 있습니다/, '스택에 같은 노드 두 번');

    const ghost = raw('basic');
    ghost.steps[4].state.frames[1].node = 'Z';
    assertRejected(ghost, /"Z"는 graph에 없는 노드입니다/, '없는 노드');

    const range = raw('basic');
    range.steps[4].state.frames[1].nextNeighborIndex = 9;
    assertRejected(range, /nextNeighborIndex: 0~2 범위의 정수여야 합니다 \(9\)/, '범위 밖 인덱스');

    const missing = raw('basic');
    delete missing.steps[4].state.processed;
    assertRejected(missing, /state: 필수 키가 없습니다 \(processed\)/, '키 누락');

    const undiscoveredOnStack = raw('basic');
    undiscoveredOnStack.steps[6].state.discovered = ['A'];
    assertRejected(undiscoveredOnStack, /frames\[1\]\.node: B는 아직 발견하지 않은 노드입니다/, '발견하지 않은 노드가 스택에 있음');
});

// ---------- 화면 표시 ----------

const basicInput = () => ({ graph: raw('basic').input.graph, layout: raw('basic').input.layout });

test('classifyDfsNodes: 노드 상태 우선순위(처리 완료 > 현재 > 스택 대기 > 발견 > 미발견)와 스택 위치', () => {
    const bundle = raw('basic');
    const input = basicInput();
    const at = (index) => Object.fromEntries(classifyDfsNodes(input, bundle.steps[index].state, bundle.steps[index].operation).map((node) => [node.id, node]));

    const deep = at(8); // 스택 A, B, D 에서 D를 발견한 직후
    assert.deepEqual(Object.fromEntries(Object.entries(deep).map(([id, node]) => [id, node.status])), { A: 'stacked', B: 'stacked', C: 'undiscovered', D: 'current', E: 'undiscovered', F: 'undiscovered' });
    assert.deepEqual([deep.A.stackPosition, deep.B.stackPosition, deep.D.stackPosition], [0, 1, 2]);

    // 처리 완료가 현재보다 우선한다: D의 process 단계(frames에 D가 아직 있다)
    assert.equal(at(9).D.status, 'processed');
    // 돌아온 뒤: D는 완료, B가 현재
    assert.deepEqual([at(10).D.status, at(10).B.status, at(10).A.status], ['processed', 'current', 'stacked']);
    // 끝: 모두 완료
    assert.ok(Object.values(at(29)).every((node) => node.status === 'processed'));
});

test('검사 중인 이웃과 강조할 간선: check-neighbor는 현재 노드 → 이웃, call은 호출한 노드 → 새 노드, 나머지는 없음', () => {
    const bundle = raw('basic');
    const input = basicInput();
    const state = (i) => bundle.steps[i].state;
    const op = (i) => bundle.steps[i].operation;

    assert.equal(checkedNeighbor(input, state(6), op(6)), 'D', 'B의 첫 이웃');
    assert.deepEqual(dfsActiveEdge(input, state(6), op(6)), { from: 'B', to: 'D' });
    assert.equal(checkedNeighbor(input, state(11), op(11)), 'E', 'B의 다음 이웃');
    assert.equal(classifyDfsNodes(input, state(6), op(6)).find((node) => node.id === 'D').isNeighbor, true);

    assert.deepEqual(dfsActiveEdge(input, state(4), op(4)), { from: 'A', to: 'B' }, 'A에서 B를 호출');
    assert.equal(checkedNeighbor(input, state(4), op(4)), null, '호출 단계에는 검사 중인 이웃 표시가 없다');
    assert.equal(dfsActiveEdge(input, state(1), op(1)), null, '처음 호출에는 호출한 노드가 없다');
    for (const i of [2, 5, 9, 10, 29]) assert.equal(dfsActiveEdge(input, state(i), op(i)), null, `step ${i}(${op(i)})`);
});

test('호출 스택 화면: 꼭대기를 맨 위에 두고 각 칸에 다음에 볼 이웃을 적으며, 비면 "비어 있음"이다', () => {
    const bundle = raw('basic');
    const input = basicInput();
    const root = makeRoot();
    const view = buildStackView(root.ownerDocument, input, bundle.steps[6].state); // 스택 A(nextNeighborIndex 1), B(1)
    const items = byClass(view, 'stack-item');
    assert.deepEqual(items.map((item) => byClass(item, 'stack-node')[0].textContent), ['B', 'A'], '꼭대기(B)가 맨 위');
    assert.ok(items[0].getAttribute('class').includes('stack-item--top'));
    assert.match(byClass(items[0], 'stack-detail')[0].textContent, /다음에 볼 이웃: E \(nextNeighborIndex = 1\)/);
    assert.match(byClass(items[1], 'stack-detail')[0].textContent, /다음에 볼 이웃: C \(nextNeighborIndex = 1\)/);
    assert.equal(items[0].getAttribute('data-depth'), '2');

    // 이웃을 모두 검사한 칸(B는 이웃 D, E를 다 봤다)과 이웃이 없는 칸(D)
    const exhausted = buildStackView(root.ownerDocument, input, bundle.steps[11].state);
    assert.match(byClass(exhausted, 'stack-detail')[0].textContent, /검사할 이웃 없음 \(nextNeighborIndex = 2\)/);
    const leaf = buildStackView(root.ownerDocument, input, bundle.steps[9].state);
    assert.match(byClass(leaf, 'stack-detail')[0].textContent, /검사할 이웃 없음 \(nextNeighborIndex = 0\)/);

    const empty = buildStackView(root.ownerDocument, input, bundle.steps[0].state);
    assert.deepEqual(byClass(empty, 'stack-item').map((item) => item.textContent), ['비어 있음']);
});

test('renderDfsGraph: 그래프 그림·호출 스택·상태 목록을 그리고, 22개 조각 어디에도 HTML 문자열을 쓰지 않는다', async () => {
    const { bundle } = await loadFixture('dfs', 'basic');
    for (const step of bundle.steps) {
        const root = makeRoot(); // 가짜 DOM은 innerHTML을 쓰면 예외를 던진다
        renderDfsGraph(root, bundle.input, step.state, { operation: step.operation });
        assert.equal(byTag(root, 'svg').length, 1);
        assert.equal(byClass(root, 'node').length, 6);
        assert.equal(byClass(root, 'edge').length, 5, '간선 5개');
        assert.equal(byClass(root, 'edge--active').length, ['check-neighbor', 'call'].includes(step.operation) && !(step.operation === 'call' && step.state.frames.length < 2) ? 1 : 0, `step ${step.index}(${step.operation})`);
        assert.equal(byClass(root, 'stack-item').filter((item) => item.getAttribute('class') === 'stack-item stack-item--top' || item.getAttribute('class') === 'stack-item').length, Math.max(step.state.frames.length, 0) || 0);
        const dl = byTag(root, 'dl')[0];
        assert.equal(byTag(dl, 'dt').length, 5);
    }
});

test('DFS 상태 목록: 발견·호출 스택(바닥→꼭대기)·현재·검사 중인 이웃·처리 완료를 글자로 적는다', async () => {
    const { bundle } = await loadFixture('dfs', 'basic');
    const text = (index) => {
        const root = makeRoot();
        renderDfsGraph(root, bundle.input, bundle.steps[index].state, { operation: bundle.steps[index].operation });
        const dl = byTag(root, 'dl')[0];
        return Object.fromEntries(byTag(dl, 'dt').map((dt, i) => [dt.textContent, byTag(dl, 'dd')[i].textContent]));
    };
    assert.deepEqual(text(6), {
        '발견한 노드 (코드의 visited)': 'A, B',
        '호출 스택 (바닥 → 꼭대기)': 'A → B',
        '현재 노드 (꼭대기)': 'B',
        '검사 중인 이웃': 'D',
        '처리 완료 (학습용 표시, 순서대로)': '없음',
    });
    assert.equal(text(0)['호출 스택 (바닥 → 꼭대기)'], '비어 있음');
    assert.equal(text(0)['현재 노드 (꼭대기)'], '없음');
    assert.equal(text(29)['처리 완료 (학습용 표시, 순서대로)'], 'D, E, B, F, C, A');
});

test('DFS 범례: 노드 모양 샘플은 그래프와 같은 클래스를 쓰고 스택 대기 노드를 설명한다', () => {
    const root = makeRoot();
    renderDfsLegend(root);
    const items = byClass(root, 'legend-item');
    assert.equal(items.length, 6);
    const classes = findAll(root, (node) => node.localName === 'g').map((group) => group.getAttribute('class'));
    for (const status of ['undiscovered', 'stacked', 'current', 'processed']) assert.ok(classes.some((value) => value.includes(`node--${status}`)), status);
    assert.match(root.textContent, /스택 1.*맨 아래/);
});
