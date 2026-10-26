// 재생 상태 전이(player-state.js): 범위 고정, 불변성, 이전·다음의 복원, 주소 값의 안전한 해석.
import test from 'node:test';
import assert from 'node:assert/strict';

import { LANGUAGE_IDS, LANGUAGE_LABELS, OPERATIONS, OPERATION_LABELS, ALGORITHM_IDS } from '../../frontend/js/trace-contract.js';
import {
    ACTIONS, canGoNext, canGoPrevious, createPlayerState, describeProgress, getCurrentStep, languageOptions, reducePlayer, resolveSelection, selectView,
} from '../../frontend/js/player-state.js';
import { makeBfsBundle } from './helpers/bfs-bundle.mjs';
import { loadFixture } from './helpers/load-fixture.mjs';

const { catalog, bundle } = await loadFixture();
const LAST = bundle.steps.length - 1; // 21
const act = (type, extra = {}) => ({ type, ...extra });

function walk(state, ...types) {
    return types.reduce((current, type) => reducePlayer(current, act(type)), state);
}

// ---------- createPlayerState ----------

test('처음 상태는 step 0이고 얼려 있다', () => {
    const state = createPlayerState(bundle, 'python');
    assert.deepEqual({ ...state }, {
        algorithmId: 'bfs', exampleId: 'diamond', contentVersion: 'bfs-diamond-v4', languageId: 'python',
        languages: ['python', 'cpp', 'java', 'kotlin', 'rust', 'c', 'javascript'], stepIndex: 0, lastStepIndex: 21, playing: false, speed: 1,
    });
    assert.ok(Object.isFrozen(state));
    assert.ok(Object.isFrozen(state.languages), '고를 수 있는 언어 목록도 바꿀 수 없다');
    assert.equal(canGoPrevious(state), false);
    assert.equal(canGoNext(state), true);
});

test('이 예제에 없는 언어, 문자열이 아닌 언어, 비어 있는 실행 기록은 예외로 거부한다', () => {
    // 코드를 한 언어(Python)만 가진 bundle에서는 다른 언어로 시작할 수 없다.
    const pythonOnly = makeBfsBundle({ A: [] }, 'A');
    assert.throws(() => createPlayerState(pythonOnly, 'javascript'), /JavaScript 코드를 제공하지 않습니다/);
    assert.throws(() => createPlayerState(pythonOnly, 'c'), /C 코드를 제공하지 않습니다/);
    assert.throws(() => createPlayerState(bundle, 'ruby'), RangeError);
    for (const language of [undefined, null, 7, {}, ['python'], '__proto__', 'constructor', 'toString']) {
        assert.throws(() => createPlayerState(bundle, language), RangeError, String(language));
    }
    assert.throws(() => createPlayerState({ ...bundle, steps: [] }, 'python'), TypeError);
    assert.throws(() => createPlayerState(null, 'python'), TypeError);
});

// ---------- reducePlayer ----------

test('NEXT와 PREVIOUS는 한 단계씩 움직인다', () => {
    let state = createPlayerState(bundle, 'python');
    state = reducePlayer(state, act(ACTIONS.NEXT));
    assert.equal(state.stepIndex, 1);
    state = reducePlayer(state, act(ACTIONS.NEXT));
    assert.equal(state.stepIndex, 2);
    state = reducePlayer(state, act(ACTIONS.PREVIOUS));
    assert.equal(state.stepIndex, 1);
    assert.ok(Object.isFrozen(state));
});

test('처음에서 이전, 마지막에서 다음은 범위에 고정되고 같은 상태 객체를 돌려준다', () => {
    const first = createPlayerState(bundle, 'python');
    assert.equal(reducePlayer(first, act(ACTIONS.PREVIOUS)), first);
    assert.equal(reducePlayer(first, act(ACTIONS.RESET)), first);

    const last = reducePlayer(first, act(ACTIONS.SEEK, { index: LAST }));
    assert.equal(last.stepIndex, LAST);
    assert.equal(reducePlayer(last, act(ACTIONS.NEXT)), last);
    assert.equal(canGoNext(last), false);
    assert.equal(canGoPrevious(last), true);
});

test('NEXT를 계속 눌러도 마지막에서 멈추고, PREVIOUS를 계속 눌러도 처음에서 멈춘다', () => {
    let state = createPlayerState(bundle, 'python');
    for (let i = 0; i < LAST + 10; i += 1) state = reducePlayer(state, act(ACTIONS.NEXT));
    assert.equal(state.stepIndex, LAST);
    for (let i = 0; i < LAST + 10; i += 1) state = reducePlayer(state, act(ACTIONS.PREVIOUS));
    assert.equal(state.stepIndex, 0);
});

