// 네 알고리즘 모두에 대한 검증기의 완전성·건전성 검사(무작위 훼손).
//
// 알고리즘의 실행 기록은 입력이 정해지면 (operation, 상태)의 열이 정확히 하나로 정해진다. 따라서 올바른 검증기라면
//   - 완전성: 입력에서 만든 정답 trace는 항상 통과한다.
//   - 건전성: (operation, 상태)의 열이 정답과 다른 trace는 하나도 통과하지 못한다. 어떤 필드를 어떻게 망가뜨려도 마찬가지다.
//   - 견고성: 어떤 훼손에도 검증기가 예외로 죽지 않는다(예외는 "검증 중 예기치 않은 오류"로 보고되므로 이 문구가 없어야 한다).
// 사례를 하나씩 떠올려서는 놓치기 쉬운 빈틈을, 정해진 시드의 무작위 훼손으로 넓게 확인한다. 사람이 떠올린 사례는 알고리즘별 테스트에 있다.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBundle, EXAMPLES } from '../../scripts/trace-builders.mjs';
import { OPERATIONS } from '../../frontend/js/trace-contract.js';
import { validateBundle } from '../../frontend/js/trace-validator.js';
import { makeRng } from './helpers/rng.mjs';

const coreOf = (bundle) => JSON.stringify(bundle.steps.map((step) => [step.operation, step.state]));
const renumber = (bundle) => { bundle.steps.forEach((step, i) => { step.index = i; }); return bundle; };

/** 객체 안의 모든 (부모, 키) 위치. 상태의 어디든 훼손할 수 있게 한다. */
function slots(value, path = []) {
    const found = [];
    if (value !== null && typeof value === 'object') {
        for (const key of Object.keys(value)) {
            found.push({ parent: value, key, path: [...path, key] });
            found.push(...slots(value[key], [...path, key]));
        }
    }
    return found;
}

function randomValueLike(rng, old, pool) {
    const roll = rng();
    if (typeof old === 'number') return roll < 0.35 ? old + 1 : roll < 0.7 ? old - 1 : roll < 0.8 ? -old : roll < 0.9 ? null : pool[Math.floor(rng() * pool.length)];
    if (typeof old === 'boolean') return !old;
    if (typeof old === 'string') return roll < 0.5 ? pool[Math.floor(rng() * pool.length)] : roll < 0.8 ? '' : 7;
    if (old === null) return roll < 0.5 ? 0 : roll < 0.8 ? 'A' : [];
    if (Array.isArray(old)) {
        const copy = [...old];
        if (roll < 0.25 && copy.length > 0) copy.pop();
        else if (roll < 0.5) copy.push(copy.length > 0 ? copy[0] : 0);
        else if (roll < 0.75 && copy.length > 1) copy.reverse();
        else if (copy.length > 1) [copy[0], copy[copy.length - 1]] = [copy[copy.length - 1], copy[0]];
        else return [];
        return copy;
    }
    return null;
}

function mutate(bundle, rng, operations, pool) {
    const roll = rng();
    const steps = bundle.steps;
    const pick = () => Math.floor(rng() * steps.length);
    if (roll < 0.15) {
        steps[pick()].operation = operations[Math.floor(rng() * operations.length)];
    } else if (roll < 0.22 && steps.length > 2) {
        steps.splice(pick(), 1);
        renumber(bundle);
    } else if (roll < 0.29) {
        const i = pick();
        steps.splice(i, 0, structuredClone(steps[i]));
        renumber(bundle);
    } else if (roll < 0.35 && steps.length > 2) {
        const i = pick();
        const j = pick();
        [steps[i], steps[j]] = [steps[j], steps[i]];
        renumber(bundle);
    } else {
        const i = pick();
        const options = slots(steps[i].state);
        if (options.length === 0) return;
        const { parent, key } = options[Math.floor(rng() * options.length)];
        parent[key] = randomValueLike(rng, parent[key], pool);
    }
}

const INPUTS = [
    ...EXAMPLES.map((example) => [example.algorithmId, `${example.algorithmId}/${example.id}`, example.input]),
    ['bfs', 'bfs/random', { directed: true, graph: { A: ['C', 'B'], B: ['A', 'D'], C: ['C', 'D'], D: [], E: ['A'] }, start: 'A', layout: Object.fromEntries('ABCDE'.split('').map((n, i) => [n, { x: 10 + i * 15, y: 20 + (i % 2) * 40 }])) }],
    ['dfs', 'dfs/random', { directed: true, graph: { A: ['C', 'B'], B: ['A', 'D'], C: ['C', 'D'], D: [], E: ['A'] }, start: 'A', layout: Object.fromEntries('ABCDE'.split('').map((n, i) => [n, { x: 10 + i * 15, y: 20 + (i % 2) * 40 }])) }],
    ['binary-search', 'binary-search/random', { values: [-5, -2, 0, 0, 3, 8, 8, 13, 21], target: 8 }],
    ['bubble-sort', 'bubble-sort/random', { values: [4, -2, 4, 1, 0, -2, 9] }],
];

