// trace 검증기(validateBundle, validateCatalog), 예제 fixture, validate-traces 스크립트를 검사한다.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIMITS, OPERATIONS, STATE_KEYS } from '../../frontend/js/trace-contract.js';
import { validateBundle, validateCatalog } from '../../frontend/js/trace-validator.js';
import { validateDataDir } from '../../scripts/validate-traces.mjs';
import { EVENT_LINES_BY_LANGUAGE, makeBfsBundle } from './helpers/bfs-bundle.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_DIR = join(ROOT, 'frontend/js/data');
const SCRIPT = join(ROOT, 'scripts/validate-traces.mjs');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
/** 매번 새로 읽으므로 테스트가 서로의 변경에 영향을 받지 않는다. */
const fixture = () => readJson(join(DATA_DIR, 'bfs/diamond.json'));
const catalogFixture = () => readJson(join(DATA_DIR, 'catalog.json'));

function assertRejected(bundle, pattern, label = '') {
    const result = validateBundle(bundle);
    assert.equal(result.valid, false, `${label} 거부되어야 합니다`);
    assert.ok(
        result.errors.some((message) => pattern.test(message)),
        `${label} 기대한 오류(${pattern})가 없습니다.\n실제 오류:\n${result.errors.join('\n')}`,
    );
}

/** eventId가 가리키는 줄을 모든 언어에 대해 만든다(예제의 세 언어와 같은 매핑). */
const linesOf = (eventId) => Object.fromEntries(Object.entries(EVENT_LINES_BY_LANGUAGE).map(([language, table]) => [language, [...table[eventId]]]));
/** 모든 언어가 같은 줄 번호를 갖는 매핑(구조 검사용으로 operation 의미와 상관없는 step을 만들 때 쓴다). */
const sameLines = (lines) => ({ python: [...lines], javascript: [...lines], c: [...lines], cpp: [...lines], java: [...lines], kotlin: [...lines], rust: [...lines] });

function renumber(bundle) {
    bundle.steps.forEach((step, i) => { step.index = i; });
    return bundle;
}

// ---------- 유효한 bundle ----------

test('fixture: bfs/diamond.json이 검증을 통과한다', () => {
    const bundle = fixture();
    const result = validateBundle(bundle);
    assert.deepEqual(result, { valid: true, errors: [] });
    assert.equal(bundle.steps.length, 22);
});

test('fixture: 코드·매핑·trace가 한 파일, 하나의 contentVersion으로 묶인다', () => {
    const bundle = fixture();
    assert.equal(bundle.contentVersion, `${bundle.algorithmId}-${bundle.exampleId}-v4`);
    assert.deepEqual(Object.keys(bundle.codes), ['python', 'cpp', 'java', 'kotlin', 'rust', 'c', 'javascript']);
    for (const step of bundle.steps) assert.deepEqual(Object.keys(step.lines), ['python', 'cpp', 'java', 'kotlin', 'rust', 'c', 'javascript']);
});

test('fixture: 독립 계산한 BFS 결과와 최종 상태가 같다', () => {
    const last = fixture().steps.at(-1);
    assert.equal(last.operation, 'finish');
    assert.deepEqual(last.state.discovered, ['A', 'B', 'C', 'D']);
    assert.deepEqual(last.state.processed, ['A', 'B', 'C', 'D']);
    assert.deepEqual(last.state.queue, []);
});

test('fixture: 생성기가 만든 trace와 operation·상태·줄이 일치한다', () => {
    const bundle = fixture();
    const expected = makeBfsBundle(bundle.input.graph, bundle.input.start, bundle.input.layout, ['python', 'cpp', 'java', 'kotlin', 'rust', 'c', 'javascript']);
    const core = (steps) => steps.map(({ eventId, operation, lines, state }) => ({ eventId, operation, lines, state }));
    assert.deepEqual(core(bundle.steps), core(expected.steps));
    for (const language of ['python', 'javascript', 'c']) assert.deepEqual(bundle.codes[language].lines, expected.codes[language].lines, language);
});

test('fixture: CONTRACTS.md의 발췌 예시와 앞 7개 step이 일치한다', () => {
    const doc = readFileSync(join(ROOT, 'docs/CONTRACTS.md'), 'utf8');
    const example = JSON.parse(doc.match(/```json\n([\s\S]*?)```/)[1]);
    const bundle = fixture();
    assert.deepEqual(example, { ...bundle, steps: bundle.steps.slice(0, 7) });
});

test('여러 모양의 그래프(사이클, 자기 간선, 도달 불가 노드, 막다른 길, 한 노드)에서 만든 trace를 통과시킨다', () => {
    const graphs = {
        cycle: [{ A: ['B'], B: ['C', 'A'], C: ['A'] }, 'A'],
        selfLoop: [{ A: ['A', 'B'], B: ['B'] }, 'A'],
        unreachable: [{ A: ['B'], B: [], X: ['A'] }, 'A'],
        sharedChild: [{ A: ['B', 'C'], B: ['D'], C: ['D'], D: [] }, 'A'],
        single: [{ A: [] }, 'A'],
        reverseOrder: [{ A: ['C', 'B'], B: [], C: ['B'] }, 'A'],
    };
    for (const [name, [graph, start]] of Object.entries(graphs)) {
        const result = validateBundle(makeBfsBundle(graph, start, undefined, ['python', 'javascript', 'c']));
        assert.deepEqual(result, { valid: true, errors: [] }, name);
    }
});

test('입력 한계값(노드 12개, 간선 24개)은 통과하고 한 개 넘으면 거부한다', () => {
    const ids = 'ABCDEFGHIJKL'.split('');
    const full = Object.fromEntries(ids.map((id, i) => [id, [ids[(i + 1) % 12], ids[(i + 2) % 12]]]));
    assert.deepEqual(validateBundle(makeBfsBundle(full, 'A')), { valid: true, errors: [] });

    const nodes13 = { ...full, M: [] };
    assertRejected(makeBfsBundle(nodes13, 'A'), /노드는 1~12개/, '노드 13개');

    const edges25 = { ...full, A: ['B', 'C', 'D'] };
    assertRejected(makeBfsBundle(edges25, 'A'), /간선은 24개 이하/, '간선 25개');
});

// ---------- 최상위 구조와 헤더 ----------

test('객체가 아니거나 이상한 값이 와도 예외 없이 거부한다', () => {
    const cyclic = fixture();
    cyclic.self = cyclic;
    const weird = [undefined, null, 42, 'bundle', true, [], {}, () => {}, Symbol('x'), new Date(), { steps: 1 }, cyclic];
    for (const value of weird) {
        const result = validateBundle(value);
        assert.equal(result.valid, false, String(value));
        assert.ok(result.errors.length > 0);
    }
});

test('최상위 키가 빠지거나 더 있으면 거부한다', () => {
    const missing = fixture();
    delete missing.codes;
    assertRejected(missing, /bundle: 필수 키가 없습니다 \(codes\)/);

    const extra = fixture();
    extra.debug = true;
    assertRejected(extra, /허용되지 않은 키가 있습니다 \(debug\)/);
});