test('RESET은 어느 단계에서든 step 0으로 돌아간다', () => {
    const middle = walk(createPlayerState(bundle, 'python'), ...Array(9).fill(ACTIONS.NEXT));
    assert.equal(middle.stepIndex, 9);
    assert.equal(reducePlayer(middle, act(ACTIONS.RESET)).stepIndex, 0);
});

test('SEEK: 정수는 범위 안으로 고정하고, 정수가 아니면 무시한다', () => {
    const state = createPlayerState(bundle, 'python');
    const cases = [[5, 5], [0, 0], [LAST, LAST], [LAST + 1, LAST], [9999, LAST], [-1, 0], [-9999, 0]];
    for (const [index, expected] of cases) assert.equal(reducePlayer(state, act(ACTIONS.SEEK, { index })).stepIndex, expected, String(index));

    const at7 = reducePlayer(state, act(ACTIONS.SEEK, { index: 7 }));
    for (const index of [NaN, Infinity, -Infinity, 3.5, '4', null, undefined, {}, [2], true]) {
        assert.equal(reducePlayer(at7, act(ACTIONS.SEEK, { index })), at7, `${String(index)}는 무시해야 합니다`);
    }
    assert.equal(reducePlayer(at7, act(ACTIONS.SEEK)), at7);
});

test('알 수 없는 action은 프로그램의 실수이므로 예외를 던진다', () => {
    const state = createPlayerState(bundle, 'python');
    for (const action of [act('JUMP'), act('next'), act(''), null, undefined, 'NEXT', {}]) {
        assert.throws(() => reducePlayer(state, action), TypeError, JSON.stringify(action));
    }
});

test('전이는 인자(state, action)를 바꾸지 않는다', () => {
    const state = createPlayerState(bundle, 'python');
    const action = Object.freeze(act(ACTIONS.SEEK, { index: 4 }));
    const before = JSON.stringify(state);
    const next = reducePlayer(state, action);
    assert.equal(JSON.stringify(state), before);
    assert.notEqual(next, state);
    assert.throws(() => { next.stepIndex = 0; }, TypeError, '얼린 상태는 직접 바꿀 수 없다');
});

/** 결정적 난수 */
function makeRng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

test('어떤 조작 순서에서도 상태는 단순 산술 모델과 같고 항상 0~마지막 범위 안에 있다', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
        const rng = makeRng(seed);
        let state = createPlayerState(bundle, 'python');
        let model = 0;
        for (let i = 0; i < 300; i += 1) {
            const roll = rng();
            let action;
            if (roll < 0.4) { action = act(ACTIONS.NEXT); model = Math.min(model + 1, LAST); }
            else if (roll < 0.75) { action = act(ACTIONS.PREVIOUS); model = Math.max(model - 1, 0); }
            else if (roll < 0.85) { action = act(ACTIONS.RESET); model = 0; }
            else {
                const index = Math.floor(rng() * 60) - 20; // -20..39: 범위 밖 값을 자주 포함
                action = act(ACTIONS.SEEK, { index });
                model = Math.min(Math.max(index, 0), LAST);
            }
            state = reducePlayer(state, action);
            assert.equal(state.stepIndex, model, `seed ${seed}, ${i}번째 ${action.type}`);
            assert.ok(state.stepIndex >= 0 && state.stepIndex <= LAST);
        }
    }
});

// ---------- 이전·다음의 복원 ----------

test('마지막 → 이전 → 다음을 해도 같은 단계의 같은 스냅샷으로 돌아온다(모든 단계)', () => {
    const start = createPlayerState(bundle, 'python');
    for (let i = 0; i <= LAST; i += 1) {
        const atI = reducePlayer(start, act(ACTIONS.SEEK, { index: i }));
        const viaNext = walk(start, ...Array(i).fill(ACTIONS.NEXT));
        assert.equal(viaNext.stepIndex, i);
        assert.equal(getCurrentStep(bundle, viaNext), getCurrentStep(bundle, atI), `step ${i}: NEXT ${i}번과 SEEK이 같은 스냅샷이어야 합니다`);

        // 마지막까지 갔다가 (LAST - i)번 이전으로 돌아오면 같은 step(같은 객체)이다.
        const atLast = reducePlayer(start, act(ACTIONS.SEEK, { index: LAST }));
        const back = walk(atLast, ...Array(LAST - i).fill(ACTIONS.PREVIOUS));
        assert.equal(getCurrentStep(bundle, back), getCurrentStep(bundle, viaNext), `step ${i}`);

        // 한 단계 이전으로 갔다가 다음으로 오면 제자리다.
        if (i > 0 && i < LAST) {
            const round = walk(viaNext, ACTIONS.PREVIOUS, ACTIONS.NEXT);
            assert.equal(getCurrentStep(bundle, round), getCurrentStep(bundle, viaNext), `step ${i}: 이전 → 다음`);
        }
    }
});

