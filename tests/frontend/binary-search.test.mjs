// 이분 탐색: 등록된 예제의 의미(구간 축소, 유효한 인덱스, 빈 배열·한 원소·없음·중복), 검증기의 전이 규칙, 모든 작은 입력에서 빌더와 검증기의 일치, 화면 표시.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBundle } from '../../scripts/trace-builders.mjs';
import { validateBundle } from '../../frontend/js/trace-validator.js';
import { buildCells, classifyBinarySearchCells, describeCell, renderBinarySearch, renderBinarySearchLegend } from '../../frontend/js/renderers/array.js';
import { byClass, byTag, makeRoot } from './helpers/fake-dom.mjs';
import { loadFixture, rawFixture } from './helpers/load-fixture.mjs';
import { makeRng } from './helpers/rng.mjs';

const raw = (name) => rawFixture(`binary-search/${name}.json`);
const make = (input) => buildBundle({ algorithmId: 'binary-search', id: 'test', version: 1, input });
const opsOf = (bundle) => bundle.steps.map((step) => step.operation);
const midsOf = (bundle) => bundle.steps.filter((step) => step.operation === 'compute-mid').map((step) => step.state.mid);

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

test('binary-search/basic: 구간이 절반씩 줄어 중간 위치 4, 7, 5를 거쳐 인덱스 5에서 찾는다', () => {
    const bundle = raw('basic');
    assert.deepEqual(midsOf(bundle), [4, 7, 5]);
    assert.deepEqual(opsOf(bundle), ['initial', 'compute-mid', 'compare', 'set-left', 'compute-mid', 'compare', 'set-right', 'compute-mid', 'compare', 'found']);
    const last = bundle.steps.at(-1).state;
    assert.deepEqual([last.result, last.mid], [5, null]);
    assert.equal(bundle.input.values[last.result], bundle.input.target);
    // 구간의 크기는 라운드마다 줄어든다(10 → 5 → 2)
    const sizes = bundle.steps.filter((step) => step.operation === 'compute-mid').map((step) => step.state.right - step.state.left + 1);
    assert.deepEqual(sizes, [10, 5, 2]);
    assert.deepEqual(validateBundle(bundle), { valid: true, errors: [] });
});

test('binary-search/not-found: 찾는 값이 없으면 구간이 비어(left > right) result = -1로 끝나며 mid는 null이다', () => {
    const bundle = raw('not-found');
    const last = bundle.steps.at(-1);
    assert.equal(last.operation, 'finish');
    assert.deepEqual([last.state.left, last.state.right, last.state.mid, last.state.result], [2, 1, null, -1]);
    assert.ok(!bundle.input.values.includes(bundle.input.target));
    assert.ok(bundle.steps.every((step) => step.state.result === null || step === last), 'result는 마지막 step에서만 정해진다');
    assert.deepEqual(validateBundle(bundle), { valid: true, errors: [] });
});

test('binary-search/duplicates: 같은 값이 여럿이면 일치하는 인덱스 중 하나를 돌려주며 첫 번째 위치라는 보장은 없다', () => {
    const bundle = raw('duplicates');
    const { values, target } = bundle.input;
    const result = bundle.steps.at(-1).state.result;
    const matches = values.map((value, index) => (value === target ? index : -1)).filter((index) => index >= 0);
    assert.deepEqual(matches, [1, 2, 3]);
    assert.ok(matches.includes(result), '돌려준 인덱스는 일치하는 칸이다');
    assert.notEqual(result, matches[0], '이 예제는 첫 번째가 아닌 위치(2)를 돌려준다');
    // 화면 문구가 "첫 번째"라고 말하지 않는다
    assert.ok(bundle.steps.every((step) => !/첫 번째 (위치|인덱스)|가장 앞/.test(step.message)));
    assert.ok(Object.values(bundle.codes).every((code) => /보장은 없습니다|그중 하나/.test(code.notes)));
});

