// BFS 예제(diamond)의 의미 검사: 큐 변화, 발견 중복 방지, 처리 완료 시점, 방향 간선과 공유 자식 D, 조건 검사 단계.
// 기대값 표는 fixture에서 복사하지 않고 알고리즘의 의미에서 손으로 계산해 적었다(그래프: A→B, A→C, B→D, C→D, 이웃 순서는 배열 순서).
import test from 'node:test';
import assert from 'node:assert/strict';

import { ACTIONS, createPlayerState, getCurrentStep, reducePlayer, selectView } from '../../frontend/js/player-state.js';
import { loadFixture, rawFixture } from './helpers/load-fixture.mjs';

const { bundle } = await loadFixture();
const steps = bundle.steps;

// [단계, operation, discovered, processed, queue, current, neighbor]
const EXPECTED = [
    [0, 'initial', [], [], [], null, null],
    [1, 'discover', ['A'], [], [], null, null],
    [2, 'enqueue', ['A'], [], ['A'], null, null],
    [3, 'dequeue', ['A'], [], [], 'A', null],
    [4, 'check-neighbor', ['A'], [], [], 'A', 'B'],
    [5, 'discover', ['A', 'B'], [], [], 'A', 'B'],
    [6, 'enqueue', ['A', 'B'], [], ['B'], 'A', 'B'],
    [7, 'check-neighbor', ['A', 'B'], [], ['B'], 'A', 'C'],
    [8, 'discover', ['A', 'B', 'C'], [], ['B'], 'A', 'C'],
    [9, 'enqueue', ['A', 'B', 'C'], [], ['B', 'C'], 'A', 'C'],
    [10, 'process', ['A', 'B', 'C'], ['A'], ['B', 'C'], null, null],
    [11, 'dequeue', ['A', 'B', 'C'], ['A'], ['C'], 'B', null],
    [12, 'check-neighbor', ['A', 'B', 'C'], ['A'], ['C'], 'B', 'D'],
    [13, 'discover', ['A', 'B', 'C', 'D'], ['A'], ['C'], 'B', 'D'],
    [14, 'enqueue', ['A', 'B', 'C', 'D'], ['A'], ['C', 'D'], 'B', 'D'],
    [15, 'process', ['A', 'B', 'C', 'D'], ['A', 'B'], ['C', 'D'], null, null],
    [16, 'dequeue', ['A', 'B', 'C', 'D'], ['A', 'B'], ['D'], 'C', null],
    [17, 'check-neighbor', ['A', 'B', 'C', 'D'], ['A', 'B'], ['D'], 'C', 'D'],
    [18, 'process', ['A', 'B', 'C', 'D'], ['A', 'B', 'C'], ['D'], null, null],
    [19, 'dequeue', ['A', 'B', 'C', 'D'], ['A', 'B', 'C'], [], 'D', null],
    [20, 'process', ['A', 'B', 'C', 'D'], ['A', 'B', 'C', 'D'], [], null, null],
    [21, 'finish', ['A', 'B', 'C', 'D'], ['A', 'B', 'C', 'D'], [], null, null],
];

test('모든 단계의 연산과 상태(발견·처리 완료·큐·현재·검사 중인 이웃)가 손으로 계산한 값과 같다', () => {
    assert.equal(steps.length, EXPECTED.length);
    for (const [index, operation, discovered, processed, queue, current, neighbor] of EXPECTED) {
        const step = steps[index];
        assert.equal(step.operation, operation, `step ${index}: operation`);
        assert.deepEqual(
            { ...step.state, discovered: [...step.state.discovered], processed: [...step.state.processed], queue: [...step.state.queue] },
            { discovered, processed, queue, current, neighbor },
            `step ${index} (${operation})`,
        );
    }
});

test('큐의 변화: 먼저 들어간 노드가 먼저 나온다(FIFO)', () => {
    const enqueued = [];
    const dequeued = [];
    for (let i = 1; i < steps.length; i += 1) {
        const before = steps[i - 1].state;
        const after = steps[i].state;
        if (steps[i].operation === 'enqueue') enqueued.push(after.queue[after.queue.length - 1]);
        if (steps[i].operation === 'dequeue') {
            dequeued.push(after.current);
            assert.equal(before.queue[0], after.current, `step ${i}: 큐의 맨 앞을 꺼내야 합니다`);
        }
    }
    assert.deepEqual(enqueued, ['A', 'B', 'C', 'D']);
    assert.deepEqual(dequeued, enqueued, '꺼낸 순서가 넣은 순서와 같다');
});

