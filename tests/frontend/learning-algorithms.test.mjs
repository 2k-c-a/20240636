import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEARNING_EXAMPLES, GRID_EXAMPLES, buildLearningBundle } from '../../scripts/learning-traces.mjs';
import { buildBundle } from '../../scripts/trace-builders.mjs';
import { checkLearningInput, learningProgram, executeLearning } from '../../frontend/js/learning-programs.js';
import { validateBundle } from '../../frontend/js/trace-validator.js';
import { algorithmInfo, ALGORITHM_INFO, renderAlgorithmInfo } from '../../frontend/js/algorithm-info.js';
import { ALGORITHM_IDS, LANGUAGE_IDS } from '../../frontend/js/trace-contract.js';
import { getRenderer } from '../../frontend/js/renderers/index.js';
import { gridCells } from '../../frontend/js/grid-bfs.js';
import { learningAnswer } from './helpers/learning-reference.mjs';
import { makeRoot } from './helpers/fake-dom.mjs';
import { createPlayerState, reducePlayer, ACTIONS } from '../../frontend/js/player-state.js';

const resultOf = (id, input) => {
    const program = learningProgram(id, input), state = executeLearning(program).at(-1).state.vars, value = state[program.output];
    return Array.isArray(value) ? value : [value];
};

test('새 알고리즘 17예제는 독립 정답 계산과 일치하며 저장된 파일과 같다', () => {
    for (const example of LEARNING_EXAMPLES) {
        const bundle = buildLearningBundle(example);
        assert.deepEqual(resultOf(example.algorithmId, example.input), learningAnswer(example.algorithmId, example.input), `${example.algorithmId}/${example.id}`);
        assert.deepEqual(validateBundle(bundle), { valid: true, errors: [] });
        assert.deepEqual(JSON.parse(readFileSync(new URL(`../../frontend/js/data/${example.algorithmId}/${example.id}.json`, import.meta.url))), bundle);
    }
});

test('시드 고정 작은 무작위 입력을 독립 정답과 비교한다', () => {
    let seed = 20261025;
    const random = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
    for (let run = 0; run < 100; run++) {
        const n = 1 + random(6), edges = [];
        for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (edges.length < 12 && random(4) === 0) edges.push([a,b,random(8)]);
        const k = random(6), weights = Array.from({ length: k }, () => 1 + random(8));
        const cases = [
            ['union-find', { n, operations: Array.from({ length: 8 }, () => [random(2),random(n),random(n)]) }],
            ['dijkstra', { n, edges, start: random(n) }],
            ['topological-sort', { n, edges: edges.map(([a,b]) => [a,b]) }],
            ['knapsack', { weights, values: weights.map(() => random(20)), capacity: random(13) }],
            ['two-pointers', { values: Array.from({ length: random(13) }, () => 1 + random(10)), target: 1 + random(30) }],
        ];
        for (const [id, input] of cases) assert.deepEqual(resultOf(id, input), learningAnswer(id, input), `${id} seed case ${run}`);
    }
});

test('상태 훼손·단계 삭제·조기 종료·코드/줄 매핑 훼손은 모두 거부한다', () => {
    for (const example of LEARNING_EXAMPLES) {
        const original = buildLearningBundle(example);
        const edits = [
            b => { b.steps[1].state.vars.n = 999; },
            b => { b.steps.splice(1, 1); },
            b => { b.steps = [b.steps[0], b.steps.at(-1)]; b.steps.at(-1).state.vars.invalid = 1; },
            b => { b.codes.python.lines[0] = '# 바뀐 초기화'; },
            b => { b.steps.at(-1).lines.javascript = [1]; },
        ];
        for (const edit of edits) { const bad = structuredClone(original); edit(bad); bad.steps.forEach((s,i) => { s.index = i; }); assert.equal(validateBundle(bad).valid, false, `${example.algorithmId}/${example.id}`); }
    }
});

