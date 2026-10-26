// 버블 정렬: 등록된 예제의 의미(정렬 결과, 원소 보존, 같은 값은 교환하지 않음, 음수), 검증기의 전이 규칙, 모든 작은 입력에서 빌더와 검증기의 일치, 화면 표시.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBundle } from '../../scripts/trace-builders.mjs';
import { validateBundle } from '../../frontend/js/trace-validator.js';
import { classifyBubbleSortCells, renderBubbleSort, renderBubbleSortLegend } from '../../frontend/js/renderers/array.js';
import { byClass, byTag, makeRoot } from './helpers/fake-dom.mjs';
import { rawFixture } from './helpers/load-fixture.mjs';
import { makeRng } from './helpers/rng.mjs';

const raw = (name) => rawFixture(`bubble-sort/${name}.json`);
const make = (input) => buildBundle({ algorithmId: 'bubble-sort', id: 'test', version: 1, input });
const opsOf = (bundle) => bundle.steps.map((step) => step.operation);
const count = (bundle, operation) => bundle.steps.filter((step) => step.operation === operation).length;
const sorted = (values) => [...values].sort((a, b) => a - b);
const inversions = (values) => values.reduce((total, a, i) => total + values.slice(i + 1).filter((b) => a > b).length, 0);

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

test('bubble-sort/basic: 마지막에 오름차순이고, 모든 step에서 원소의 다중집합이 보존된다', () => {
    const bundle = raw('basic');
    assert.deepEqual(bundle.steps.at(-1).state.values, [1, 2, 4, 5, 8]);
    for (const step of bundle.steps) assert.deepEqual(sorted(step.state.values), sorted(bundle.input.values), `step ${step.index}`);
    assert.deepEqual(validateBundle(bundle), { valid: true, errors: [] });
});

test('bubble-sort/basic: 비교와 교환은 별도 operation이고, 교환 횟수는 입력의 역순 쌍의 수와 같다', () => {
    const bundle = raw('basic');
    assert.equal(count(bundle, 'swap'), inversions(bundle.input.values));
    assert.equal(count(bundle, 'swap'), 4);
    assert.equal(count(bundle, 'compare'), (5 * 4) / 2, '조기 종료가 없는 기본형은 모든 쌍을 비교한다(n(n-1)/2)');
    // 교환은 항상 직전 step이 비교였고, 교환 직전의 값은 앞이 더 컸다
    bundle.steps.forEach((step, i) => {
        if (step.operation !== 'swap') return;
        const before = bundle.steps[i - 1];
        assert.equal(before.operation, 'compare');
        const [a, b] = before.state.compareIndices;
        assert.ok(before.state.values[a] > before.state.values[b]);
        assert.deepEqual(step.state.values[a], before.state.values[b]);
        assert.deepEqual(step.state.values[b], before.state.values[a]);
    });
});

test('bubble-sort/basic: 한 패스가 끝날 때마다 sortedFrom이 1 줄고 compareIndices가 비며, 확정된 구간은 다시 비교하지 않는다', () => {
    const bundle = raw('basic');
    const marks = bundle.steps.filter((step) => step.operation === 'mark-sorted').map((step) => step.state.sortedFrom);
    assert.deepEqual(marks, [4, 3, 2, 1]);
    for (const step of bundle.steps) {
        if (step.operation === 'mark-sorted') assert.deepEqual([step.state.compareIndices, step.state.swapped], [null, false]);
        if (step.operation === 'compare') assert.ok(step.state.compareIndices[1] < step.state.sortedFrom, `step ${step.index}: 확정된 구간 밖만 비교한다`);
    }
    // 한 패스가 끝나면 가장 큰 값이 확정된 자리에 있다
    const afterFirstPass = bundle.steps.find((step) => step.operation === 'mark-sorted').state;
    assert.equal(afterFirstPass.values[4], Math.max(...bundle.input.values));
});