test('binary-search/empty와 single: 빈 배열은 left = 0, right = -1에서 바로 끝나고, 원소 하나는 한 번의 비교로 끝난다', () => {
    const empty = raw('empty');
    assert.deepEqual(opsOf(empty), ['initial', 'finish']);
    assert.deepEqual([empty.steps[0].state.left, empty.steps[0].state.right], [0, -1]);
    assert.equal(empty.steps.at(-1).state.result, -1);
    assert.equal(empty.steps.at(-1).eventId, 'first-finish', '처음부터 구간이 없다');

    const single = raw('single');
    assert.deepEqual(opsOf(single), ['initial', 'compute-mid', 'compare', 'found']);
    assert.equal(single.steps.at(-1).state.result, 0);
    for (const bundle of [empty, single]) assert.deepEqual(validateBundle(bundle), { valid: true, errors: [] });
});

test('모든 작은 입력(길이 0~7의 비내림차순 배열 × 모든 target)에서 빌더가 만든 trace는 규칙을 통과하고, 결과가 항상 유효하다', () => {
    let cases = 0;
    const arrays = [[]];
    for (let length = 1; length <= 7; length += 1) {
        // 값 0~3으로 만들 수 있는 모든 비내림차순 배열(중복 포함)
        const extend = (prefix) => {
            if (prefix.length === length) { arrays.push(prefix); return; }
            for (let value = prefix.length === 0 ? 0 : prefix.at(-1); value <= 3; value += 1) extend([...prefix, value]);
        };
        extend([]);
    }
    for (const values of arrays) {
        for (let target = -1; target <= 4; target += 1) {
            const bundle = make({ values, target });
            const result = validateBundle(bundle);
            assert.deepEqual(result, { valid: true, errors: [] }, `${JSON.stringify(values)} target=${target}`);
            const found = bundle.steps.at(-1).state.result;
            assert.ok(found === -1 ? !values.includes(target) : values[found] === target, `${JSON.stringify(values)} target=${target} result=${found}`);
            // 라운드 수는 log2(n) + 1을 넘지 않는다
            assert.ok(midsOf(bundle).length <= Math.floor(Math.log2(Math.max(values.length, 1))) + 1);
            cases += 1;
        }
    }
    assert.ok(cases > 1000, `${cases}개 입력을 확인했다`);
});

test('무작위 긴 배열(최대 20개, 음수 포함)도 규칙을 통과한다', () => {
    const rng = makeRng(77);
    for (let round = 0; round < 200; round += 1) {
        const length = Math.floor(rng() * 21);
        const values = Array.from({ length }, () => Math.floor(rng() * 41) - 20).sort((a, b) => a - b);
        const target = rng() < 0.5 && length > 0 ? values[Math.floor(rng() * length)] : Math.floor(rng() * 61) - 30;
        assert.deepEqual(validateBundle(make({ values, target })), { valid: true, errors: [] }, `${JSON.stringify(values)} target=${target}`);
    }
});

// ---------- 검증기: 일부러 망가뜨린 trace를 거부한다 ----------

test('검증기: 중간 위치와 구간 이동을 잘못 계산한 trace를 거부한다', () => {
    const wrongMid = raw('basic');
    wrongMid.steps[1].state.mid = 5;
    assertRejected(wrongMid, /mid는 floor\(\(0 \+ 9\) \/ 2\) = 4여야 합니다 \(5\)/, '중간 위치 오계산');

    const wrongLeft = raw('basic');
    wrongLeft.steps[3].state.left = 4;
    assertRejected(wrongLeft, /left는 mid \+ 1 = 5이어야 합니다 \(4\)/, 'left = mid');

    const wrongRight = raw('basic');
    wrongRight.steps[6].state.right = 7;
    assertRejected(wrongRight, /right는 mid - 1 = 6이어야 합니다 \(7\)/, 'right = mid');

    const wrongDirection = raw('basic');
    // values[4] = 16 < 23이므로 오른쪽으로 가야 하는데 왼쪽 경계 대신 오른쪽 경계를 줄였다
    Object.assign(wrongDirection.steps[3], { operation: 'set-right', eventId: 'set-right', lines: structuredClone(raw('basic').steps[6].lines) });
    wrongDirection.steps[3].state = { ...wrongDirection.steps[3].state, left: 0, right: 3 };
    assertRejected(wrongDirection, /values\[4\] = 16이 target 23보다 클 때만 오른쪽 경계를 옮길 수 있습니다/, '방향 반대');

    const midNotRecomputed = raw('basic');
    midNotRecomputed.steps[4].state.mid = 4; // 새 구간(5~9)에서 mid를 다시 계산하지 않았다
    assertRejected(midNotRecomputed, /mid는 floor\(\(5 \+ 9\) \/ 2\) = 7여야 합니다 \(4\)/, 'mid 미갱신');
});