test('schemaVersion, algorithmId, exampleId, contentVersion 오류를 거부한다', () => {
    const cases = [
        [(b) => { b.schemaVersion = 2; }, /schemaVersion/],
        [(b) => { b.algorithmId = 'quick-sort'; }, /algorithmId: 알 수 없는 알고리즘/],
        [(b) => { b.exampleId = 'Diamond'; }, /exampleId/],
        [(b) => { b.exampleId = 'a'.repeat(33); }, /exampleId/],
        [(b) => { b.contentVersion = 'bfs-diamond-v0'; }, /contentVersion/],
        [(b) => { b.contentVersion = 'bfs-other-v1'; }, /contentVersion/],
        [(b) => { b.contentVersion = 'bfs-diamond-v1.2'; }, /contentVersion/],
        [(b) => { b.contentVersion = 7; }, /contentVersion/],
    ];
    for (const [mutate, pattern] of cases) {
        const bundle = fixture();
        mutate(bundle);
        assertRejected(bundle, pattern, pattern.source);
    }
});

test('크기 제한을 넘는 bundle을 거부한다', () => {
    const bundle = fixture();
    bundle.padding = 'x'.repeat(LIMITS.maxBundleBytes);
    assertRejected(bundle, /크기가 \d+바이트를 넘습니다/);
});

// ---------- codes ----------

test('codes: 지원하지 않는 언어, 빈 codes, 설명 누락을 거부한다', () => {
    const unknownLanguage = fixture();
    unknownLanguage.codes.ruby = unknownLanguage.codes.python;
    assertRejected(unknownLanguage, /codes\.ruby: 지원하지 않는 언어/);

    const empty = fixture();
    empty.codes = {};
    assertRejected(empty, /codes: 언어가 하나 이상/);

    const noNotes = fixture();
    delete noNotes.codes.python.notes;
    assertRejected(noNotes, /codes\.python: 필수 키가 없습니다 \(notes\)/);

    const englishNotes = fixture();
    englishNotes.codes.python.notes = 'English only.';
    assertRejected(englishNotes, /notes: 한국어 설명이어야/);

    const longNotes = fixture();
    longNotes.codes.python.notes = '가'.repeat(LIMITS.maxNotesLength + 1);
    assertRejected(longNotes, /notes: 500자 이하/);
});

test('codes: 코드 줄 수·길이·탭 문자 제한을 검사한다', () => {
    const tooMany = fixture();
    tooMany.codes.python.lines = Array.from({ length: LIMITS.maxCodeLines + 1 }, (_, i) => `x = ${i}`);
    assertRejected(tooMany, /코드는 1~120줄/);

    const tooLong = fixture();
    tooLong.codes.python.lines[2] = 'x'.repeat(LIMITS.maxCodeLineLength + 1);
    assertRejected(tooLong, /lines\[2\]: 한 줄은 120자 이하/);

    const tab = fixture();
    tab.codes.python.lines[3] = '\tqueue = deque([start])';
    assertRejected(tab, /lines\[3\]: 줄바꿈이나 탭/);

    const notString = fixture();
    notString.codes.python.lines[0] = 7;
    assertRejected(notString, /lines\[0\]: 문자열이어야/);

    const noLines = fixture();
    noLines.codes.python.lines = [];
    assertRejected(noLines, /코드는 1~120줄/);
});

// ---------- 줄 매핑(R4) ----------

test('줄 번호가 코드 범위를 벗어나면 거부한다', () => {
    const over = fixture();
    over.steps[3].lines.python = [5, 11];
    assertRejected(over, /steps\[3\]\.lines\.python\[1\]: 줄 번호 11가 코드의 줄 범위 1~10를 벗어났습니다/);

    const zero = fixture();
    zero.steps[3].lines.python = [0];
    assertRejected(zero, /줄 번호 0가 코드의 줄 범위/);

    const negative = fixture();
    negative.steps[3].lines.python = [-1];
    assertRejected(negative, /줄 번호 -1가/);
});

test('줄 번호는 정수·오름차순·중복 없음이어야 한다', () => {
    const fraction = fixture();
    fraction.steps[3].lines.python = [5.5];
    assertRejected(fraction, /줄 번호는 정수여야/);

    const text = fixture();
    text.steps[3].lines.python = ['5'];
    assertRejected(text, /줄 번호는 정수여야/);

    const unsorted = fixture();
    unsorted.steps[3].lines.python = [6, 5];
    assertRejected(unsorted, /오름차순이며 중복될 수 없습니다/);

    const duplicate = fixture();
    duplicate.steps[3].lines.python = [5, 5];
    assertRejected(duplicate, /오름차순이며 중복될 수 없습니다/);

    const notArray = fixture();
    notArray.steps[3].lines.python = 5;
    assertRejected(notArray, /줄 번호 배열이어야/);
});

test('코드가 있는 언어의 줄 번호가 빠지거나, 코드 없는 언어의 줄 번호가 있으면 거부한다', () => {
    const missingLines = fixture();
    delete missingLines.steps[0].lines.c;
    assertRejected(missingLines, /steps\[0\]\.lines: 코드가 있는 언어의 줄 번호가 없습니다 \(c\)/);

    const missingCode = fixture();
    delete missingCode.codes.javascript;
    assertRejected(missingCode, /steps\[2\]\.lines: codes에 없는 언어의 줄 번호가 있습니다 \(javascript\)/);
});

test('step 0은 줄이 비어 있고, step 1 이후는 줄이 있어야 한다', () => {
    const initialWithLines = fixture();
    initialWithLines.steps[0].lines.python = [1];
    assertRejected(initialWithLines, /step 0은 실행한 줄이 없으므로 빈 배열/);

    const emptyLater = fixture();
    emptyLater.steps[4].lines.python = [];
    assertRejected(emptyLater, /steps\[4\]\.lines\.python: step 1 이후에는 실행한 줄이 하나 이상/);
});

test('같은 eventId가 다른 줄이나 다른 operation을 가리키면 거부한다', () => {
    const otherLines = fixture();
    otherLines.steps[7].lines.python = [7, 8, 9];
    assertRejected(otherLines, /eventId "check-neighbor"는 steps\[4\]와 같은 줄을 가리켜야/);

    const otherOperation = fixture();
    otherOperation.steps[7].operation = 'process';
    assertRejected(otherOperation, /steps\[7\]\.eventId: "check-neighbor"가 steps\[4\]에서는 operation "check-neighbor"인데 여기서는 "process"입니다/);
});

test('언어 키의 순서만 다른 같은 매핑은 일관된 것으로 본다', () => {
    const bundle = fixture();
    bundle.steps.forEach((step, i) => {
        // 짝수 step은 python, javascript, c 순서로, 홀수 step은 반대로 만든다.
        const entries = Object.entries(step.lines);
        step.lines = Object.fromEntries(i % 2 === 0 ? entries : entries.reverse());
    });
    assert.deepEqual(validateBundle(bundle), { valid: true, errors: [] });
});