test('bubble-sort/sorted: 이미 정렬된 배열은 교환이 한 번도 없다(조기 종료 없이 모든 비교를 한다)', () => {
    const bundle = raw('sorted');
    assert.equal(count(bundle, 'swap'), 0);
    assert.equal(count(bundle, 'compare'), 6);
    assert.ok(bundle.steps.every((step) => step.state.swapped === false));
    assert.deepEqual(validateBundle(bundle), { valid: true, errors: [] });
});

test('bubble-sort/negative-duplicates: 음수와 같은 값을 정렬하고, 같은 값끼리는 교환하지 않는다', () => {
    const bundle = raw('negative-duplicates');
    assert.deepEqual(bundle.steps.at(-1).state.values, [-1, -1, 0, 3, 3]);
    assert.equal(count(bundle, 'swap'), inversions(bundle.input.values));
    bundle.steps.forEach((step, i) => {
        if (step.operation !== 'compare') return;
        const [a, b] = step.state.compareIndices;
        const equal = step.state.values[a] === step.state.values[b];
        if (equal) assert.notEqual(bundle.steps[i + 1].operation, 'swap', `step ${i}: 같은 값은 교환하지 않는다`);
    });
    assert.ok(bundle.steps.some((step) => step.operation === 'compare' && step.state.values[step.state.compareIndices[0]] === step.state.values[step.state.compareIndices[1]]), '같은 값을 비교하는 단계가 실제로 있다');
    assert.ok(bundle.steps.some((step) => step.state.values.some((value) => value < 0)));
    assert.deepEqual(validateBundle(bundle), { valid: true, errors: [] });
});

test('bubble-sort/empty와 single: 원소가 0개나 1개이면 비교 없이 initial → finish이다', () => {
    for (const name of ['empty', 'single']) {
        const bundle = raw(name);
        assert.deepEqual(opsOf(bundle), ['initial', 'finish'], name);
        assert.equal(bundle.steps.at(-1).eventId, 'finish-empty');
        assert.equal(bundle.steps.at(-1).state.sortedFrom, 0);
        assert.deepEqual(bundle.steps.at(-1).state.values, bundle.input.values);
        assert.deepEqual(validateBundle(bundle), { valid: true, errors: [] }, name);
    }
    assert.equal(raw('empty').steps[0].state.sortedFrom, 0);
    assert.equal(raw('single').steps[0].state.sortedFrom, 1);
});

test('모든 작은 입력(길이 0~5, 값 -1~2의 모든 배열)에서 빌더가 만든 trace는 규칙을 통과하고 결과·교환·비교 횟수가 맞다', () => {
    let cases = 0;
    const build = (prefix, length) => {
        if (prefix.length === length) {
            const bundle = make({ values: prefix });
            assert.deepEqual(validateBundle(bundle), { valid: true, errors: [] }, JSON.stringify(prefix));
            const last = bundle.steps.at(-1).state;
            assert.deepEqual(last.values, sorted(prefix), JSON.stringify(prefix));
            assert.equal(count(bundle, 'swap'), inversions(prefix), `${JSON.stringify(prefix)}: 교환 횟수 = 역순 쌍의 수`);
            assert.equal(count(bundle, 'compare'), prefix.length < 2 ? 0 : (prefix.length * (prefix.length - 1)) / 2);
            cases += 1;
            return;
        }
        for (let value = -1; value <= 2; value += 1) build([...prefix, value], length);
    };
    for (let length = 0; length <= 5; length += 1) build([], length);
    assert.ok(cases >= 1365, `${cases}개 입력을 확인했다`);
});

test('무작위 긴 배열(최대 20개, 음수·중복 포함)도 규칙을 통과한다', () => {
    const rng = makeRng(31);
    for (let round = 0; round < 100; round += 1) {
        const length = Math.floor(rng() * 21);
        const values = Array.from({ length }, () => Math.floor(rng() * 21) - 10);
        const bundle = make({ values });
        assert.deepEqual(validateBundle(bundle), { valid: true, errors: [] }, JSON.stringify(values));
        assert.deepEqual(bundle.steps.at(-1).state.values, sorted(values));
    }
});