test('발견 중복 방지: 공유 자식 D는 한 번만 발견되고 한 번만 큐에 들어간다', () => {
    const discoverOps = steps.filter((s) => s.operation === 'discover');
    const discoveredNodes = discoverOps.map((s) => s.state.discovered.at(-1));
    assert.deepEqual(discoveredNodes, ['A', 'B', 'C', 'D']);
    assert.equal(new Set(discoveredNodes).size, discoveredNodes.length, '같은 노드를 두 번 발견하면 안 된다');

    // D는 B에서 처음 발견된다(step 13). C가 D를 다시 검사할 때(step 17)는 이미 발견한 노드이므로 건너뛴다.
    assert.equal(steps[13].state.discovered.at(-1), 'D');
    assert.equal(steps[17].state.current, 'C');
    assert.equal(steps[17].state.neighbor, 'D');
    assert.ok(steps[16].state.discovered.includes('D'), 'C가 D를 검사하기 전에 D는 이미 발견되어 있다');
    assert.equal(steps[18].operation, 'process', '이미 발견한 이웃을 검사한 뒤에는 발견·큐 삽입 없이 바로 이어진다');
    assert.deepEqual(steps[17].state.queue, steps[16].state.queue, '건너뛴 이웃 때문에 큐가 바뀌면 안 된다');
    assert.equal(steps.filter((s) => s.operation === 'enqueue' && s.state.queue.at(-1) === 'D').length, 1);
});

test('처리 완료 시점: 노드는 이웃 검사를 모두 마친 바로 그 step에서만 처리 완료가 된다', () => {
    const processSteps = steps.filter((s) => s.operation === 'process');
    assert.deepEqual(processSteps.map((s) => s.state.processed.at(-1)), ['A', 'B', 'C', 'D'], '처리 완료 순서는 꺼낸 순서와 같다');

    for (const node of ['A', 'B', 'C', 'D']) {
        const processedAt = steps.findIndex((s) => s.operation === 'process' && s.state.processed.at(-1) === node);
        const checks = steps.map((s, i) => ({ s, i })).filter(({ s }) => s.operation === 'check-neighbor' && s.state.current === node);
        const expectedChecks = rawFixture().input.graph[node].length;
        assert.equal(checks.length, expectedChecks, `${node}의 이웃 ${expectedChecks}개를 모두 한 번씩 검사한다`);
        for (const { i } of checks) assert.ok(i < processedAt, `${node}의 이웃 검사(step ${i})는 처리 완료(step ${processedAt})보다 앞이다`);
        // 처리 완료 직전 step은 그 노드의 마지막 이웃 검사·큐 삽입이거나(이웃 없는 노드는 dequeue)이다. 어느 경우든 current가 그 노드다.
        assert.equal(steps[processedAt - 1].state.current, node, `${node}: 처리 완료 직전까지 current였다`);
        assert.equal(steps[processedAt].state.current, null, `${node}: 처리 완료와 함께 current가 비워진다`);
        // 처리 완료 전에는 processed에 없다.
        for (let i = 0; i < processedAt; i += 1) assert.ok(!steps[i].state.processed.includes(node), `${node}는 step ${i}에서 아직 처리 완료가 아니다`);
    }
    assert.equal(steps[10].state.processed.length, 1);
    assert.deepEqual([...steps[10].state.queue], ['B', 'C'], 'A를 처리 완료한 시점에 B, C가 모두 큐에 있다');
});

test('방향 간선: A→B, A→C, B→D, C→D만 있고 반대 방향 간선은 없으며 각 간선을 정확히 한 번씩 검사한다', () => {
    const graph = bundle.input.graph;
    const edges = Object.entries(graph).flatMap(([from, tos]) => tos.map((to) => `${from}>${to}`)).sort();
    assert.deepEqual(edges, ['A>B', 'A>C', 'B>D', 'C>D']);
    assert.equal(bundle.input.directed, true);
    assert.deepEqual([...graph.D], [], 'D에서 나가는 간선은 없다');
    for (const reverse of ['B>A', 'C>A', 'D>B', 'D>C']) assert.ok(!edges.includes(reverse), `${reverse}는 없는 간선이다`);

    // 조건 검사 단계가 누락되지 않았다: 간선 4개 = check-neighbor step 4개, 순서는 입력의 이웃 배열 순서
    const checked = steps.filter((s) => s.operation === 'check-neighbor').map((s) => `${s.state.current}>${s.state.neighbor}`);
    assert.deepEqual(checked, ['A>B', 'A>C', 'B>D', 'C>D']);
    assert.deepEqual([...checked].sort(), edges);
});