test('완전성: 입력에서 만든 정답 trace는 항상 통과한다(모든 예제 입력과 무작위 입력)', () => {
    for (const [algorithmId, label, input] of INPUTS) {
        const bundle = buildBundle({ algorithmId, id: 'fuzz', version: 1, input });
        assert.deepEqual(validateBundle(bundle), { valid: true, errors: [] }, label);
    }
});

test('건전성·견고성: (operation, 상태)를 일부러 망가뜨린 trace 수천 개는 하나도 통과하지 못하고, 검증기는 예외로 죽지 않는다', () => {
    const rng = makeRng(20260616);
    let rejected = 0;
    let unchanged = 0;
    for (const [algorithmId, label, input] of INPUTS) {
        const original = buildBundle({ algorithmId, id: 'fuzz', version: 1, input });
        const operations = OPERATIONS[algorithmId];
        const pool = algorithmId === 'bfs' || algorithmId === 'dfs' ? Object.keys(input.graph) : [...input.values.map(String), 'x'];
        for (let round = 0; round < 250; round += 1) {
            const bundle = structuredClone(original);
            const count = 1 + Math.floor(rng() * 3);
            for (let k = 0; k < count; k += 1) mutate(bundle, rng, operations, pool);
            const result = validateBundle(bundle);
            assert.ok(!result.errors.some((message) => message.includes('예기치 않은 오류')), `${label} #${round}: 검증기가 예외를 던졌습니다\n${result.errors.join('\n')}`);
            if (coreOf(bundle) === coreOf(original)) {
                unchanged += 1; // 같은 값으로 바뀌었거나 상태와 상관없는 곳이 바뀐 경우
                continue;
            }
            assert.equal(result.valid, false, `${label} #${round}: (operation, 상태)가 정답과 다른데 통과했습니다\n${JSON.stringify(bundle.steps.map((s) => [s.operation, s.state]))}`);
            rejected += 1;
        }
    }
    assert.ok(rejected > 3000, `${rejected}개의 훼손을 거부했다(변화가 없어 건너뜀 ${unchanged}개)`);
});

test('건전성: 입력 자체를 바꾸면 그 입력의 정답과 다른 trace는 거부된다(trace는 그대로, 입력만 변경)', () => {
    const rng = makeRng(99);
    let changed = 0;
    for (const [algorithmId, label, input] of INPUTS) {
        const original = buildBundle({ algorithmId, id: 'fuzz', version: 1, input });
        for (let round = 0; round < 40; round += 1) {
            const bundle = structuredClone(original);
            if (algorithmId === 'bfs' || algorithmId === 'dfs') {
                const node = Object.keys(bundle.input.graph)[Math.floor(rng() * Object.keys(bundle.input.graph).length)];
                bundle.input.graph[node] = [...bundle.input.graph[node]].reverse();
                if (JSON.stringify(bundle.input.graph[node]) === JSON.stringify(original.input.graph[node])) continue; // 이웃이 0~1개면 바뀌지 않는다
            } else if (algorithmId === 'binary-search') {
                bundle.input.target += 1 + Math.floor(rng() * 3);
            } else {
                const i = Math.floor(rng() * Math.max(bundle.input.values.length, 1));
                if (bundle.input.values.length === 0) continue;
                bundle.input.values[i] += 1;
            }
            const result = validateBundle(bundle);
            assert.ok(!result.errors.some((message) => message.includes('예기치 않은 오류')), `${label}: 예외`);
            // 입력을 바꿔도 그 입력의 정답 trace가 (operation, 상태)까지 같을 수 있다(예: 이웃이 모두 이미 발견된 노드의 이웃 순서).
            // 그런 경우만 통과가 맞고, 정답이 달라지는 경우에는 거부되어야 한다.
            const expectedForNewInput = buildBundle({ algorithmId, id: 'fuzz', version: 1, input: bundle.input });
            const sameTrace = coreOf(expectedForNewInput) === coreOf(bundle);
            assert.equal(result.valid, sameTrace, `${label} #${round}: 입력과 맞지 않는 trace가 통과했거나 맞는 trace가 거부되었습니다`);
            if (!sameTrace) changed += 1;
        }
    }
    assert.ok(changed > 200, `정답이 달라지는 입력 변경 ${changed}개를 거부했다`);
});