// ---------- 검증기: 일부러 망가뜨린 trace를 거부한다 ----------

test('검증기: 같은 값 교환, 비교 없는 교환, 교환 결과·swapped 오류를 거부한다', () => {
    const equalSwap = raw('negative-duplicates');
    // step 3은 3과 3을 비교해 교환하지 않는다. 뒤에 swap을 끼워 넣는다.
    const swapStep = structuredClone(equalSwap.steps[2]);
    swapStep.state = { ...structuredClone(equalSwap.steps[3].state), swapped: true };
    equalSwap.steps.splice(4, 0, swapStep);
    renumber(equalSwap);
    assertRejected(equalSwap, /values\[1\] = 3이 values\[2\] = 3보다 클 때만 교환할 수 있습니다\(같은 값은 교환하지 않습니다\)/, '같은 값 교환');

    const noCompare = raw('basic');
    noCompare.steps.splice(1, 1); // 첫 compare를 없애면 initial 다음에 swap이 온다
    renumber(noCompare);
    assertRejected(noCompare, /첫 연산은 compare여야 합니다|교환은 compare 바로 다음에만 올 수 있습니다/, '비교 없는 교환');

    const wrongValues = raw('basic');
    wrongValues.steps[2].state.values = [1, 5, 4, 2, 8]; // 교환했다고 하면서 values가 [1, 5, ...]이 아닌 다른 위치를 바꿈
    wrongValues.steps[2].state.values = [5, 4, 1, 2, 8];
    assertRejected(wrongValues, /values의 0번과 1번 원소만 서로 바꿔야 합니다/, '엉뚱한 위치 교환');

    const lostElement = raw('basic');
    lostElement.steps[4].state.values = [1, 4, 4, 2, 8]; // 5가 사라지고 4가 늘었다
    assertRejected(lostElement, /input\.values와 같은 원소를 가진 순열이어야 합니다/, '원소가 늘거나 줆');

    const notSwapped = raw('basic');
    notSwapped.steps[2].state.swapped = false;
    assertRejected(notSwapped, /교환 직후에는 swapped가 true여야 합니다/, 'swapped 누락');

    const stuckSwapped = raw('basic');
    stuckSwapped.steps[3].state.swapped = true;
    assertRejected(stuckSwapped, /비교 직후에는 swapped가 false여야 합니다/, 'swapped가 남음');
});

test('검증기: 비교 위치와 패스 규칙을 어긴 trace를 거부한다(순서, 확정된 구간 비교, 이른 정렬 확정, sortedFrom)', () => {
    const skipped = raw('basic');
    skipped.steps[3].state.compareIndices = [2, 3]; // [1, 2]를 비교해야 하는데 한 칸 건너뜀
    assertRejected(skipped, /compareIndices는 \[1, 2\]이어야 합니다 \(\[2,3\]\)/, '비교 위치를 건너뜀');

    const nonAdjacent = raw('basic');
    nonAdjacent.steps[3].state.compareIndices = [1, 3];
    assertRejected(nonAdjacent, /compareIndices: 배열 안의 인접한 두 위치 \[j, j \+ 1\]이어야 합니다/, '인접하지 않은 비교');

    const intoSorted = raw('basic');
    // 두 번째 패스에서 확정된 4번 칸을 다시 비교한다
    intoSorted.steps[12].state.compareIndices = [3, 4];
    assertRejected(intoSorted, /이미 자리가 확정된 구간\(sortedFrom = 4\)이라 비교할 수 없습니다/, '확정된 구간 비교');

    const early = raw('basic');
    // 첫 패스의 마지막 비교를 마치기 전에 정렬 확정으로 넘어간다
    early.steps.splice(7, 1);
    renumber(early);
    assertRejected(early, /패스가 아직 끝나지 않았습니다/, '이른 정렬 확정');

    const wrongSortedFrom = raw('basic');
    wrongSortedFrom.steps[8].state.sortedFrom = 3;
    assertRejected(wrongSortedFrom, /sortedFrom은 5에서 1 줄어든 4이어야 합니다 \(3\)/, 'sortedFrom 오류');

    const changedSortedFrom = raw('basic');
    changedSortedFrom.steps[3].state.sortedFrom = 4;
    assertRejected(changedSortedFrom, /sortedFrom은 이 operation에서 바뀌면 안 됩니다/, '비교 중 sortedFrom 변경');

    const wrongOrder = raw('basic');
    // 5 > 1인데 교환하지 않고 다음 비교로 넘어간다
    wrongOrder.steps.splice(2, 1);
    renumber(wrongOrder);
    assertRejected(wrongOrder, /values\[0\] = 5, values\[1\] = 1이므로 다음 step은 swap이어야 합니다/, '교환해야 하는데 건너뜀');
});

