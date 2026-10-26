// BFS 검증기의 건전성(soundness) 검사.
//
// BFS의 실행 기록은 입력(그래프, 시작 노드)이 정해지면 (operation, 상태)의 열이 정확히 하나로 정해진다.
// 따라서 올바른 검증기라면 다음 성질이 성립해야 한다.
//   - 완전성: 입력에서 만든 정답 trace는 항상 통과한다.
//   - 건전성: 통과한 trace의 (operation, 상태) 열은 항상 그 입력의 정답과 같다. 정답과 다른 trace는 하나도 통과하지 못한다.
//
// 사례를 하나씩 떠올려서는 `initial -> finish`처럼 아무 operation도 없는 trace를 놓치기 쉬워서,
// 정해진 시드의 무작위 그래프로 정답을 만든 뒤 모든 위치에 훼손을 가해 이 성질을 전수로 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';

import { OPERATIONS } from '../../frontend/js/trace-contract.js';
import { validateBundle } from '../../frontend/js/trace-validator.js';
import { coreOf, makeBfsBundle } from './helpers/bfs-bundle.mjs';
import { makeRng } from './helpers/rng.mjs';

function randomInput(rng) {
    const count = 1 + Math.floor(rng() * 6);
    const names = 'ABCDEF'.slice(0, count).split('');
    const graph = {};
    for (const name of names) {
        const picks = [];
        // 이웃 0~2개(자기 간선, 사이클, 합류 포함). 노드가 1개면 서로 다른 이웃을 2개 고를 수 없으므로 상한을 둔다.
        const wanted = Math.min(Math.floor(rng() * 3), count);
        while (picks.length < wanted) {
            const candidate = names[Math.floor(rng() * count)];
            if (!picks.includes(candidate)) picks.push(candidate);
        }
        graph[name] = picks;
    }
    return { graph, start: names[Math.floor(rng() * count)] };
}

const renumber = (bundle) => { bundle.steps.forEach((step, i) => { step.index = i; }); return bundle; };
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

/** 훼손 방법. 각 함수는 bundle을 직접 고치고, 적용할 수 없으면 false를 돌려준다. */
const MUTATIONS = {
    'step 삭제': (b, k) => { b.steps.splice(k, 1); },
    'step 복제': (b, k) => { b.steps.splice(k + 1, 0, structuredClone(b.steps[k])); },
    '인접한 두 step의 순서 교환': (b, k) => {
        if (k + 1 >= b.steps.length) return false;
        [b.steps[k], b.steps[k + 1]] = [b.steps[k + 1], b.steps[k]];
        return undefined;
    },
    '조기 종료(그 step의 상태 그대로 finish)': (b, k) => {
        b.steps = b.steps.slice(0, k + 1);
        const finish = structuredClone(b.steps[b.steps.length - 1]);
        Object.assign(finish, { eventId: 'finish', operation: 'finish', lines: { python: [5] } });
        b.steps.push(finish);
    },
    'operation 바꾸기': (b, k, rng) => {
        const others = OPERATIONS.bfs.filter((operation) => operation !== b.steps[k].operation);
        b.steps[k].operation = pick(rng, others);
    },
    '상태 값 바꾸기': (b, k, rng) => {
        const state = b.steps[k].state;
        const nodes = Object.keys(b.input.graph);
        const field = pick(rng, ['discovered', 'processed', 'queue', 'current', 'neighbor']);
        if (field === 'current' || field === 'neighbor') {
            state[field] = pick(rng, [null, ...nodes].filter((value) => value !== state[field]));
        } else {
            const list = state[field];
            const absent = nodes.filter((node) => !list.includes(node));
            const options = ['비우기'];
            if (list.length > 0) options.push('마지막 제거');
            if (list.length > 1) options.push('앞 두 개 교환');
            if (absent.length > 0) options.push('없는 노드 추가');
            const how = pick(rng, options);
            if (how === '비우기') state[field] = [];
            else if (how === '마지막 제거') state[field] = list.slice(0, -1);
            else if (how === '앞 두 개 교환') state[field] = [list[1], list[0], ...list.slice(2)];
            else state[field] = [...list, pick(rng, absent)];
        }
    },
    '입력(그래프, 시작 노드)만 다른 것으로 교체': (b, k, rng) => {
        const { graph, start } = randomInput(rng);
        b.input = makeBfsBundle(graph, start).input;
    },
};

test('건전성: 정답을 한 곳씩 훼손한 trace는 하나도 통과하지 못하고, 통과한 것은 항상 정답과 같다', (t) => {
    const SEEDS = 150;
    let graphs = 0;
    let examined = 0;
    let identical = 0;
    const examinedBy = Object.fromEntries(Object.keys(MUTATIONS).map((name) => [name, 0]));
    const accepted = [];

    for (let seed = 1; seed <= SEEDS; seed += 1) {
        const rng = makeRng(seed);
        const { graph, start } = randomInput(rng);
        const canonical = makeBfsBundle(graph, start);

        // 완전성: 정답은 항상 통과한다.
        const result = validateBundle(canonical);
        assert.deepEqual(result, { valid: true, errors: [] }, `seed ${seed}: 정답 trace가 거부되었습니다 ${JSON.stringify(graph)} start=${start}`);
        graphs += 1;

        for (const [name, mutate] of Object.entries(MUTATIONS)) {
            for (let k = 0; k < canonical.steps.length; k += 1) {
                const bundle = structuredClone(canonical);
                if (mutate(bundle, k, rng) === false) continue;
                renumber(bundle);

                // 훼손한 bundle 자신의 입력에서 다시 계산한 정답. 입력을 바꾼 경우에도 올바르게 비교한다.
                const expected = coreOf(makeBfsBundle(bundle.input.graph, bundle.input.start).steps);
                if (JSON.stringify(coreOf(bundle.steps)) === JSON.stringify(expected)) {
                    identical += 1; // 훼손했지만 결과적으로 정답과 같은 열이면 통과해도 된다.
                    continue;
                }

                examined += 1;
                examinedBy[name] += 1;
                if (validateBundle(bundle).valid) {
                    accepted.push(`seed ${seed}, ${name}, step ${k}: graph=${JSON.stringify(graph)} start=${start}`);
                }
            }
        }
    }

    t.diagnostic(`그래프 ${graphs}개, 훼손 사례 ${examined}개 검사(정답과 같아져 제외 ${identical}개), 종류별: ${JSON.stringify(examinedBy)}`);
    assert.deepEqual(accepted, [], `정답과 다른데 통과한 trace가 ${accepted.length}개 있습니다`);
    // 아무것도 검사하지 않은 채 통과하는 것을 막는다.
    assert.equal(graphs, SEEDS);
    assert.ok(examined > 5000, `검사한 훼손 사례가 너무 적습니다 (${examined}개)`);
    for (const [name, count] of Object.entries(examinedBy)) assert.ok(count > 100, `${name}: 검사한 사례가 너무 적습니다 (${count}개)`);
    assert.ok(identical < examined, '정답과 같아진 사례가 더 많으면 훼손이 의미가 없습니다');
});

test('건전성: 아무 operation도 하지 않은 최소 trace(initial -> finish)는 어떤 그래프에서도 거부한다', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
        const { graph, start } = randomInput(makeRng(seed));
        const bundle = makeBfsBundle(graph, start);
        const finish = structuredClone(bundle.steps.at(-1));
        finish.state = structuredClone(bundle.steps[0].state);
        bundle.steps = [bundle.steps[0], finish];
        renumber(bundle);
        assert.equal(validateBundle(bundle).valid, false, `seed ${seed}: ${JSON.stringify(graph)} start=${start}`);
    }
});