test('검증기: 찾음·종료·결과 규칙을 어긴 trace를 거부한다', () => {
    const wrongResult = raw('basic');
    wrongResult.steps[9].state.result = 4;
    assertRejected(wrongResult, /result는 mid\(5\)이고 mid는 null이어야 합니다/, 'result가 mid와 다름');

    const midKept = raw('basic');
    midKept.steps[9].state.mid = 5;
    assertRejected(midKept, /result는 mid\(5\)이고 mid는 null이어야 합니다/, '찾은 뒤에도 mid 유지');

    const earlyFinish = raw('basic');
    // 구간이 남아 있는데(5~6) 종료했다고 한다
    Object.assign(earlyFinish.steps[9], { operation: 'finish', eventId: 'finish', lines: structuredClone(raw('not-found').steps[10].lines) });
    earlyFinish.steps[9].state = { ...earlyFinish.steps[9].state, mid: null, result: -1 };
    assertRejected(earlyFinish, /구간이 아직 남아 있는데\(left = 5 <= right = 6\) 종료할 수 없습니다/, '구간이 남았는데 종료');

    const falseFound = raw('not-found');
    // 같지 않은 값을 찾았다고 한다
    Object.assign(falseFound.steps[10], { operation: 'found', eventId: 'found', lines: structuredClone(raw('basic').steps[9].lines) });
    falseFound.steps[10].state = { ...falseFound.steps[10].state, result: 1, mid: null };
    assertRejected(falseFound, /values\[1\] = 3이 target 4과 다른데 찾았다고 할 수 없습니다|found는 compare 바로 다음에만/, '다른 값을 찾았다고 함');

    const outOfRange = raw('basic');
    outOfRange.steps[9].state.result = 10;
    assertRejected(outOfRange, /result: -1~9 범위의 정수여야 합니다 \(10\)/, '범위 밖 인덱스');

    const wrongFinal = raw('duplicates');
    wrongFinal.steps[3].state.result = 3; // 값은 같지만 이 알고리즘이 돌려주는 인덱스가 아니다
    assertRejected(wrongFinal, /result가 이분 탐색 결과와 다릅니다 \(기대 2, 실제 3\)/, '유효하지만 다른 일치 인덱스');

    const missed = raw('basic');
    // 찾는 값이 있는데 -1로 끝낸다
    Object.assign(missed.steps[9], { operation: 'finish', eventId: 'finish', lines: structuredClone(raw('not-found').steps[10].lines) });
    missed.steps[9].state = { left: 7, right: 6, values: missed.steps[9].state.values, target: 23, mid: null, result: -1 };
    assertRejected(missed, /result가 이분 탐색 결과와 다릅니다 \(기대 5, 실제 -1\)/, '있는 값을 못 찾음');
});