test('끝까지 갔다가 처음까지 되돌리면 모든 step을 같은 순서로 다시 지난다', () => {
    let state = createPlayerState(bundle, 'python');
    const forward = [getCurrentStep(bundle, state)];
    for (let i = 0; i < LAST; i += 1) { state = reducePlayer(state, act(ACTIONS.NEXT)); forward.push(getCurrentStep(bundle, state)); }
    const backward = [getCurrentStep(bundle, state)];
    for (let i = 0; i < LAST; i += 1) { state = reducePlayer(state, act(ACTIONS.PREVIOUS)); backward.push(getCurrentStep(bundle, state)); }
    assert.deepEqual(backward.reverse(), forward);
    forward.forEach((step, i) => assert.equal(step, bundle.steps[i], `step ${i}`));
});

// ---------- 선택자 ----------

test('getCurrentStep은 bundle의 step 객체를 복사 없이 돌려주고, 맞지 않는 상태는 거부한다', () => {
    const state = reducePlayer(createPlayerState(bundle, 'python'), act(ACTIONS.SEEK, { index: 6 }));
    assert.equal(getCurrentStep(bundle, state), bundle.steps[6]);
    assert.ok(Object.isFrozen(getCurrentStep(bundle, state).state), '화면이 받는 상태는 얼려 있어 바꿀 수 없다');

    assert.throws(() => getCurrentStep({ ...bundle, contentVersion: 'bfs-diamond-v999' }, state), /맞지 않습니다/);
    assert.throws(() => getCurrentStep({ ...bundle, exampleId: 'other' }, state), /맞지 않습니다/);
    assert.throws(() => getCurrentStep(bundle, { ...state, stepIndex: LAST + 1 }), RangeError);
    assert.throws(() => getCurrentStep(bundle, { ...state, stepIndex: -1 }), RangeError);
});

test('selectView: 현재 step, 선택한 언어의 코드와 강조할 줄, 진행 상황을 한 번에 돌려준다', () => {
    const state = reducePlayer(createPlayerState(bundle, 'python'), act(ACTIONS.SEEK, { index: 3 }));
    const view = selectView(bundle, state);
    assert.equal(view.step, bundle.steps[3]);
    assert.equal(view.codeLines, bundle.codes.python.lines);
    assert.deepEqual(view.activeLines, [5, 6]);
    assert.equal(view.notes, bundle.codes.python.notes);
    assert.equal(view.progress.label, '단계 3 / 21');
});

test('describeProgress: 처음은 실행 전, 끝은 실행 끝', () => {
    const state = createPlayerState(bundle, 'python');
    assert.deepEqual(describeProgress(state), { index: 0, last: 21, phase: '실행 전', label: '단계 0 / 21', playing: false });
    assert.equal(describeProgress(reducePlayer(state, act(ACTIONS.SEEK, { index: 10 }))).phase, '실행 중');
    assert.equal(describeProgress(reducePlayer(state, act(ACTIONS.SEEK, { index: 21 }))).phase, '실행 끝');
    // 자동 재생 중에는 단계와 상관없이 글자로 알린다(속도도 함께)
    assert.equal(describeProgress(reducePlayer(state, act(ACTIONS.PLAY))).phase, '자동 재생 중 (1배속)');
    assert.equal(describeProgress(reducePlayer(reducePlayer(state, act(ACTIONS.SET_SPEED, { speed: 0.5 })), act(ACTIONS.PLAY))).phase, '자동 재생 중 (0.5배속)');
});

// ---------- 주소(URL)로 선택한 값 ----------

const params = (query) => new URLSearchParams(query);

test('resolveSelection: 주소에 아무것도 없으면 BFS, 첫 예제, Python이며 안내가 없다', () => {
    const selection = resolveSelection(catalog, params(''));
    assert.deepEqual({ ...selection, notices: [...selection.notices] }, { algorithmId: 'bfs', exampleId: 'diamond', languageId: 'python', notices: [] });
    assert.ok(Object.isFrozen(selection));
    assert.deepEqual({ ...resolveSelection(catalog) }.notices, []);
});

test('resolveSelection: catalog에 있는 값은 그대로 쓰고 일반 객체도 받는다', () => {
    const selection = resolveSelection(catalog, params('algorithm=bfs&example=diamond&language=python'));
    assert.deepEqual([selection.algorithmId, selection.exampleId, selection.languageId, selection.notices.length], ['bfs', 'diamond', 'python', 0]);
    const fromObject = resolveSelection(catalog, { algorithm: 'bfs', example: 'diamond', language: 'python' });
    assert.equal(fromObject.exampleId, 'diamond');
});