test('음수 가중치·0/음수 슬라이딩 원소·과대 입력·잘못된 간선을 거부한다', () => {
    for (const [id, input] of [
        ['dijkstra', { n: 2, start: 0, edges: [[0,1,-1]] }],
        ['topological-sort', { n: 2, edges: [[0,2]] }],
        ['union-find', { n: 2, operations: [[0,0,3]] }],
        ['knapsack', { weights: [0], values: [2], capacity: 4 }],
        ['two-pointers', { values: [1,0,2], target: 3 }],
        ['two-pointers', { values: [1,-1,2], target: 2 }],
    ]) assert.throws(() => checkLearningInput(id, input), /input:/);
});

test('격자 응용은 기존 BFS 검증을 통과하고 벽·최단 거리·도달 불가가 일치한다', () => {
    for (const example of GRID_EXAMPLES) {
        const b = buildBundle(example);
        assert.equal(validateBundle(b).valid, true);
        const first = gridCells(b.input, b.steps[0].state), last = gridCells(b.input, b.steps.at(-1).state);
        assert.ok(first.cells.filter(c => !c.wall).every(c => c.distance === null));
        const distance = Object.fromEntries(Object.keys(b.input.graph).map(n => [n, n === b.input.start ? 0 : Infinity]));
        for (let round = 0; round < Object.keys(distance).length; round++) for (const [u, edges] of Object.entries(b.input.graph)) for (const v of edges) distance[v] = Math.min(distance[v], distance[u] + 1);
        const goal = last.cells.find(c => c.goal);
        assert.equal(last.goalDistance, Number.isFinite(distance[goal.name]) ? distance[goal.name] : null);
        if (last.path.length) { assert.equal(last.path.length - 1, last.goalDistance); for (let i = 1; i < last.path.length; i++) assert.ok(b.input.graph[last.path[i-1]].includes(last.path[i])); }
        const bad = structuredClone(b); bad.input.grid.walls.push(bad.input.grid.start.slice()); assert.equal(validateBundle(bad).valid, false);
    }
});

test('새 예제 전체 단계·7개 언어에서 렌더링·스냅샷 복원·언어 전환이 동작한다', () => {
    for (const example of [...GRID_EXAMPLES, ...LEARNING_EXAMPLES]) {
        const b = example.algorithmId === 'bfs' ? buildBundle(example) : buildLearningBundle(example), renderer = getRenderer(b.algorithmId);
        const legend = makeRoot(); renderer.renderLegend(legend, b.input);
        if (b.input.grid) assert.match(legend.textContent, /벽/);
        for (const step of b.steps) {
            const root = makeRoot(); renderer.render(root, b.input, step.state, { operation: step.operation }); assert.ok(root.childNodes.length);
            const player = reducePlayer(createPlayerState(b, 'python'), { type: ACTIONS.SEEK, index: step.index });
            for (const languageId of LANGUAGE_IDS) {
                const switched = reducePlayer(player, { type: ACTIONS.SWITCH_LANGUAGE, languageId });
                assert.equal(switched.stepIndex, step.index);
                assert.deepEqual(b.steps[switched.stepIndex].state, step.state);
                assert.ok(step.lines[languageId].every(line => line > 0 && line <= b.codes[languageId].lines.length));
            }
        }
    }
});

test('기존·새 알고리즘 모두 실제 구현에 맞는 복잡도·전제·기호 설명을 제공한다', () => {
    assert.deepEqual(Object.keys(ALGORITHM_INFO).sort(), [...ALGORITHM_IDS].sort());
    for (const id of ALGORITHM_IDS) {
        const bundle = { algorithmId: id, input: {} }, info = algorithmInfo(bundle), root = makeRoot();
        assert.match(info.time, /O\(/); assert.match(info.reason, /[가-힣]/); assert.ok(info.symbols && info.caveat);
        renderAlgorithmInfo(root, bundle); assert.match(root.textContent, /시간: /); assert.match(root.textContent, /구현 전제/); assert.match(root.textContent, /렌더링/);
    }
    assert.match(algorithmInfo({ algorithmId: 'bfs', input: GRID_EXAMPLES[0].input }).time, /RC/);
    assert.match(ALGORITHM_INFO.dijkstra.time, /V²/);
    assert.match(ALGORITHM_INFO['bubble-sort'].time, /모두/);
    assert.match(ALGORITHM_INFO.knapsack.caveat, /의사 다항/);
});