test('검증기: 입력을 바꾸거나 순서를 어긴 trace를 거부한다(values·target 변경, compare 건너뜀, 빈 구간에서 계산, 첫 연산)', () => {
    const values = raw('basic');
    values.steps[4].state.values[0] = 99;
    assertRejected(values, /values: input\.values와 같아야 합니다/, 'values 변경');

    const target = raw('basic');
    target.steps[4].state.target = 24;
    assertRejected(target, /target: input\.target\(23\)과 같아야 합니다 \(24\)/, 'target 변경');

    const noCompare = raw('basic');
    noCompare.steps.splice(2, 1); // 첫 compare를 없앤다
    renumber(noCompare);
    assertRejected(noCompare, /set-left는 compare 바로 다음에만 올 수 있습니다 \(compute-mid 다음\)/, 'compare 없이 경계 이동');

    const emptyRange = raw('not-found');
    // 구간이 이미 비었는데(left = 2 > right = 1) 끝내지 않고 중간 위치를 계산한다
    const extraMid = { ...structuredClone(raw('basic').steps[4]), state: { ...structuredClone(emptyRange.steps[9].state), mid: 1 } };
    emptyRange.steps.splice(10, 0, extraMid);
    renumber(emptyRange);
    assertRejected(emptyRange, /구간이 비어 있는데\(left = 2 > right = 1\) 중간 위치를 계산할 수 없습니다/, '빈 구간에서 계산');

    const firstOperation = raw('empty');
    // 빈 배열인데 중간 위치부터 계산하고 나서 끝낸다
    firstOperation.steps.splice(1, 0, { ...structuredClone(raw('basic').steps[1]), state: structuredClone(firstOperation.steps[0].state) });
    renumber(firstOperation);
    assertRejected(firstOperation, /첫 연산은 finish여야 합니다/, '빈 배열인데 중간 위치 계산');

    const badInitial = raw('basic');
    badInitial.steps[0].state.right = 8;
    assertRejected(badInitial, /초기 상태는 left = 0, right = 9, mid·result는 null이어야 합니다/, '초기 구간');

    const nonInteger = raw('basic');
    nonInteger.steps[1].state.mid = 4.5;
    assertRejected(nonInteger, /mid: 0~9 범위의 정수여야 합니다 \(4\.5\)/, '정수가 아닌 mid');
});

test('검증기: 값이 다른데 found로 가면 두 규칙(compare 다음 연산, found의 일치 확인)이 각각 같은 오류를 보고한다', () => {
    // compare-smaller(values[4] = 16 < 23) 바로 뒤에 found를 붙인다. 두 규칙이 겹쳐서 하나를 없애도 다른 하나가 막으므로 둘 다 각자의 문장으로 확인한다.
    const bundle = raw('basic');
    const found = { ...structuredClone(bundle.steps[9]), state: { ...structuredClone(bundle.steps[2].state), mid: null, result: 4 } };
    bundle.steps = [...bundle.steps.slice(0, 3), found];
    renumber(bundle);
    assertRejected(bundle, /values\[4\] = 16, target = 23이므로 다음 step은 set-left여야 합니다 \(found\)/, 'compare 다음 연산 규칙');
    assertRejected(bundle, /values\[4\] = 16이 target 23과 다른데 찾았다고 할 수 없습니다/, 'found의 일치 확인');
    assertRejected(bundle, /result가 이분 탐색 결과와 다릅니다 \(기대 5, 실제 4\)/, '독립 계산');
});

// ---------- 화면 표시 ----------

const cellStates = (bundle, index) => Object.fromEntries(classifyBinarySearchCells(bundle.input, bundle.steps[index].state).map((cell) => [cell.index, cell]));

test('classifyBinarySearchCells: 탐색 구간 안·밖, left·right·mid 표시, 찾은 칸', () => {
    const bundle = raw('basic');
    const first = cellStates(bundle, 2); // L0 R9 M4
    assert.deepEqual(first[0].tags, ['left']);
    assert.deepEqual(first[9].tags, ['right']);
    assert.deepEqual([first[4].status, first[4].tags], ['mid', ['mid']]);
    assert.ok([1, 2, 3, 5, 6, 7, 8].every((i) => first[i].status === 'in' && first[i].tags.length === 0));

    const shrunk = cellStates(bundle, 4); // L5 R9 M7: 왼쪽 0~4는 이미 제외
    assert.ok([0, 1, 2, 3, 4].every((i) => shrunk[i].status === 'out'), '제외된 칸');
    assert.deepEqual(shrunk[5].tags, ['left']);
    assert.deepEqual(shrunk[7].status, 'mid');

    const found = cellStates(bundle, 9);
    assert.deepEqual([found[5].status, found[5].tags], ['found', ['left', '찾음']]);
    assert.deepEqual(Object.values(found).filter((cell) => cell.status === 'found').map((cell) => cell.index), [5]);
});