test('resolveSelection: 없는 알고리즘·예제·언어는 기본값으로 바꾸고 한국어로 알린다', () => {
    const algorithm = resolveSelection(catalog, params('algorithm=quick-sort'));
    assert.equal(algorithm.algorithmId, 'bfs');
    assert.equal(algorithm.notices.length, 1);
    // 제목이 어떤 글자로 끝나는지 알 수 없어 조사는 "을(를)"로 쓴다("BFS"는 "비에프에스"라서 "을"이 틀린다).
    assert.equal(
        algorithm.notices[0],
        '주소에 지정한 알고리즘 “quick-sort”은(는) 사용할 수 없어 기본 알고리즘 “너비 우선 탐색 (BFS)”을(를) 보여 줍니다.',
    );

    const example = resolveSelection(catalog, params('example=nope'));
    assert.equal(example.exampleId, 'diamond');
    assert.match(example.notices[0], /예제 “nope”은\(는\) 사용할 수 없어 기본 예제 “마름모 그래프 \(A→B, A→C, B→D, C→D\)”을\(를\) 보여 줍니다/);

    const language = resolveSelection(catalog, params('language=ruby'));
    assert.equal(language.languageId, 'python');
    assert.match(language.notices[0], /언어 “ruby”은\(는\) 이 예제에서 사용할 수 없어 기본 언어 “Python”을\(를\) 보여 줍니다/);

    // 이 예제에 없는 언어(등록된 언어이지만 이 예제는 제공하지 않음)도 같다.
    const pythonOnly = structuredClone(catalog);
    pythonOnly.algorithms[0].examples[0].languages = ['python'];
    const missing = resolveSelection(pythonOnly, params('language=javascript'));
    assert.equal(missing.languageId, 'python');
    assert.match(missing.notices[0], /언어 “javascript”은\(는\) 이 예제에서 사용할 수 없어 기본 언어 “Python”을\(를\) 보여 줍니다/);
});

test('resolveSelection: 예제가 제공하는 언어(JavaScript, C)는 주소의 값대로 시작 언어가 된다', () => {
    for (const language of ['python', 'javascript', 'c']) {
        const selection = resolveSelection(catalog, params(`language=${language}`));
        assert.equal(selection.languageId, language);
        assert.deepEqual([...selection.notices], []);
    }
    // 대소문자가 다르면 같은 값이 아니다.
    assert.equal(resolveSelection(catalog, params('language=JavaScript')).languageId, 'python');
});

test('resolveSelection: 알고리즘이 기본값으로 바뀌면 그 알고리즘 기준의 예제·언어 값은 안내를 겹쳐 내지 않는다', () => {
    const selection = resolveSelection(catalog, params('algorithm=nope&example=zzz&language=zzz'));
    assert.equal(selection.notices.length, 1);
    assert.equal(selection.exampleId, 'diamond');
    assert.equal(selection.languageId, 'python');
});

test('resolveSelection: 비어 있는 값은 "지정하지 않음"으로 보고 안내하지 않는다', () => {
    assert.equal(resolveSelection(catalog, params('algorithm=&example=&language=')).notices.length, 0);
});

test('resolveSelection: 경로·태그·__proto__ 같은 값을 넣어도 catalog의 값만 돌려주고, 안내 문구는 다듬어 짧게 보여 준다', () => {
    const hostile = [
        '../../etc/passwd', 'bfs/diamond.json', 'https://example.com/x', '<script>alert(1)</script>', '__proto__', 'constructor',
        'toString', 'hasOwnProperty', '%00', 'a\u0000b\nc\td', ' bfs ', 'BFS', 'x'.repeat(5000), '😀'.repeat(100), '‮evil',
    ];
    const ids = new Set(catalog.algorithms.map((a) => a.id));
    const exampleIds = new Set(catalog.algorithms.flatMap((a) => a.examples.map((e) => e.id)));
    for (const value of hostile) {
        const selection = resolveSelection(catalog, params(new URLSearchParams({ algorithm: value, example: value, language: value }).toString()));
        assert.ok(ids.has(selection.algorithmId), value);
        assert.ok(exampleIds.has(selection.exampleId), value);
        assert.equal(selection.languageId, 'python', value); // 위 값들은 모두 지원하는 언어 이름이 아니다
        for (const notice of selection.notices) {
            assert.ok(!/[\u0000-\u001f\u007f]/.test(notice), `제어 문자가 남았습니다: ${JSON.stringify(notice)}`);
            assert.ok([...notice].length < 200, `안내가 너무 깁니다 (${[...notice].length}자)`);
        }
        const quoted = value === 'x'.repeat(5000) ? selection.notices[0] : '';
        if (quoted) assert.ok(quoted.includes('…'), '긴 값은 줄여서 보여 줘야 합니다');
    }
    // 같은 값을 일반 객체로 주어도 안전하다(프로토타입의 값을 읽지 않는다).
    for (const key of ['__proto__', 'constructor', 'toString']) {
        const selection = resolveSelection(catalog, { algorithm: key });
        assert.equal(selection.algorithmId, 'bfs');
    }
});