test('검증기: 종료·최종 결과·초기 상태 규칙을 어긴 trace를 거부한다', () => {
    const unsorted = raw('basic');
    unsorted.steps.at(-1).state.values = [1, 2, 5, 4, 8];
    assertRejected(unsorted, /종료했는데 values가 오름차순이 아닙니다/, '정렬되지 않았는데 종료');

    const earlyFinish = raw('basic');
    earlyFinish.steps.length = 14; // 두 번째 패스를 마친 곳(sortedFrom = 3)에서 끝낸다
    Object.assign(earlyFinish.steps[13], { operation: 'finish', eventId: 'finish', lines: structuredClone(raw('basic').steps[19].lines) });
    earlyFinish.steps[13].state = { ...earlyFinish.steps[13].state, sortedFrom: 0 };
    assertRejected(earlyFinish, /finish는 마지막 패스를 마친 뒤\(mark-sorted, sortedFrom = 1\)에만 올 수 있습니다/, '패스가 남았는데 종료');

    const trivialFinish = raw('basic');
    trivialFinish.steps.splice(1, trivialFinish.steps.length - 2);
    renumber(trivialFinish);
    assertRejected(trivialFinish, /원소가 5개라서 비교 없이 끝날 수 없습니다|첫 연산은 compare여야 합니다/, '비교 없이 종료');

    const badInitial = raw('basic');
    badInitial.steps[0].state.sortedFrom = 4;
    assertRejected(badInitial, /초기 상태는 values가 input과 같고 compareIndices는 null, swapped는 false, sortedFrom은 5이어야 합니다/, '초기 상태');

    const missingKey = raw('basic');
    delete missingKey.steps[3].state.swapped;
    assertRejected(missingKey, /state: 필수 키가 없습니다 \(swapped\)/, '키 누락');

    const notSortedAtLast = raw('sorted');
    notSortedAtLast.steps.at(-1).state.values = [1, 2, 4, 3];
    assertRejected(notSortedAtLast, /(종료했는데 values가 오름차순이 아닙니다|input\.values와 같은 원소를 가진 순열)/, '결과가 다름');
});

// ---------- 화면 표시 ----------

const cellsAt = (bundle, index) => classifyBubbleSortCells(bundle.steps[index].state);

test('classifyBubbleSortCells: 비교 중인 두 칸, 방금 교환한 두 칸, 확정된 칸', () => {
    const bundle = raw('basic');
    const compare = cellsAt(bundle, 1); // [5,1,...] 비교 중
    assert.deepEqual(compare.map((cell) => cell.status), ['compare', 'compare', 'plain', 'plain', 'plain']);
    assert.deepEqual(compare[0].tags, ['비교']);

    const swapped = cellsAt(bundle, 2); // 교환 직후
    assert.deepEqual(swapped.slice(0, 2).map((cell) => [cell.status, cell.tags]), [['swapped', ['교환됨']], ['swapped', ['교환됨']]]);
    assert.deepEqual(swapped.map((cell) => cell.value), [1, 5, 4, 2, 8]);

    const marked = cellsAt(bundle, 8); // 첫 패스 끝: 4번 칸 확정
    assert.deepEqual(marked.map((cell) => cell.status), ['plain', 'plain', 'plain', 'plain', 'sorted']);
    assert.deepEqual(marked[4].tags, ['확정']);

    assert.ok(cellsAt(bundle, 19).every((cell) => cell.status === 'sorted'), '끝나면 모두 확정');
    assert.ok(cellsAt(bundle, 0).every((cell) => cell.status === 'plain'), '시작은 모두 평범한 칸');
});