test('언어마다 줄 번호가 다르게 매핑되어도(같은 eventId는 언어별로 같은 줄) 통과하고, 언어 하나만 어긋나면 그 언어를 짚어 거부한다', () => {
    const javascriptOnly = fixture();
    javascriptOnly.steps[7].lines.javascript = [7];
    assertRejected(javascriptOnly, /steps\[7\].*eventId "check-neighbor"는 steps\[4\]와 같은 줄을 가리켜야/);

    const cOnly = fixture();
    cOnly.steps[9].lines.c = [12, 13];
    assertRejected(cOnly, /steps\[9\].*같은 줄을 가리켜야/);
});

// ---------- steps 구조(R1~R3, R8, R9) ----------

test('index가 불연속·중복·비정수이면 거부한다', () => {
    const gap = fixture();
    gap.steps[5].index = 6;
    assertRejected(gap, /steps\[5\]\.index: 5이어야 합니다 \(6\)/);

    const removed = fixture();
    removed.steps.splice(5, 1);
    assertRejected(removed, /steps\[5\]\.index: 5이어야 합니다 \(6\)/);

    const duplicate = fixture();
    duplicate.steps[6].index = 5;
    assertRejected(duplicate, /steps\[6\]\.index: 6이어야 합니다 \(5\)/);

    const text = fixture();
    text.steps[2].index = '2';
    assertRejected(text, /steps\[2\]\.index: 2이어야/);
});