test('resolveSelection: 예제가 하나도 없는 catalog는 예외로 거부한다', () => {
    for (const broken of [{ schemaVersion: 1, algorithms: [] }, null, {}, { algorithms: 'x' }]) {
        assert.throws(() => resolveSelection(broken, params('')), /등록되어 있지 않습니다/);
    }
});

test('resolveSelection: 무작위 문자열을 넣어도 항상 catalog에 있는 값만 돌려준다', () => {
    const rng = makeRng(7);
    const alphabet = 'abcdefghijklmnopqrstuvwxyz-./%\\ 가나다<>"\'';
    const randomText = () => Array.from({ length: Math.floor(rng() * 12) }, () => alphabet[Math.floor(rng() * alphabet.length)]).join('');
    const ids = new Set(catalog.algorithms.map((a) => a.id));
    for (let i = 0; i < 500; i += 1) {
        const query = new URLSearchParams({ algorithm: randomText(), example: randomText(), language: randomText() });
        const selection = resolveSelection(catalog, query);
        assert.ok(ids.has(selection.algorithmId));
        assert.equal(selection.exampleId, 'diamond');
        // 무작위 문자열이 우연히 "c"가 될 수 있다. 알고리즘 값이 없거나 올바를 때만 주소의 언어를 쓰고, 나머지는 기본 언어다.
        const algorithmKept = ['', 'bfs'].includes(query.get('algorithm'));
        assert.equal(selection.languageId, algorithmKept && ['python', 'javascript', 'c'].includes(query.get('language')) ? query.get('language') : 'python');
    }
});

// ---------- 화면 문구 표 ----------

test('모든 operation과 언어에 화면에 보일 한국어 이름이 있다(표가 어긋나면 새 operation의 이름이 빠진다)', () => {
    for (const algorithmId of ALGORITHM_IDS) {
        assert.deepEqual(Object.keys(OPERATION_LABELS[algorithmId]).sort(), [...OPERATIONS[algorithmId]].sort(), algorithmId);
        for (const label of Object.values(OPERATION_LABELS[algorithmId])) assert.match(label, /[가-힣]/, label);
    }
    assert.deepEqual(Object.keys(LANGUAGE_LABELS).sort(), [...LANGUAGE_IDS].sort());
});

// ---------- 언어 전환(SWITCH_LANGUAGE) ----------

const switchTo = (state, languageId) => reducePlayer(state, act(ACTIONS.SWITCH_LANGUAGE, { languageId }));
const at = (index, language = 'python') => reducePlayer(createPlayerState(bundle, language), act(ACTIONS.SEEK, { index }));

test('SWITCH_LANGUAGE: 처음·중간·마지막 단계에서 언어만 바뀌고 단계·예제·알고리즘은 그대로다', () => {
    for (const index of [0, 1, 9, 10, LAST - 1, LAST]) {
        for (const [from, to] of [['python', 'javascript'], ['javascript', 'c'], ['c', 'python'], ['python', 'c']]) {
            const before = at(index, from);
            const snapshot = JSON.stringify(before);
            const after = switchTo(before, to);
            assert.equal(after.languageId, to, `step ${index} ${from}→${to}`);
            assert.deepEqual(
                { ...after, languageId: from },
                { ...before },
                `step ${index} ${from}→${to}: 언어 외의 모든 값(stepIndex, 예제, 알고리즘, 버전, 언어 목록)이 같아야 한다`,
            );
            assert.ok(Object.isFrozen(after));
            assert.equal(JSON.stringify(before), snapshot, '원래 상태는 바뀌지 않는다');
        }
    }
});

test('SWITCH_LANGUAGE: 같은 언어이거나 이 예제에 없는 값이면 같은 상태 객체를 돌려준다(무시)', () => {
    const state = at(7, 'javascript');
    assert.equal(switchTo(state, 'javascript'), state);
    for (const value of ['ruby', 'Python', 'JAVASCRIPT', ' c', 'c ', '', '__proto__', 'constructor', 'toString', 'hasOwnProperty', undefined, null, 7, {}, ['c'], true]) {
        assert.equal(switchTo(state, value), state, String(value));
    }
    assert.equal(reducePlayer(state, { type: ACTIONS.SWITCH_LANGUAGE }), state, 'languageId 없이 호출해도 상태는 그대로다');
    // 코드를 Python만 가진 bundle이면 다른 언어는 고를 수 없다.
    const pythonOnly = createPlayerState(makeBfsBundle({ A: [] }, 'A'), 'python');
    assert.equal(switchTo(pythonOnly, 'javascript'), pythonOnly);
});