test('확정된 칸이 비교 표시보다 우선한다(확정된 칸은 비교 대상이 될 수 없다)', () => {
    const cells = classifyBubbleSortCells({ values: [1, 2, 3], compareIndices: [1, 2], swapped: false, sortedFrom: 2 });
    assert.equal(cells[2].status, 'sorted');
    assert.deepEqual(cells[1].tags, ['비교']);
});

test('renderBubbleSort: 칸·상태 목록을 그리고 음수를 부호 그대로 보여 주며, 빈 배열은 안내를 보인다', () => {
    const bundle = raw('negative-duplicates');
    const root = makeRoot();
    renderBubbleSort(root, bundle.input, bundle.steps[1].state);
    const cells = byClass(root, 'cell');
    assert.deepEqual(cells.map((cell) => byClass(cell, 'cell-value')[0].textContent), ['3', '-1', '3', '0', '-1']);
    assert.ok(cells[1].getAttribute('class').includes('cell--negative'));
    assert.match(cells[1].getAttribute('aria-label'), /값 -1 \(음수\)/);
    const dl = byTag(root, 'dl')[0];
    const rows = Object.fromEntries(byTag(dl, 'dt').map((dt, i) => [dt.textContent, byTag(dl, 'dd')[i].textContent]));
    assert.equal(rows['배열 (values)'], '3, -1, 3, 0, -1');
    assert.equal(rows['비교 중인 위치 (compareIndices)'], '인덱스 0, 1 (values[0] = 3, values[1] = -1)');
    assert.equal(rows['방금 교환했는가 (swapped)'], '아니오');
    assert.equal(rows['자리가 확정된 구간 (sortedFrom)'], '없음');

    const last = bundle.steps.at(-1).state;
    const done = makeRoot();
    renderBubbleSort(done, bundle.input, last);
    const doneRows = byTag(byTag(done, 'dl')[0], 'dd').map((dd) => dd.textContent);
    assert.equal(doneRows[3], '인덱스 0 이상 (전부 확정)');
    assert.equal(doneRows[1], '없음');

    const empty = makeRoot();
    const emptyBundle = raw('empty');
    renderBubbleSort(empty, emptyBundle.input, emptyBundle.steps[0].state);
    assert.equal(byClass(empty, 'cell').length, 0);
    assert.match(byClass(empty, 'array-empty')[0].textContent, /배열이 비어 있습니다/);
});

test('renderBubbleSort: 모든 예제의 모든 단계를 그릴 수 있고 칸 수가 배열 길이와 같다', () => {
    for (const name of ['basic', 'empty', 'single', 'sorted', 'negative-duplicates']) {
        const bundle = raw(name);
        for (const step of bundle.steps) {
            const root = makeRoot(); // 가짜 DOM은 innerHTML을 쓰면 예외를 던진다
            renderBubbleSort(root, bundle.input, step.state);
            assert.equal(byClass(root, 'cell').length, bundle.input.values.length, `${name} step ${step.index}`);
        }
    }
});

test('버블 정렬 범례: 비교·교환·확정을 설명하고 칸 모양 샘플을 그래프와 같은 클래스로 보여 준다', () => {
    const root = makeRoot();
    renderBubbleSortLegend(root);
    assert.equal(byClass(root, 'legend-item').length, 4);
    for (const status of ['plain', 'compare', 'swapped', 'sorted']) assert.ok(byClass(root, 'cell').some((cell) => cell.getAttribute('class').includes(`cell--${status}`)), status);
});