test('알 수 없는 operation과 다른 알고리즘의 operation을 거부한다', () => {
    const unknown = fixture();
    unknown.steps[3].operation = 'teleport';
    assertRejected(unknown, /steps\[3\]\.operation: 알 수 없는 operation "teleport" \(bfs의 허용 값: initial, discover/);

    const foreign = fixture();
    foreign.steps[3].operation = 'call'; // DFS의 operation
    assertRejected(foreign, /알 수 없는 operation "call"/);

    const notString = fixture();
    notString.steps[3].operation = 3;
    assertRejected(notString, /알 수 없는 operation 3/);
});

test('initial과 종료 operation의 위치를 지킨다', () => {
    const wrongFirst = fixture();
    wrongFirst.steps[0].operation = 'discover';
    assertRejected(wrongFirst, /첫 step은 initial이어야/);

    const wrongEventId = fixture();
    wrongEventId.steps[0].eventId = 'start';
    assertRejected(wrongEventId, /첫 step의 eventId는 initial/);

    const laterInitial = fixture();
    laterInitial.steps[3].operation = 'initial';
    assertRejected(laterInitial, /initial은 step 0에만/);

    const earlyFinish = fixture();
    earlyFinish.steps[10].operation = 'finish';
    assertRejected(earlyFinish, /finish은\(는\) 마지막 step에만/);

    const noFinish = fixture();
    noFinish.steps.pop();
    assertRejected(noFinish, /마지막 step은 finish이어야/);
});

test('eventId와 message 형식을 검사한다', () => {
    const badEventId = fixture();
    badEventId.steps[2].eventId = 'Enqueue_Start';
    assertRejected(badEventId, /eventId: 소문자·숫자·하이픈/);

    const longEventId = fixture();
    longEventId.steps[2].eventId = 'a'.repeat(41);
    assertRejected(longEventId, /eventId/);

    const emptyMessage = fixture();
    emptyMessage.steps[2].message = '   ';
    assertRejected(emptyMessage, /message: 설명 문자열이 필요/);

    const longMessage = fixture();
    longMessage.steps[2].message = '가'.repeat(LIMITS.maxMessageLength + 1);
    assertRejected(longMessage, /message: 200자 이하/);

    const english = fixture();
    english.steps[2].message = 'Enqueue A.';
    assertRejected(english, /message: 한국어 설명이어야/);

    const notString = fixture();
    notString.steps[2].message = 5;
    assertRejected(notString, /message: 설명 문자열이 필요/);

    const control = fixture();
    control.steps[2].message = '큐에 넣습니다.\u0007';
    assertRejected(control, /message: 제어 문자/);
});

test('step의 키가 빠지거나 더 있으면 거부한다', () => {
    const missing = fixture();
    delete missing.steps[4].state;
    assertRejected(missing, /steps\[4\]: 필수 키가 없습니다 \(state\)/);

    const extra = fixture();
    extra.steps[4].note = '메모';
    assertRejected(extra, /steps\[4\]: 허용되지 않은 키가 있습니다 \(note\)/);

    const notObject = fixture();
    notObject.steps[4] = 'step';
    assertRejected(notObject, /steps\[4\]: 객체여야/);
});

test('step 개수 제한(최소 2개, 최대 2,000개)을 검사한다', () => {
    const one = fixture();
    one.steps = one.steps.slice(0, 1);
    assertRejected(one, /최소 2개/);

    const tooMany = fixture();
    const filler = tooMany.steps[3];
    tooMany.steps = Array.from({ length: LIMITS.maxSteps + 1 }, (_, i) => ({ ...structuredClone(filler), index: i }));
    assertRejected(tooMany, /steps: 2000개 이하여야 합니다 \(2001개\)/);

    const notArray = fixture();
    notArray.steps = {};
    assertRejected(notArray, /steps: 배열이어야/);
});

test('오류가 많아도 앞의 50개만 보여 주고 나머지 개수를 알린다', () => {
    const bundle = fixture();
    for (const step of bundle.steps) step.lines.python = [99, 98, 97];
    const { valid, errors } = validateBundle(bundle);
    assert.equal(valid, false);
    assert.equal(errors.length, 51);
    assert.match(errors.at(-1), /앞의 50개만 표시/);
});

// ---------- 스냅샷의 독립성(R6) ----------

test('step 사이에 같은 배열을 공유하면 거부한다(과거 상태가 함께 바뀐다)', () => {
    const bundle = fixture();
    bundle.steps[3].state.discovered = bundle.steps[2].state.discovered;
    assertRejected(bundle, /steps\[3\]\.state\.discovered: steps\[2\]\.state\.discovered와\(과\) 같은 객체를 공유합니다/);
});

test('공유된 배열을 바꾸면 과거 step도 바뀌는 것을 실제로 보여 주고 검증기가 이를 잡는다', () => {
    const bundle = fixture();
    const shared = bundle.steps[3].state.discovered;
    bundle.steps[4].state.discovered = shared; // 같은 배열(내용은 같다)
    assert.equal(validateBundle(bundle).valid, false);
    shared.push('Z'); // 한 곳을 바꾸면
    assert.deepEqual(bundle.steps[4].state.discovered, shared); // 다른 곳도 함께 바뀐다
});

test('input과 state, 또는 step과 step이 객체를 공유해도 거부한다', () => {
    const shareInput = fixture();
    shareInput.steps[2].state.queue = shareInput.input.graph.D;
    assertRejected(shareInput, /같은 객체를 공유합니다/);

    const shareLines = fixture();
    shareLines.steps[4].lines = shareLines.steps[3].lines;
    assertRejected(shareLines, /steps\[4\]\.lines: steps\[3\]\.lines와\(과\) 같은 객체를 공유/);
});

test('순환 참조가 있어도 멈추지 않고 거부한다', () => {
    const bundle = fixture();
    bundle.steps[2].state.queue = [bundle.steps[2].state];
    const result = validateBundle(bundle);
    assert.equal(result.valid, false);
});

test('검증은 입력을 바꾸지 않는다', () => {
    const bundle = fixture();
    const before = JSON.stringify(bundle);
    validateBundle(bundle);
    const broken = fixture();
    broken.steps[3].lines.python = [99];
    const brokenBefore = JSON.stringify(broken);
    validateBundle(broken);
    assert.equal(JSON.stringify(bundle), before);
    assert.equal(JSON.stringify(broken), brokenBefore);
});

// ---------- input ----------

test('그래프 입력 오류를 거부한다', () => {
    const cases = [
        [(i) => { i.directed = false; }, /input\.directed: 방향 그래프만/],
        [(i) => { i.start = 'Z'; }, /input\.start: 시작 노드 "Z"는 graph에 없습니다/],
        [(i) => { i.graph.A = ['B', 'Q']; }, /이웃 "Q"는 graph에 없는 노드/],
        [(i) => { i.graph.A = ['B', 'B']; }, /이웃 B가 중복되었습니다/],
        [(i) => { i.graph.A = 'B'; }, /이웃 배열이어야/],
        [(i) => { i.graph.ABCD = []; i.layout.ABCD = { x: 1, y: 1 }; }, /노드 ID "ABCD"는 영문·숫자 1~3자/],
        [(i) => { i.graph = []; }, /input\.graph: 객체여야/],
        [(i) => { delete i.layout.D; }, /input\.layout: 위치가 없는 노드가 있습니다 \(D\)/],
        [(i) => { i.layout.Q = { x: 1, y: 1 }; }, /graph에 없는 노드의 위치가 있습니다 \(Q\)/],
        [(i) => { i.layout.A.x = 101; }, /layout\.A\.x: 0~100 범위의 숫자/],
        [(i) => { i.layout.A.y = '10'; }, /layout\.A\.y: 0~100 범위의 숫자/],
        [(i) => { i.layout.A.z = 1; }, /layout\.A: 허용되지 않은 키/],
        [(i) => { i.layout.A = [50, 10]; }, /layout\.A: \{x, y\} 객체여야/],
        [(i) => { i.extra = 1; }, /input: 허용되지 않은 키가 있습니다 \(extra\)/],
    ];
    for (const [mutate, pattern] of cases) {
        const bundle = fixture();
        mutate(bundle.input);
        assertRejected(bundle, pattern, pattern.source);
    }
});

test('배열 입력의 크기·정수 범위·정렬 조건을 검사한다(이분 탐색·버블 정렬)', () => {
    const base = (algorithmId, input) => {
        const bundle = fixture();
        bundle.algorithmId = algorithmId;
        bundle.contentVersion = `${algorithmId}-diamond-v1`;
        bundle.input = input;
        return bundle;
    };
    const twenty = Array.from({ length: 20 }, (_, i) => i);
    assertRejected(base('binary-search', { values: [...twenty, 20], target: 1 }), /원소는 20개 이하여야 합니다 \(21개\)/);
    assertRejected(base('binary-search', { values: [1, 1000], target: 1 }), /input\.values\[1\]: -999~999 범위를 벗어났습니다 \(1000\)/);
    assertRejected(base('binary-search', { values: [-1000], target: 1 }), /-999~999 범위/);
    assertRejected(base('binary-search', { values: [1, 2.5], target: 1 }), /input\.values\[1\]: 정수여야/);
    assertRejected(base('binary-search', { values: [3, 1], target: 1 }), /오름차순\(비내림차순\)이어야/);
    assertRejected(base('binary-search', { values: [1, 2], target: '1' }), /input\.target: 정수여야/);
    assertRejected(base('binary-search', { values: [1, 2] }), /input: 필수 키가 없습니다 \(target\)/);
    assertRejected(base('bubble-sort', { values: [...twenty, 20] }), /원소는 20개 이하/);
    assertRejected(base('bubble-sort', { values: 'abc' }), /input\.values: 배열이어야/);

    // 규칙에 맞는 입력(중복·음수·빈 배열)은 입력 오류가 아니다. 상태 검증기가 없다는 오류만 남아야 한다.
    for (const [algorithmId, input] of [
        ['binary-search', { values: [], target: 5 }],
        ['binary-search', { values: [-5, -5, 0, 3, 3], target: 3 }],
        ['bubble-sort', { values: [] }],
        ['bubble-sort', { values: [3, -1, 3, 0] }],
    ]) {
        const { errors } = validateBundle(base(algorithmId, input));
        assert.ok(errors.every((message) => !message.startsWith('input')), `${algorithmId}: ${errors.join(' / ')}`);
    }
});

// ---------- 모든 알고리즘에 상태·전이 규칙이 있다 ----------

test('네 알고리즘 모두 상태·전이 검증기가 있어서, 구조만 맞고 상태가 엉터리인 bundle은 상태 오류로 거부된다', () => {
    for (const algorithmId of ['bfs', 'dfs', 'binary-search', 'bubble-sort']) {
        const bundle = fixture();
        bundle.algorithmId = algorithmId;
        bundle.contentVersion = `${algorithmId}-diamond-v1`;
        bundle.input = algorithmId === 'bubble-sort' ? { values: [2, 1] } : algorithmId === 'binary-search' ? { values: [1, 2], target: 2 } : bundle.input;
        // 이 알고리즘의 operation으로 구조만 맞춘 step 2개(상태는 어느 알고리즘의 모양도 아니다)
        const [first, second] = OPERATIONS[algorithmId].includes('finish') ? ['initial', 'finish'] : ['initial', 'return'];
        bundle.steps = [
            { index: 0, eventId: 'initial', operation: first, lines: sameLines([]), state: { x: [] }, message: '실행 전 상태입니다.' },
            { index: 1, eventId: 'finish', operation: second, lines: sameLines([1]), state: { y: [] }, message: '끝났습니다.' },
        ];
        const result = validateBundle(bundle);
        assert.equal(result.valid, false, algorithmId);
        assert.ok(result.errors.some((message) => /^steps\[\d\]\.state: 필수 키가 없습니다/.test(message)), `${algorithmId}: 상태 모양 오류가 있어야 합니다\n${result.errors.join('\n')}`);
        assert.ok(!result.errors.some((message) => /검증기가 아직 없어/.test(message)), `${algorithmId}: 규칙이 있는 알고리즘입니다`);
    }
});

test('계약의 operation·상태 키 표가 네 알고리즘을 모두 정의한다', () => {
    for (const algorithmId of ['bfs', 'dfs', 'binary-search', 'bubble-sort']) {
        assert.ok(OPERATIONS[algorithmId].includes('initial'), algorithmId);
        assert.ok(STATE_KEYS[algorithmId].length >= 4, algorithmId);
    }
});

// ---------- BFS 상태 모양과 불변식 ----------

test('BFS state: 키 누락·추가, 잘못된 타입, graph에 없는 노드, 중복을 거부한다', () => {
    const cases = [
        [(s) => { delete s.steps[3].state.neighbor; }, /steps\[3\]\.state: 필수 키가 없습니다 \(neighbor\)/],
        [(s) => { s.steps[3].state.extra = []; }, /steps\[3\]\.state: 허용되지 않은 키가 있습니다 \(extra\)/],
        [(s) => { s.steps[3].state.current = 7; }, /state\.current: null이거나 graph에 있는 노드여야/],
        [(s) => { s.steps[3].state.queue = 'A'; }, /state\.queue: 노드 배열이어야/],
        [(s) => { s.steps[3].state.discovered = ['A', 'Z']; }, /state\.discovered\[1\]: "Z"는 graph에 없는 노드/],
        [(s) => { s.steps[3].state.discovered = ['A', 'A']; }, /state\.discovered\[1\]: A가 중복되었습니다/],
        [(s) => { s.steps[3] = { ...s.steps[3], state: null }; }, /steps\[3\]\.state: 객체여야/],
    ];
    for (const [mutate, pattern] of cases) {
        const bundle = fixture();
        mutate(bundle);
        assertRejected(bundle, pattern, pattern.source);
    }
});

test('BFS state 불변식: 큐·처리 완료·현재·이웃의 관계를 검사한다', () => {
    const cases = [
        [(s) => { s.steps[2].state.queue = ['B']; }, /state\.queue: B는 아직 발견하지 않은 노드/],
        [(s) => { s.steps[3].state.queue = ['A']; }, /current: A는 이미 큐에서 꺼냈으므로 queue에 있으면 안 됩니다/],
        [(s) => { s.steps[3].state.processed = ['A']; }, /current: A는 이미 처리를 마친 노드/],
        [(s) => { s.steps[3].state.current = 'D'; }, /current: D는 발견하지 않은 노드/],
        [(s) => { s.steps[4].state.neighbor = 'D'; }, /neighbor: D는 A의 이웃이 아닙니다/],
        [(s) => { s.steps[2].state.neighbor = 'B'; }, /neighbor: current가 없는데 이웃을 검사할 수 없습니다/],
        [(s) => { s.steps[3].state.processed = ['A']; s.steps[3].state.queue = ['A']; s.steps[3].state.current = null; }, /queue와 processed에 동시에/],
    ];
    for (const [mutate, pattern] of cases) {
        const bundle = fixture();
        mutate(bundle);
        assertRejected(bundle, pattern, pattern.source);
    }
});

test('BFS 초기 상태는 모두 비어 있어야 한다', () => {
    const bundle = fixture();
    bundle.steps[0].state.discovered = ['A'];
    assertRejected(bundle, /steps\[0\]\.state: 초기 상태는 배열이 모두 비어 있고/);
});

// ---------- BFS 전이 규칙(R7) ----------

test('BFS 전이: 입력의 시작 노드가 아닌 노드에서 시작한 trace를 거부한다', () => {
    const bundle = fixture();
    bundle.input.start = 'D'; // trace는 A에서 시작하지만 입력은 D에서 시작하라고 한다
    assertRejected(bundle, /steps\[1\]\(discover\): 이웃 검사 없이 발견할 수 있는 노드는 시작 노드 D뿐입니다 \(A\)/);
});

// 시작 노드를 발견하지 않는 trace. 검토에서 `initial -> finish`가 통과하는 것이 재현되었다.
// 전이 규칙은 "어떤 operation이 나타났을 때" 적용되므로, 아무 operation도 나타나지 않는 trace는 걸리지 않았다.
const START_RULE = /steps\[1\]\(\w[\w-]*\): 첫 연산은 시작 노드 A의 발견\(discover\)이어야 합니다/;
const ORACLE_RULE = /최종 상태: (discovered가 BFS 결과와|processed가 BFS 처리 순서와) 다릅니다/;
const EMPTY_STATE = () => ({ discovered: [], processed: [], queue: [], current: null, neighbor: null });

function finishStep(index, state) {
    return { index, eventId: 'finish', operation: 'finish', lines: linesOf('finish'), state, message: '큐가 비었으므로 반복을 끝냅니다.' };
}

/**
 * 거부되어야 하며, 시작 노드 규칙 또는 독립 계산(최종 결과 비교) 중 하나가 이유로 나와야 한다.
 * 두 검사는 서로의 빈틈을 막는 이중 방어선이다. 하나가 사라져도 이 테스트는 통과해야 하고(다른 쪽이 잡는다),
 * 둘 다 사라지면 실패해야 한다. 변이 검사에서 이 점을 확인한다.
 */
function assertRejectedEarlyExit(bundle, label) {
    const { valid, errors } = validateBundle(bundle);
    assert.equal(valid, false, `${label}: 시작 노드를 발견하지 않은 trace가 통과했습니다`);
    assert.ok(errors.some((message) => START_RULE.test(message) || ORACLE_RULE.test(message)), `${label}\n${errors.join('\n')}`);
}

test('BFS: 시작 노드를 발견하지 않고 initial 바로 다음에 종료하는 trace를 거부한다', () => {
    const bundle = fixture();
    bundle.steps = [bundle.steps[0], finishStep(1, EMPTY_STATE())];
    assertRejectedEarlyExit(bundle, 'initial -> finish');
    // 시작 노드 규칙이 있으므로 구체적인 이유가 나와야 한다.
    assertRejected(bundle, START_RULE, 'initial -> finish');
});

test('BFS: 첫 연산이 discover가 아닌 다른 trace도 거부한다', () => {
    for (const operation of ['dequeue', 'check-neighbor', 'process', 'enqueue']) {
        const bundle = fixture();
        const step = { ...structuredClone(bundle.steps[3]), index: 1, operation };
        bundle.steps = [bundle.steps[0], step, finishStep(2, EMPTY_STATE())];
        assertRejectedEarlyExit(bundle, `initial -> ${operation} -> finish`);
    }
});

test('BFS: 시작 노드만 발견하고 큐에 넣지 않거나, 탐색 없이 처리 완료로 건너뛰는 trace를 거부한다', () => {
    const noEnqueue = fixture();
    noEnqueue.steps = [noEnqueue.steps[0], noEnqueue.steps[1], finishStep(2, { ...EMPTY_STATE(), discovered: ['A'] })];
    assertRejectedEarlyExit(noEnqueue, 'discover 후 바로 finish');
    assertRejected(noEnqueue, /발견한 노드는 바로 큐에 넣어야 하므로 다음 step은 enqueue여야/);

    const skipWork = fixture();
    // 시작 노드의 이웃(B, C)을 하나도 검사하지 않고 process
    skipWork.steps = skipWork.steps.slice(0, 4).concat([structuredClone(skipWork.steps[10])]);
    skipWork.steps.push(finishStep(5, structuredClone(skipWork.steps[4].state)));
    renumber(skipWork);
    assertRejected(skipWork, /A의 이웃 2개 중 0개만 검사했습니다/);
});

test('BFS: 이웃이 없는 시작 노드 하나만 있는 그래프는 정상 trace로 통과한다(빈 탐색과 구분)', () => {
    const bundle = makeBfsBundle({ A: [] }, 'A', undefined, ['python', 'cpp', 'java', 'kotlin', 'rust', 'c', 'javascript']);
    assert.deepEqual(bundle.steps.map((step) => step.operation), ['initial', 'discover', 'enqueue', 'dequeue', 'process', 'finish']);
    assert.deepEqual(validateBundle(bundle), { valid: true, errors: [] });
    // 같은 그래프에서 시작 노드를 발견하지 않은 trace는 거부한다.
    bundle.steps = [bundle.steps[0], finishStep(1, EMPTY_STATE())];
    assertRejectedEarlyExit(bundle, '한 노드 그래프의 빈 trace');
});

test('BFS: 도달할 수 있는 노드를 일부러 빠뜨린 trace(조기 종료)를 거부한다', () => {
    // 마름모 그래프에서 D를 발견하지 않고 끝낸 것처럼 만든 trace는 전이 규칙(미발견 이웃 건너뜀 등)으로 거부된다.
    const bundle = fixture();
    bundle.steps = bundle.steps.slice(0, 11); // A를 처리한 직후(큐 [B, C])까지만
    bundle.steps.push(finishStep(11, { ...structuredClone(bundle.steps[10].state), queue: [] }));
    assertRejected(bundle, /steps\[11\]\(finish\): 큐에 2개가 남아 있어 종료할 수 없습니다/);
    assertRejectedEarlyExit(bundle, 'A만 처리하고 종료');
});

test('BFS 전이: 방금 검사한 이웃이 아닌 노드를 발견으로 기록하면 거부한다', () => {
    // step 5는 이웃 B를 발견으로 기록한다. 대신 C를 기록한 것처럼 바꾼다(상태 모양은 유효하다).
    const bundle = fixture();
    assert.equal(bundle.steps[4].state.neighbor, 'B');
    bundle.steps[5].state.discovered = ['A', 'C'];
    assertRejected(bundle, /steps\[5\]\(discover\): 방금 검사한 이웃 B만 발견으로 기록할 수 있습니다 \(C\)/);
});

test('BFS 전이: enqueue가 큐에 넣지 않거나 discover 없이 오면 거부한다', () => {
    // 상태 모양은 유효하다(큐가 빈 것 자체는 문제가 아니다). enqueue 규칙만 어긴다.
    const notQueued = fixture();
    notQueued.steps[2].state.queue = [];
    assertRejected(notQueued, /steps\[2\]\(enqueue\): queue 끝에 방금 발견한 노드 A만 추가해야 합니다/);

    const noDiscover = fixture();
    noDiscover.steps[5].operation = 'check-neighbor';
    noDiscover.steps[5].eventId = 'check-neighbor';
    noDiscover.steps[5].lines = linesOf('check-neighbor');
    assertRejected(noDiscover, /enqueue는 discover 바로 다음에만/);
});

test('BFS 전이: 큐가 비었는데 dequeue하거나 앞이 아닌 노드를 꺼내면 거부한다', () => {
    const emptyQueue = fixture();
    emptyQueue.steps[2].state.queue = [];
    emptyQueue.steps[3].state.current = 'A';
    assertRejected(emptyQueue, /steps\[3\]\(dequeue\): 큐가 비어 있어 꺼낼 수 없습니다/);

    // step 11은 큐 [B, C]에서 앞의 B를 꺼내는 dequeue다. 뒤의 C를 꺼낸 것처럼 바꾼다(상태 모양은 유효하다).
    const wrongEnd = fixture();
    assert.deepEqual(wrongEnd.steps[10].state.queue, ['B', 'C']);
    wrongEnd.steps[11].state.queue = ['B'];
    wrongEnd.steps[11].state.current = 'C';
    assertRejected(wrongEnd, /steps\[11\]\(dequeue\): queue 맨 앞의 B만 꺼내야 합니다/);

    // 큐에서 꺼내지 않고 current만 정하면 상태 불변식(current는 queue에 없어야 함)이 먼저 잡는다.
    const notPopped = fixture();
    notPopped.steps[3].state.queue = ['A'];
    assertRejected(notPopped, /current: A는 이미 큐에서 꺼냈으므로 queue에 있으면 안 됩니다/);
});

test('BFS 전이: 이웃은 입력 배열의 순서대로 한 번씩만 검사해야 한다', () => {
    const wrongOrder = fixture();
    // A의 이웃 [B, C]를 C부터 검사한 것처럼 바꾼다.
    wrongOrder.steps[4].state.neighbor = 'C';
    assertRejected(wrongOrder, /steps\[4\]\(check-neighbor\): A의 1번째 이웃 B를 검사해야 합니다/);

    const repeated = fixture();
    // 이웃이 하나뿐인 B를 두 번 검사한 trace를 만든다(step 9 다음에 check-neighbor 복제).
    const dup = structuredClone(repeated.steps[10]);
    repeated.steps.splice(11, 0, dup);
    renumber(repeated);
    assertRejected(repeated, /이웃을 이미 모두 검사했습니다|다음 step은/);
});

test('BFS 전이: 이웃을 다 검사하기 전에 process하면 거부한다', () => {
    const bundle = fixture();
    // A의 두 번째 이웃 C의 검사·발견·큐 삽입(3개 step)을 빼고 바로 process하게 만든다.
    bundle.steps.splice(7, 3);
    renumber(bundle);
    assertRejected(bundle, /A의 이웃 2개 중 1개만 검사했습니다/);
});

test('BFS 전이: 발견하지 않은 이웃을 건너뛰면 거부한다', () => {
    const bundle = fixture();
    // A의 첫 이웃 B를 검사한 뒤 discover·enqueue(2개 step)를 빼 버린다.
    bundle.steps.splice(5, 2);
    renumber(bundle);
    assertRejected(bundle, /아직 발견하지 않은 이웃 B를 건너뛰었습니다/);
});

test('BFS 전이: 이미 발견한 이웃을 또 발견하거나 큐에 넣으면 거부한다', () => {
    const bundle = fixture();
    // C의 이웃 D를 검사하는 step(이미 발견됨) 바로 뒤에 discover를 끼워 넣는다.
    const checkD = bundle.steps.findIndex((step, i) => i > 10 && step.operation === 'check-neighbor' && step.state.current === 'C');
    assert.ok(checkD > 0);
    const extra = structuredClone(bundle.steps[5]);
    extra.state = structuredClone(bundle.steps[checkD].state);
    bundle.steps.splice(checkD + 1, 0, extra);
    renumber(bundle);
    assertRejected(bundle, /이미 발견한 이웃 D는 건너뛰어야|discovered는 이전 목록 끝에 노드 하나만|neighbor|중복/);
});

test('BFS 전이: check-neighbor나 process가 다른 필드를 바꾸면 거부한다', () => {
    const changedDiscovered = fixture();
    changedDiscovered.steps[4].state.discovered = ['A', 'B'];
    assertRejected(changedDiscovered, /steps\[4\]\(check-neighbor\): discovered은\(는\) 이 operation에서 바뀌면 안 됩니다/);

    const changedQueue = fixture();
    changedQueue.steps[4].state.queue = ['A'];
    changedQueue.steps[4].state.current = null;
    changedQueue.steps[4].state.neighbor = null;
    assertRejected(changedQueue, /steps\[4\]\(check-neighbor\)/);
});

/** step 0..keep-1까지만 남기고, 마지막 상태를 그대로 가진 finish step을 붙인다. */
function truncateWithFinish(bundle, keep) {
    bundle.steps = bundle.steps.slice(0, keep);
    const finish = structuredClone(bundle.steps.at(-1));
    finish.eventId = 'finish';
    finish.operation = 'finish';
    finish.lines = linesOf('finish');
    bundle.steps.push(finish);
    return renumber(bundle);
}

test('BFS 전이: 큐에 노드가 남았는데 finish하면 거부한다', () => {
    // step 10(process A)의 상태는 current가 null이고 큐가 [B, C]다. 큐 규칙만 어긴다.
    const bundle = truncateWithFinish(fixture(), 11);
    assert.equal(bundle.steps[10].state.current, null);
    assert.deepEqual(bundle.steps[10].state.queue, ['B', 'C']);
    assertRejected(bundle, /steps\[11\]\(finish\): 큐에 2개가 남아 있어 종료할 수 없습니다/);
});

test('BFS 전이: 처리 중인 노드가 있는데 finish하면 거부한다', () => {
    // step 8(discover C)의 상태는 큐가 [B]이므로, 큐가 비고 current만 남은 상태를 만든다: step 3(dequeue A).
    const bundle = truncateWithFinish(fixture(), 4);
    assert.deepEqual(bundle.steps[3].state.queue, []);
    assert.equal(bundle.steps[3].state.current, 'A');
    assertRejected(bundle, /steps\[4\]\(finish\): 처리 중인 노드 A가 있어 종료할 수 없습니다/);
});

test('BFS 전이: finish 뒤에 step이 더 있으면 거부한다', () => {
    const after = fixture();
    const again = structuredClone(after.steps.at(-1));
    again.index = after.steps.length;
    after.steps.push(again);
    assertRejected(after, /finish은\(는\) 마지막 step에만/);
});

test('BFS 전이: process 뒤에는 큐 상태에 맞는 operation이 와야 한다', () => {
    // 큐가 남았는데(step 10의 큐는 [B, C]) 다음 step이 dequeue가 아닌 경우.
    // eventId·줄 매핑은 check-neighbor와 일치시켜 구조 검사는 통과하고 전이 규칙만 어기게 한다.
    const queueLeft = fixture();
    Object.assign(queueLeft.steps[11], { eventId: 'check-neighbor', operation: 'check-neighbor', lines: linesOf('check-neighbor') });
    assertRejected(queueLeft, /steps\[10\]\(process\): 큐가 남아 있으므로 다음 step은 dequeue여야 합니다 \(check-neighbor\)/);

    // 큐가 비었는데 finish 대신 dequeue가 끼어든 경우.
    const queueEmpty = fixture();
    const extra = structuredClone(queueEmpty.steps[3]); // dequeue-node(operation: dequeue)
    extra.state = structuredClone(queueEmpty.steps[20].state);
    queueEmpty.steps.splice(21, 0, extra);
    renumber(queueEmpty);
    assertRejected(queueEmpty, /steps\[20\]\(process\): 큐가 비었으므로 다음 step은 finish여야 합니다 \(dequeue\)/);
});

test('BFS: 입력 그래프의 이웃 순서와 trace의 검사 순서가 어긋나면 거부한다', () => {
    const bundle = fixture();
    bundle.input.graph.A = ['C', 'B']; // 입력은 C부터 검사하라고 하는데 trace는 B부터 검사한다
    assertRejected(bundle, /steps\[4\]\(check-neighbor\): A의 1번째 이웃 C를 검사해야 합니다/);
});

test('BFS: 검증을 통과한 trace의 최종 상태는 독립적으로 계산한 BFS 결과와 같다', () => {
    // 검증기는 전이 규칙만 확인한다. 규칙을 모두 지킨 trace가 실제 BFS 결과와 같은지는 따로 계산해 비교한다.
    const reference = (graph, start) => {
        const discovered = [start];
        const queue = [start];
        const processed = [];
        while (queue.length > 0) {
            const node = queue.shift();
            for (const neighbor of graph[node]) {
                if (!discovered.includes(neighbor)) { discovered.push(neighbor); queue.push(neighbor); }
            }
            processed.push(node);
        }
        return { discovered, processed };
    };
    const cases = [
        [{ A: ['B', 'C'], B: ['D'], C: ['D'], D: [] }, 'A'],
        [{ A: ['C', 'B'], B: ['A'], C: ['B', 'D'], D: ['A'] }, 'A'],
        [{ A: ['B'], B: ['C', 'A'], C: ['C'] }, 'B'],
        [{ A: ['B'], B: [], X: ['A'] }, 'X'],
        [{ A: [] }, 'A'],
    ];
    for (const [graph, start] of cases) {
        const bundle = makeBfsBundle(graph, start);
        assert.deepEqual(validateBundle(bundle), { valid: true, errors: [] });
        const last = bundle.steps.at(-1).state;
        const expected = reference(graph, start);
        assert.deepEqual(last.discovered, expected.discovered);
        assert.deepEqual(last.processed, expected.processed);
    }
});

// ---------- catalog ----------

test('catalog: 실제 catalog가 검증을 통과한다', () => {
    assert.deepEqual(validateCatalog(catalogFixture()), { valid: true, errors: [] });
});

test('catalog: 구조 오류를 거부한다', () => {
    const cases = [
        [(c) => { c.schemaVersion = 2; }, /catalog\.schemaVersion/],
        [(c) => { c.extra = 1; }, /catalog: 허용되지 않은 키/],
        [(c) => { c.algorithms = {}; }, /catalog\.algorithms: 배열이어야/],
        [(c) => { c.algorithms[0].id = 'quick-sort'; }, /알 수 없는 알고리즘/],
        [(c) => { c.algorithms.push(structuredClone(c.algorithms[0])); }, /bfs가 중복되었습니다/],
        [(c) => { c.algorithms[0].title = ' '; }, /title: 제목이 필요/],
        [(c) => { c.algorithms[0].examples = []; }, /예제가 하나 이상 필요/],
        [(c) => { c.algorithms[0].examples.push(structuredClone(c.algorithms[0].examples[0])); }, /diamond가 bfs 안에서 중복/],
        [(c) => { c.algorithms[0].examples[0].id = 'Diamond'; }, /examples\[0\]\.id/],
        [(c) => { c.algorithms[0].examples[0].languages = []; }, /언어가 하나 이상 필요/],
        [(c) => { c.algorithms[0].examples[0].languages = ['python', 'python']; }, /python가 중복/],
        [(c) => { c.algorithms[0].examples[0].languages = ['ruby']; }, /지원하지 않는 언어/],
        [(c) => { c.algorithms[0].examples[0].extra = 1; }, /examples\[0\]: 허용되지 않은 키/],
    ];
    for (const [mutate, pattern] of cases) {
        const catalog = catalogFixture();
        mutate(catalog);
        const result = validateCatalog(catalog);
        assert.equal(result.valid, false, pattern.source);
        assert.ok(result.errors.some((message) => pattern.test(message)), `${pattern}\n${result.errors.join('\n')}`);
    }
});

test('catalog: 허용된 폴더 밖이나 외부 주소를 가리키는 경로를 거부한다', () => {
    const paths = [
        '../secret.json', 'bfs/../../secret.json', '/etc/passwd', 'C:\\Windows\\win.ini', 'bfs\\diamond.json',
        'https://example.com/bfs/diamond.json', '//example.com/bfs/diamond.json', 'bfs/other.json',
        'dfs/diamond.json', 'bfs/diamond.json?x=1', 'bfs/diamond.json#x', 'bfs/diamond.JSON', 'bfs/diamond', '', 7,
    ];
    for (const path of paths) {
        const catalog = catalogFixture();
        catalog.algorithms[0].examples[0].path = path;
        const result = validateCatalog(catalog);
        assert.equal(result.valid, false, `경로 ${JSON.stringify(path)}를 거부해야 합니다`);
        assert.ok(result.errors.some((message) => /\.path:/.test(message)), JSON.stringify(path));
    }
});

test('catalog: 객체가 아니거나 이상한 값이 와도 예외 없이 거부한다', () => {
    for (const value of [undefined, null, 1, 'catalog', [], () => {}, { algorithms: [null, 1, 'x'] }, { schemaVersion: 1, algorithms: [{}] }]) {
        assert.equal(validateCatalog(value).valid, false, String(value));
    }
});

// ---------- scripts/validate-traces.mjs ----------

const tempRoots = [];
after(() => tempRoots.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function copyDataDir() {
    const dir = mkdtempSync(join(tmpdir(), 'trace-data-'));
    tempRoots.push(dir);
    cpSync(DATA_DIR, dir, { recursive: true });
    return dir;
}

const sameLanguages = (languages) => JSON.stringify([...languages].sort()) === JSON.stringify(['c', 'cpp', 'java', 'javascript', 'kotlin', 'python', 'rust']);

test('validateDataDir: 실제 data 폴더의 등록된 예제가 모두 통과한다', async () => {
    const { errors, checked } = await validateDataDir(DATA_DIR);
    assert.deepEqual(errors, []);
    // catalog에 등록된 모든 예제(알고리즘 4개, 예제 16개)가 세 언어를 가지고 통과한다.
    assert.equal(checked.length, 36);
    assert.ok(checked.every((item) => sameLanguages(item.languages)), '모든 예제가 세 언어를 가진다');
    assert.deepEqual(checked.find((item) => item.path === 'bfs/diamond.json'), { path: 'bfs/diamond.json', contentVersion: 'bfs-diamond-v4', steps: 22, languages: ['c', 'cpp', 'java', 'javascript', 'kotlin', 'python', 'rust'] });
    for (const algorithmId of ['bfs', 'dfs', 'binary-search', 'bubble-sort']) assert.ok(checked.some((item) => item.path.startsWith(`${algorithmId}/`)), algorithmId);
});

test('validateDataDir: 등록되지 않은 bundle 파일을 오류로 본다', async () => {
    const dir = copyDataDir();
    mkdirSync(join(dir, 'bfs'), { recursive: true });
    writeFileSync(join(dir, 'bfs/forgotten.json'), JSON.stringify(fixture()));
    const { errors } = await validateDataDir(dir);
    assert.deepEqual(errors, ['bfs/forgotten.json: catalog.json에 등록되지 않은 bundle 파일입니다']);
});

test('validateDataDir: 등록했지만 파일이 없거나 JSON이 깨졌으면 오류로 본다', async () => {
    const missing = copyDataDir();
    rmSync(join(missing, 'bfs/diamond.json'));
    assert.match((await validateDataDir(missing)).errors[0], /bfs\/diamond\.json: 파일을 읽을 수 없습니다/);

    const broken = copyDataDir();
    writeFileSync(join(broken, 'bfs/diamond.json'), '{ "schemaVersion": ');
    assert.match((await validateDataDir(broken)).errors[0], /bfs\/diamond\.json: JSON 형식이 올바르지 않습니다/);
});

test('validateDataDir: catalog와 bundle의 언어가 다르면 오류로 본다', async () => {
    const dir = copyDataDir();
    const catalog = readJson(join(dir, 'catalog.json'));
    catalog.algorithms[0].examples[0].languages = ['python', 'javascript'];
    writeFileSync(join(dir, 'catalog.json'), JSON.stringify(catalog));
    const { errors } = await validateDataDir(dir);
    assert.deepEqual(errors, ['bfs/diamond.json: 언어가 catalog와 다릅니다 (catalog javascript,python, bundle c,cpp,java,javascript,kotlin,python,rust)']);
});

test('validateDataDir: bundle이 잘못되면 오류 이유와 함께 보고한다', async () => {
    const dir = copyDataDir();
    const bundle = fixture();
    bundle.steps[3].lines.python = [11];
    writeFileSync(join(dir, 'bfs/diamond.json'), JSON.stringify(bundle));
    const { errors, checked } = await validateDataDir(dir);
    assert.equal(checked.length, 35, '고장 난 예제 하나만 빠지고 나머지 15개는 통과로 센다');
    assert.ok(errors.length >= 1 && errors.every((message) => message.startsWith('bfs/diamond.json: ')), '오류는 모두 고장 난 파일의 것이다');
    assert.match(errors[0], /^bfs\/diamond\.json: steps\[3\]\.lines\.python\[0\]: 줄 번호 11가/);
});

test('validateDataDir: catalog가 없거나 비어 있으면 "아무것도 검증하지 않은 통과"를 만들지 않는다', async () => {
    const noCatalog = copyDataDir();
    rmSync(join(noCatalog, 'catalog.json'));
    assert.match((await validateDataDir(noCatalog)).errors[0], /catalog\.json: 파일을 읽을 수 없습니다/);

    const empty = copyDataDir();
    writeFileSync(join(empty, 'catalog.json'), JSON.stringify({ schemaVersion: 1, algorithms: [] }));
    const { errors, checked } = await validateDataDir(empty);
    assert.equal(checked.length, 0);
    assert.match(errors[0], /등록된 예제가 없습니다/);
});

test('validate-traces CLI: 통과하면 종료 코드 0, 실패하면 1이다', () => {
    const run = (dir) => spawnSync(process.execPath, dir ? [SCRIPT, dir] : [SCRIPT], { encoding: 'utf8' });

    const ok = run();
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /✔ bfs\/diamond\.json - bfs-diamond-v4, 22 steps, 언어: c, cpp, java, javascript, kotlin, python, rust/);
    assert.match(ok.stdout, /결과: 통과 36개, 오류 0개/);

    const dir = copyDataDir();
    const bundle = fixture();
    bundle.steps[2].operation = 'teleport';
    writeFileSync(join(dir, 'bfs/diamond.json'), JSON.stringify(bundle));
    const bad = run(dir);
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /✖ bfs\/diamond\.json: steps\[2\]\.operation: 알 수 없는 operation "teleport"/);
    assert.match(bad.stdout, /통과 35개, 오류 1개/);
});