test('SWITCH_LANGUAGE: 언어를 바꾸어도 같은 단계의 그래프 상태·연산·설명은 같은 객체이고 코드·줄·설명만 달라진다', () => {
    const python = createPlayerState(bundle, 'python');
    for (const index of [0, 1, 4, 5, 6, 10, 11, 15, 20, LAST]) {
        const views = Object.fromEntries(['python', 'javascript', 'c'].map((language) => [language, selectView(bundle, switchTo(reducePlayer(python, act(ACTIONS.SEEK, { index })), language))]));
        for (const language of ['javascript', 'c']) {
            const view = views[language];
            assert.equal(view.step, views.python.step, `step ${index} ${language}: 같은 step 객체를 읽는다`);
            assert.equal(view.step.state, views.python.step.state, `step ${index} ${language}: 논리 상태`);
            assert.equal(view.progress.label, views.python.progress.label);
            assert.equal(view.codeLines, bundle.codes[language].lines);
            assert.equal(view.notes, bundle.codes[language].notes);
            assert.deepEqual(view.activeLines, view.step.lines[language]);
            assert.notEqual(view.notes, views.python.notes, `${language}의 설명은 Python의 설명과 달라야 한다`);
            assert.notDeepEqual(view.codeLines, views.python.codeLines);
        }
    }
});

test('SWITCH_LANGUAGE: 언어를 바꾼 뒤의 이동은 그 언어를 유지하고, 언어를 한 바퀴 돌려도 처음 상태로 돌아온다', () => {
    let state = at(5);
    state = switchTo(state, 'c');
    state = walk(state, ACTIONS.NEXT, ACTIONS.NEXT, ACTIONS.PREVIOUS);
    assert.deepEqual([state.languageId, state.stepIndex], ['c', 6]);
    state = reducePlayer(state, act(ACTIONS.RESET));
    assert.deepEqual([state.languageId, state.stepIndex], ['c', 0]);

    const start = at(13);
    const round = switchTo(switchTo(switchTo(start, 'javascript'), 'c'), 'python');
    assert.deepEqual({ ...round }, { ...start });
    assert.equal(getCurrentStep(bundle, round), getCurrentStep(bundle, start));
});

test('SWITCH_LANGUAGE: 이동과 언어 전환을 무작위로 섞어도 단계는 이동으로만 바뀌고 상태는 항상 유효하다', () => {
    let seed = 12345;
    const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    let state = createPlayerState(bundle, 'python');
    let expectedStep = 0;
    for (let i = 0; i < 2000; i += 1) {
        const kind = rand(4);
        if (kind === 0) { state = reducePlayer(state, act(ACTIONS.NEXT)); expectedStep = Math.min(expectedStep + 1, LAST); }
        else if (kind === 1) { state = reducePlayer(state, act(ACTIONS.PREVIOUS)); expectedStep = Math.max(expectedStep - 1, 0); }
        else state = switchTo(state, ['python', 'javascript', 'c', 'ruby'][rand(4)]);
        assert.equal(state.stepIndex, expectedStep, `반복 ${i}`);
        assert.ok(Object.isFrozen(state));
        assert.ok(state.languages.includes(state.languageId));
        assert.doesNotThrow(() => selectView(bundle, state));
    }
});

test('languageOptions: 고를 수 있는 언어를 코드 목록 순서대로, 현재 언어를 표시해 돌려준다', () => {
    assert.deepEqual(languageOptions(createPlayerState(bundle, 'python')), [
        { id: 'python', label: 'Python', selected: true },
        { id: 'cpp', label: 'C++', selected: false },
        { id: 'java', label: 'Java', selected: false },
        { id: 'kotlin', label: 'Kotlin', selected: false },
        { id: 'rust', label: 'Rust', selected: false },
        { id: 'c', label: 'C', selected: false },
        { id: 'javascript', label: 'JavaScript', selected: false },
    ]);
    assert.deepEqual(languageOptions(switchTo(at(3), 'c')).map((o) => [o.id, o.selected]), [['python', false], ['cpp', false], ['java', false], ['kotlin', false], ['rust', false], ['c', true], ['javascript', false]]);
    assert.deepEqual(languageOptions(createPlayerState(makeBfsBundle({ A: [] }, 'A'), 'python')).map((o) => o.id), ['python']);
});

test('알 수 없는 action은 여전히 예외이고, 새 action 이름은 계약에 포함되어 있다', () => {
    assert.throws(() => reducePlayer(at(0), act('SWITCH_LANG')), TypeError);
    assert.equal(ACTIONS.SWITCH_LANGUAGE, 'SWITCH_LANGUAGE');
    assert.ok(Object.isFrozen(ACTIONS));
});

// ---------- 자동 재생(PLAY, PAUSE, SET_SPEED, TICK) ----------

import { DEFAULT_SPEED, SPEEDS, intervalFor } from '../../frontend/js/player-state.js';