test('결과가 -1이면 어느 칸도 "찾음"이 아니고, 구간이 비어 모든 칸이 제외된 것으로 보인다', () => {
    const bundle = raw('not-found');
    const cells = Object.values(cellStates(bundle, 10));
    assert.ok(cells.every((cell) => cell.status === 'out' && !cell.tags.includes('찾음')));
    const root = makeRoot();
    renderBinarySearch(root, bundle.input, bundle.steps[10].state);
    const dl = byTag(root, 'dl')[0];
    const rows = Object.fromEntries(byTag(dl, 'dt').map((dt, i) => [dt.textContent, byTag(dl, 'dd')[i].textContent]));
    assert.equal(rows['결과 (result)'], '-1 (찾지 못함)');
    assert.equal(rows['탐색 구간 (left ~ right)'], '비어 있음 (left = 2 > right = 1)');
    assert.equal(rows['중간 위치 (mid)'], '없음');
});

test('renderBinarySearch: 빈 배열은 칸 대신 안내를 보이고, 상태 목록에 구간과 결과를 적는다', () => {
    const bundle = raw('empty');
    const root = makeRoot();
    renderBinarySearch(root, bundle.input, bundle.steps[0].state);
    assert.equal(byClass(root, 'cell').length, 0);
    assert.match(byClass(root, 'array-empty')[0].textContent, /배열이 비어 있습니다/);
    const dl = byTag(root, 'dl')[0];
    assert.equal(byTag(dl, 'dd')[0].textContent, '비어 있음');
    assert.equal(byTag(dl, 'dd')[2].textContent, '비어 있음 (left = 0 > right = -1)');
    assert.equal(byTag(dl, 'dd')[4].textContent, '아직 없음');
});

test('renderBinarySearch: 모든 단계를 그릴 수 있고(20칸, 음수 포함) 칸의 글자와 설명이 값과 같다', async () => {
    const values = Array.from({ length: 20 }, (_, i) => i * 3 - 10);
    const bundle = make({ values, target: -7 });
    assert.deepEqual(validateBundle(bundle), { valid: true, errors: [] });
    for (const step of bundle.steps) {
        const root = makeRoot();
        renderBinarySearch(root, bundle.input, step.state);
        const cells = byClass(root, 'cell');
        assert.equal(cells.length, 20);
        assert.deepEqual(cells.map((cell) => byClass(cell, 'cell-value')[0].textContent), values.map(String));
    }
    const root = makeRoot();
    renderBinarySearch(root, bundle.input, bundle.steps[1].state);
    const first = byClass(root, 'cell')[0];
    assert.equal(byClass(first, 'cell-value')[0].textContent, '-10');
    assert.ok(first.getAttribute('class').includes('cell--negative'));
    assert.match(first.getAttribute('aria-label'), /값 -10 \(음수\)/);
    assert.equal(describeCell({ index: 3, value: 5, status: 'mid', tags: ['mid'] }), '인덱스 3, 값 5, mid');
    assert.equal(describeCell({ index: 0, value: 1, status: 'out', tags: [] }), '인덱스 0, 값 1, 탐색 구간 밖');
});

test('이분 탐색 범례: 구간 안·경계·mid·제외·찾음을 설명한다', () => {
    const root = makeRoot();
    renderBinarySearchLegend(root);
    assert.equal(byClass(root, 'legend-item').length, 5);
    for (const status of ['in', 'mid', 'out', 'found']) assert.ok(byClass(root, 'cell').some((cell) => cell.getAttribute('class').includes(`cell--${status}`)), status);
    assert.match(root.textContent, /결과가 -1이면 어느 칸도 찾음이 아닙니다/);
});

test('buildCells는 칸마다 인덱스·값·표시를 별도 요소로 두고 HTML 문자열을 만들지 않는다', async () => {
    const { bundle } = await loadFixture('binary-search', 'basic');
    const root = makeRoot();
    const list = buildCells(root.ownerDocument, classifyBinarySearchCells(bundle.input, bundle.steps[2].state), '배열');
    assert.equal(list.getAttribute('aria-label'), '배열');
    const cell = byClass(list, 'cell')[4];
    assert.deepEqual(['cell-index', 'cell-value', 'cell-tags'].map((name) => byClass(cell, name)[0].textContent), ['4', '16', 'mid']);
});