test('코드 줄 강조: 각 단계가 가리키는 줄의 실제 코드가 그 연산과 맞는다', () => {
    const code = bundle.codes.python.lines;
    const sourceOf = (index) => steps[index].lines.python.map((n) => code[n - 1].trim());
    assert.deepEqual(sourceOf(0), []);
    assert.deepEqual(sourceOf(1), ['visited = {start}']);
    assert.deepEqual(sourceOf(2), ['queue = deque([start])']);
    assert.deepEqual(sourceOf(3), ['while queue:', 'node = queue.popleft()']);
    assert.deepEqual(sourceOf(4), ['for nxt in graph[node]:', 'if nxt not in visited:']);
    assert.deepEqual(sourceOf(5), ['visited.add(nxt)']);
    assert.deepEqual(sourceOf(6), ['queue.append(nxt)']);
    assert.deepEqual(sourceOf(10), ['for nxt in graph[node]:'], '이웃을 다 돌고 for가 끝나는 지점');
    assert.deepEqual(sourceOf(21), ['while queue:'], '큐가 비어 while이 거짓이 되는 지점');
});

test('모든 step의 설명이 그 단계의 상태와 일치하는 노드를 말한다', () => {
    for (const step of steps.slice(1)) {
        const { current, neighbor, discovered } = step.state;
        const subject = step.operation === 'discover' || step.operation === 'enqueue'
            ? (neighbor ?? discovered.at(-1))
            : step.operation === 'dequeue' || step.operation === 'process' ? current ?? step.state.processed.at(-1) : neighbor ?? current;
        if (step.operation === 'finish') continue;
        assert.ok(step.message.includes(subject), `step ${step.index}(${step.operation}): 설명에 ${subject}가 없습니다 -> ${step.message}`);
    }
    // 이미 발견한 이웃을 건너뛰는 단계는 그렇게 말해야 한다.
    assert.match(steps[17].message, /이미 발견한 노드라서 건너뜁니다/);
    assert.match(steps[4].message, /아직 발견하지 않은 노드입니다/);
});

// ---------- 재생: 이전은 실제 스냅샷 복원 ----------

test('끝까지 가며 본 상태와, 되돌아오며 본 상태가 단계마다 같다(이전은 저장된 스냅샷을 다시 읽는 것이다)', () => {
    let state = createPlayerState(bundle, 'python');
    const seenForward = [selectView(bundle, state)];
    for (let i = 0; i < steps.length - 1; i += 1) { state = reducePlayer(state, { type: ACTIONS.NEXT }); seenForward.push(selectView(bundle, state)); }
    for (let i = steps.length - 1; i >= 0; i -= 1) {
        const view = selectView(bundle, state);
        assert.equal(view.step, seenForward[i].step, `step ${i}`);
        assert.equal(view.codeLines, seenForward[i].codeLines);
        assert.deepEqual(view.activeLines, seenForward[i].activeLines);
        if (i > 0) state = reducePlayer(state, { type: ACTIONS.PREVIOUS });
    }
});

test('끝까지 이동하고 되돌아와도 bundle과 step은 한 글자도 바뀌지 않는다(snapshot 변경 없음)', () => {
    const before = JSON.stringify(bundle);
    const stepRefs = [...bundle.steps];
    const stateRefs = bundle.steps.map((step) => step.state);

    let state = createPlayerState(bundle, 'python');
    for (let round = 0; round < 3; round += 1) {
        for (let i = 0; i < steps.length + 3; i += 1) { state = reducePlayer(state, { type: ACTIONS.NEXT }); selectView(bundle, state); }
        for (let i = 0; i < steps.length + 3; i += 1) { state = reducePlayer(state, { type: ACTIONS.PREVIOUS }); selectView(bundle, state); }
        state = reducePlayer(state, { type: ACTIONS.SEEK, index: 13 });
        state = reducePlayer(state, { type: ACTIONS.RESET });
    }
    assert.equal(JSON.stringify(bundle), before);
    assert.ok(bundle.steps.every((step, i) => step === stepRefs[i] && step.state === stateRefs[i]), 'step 객체는 그대로(교체·복사 없음)');
    assert.ok(Object.isFrozen(bundle) && bundle.steps.every((step) => Object.isFrozen(step) && Object.isFrozen(step.state) && Object.isFrozen(step.state.queue)));
});

test('step 이동만으로는 같은 bundle을 다시 읽어 오지 않는다(상태 전이와 선택자에는 네트워크 접근이 없다)', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = () => { calls += 1; throw new Error('step 이동 중 서버를 부르면 안 됩니다'); };
    try {
        let state = createPlayerState(bundle, 'python');
        for (let i = 0; i < 100; i += 1) {
            state = reducePlayer(state, { type: i % 3 === 0 ? ACTIONS.PREVIOUS : ACTIONS.NEXT });
            getCurrentStep(bundle, state);
            selectView(bundle, state);
        }
    } finally {
        globalThis.fetch = original;
    }
    assert.equal(calls, 0);
});