const play = (state) => reducePlayer(state, act(ACTIONS.PLAY));
const tick = (state) => reducePlayer(state, act(ACTIONS.TICK));

test('속도: 0.5배는 2초, 1배는 1초, 2배는 0.5초이고 기본은 1배이며, 목록은 바꿀 수 없다', () => {
    assert.deepEqual([...SPEEDS], [0.5, 1, 2]);
    assert.ok(Object.isFrozen(SPEEDS));
    assert.equal(DEFAULT_SPEED, 1);
    assert.deepEqual(SPEEDS.map(intervalFor), [2000, 1000, 500]);
    assert.equal(createPlayerState(bundle, 'python').speed, 1);
});

test('createPlayerState: 속도를 이어받되 목록에 없으면 기본값이고, 재생은 항상 멈춘 채로 시작한다', () => {
    assert.equal(createPlayerState(bundle, 'python', { speed: 2 }).speed, 2);
    assert.equal(createPlayerState(bundle, 'python', { speed: 0.5 }).speed, 0.5);
    for (const speed of [3, 0, -1, '2', NaN, null, Infinity]) assert.equal(createPlayerState(bundle, 'python', { speed }).speed, 1, String(speed));
    assert.equal(createPlayerState(bundle, 'python', { speed: undefined }).speed, 1);
    assert.equal(createPlayerState(bundle, 'python', { speed: 2 }).playing, false);
});

test('PLAY와 PAUSE: 재생 상태만 바꾸고 단계는 그대로이며, 이미 그 상태면 같은 객체를 돌려준다', () => {
    const start = at(5);
    const playing = play(start);
    assert.deepEqual([playing.playing, playing.stepIndex], [true, 5]);
    assert.ok(Object.isFrozen(playing));
    assert.equal(play(playing), playing, '재생 중에 다시 PLAY: 같은 객체(중복 재생 없음)');
    const paused = reducePlayer(playing, act(ACTIONS.PAUSE));
    assert.deepEqual([paused.playing, paused.stepIndex], [false, 5]);
    assert.equal(reducePlayer(paused, act(ACTIONS.PAUSE)), paused, '멈춘 상태에서 PAUSE: 같은 객체');
    assert.equal(reducePlayer(start, act(ACTIONS.PAUSE)), start);
});

test('PLAY: 마지막 단계에서 누르면 처음부터 다시 재생한다', () => {
    const last = at(LAST);
    const replay = play(last);
    assert.deepEqual([replay.stepIndex, replay.playing], [0, true]);
    assert.equal(play(at(0)).stepIndex, 0, '처음에서 재생하면 처음 그대로');
    assert.equal(play(at(LAST - 1)).stepIndex, LAST - 1, '끝 직전에서는 그 자리에서 이어서 재생');
});

test('TICK: 재생 중이면 한 단계 나아가고, 마지막 단계에 닿으면 저절로 멈춘다', () => {
    let state = play(at(0));
    for (let i = 1; i < LAST; i += 1) {
        state = tick(state);
        assert.deepEqual([state.stepIndex, state.playing], [i, true], `tick ${i}`);
    }
    state = tick(state);
    assert.deepEqual([state.stepIndex, state.playing], [LAST, false], '마지막 단계에 닿으면 재생이 멈춘다');
    assert.equal(tick(state), state, '멈춘 뒤의 TICK은 무시한다');
});

test('TICK: 재생 중이 아니면 무시한다(멈춘 뒤에 늦게 도착한 timer callback이 단계를 옮기지 못한다)', () => {
    const paused = reducePlayer(play(at(5)), act(ACTIONS.PAUSE));
    assert.equal(tick(paused), paused);
    const idle = at(5);
    assert.equal(tick(idle), idle);
    // 직접 조작으로 멈춘 뒤에도 마찬가지다
    const afterSeek = reducePlayer(play(at(2)), act(ACTIONS.SEEK, { index: 9 }));
    assert.equal(tick(afterSeek), afterSeek);
    assert.equal(afterSeek.stepIndex, 9);
});

test('직접 한 조작(다음·이전·처음으로·슬라이더 이동·언어 전환)은 재생을 멈추고, 조작한 결과는 그대로 반영된다', () => {
    const playing = play(at(5));
    const next = reducePlayer(playing, act(ACTIONS.NEXT));
    assert.deepEqual([next.stepIndex, next.playing], [6, false]);
    const previous = reducePlayer(playing, act(ACTIONS.PREVIOUS));
    assert.deepEqual([previous.stepIndex, previous.playing], [4, false]);
    const reset = reducePlayer(playing, act(ACTIONS.RESET));
    assert.deepEqual([reset.stepIndex, reset.playing], [0, false]);
    const seek = reducePlayer(playing, act(ACTIONS.SEEK, { index: 12 }));
    assert.deepEqual([seek.stepIndex, seek.playing], [12, false]);
    const sameSeek = reducePlayer(playing, act(ACTIONS.SEEK, { index: 5 }));
    assert.deepEqual([sameSeek.stepIndex, sameSeek.playing], [5, false], '같은 자리로 옮겨도 사용자가 개입한 것이므로 멈춘다');
    const language = switchTo(playing, 'c');
    assert.deepEqual([language.languageId, language.stepIndex, language.playing, language.speed], ['c', 5, false, 1], '언어를 바꾸면 재생이 멈추고 단계·속도는 유지된다');
});

test('아무것도 바꾸지 않는 조작은 재생을 멈추지 않는다(잘못된 SEEK 값, 같은 언어, 없는 언어, 같은 속도, 목록에 없는 속도)', () => {
    const playing = play(at(5));
    for (const index of [NaN, 1.5, '3', null, undefined]) assert.equal(reducePlayer(playing, act(ACTIONS.SEEK, { index })), playing, String(index));
    assert.equal(switchTo(playing, 'python'), playing, '같은 언어');
    for (const value of ['ruby', '__proto__', undefined, null, 7]) assert.equal(switchTo(playing, value), playing, String(value));
    assert.equal(reducePlayer(playing, act(ACTIONS.SET_SPEED, { speed: 1 })), playing, '같은 속도');
    for (const speed of [3, 0, '2', NaN, null, undefined, [], {}, -0.5, 1.0000001]) assert.equal(reducePlayer(playing, act(ACTIONS.SET_SPEED, { speed })), playing, String(speed));
});

test('SET_SPEED: 속도만 바꾸고 재생 중인지·단계는 그대로이며 결과는 얼려 있다', () => {
    for (const playing of [false, true]) {
        const base = playing ? play(at(7)) : at(7);
        for (const speed of [0.5, 2]) {
            const next = reducePlayer(base, act(ACTIONS.SET_SPEED, { speed }));
            assert.deepEqual([next.speed, next.playing, next.stepIndex], [speed, playing, 7]);
            assert.ok(Object.isFrozen(next));
        }
    }
});

test('재생 조작은 원래 상태를 바꾸지 않는다', () => {
    const state = at(5);
    const snapshot = JSON.stringify(state);
    for (const action of [act(ACTIONS.PLAY), act(ACTIONS.PAUSE), act(ACTIONS.TICK), act(ACTIONS.SET_SPEED, { speed: 2 })]) reducePlayer(state, action);
    reducePlayer(play(state), act(ACTIONS.TICK));
    assert.equal(JSON.stringify(state), snapshot);
});

test('무작위 조작 5000번: 단계는 항상 범위 안이고, 재생 중이면 마지막 단계가 아니며, 상태는 항상 얼려 있고 언어·속도가 유효하다', () => {
    let seed = 424242;
    const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const actions = [
        () => act(ACTIONS.NEXT), () => act(ACTIONS.PREVIOUS), () => act(ACTIONS.RESET), () => act(ACTIONS.SEEK, { index: rand(LAST + 6) - 3 }),
        () => act(ACTIONS.PLAY), () => act(ACTIONS.PLAY), () => act(ACTIONS.PAUSE), () => act(ACTIONS.TICK), () => act(ACTIONS.TICK), () => act(ACTIONS.TICK),
        () => act(ACTIONS.SET_SPEED, { speed: [0.5, 1, 2, 3, 0][rand(5)] }), () => act(ACTIONS.SWITCH_LANGUAGE, { languageId: ['python', 'javascript', 'c', 'ruby'][rand(4)] }),
    ];
    let state = createPlayerState(bundle, 'python');
    for (let i = 0; i < 5000; i += 1) {
        const action = actions[rand(actions.length)]();
        const next = reducePlayer(state, action);
        assert.ok(Object.isFrozen(next));
        assert.ok(next.stepIndex >= 0 && next.stepIndex <= LAST, `${i}: 단계 범위`);
        assert.ok(!next.playing || next.stepIndex < LAST, `${i}: 재생 중이면 마지막 단계가 아니다(${action.type})`);
        assert.ok(SPEEDS.includes(next.speed) && next.languages.includes(next.languageId));
        if (action.type === ACTIONS.TICK && !state.playing) assert.equal(next, state, `${i}: 멈춘 상태의 TICK은 무시`);
        if (action.type === ACTIONS.TICK && state.playing) assert.equal(next.stepIndex, state.stepIndex + 1);
        if ([ACTIONS.NEXT, ACTIONS.PREVIOUS, ACTIONS.RESET].includes(action.type)) assert.equal(next.playing, false, `${i}: 직접 이동은 재생을 멈춘다`);
        assert.doesNotThrow(() => selectView(bundle, next));
        state = next;
    }
});
