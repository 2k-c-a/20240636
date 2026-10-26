// 시각화에 보여 주는 세 언어의 코드를 "실제로 실행해서" 줄 매핑과 결과가 맞는지 확인한다. 네 알고리즘(BFS, DFS, 이분 탐색, 버블 정렬) 모두 같은 방식이다.
//
// 코드는 등록된 bundle에서 그대로 가져온다. 입력을 바꿔 가며 실행하고, 실행된 줄의 순서가 bundle의 step 순서대로 이어 붙인
// 매핑 줄과 같은지 비교한다. 같은 eventId는 항상 같은 줄을 가리키므로(계약 R5), 어떤 입력에서든 기대하는 줄 순서는
// "그 입력에서 알고리즘이 내는 eventId 순서(scripts/trace-builders.mjs) × bundle의 eventId별 줄"로 정해진다.
//
//   Python      sys.settrace로 함수 안에서 실행된 줄을 순서대로 기록한다(원본 그대로).
//   JavaScript  V8 인스펙터로 한 문장씩 실행하며 멈춘 줄을 기록한다(원본 그대로).
//   C           (1) 원본을 gcc로 컴파일해 gcov로 줄마다 실행된 횟수를 확인한다. gcov는 순서를 알려 주지 않는다.
//               (2) 줄 순서는 문장 앞에 탐침을 넣은 "사본"으로 확인한다. 원본이 아니라 사본을 실행한 결과다.
//
// 실행으로 볼 수 없는 것(아래 EXECUTION에 명시): 함수 머리 줄(Python·JavaScript의 추적기는 이 줄에서 멈추지 않는다)과, 그 자체로
// 실행되는 줄이 없는 DFS의 return 단계(호출한 줄을 보여 줄 뿐이다). 이 둘은 줄 순서·횟수 비교에서 빼고, 사람이 읽는 의미 표
// (language-mapping.test.mjs)로 검토한다.
//
// 실행기(python, gcc+gcov, Node의 WebSocket)가 없으면 해당 테스트는 이유와 함께 건너뛴다. 건너뛴 것은 통과가 아니다.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EXAMPLES, buildSteps } from '../../scripts/trace-builders.mjs';
import { lineTraceUnavailableReason } from './helpers/js-line-trace.mjs';
import { findC, findPython, instrumentC, runCWithCoverage, runCWithProbes, runJavaScript, runPython } from './helpers/language-runners.mjs';
import { DATA_DIR } from './helpers/load-fixture.mjs';

const LANGUAGES = ['python', 'javascript', 'c'];
const ALGORITHMS = ['bfs', 'dfs', 'binary-search', 'bubble-sort'];
const python = findPython();
const c = findC();
const jsReason = lineTraceUnavailableReason();

const dirs = [];
const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'lang-exec-'));
    dirs.push(dir);
    return dir;
};
after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

/** 건너뛰는 이유를 테스트 이름과 함께 보여 준다. 조건이 맞으면 undefined(= 실행). */
const skipUnless = (reason) => (reason ? { skip: `실행하지 않음: ${reason}` } : {});

const readBundle = (algorithmId, exampleId) => JSON.parse(readFileSync(join(DATA_DIR, `${algorithmId}/${exampleId}.json`), 'utf8'));
const bundlesOf = (algorithmId) => EXAMPLES.filter((item) => item.algorithmId === algorithmId).map((item) => readBundle(algorithmId, item.id));
/**
 * 알고리즘의 eventId별 줄(언어별). 등록된 예제 전체에서 모은다(예제마다 쓰는 eventId가 다르다).
 * 같은 eventId가 예제마다 다른 줄을 가리키면 예외를 던진다. 코드는 첫 예제의 것이다(C의 #define N만 예제마다 다르다).
 */
function bundleOf(algorithmId) {
    const bundles = bundlesOf(algorithmId);
    const eventLines = Object.fromEntries(LANGUAGES.map((language) => [language, new Map()]));
    for (const bundle of bundles) {
        for (const step of bundle.steps) {
            for (const language of LANGUAGES) {
                const known = eventLines[language].get(step.eventId);
                if (known !== undefined && JSON.stringify(known) !== JSON.stringify(step.lines[language])) {
                    throw new Error(`${algorithmId}/${bundle.exampleId}: eventId ${step.eventId}의 ${language} 줄이 다른 예제와 다릅니다`);
                }
                eventLines[language].set(step.eventId, step.lines[language]);
            }
        }
    }
    return { codes: bundles[0].codes, eventLines };
}
const dedup = (values) => values.filter((value, i) => i === 0 || value !== values[i - 1]);

/** 실행으로 볼 수 없는 것. */
const EXECUTION = {
    bfs: { headerLines: { python: [], javascript: [], c: [] }, unobservableEvents: [] },
    dfs: { headerLines: { python: [1], javascript: [1], c: [2] }, unobservableEvents: ['return-start', 'return-neighbor'] },
    'binary-search': { headerLines: { python: [], javascript: [], c: [] }, unobservableEvents: [] },
    'bubble-sort': { headerLines: { python: [], javascript: [], c: [] }, unobservableEvents: [] },
};
/**
 * C 함수의 머리 줄과 닫는 줄. 함수가 불린 횟수(entries)만큼 실행된다.
 * 값을 돌려주는 함수(이분 탐색)는 return 문이 함수를 끝내므로 gcov가 닫는 줄을 실행 줄로 알리지 않는다(null).
 */
const C_FUNCTION_LINES = { bfs: [2, 17], dfs: [2, 10], 'binary-search': [1, null], 'bubble-sort': [1, 11] };

const GRAPH_INPUTS = {
    diamond: { A: ['B', 'C'], B: ['D'], C: ['D'], D: [] },
    'reverse-order': { A: ['D', 'B'], B: ['E'], C: [], D: ['C', 'E'], E: ['A', 'F'], F: [] }, // 이웃 순서가 이름 순서가 아니다
    cycle: { A: ['B'], B: ['C', 'A'], C: ['A'] },
    'self-loop': { A: ['A', 'B'], B: ['B'] },
    unreachable: { A: ['B'], B: [], X: ['A'] },
    'dead-end-only': { A: [] },
    chain: { A: ['B'], B: ['C'], C: ['D'], D: ['E'], E: [] },
    'start-not-first': { A: ['B'], B: ['C'], C: [], D: ['A', 'B'] },
    'shared-and-deep': { A: ['B', 'C'], B: ['D', 'C'], C: ['E'], D: ['E', 'F'], E: [], F: ['A'] },
};
const withStart = (graph, start) => ({ directed: true, graph, start, layout: Object.fromEntries(Object.keys(graph).map((node, i) => [node, { x: 10 + i * 8, y: 10 + i * 8 }])) });
const graphInputs = () => Object.entries(GRAPH_INPUTS).map(([name, graph]) => [name, withStart(graph, name === 'start-not-first' ? 'D' : 'A')]);

const INPUTS = {
    bfs: graphInputs(),
    dfs: graphInputs(),
    'binary-search': [
        ['빈 배열', { values: [], target: 5 }],
        ['하나, 있음', { values: [7], target: 7 }],
        ['하나, 없음(작음)', { values: [7], target: 3 }],
        ['하나, 없음(큼)', { values: [7], target: 9 }],
        ['가운데', { values: [1, 3, 5, 7, 9, 11, 13], target: 7 }],
        ['맨 앞', { values: [1, 3, 5, 7, 9, 11, 13], target: 1 }],
        ['맨 뒤', { values: [1, 3, 5, 7, 9, 11, 13], target: 13 }],
        ['사이 값(없음)', { values: [1, 3, 5, 7, 9, 11, 13], target: 8 }],
        ['범위 밖(없음)', { values: [1, 3, 5, 7, 9, 11], target: 100 }],
        ['중복', { values: [1, 2, 2, 2, 3, 4], target: 2 }],
        ['전부 같은 값', { values: [5, 5, 5, 5], target: 5 }],
        ['음수', { values: [-9, -4, -4, 0, 3], target: -4 }],
        ['20개', { values: Array.from({ length: 20 }, (_, i) => i * 3 - 10), target: 41 }],
    ],
    'bubble-sort': [
        ['빈 배열', { values: [] }],
        ['하나', { values: [1] }],
        ['둘, 정렬됨', { values: [1, 2] }],
        ['둘, 거꾸로', { values: [2, 1] }],
        ['기본', { values: [5, 1, 4, 2, 8] }],
        ['이미 정렬됨', { values: [1, 2, 3, 4] }],
        ['역순', { values: [9, 8, 7, 6, 5, 4, 3, 2] }],
        ['같은 값', { values: [2, 2, 2] }],
        ['음수와 중복', { values: [3, -1, 3, 0, -1] }],
    ],
};

/** 입력에서 알고리즘이 내는 단계와, 그 단계들이 실행하는 줄(언어별, 실행으로 볼 수 있는 것만), 코드가 돌려줘야 하는 결과. */
function expectationFor(algorithmId, input, bundle) {
    const spec = EXECUTION[algorithmId];
    const steps = buildSteps(algorithmId, input);
    const last = steps.at(-1).state;
    const tables = Object.fromEntries(LANGUAGES.map((language) => [language, Object.fromEntries(bundle.eventLines[language])]));
    const outcome = {
        bfs: { order: steps.filter((step) => step.operation === 'dequeue').map((step) => step.state.current), discovered: last.discovered },
        dfs: { order: last.discovered, discovered: last.discovered },
        'binary-search': { result: last.result },
        'bubble-sort': { result: last.values },
    }[algorithmId];
    return {
        steps,
        outcome,
        entries: algorithmId === 'dfs' ? steps.filter((step) => step.operation === 'call').length : 1,
        observable: (language) => steps.slice(1).flatMap((step) => (spec.unobservableEvents.includes(step.eventId)
            ? []
            : tables[language][step.eventId].filter((line) => !spec.headerLines[language].includes(line)))),
    };
}

const everyInput = (algorithmId, check) => {
    const bundle = bundleOf(algorithmId);
    for (const [name, input] of INPUTS[algorithmId]) check(name, input, bundle, expectationFor(algorithmId, input, bundle));
};

/** Python·JavaScript가 돌려준 값(탐색 순서 또는 결과)을 기대와 비교한다. */
function assertOutcome(actual, outcome, name) {
    if (outcome.order !== undefined) assert.deepEqual(actual.order, outcome.order, `${name}: 탐색 순서`);
    else assert.deepEqual(actual.result, outcome.result, `${name}: 결과`);
}

test('기준 확인: 등록된 예제의 step에서 얻은 줄이 빌더가 만든 기대 줄과 같다', () => {
    for (const example of EXAMPLES) {
        const bundle = bundleOf(example.algorithmId);
        const own = readBundle(example.algorithmId, example.id);
        const expected = expectationFor(example.algorithmId, example.input, bundle); // eventId별 줄은 모든 예제에서 모은 것
        const spec = EXECUTION[example.algorithmId];
        for (const language of LANGUAGES) {
            const fromData = own.steps.slice(1).flatMap((step) => (spec.unobservableEvents.includes(step.eventId) ? [] : step.lines[language].filter((line) => !spec.headerLines[language].includes(line))));
            assert.deepEqual(expected.observable(language), fromData, `${example.algorithmId}/${example.id} ${language}`);
        }
    }
});

for (const algorithmId of ALGORITHMS) {
    test(`[${algorithmId}] Python: 코드를 실제로 실행해 실행된 줄의 순서가 매핑과 정확히 같고 결과가 맞다${python.reason ? '' : ` (${python.command})`}`, skipUnless(python.reason), () => {
        everyInput(algorithmId, (name, input, bundle, expected) => {
            const actual = runPython(python, tempDir(), algorithmId, bundle.codes.python.lines, input);
            assert.deepEqual(actual.lines, expected.observable('python'), `${name}: 실행된 줄 순서`);
            assertOutcome(actual, expected.outcome, name);
        });
    });

    test(`[${algorithmId}] JavaScript: V8 인스펙터로 실제 실행 줄을 따라가 매핑과 같은 순서로 실행되고 결과가 맞다`, skipUnless(jsReason), async () => {
        const bundle = bundleOf(algorithmId);
        for (const [name, input] of INPUTS[algorithmId]) {
            const expected = expectationFor(algorithmId, input, bundle);
            const actual = await runJavaScript(tempDir(), algorithmId, bundle.codes.javascript.lines, input);
            // V8은 한 줄의 여러 위치에서 멈출 수 있어 같은 줄의 연속 멈춤은 한 번으로 합쳐 비교한다(기대하는 쪽도 같게 합친다).
            assert.deepEqual(actual.lines, dedup(expected.observable('javascript')), `${name}: 실행된 줄 순서`);
            assertOutcome(actual, expected.outcome, name);
        }
    });

    test(`[${algorithmId}] C: 원본이 경고 없이 컴파일되고(-Wall -Wextra), gcov 줄 실행 횟수가 매핑에서 센 횟수와 같고 결과가 맞다`, skipUnless(c.reason), () => {
        everyInput(algorithmId, (name, input, bundle, expected) => {
            const lines = bundle.codes.c.lines;
            const [headerLine, closingLine] = C_FUNCTION_LINES[algorithmId];
            const run = runCWithCoverage(c, tempDir(), algorithmId, lines, input);
            assert.equal(run.warnings, '', `${name}: 컴파일 경고`);

            const wanted = new Map();
            for (const line of expected.observable('c')) wanted.set(line, (wanted.get(line) ?? 0) + 1);
            // 아래의 driver(main)는 제외한다. gcov는 한 번도 실행되지 않은 줄을 횟수 0으로 알려 주므로 "횟수가 없는 줄"과 같게 본다.
            const actual = new Map([...run.counts].filter(([line, count]) => line <= lines.length && count > 0));
            // 함수의 머리 줄과 닫는 줄은 함수가 불린 횟수만큼 실행된다(재귀 DFS는 호출 횟수).
            assert.equal(actual.get(headerLine), expected.entries, `${name}: 함수 머리 줄(${headerLine}) 횟수 = 함수 호출 횟수`);
            if (closingLine === null) assert.equal(actual.get(lines.length), undefined, `${name}: 값을 돌려주는 함수의 닫는 줄은 실행 줄이 아니다`);
            else assert.equal(actual.get(closingLine), expected.entries, `${name}: 함수를 닫는 줄(${closingLine}) 횟수 = 함수 호출 횟수`);
            for (const map of [actual, wanted]) {
                map.delete(headerLine);
                if (closingLine !== null) map.delete(closingLine);
            }
            assert.deepEqual([...actual].sort((a, b) => a[0] - b[0]), [...wanted].sort((a, b) => a[0] - b[0]), `${name}: 줄별 실행 횟수`);

            const { outcome } = expected;
            if (algorithmId === 'bfs') assert.deepEqual(run.result, outcome.discovered, `${name}: 결과(queue 배열)`);
            else if (algorithmId === 'dfs') assert.deepEqual(run.result, Object.keys(input.graph).filter((node) => outcome.discovered.includes(node)), `${name}: 발견한 노드(visited 배열)`);
            else assert.deepEqual(run.result, outcome.result, `${name}: 결과`);
        });
    });

    test(`[${algorithmId}] C: 탐침을 넣은 사본을 실행하면 줄 실행 순서가 매핑과 정확히 같다`, skipUnless(c.reason), () => {
        everyInput(algorithmId, (name, input, bundle, expected) => {
            // DFS는 발견을 기록하는 줄(visited[node] = 1;)에서 node를 함께 기록해 발견 순서도 확인한다.
            const watchLine = algorithmId === 'dfs' ? bundle.codes.c.lines.findIndex((line) => line.trim() === 'visited[node] = 1;') + 1 : null;
            const actual = runCWithProbes(c, tempDir(), algorithmId, bundle.codes.c.lines, input, { watch: watchLine === null ? {} : { [watchLine]: 'node' } });
            assert.deepEqual(actual.lines, expected.observable('c'), `${name}: 실행된 줄 순서`);
            const { outcome } = expected;
            if (algorithmId === 'bfs') assert.deepEqual(actual.result, outcome.discovered, `${name}: 결과(queue 배열)`);
            else if (algorithmId === 'dfs') assert.deepEqual(actual.watched.map((index) => actual.nodes[index]), outcome.order, `${name}: 발견한 순서`);
            else assert.deepEqual(actual.result, outcome.result, `${name}: 결과`);
        });
    });
}

// ---------- 세 언어의 결과 비교 ----------

test('세 언어의 코드가 모든 알고리즘·입력에서 같은 결과를 낸다(시각화의 최종 상태와도 같다)', skipUnless(python.reason ?? c.reason ?? jsReason), async () => {
    for (const algorithmId of ALGORITHMS) {
        const bundle = bundleOf(algorithmId);
        for (const [name, input] of INPUTS[algorithmId]) {
            const { outcome } = expectationFor(algorithmId, input, bundle);
            const py = runPython(python, tempDir(), algorithmId, bundle.codes.python.lines, input);
            const js = await runJavaScript(tempDir(), algorithmId, bundle.codes.javascript.lines, input);
            const cc = runCWithCoverage(c, tempDir(), algorithmId, bundle.codes.c.lines, input);
            const label = `${algorithmId} ${name}`;
            if (outcome.order !== undefined) {
                assert.deepEqual(py.order, outcome.order, `${label}: Python과 시각화`);
                assert.deepEqual(js.order, py.order, `${label}: JavaScript와 Python`);
                const reached = algorithmId === 'bfs' ? outcome.discovered : Object.keys(input.graph).filter((node) => outcome.discovered.includes(node));
                assert.deepEqual(cc.result, reached, `${label}: C의 결과`);
            } else {
                assert.deepEqual(py.result, outcome.result, `${label}: Python과 시각화`);
                assert.deepEqual(js.result, py.result, `${label}: JavaScript와 Python`);
                assert.deepEqual(cc.result, py.result, `${label}: C와 Python`);
            }
        }
    }
});

test('실행 검증이 걸러 내는 것: 일부러 어긋나게 만든 매핑은 실행 결과와 맞지 않는다(음성 대조)', skipUnless(python.reason), () => {
    for (const algorithmId of ALGORITHMS) {
        const bundle = bundleOf(algorithmId);
        const [name, input] = INPUTS[algorithmId].find(([, item]) => (item.graph ? Object.keys(item.graph).length > 3 : item.values.length > 3));
        const expected = expectationFor(algorithmId, input, bundle);
        const actual = runPython(python, tempDir(), algorithmId, bundle.codes.python.lines, input).lines;
        const lines = expected.observable('python');
        assert.deepEqual(actual, lines, `${algorithmId} ${name}: 올바른 매핑은 같다`);
        const wrong = lines.map((line) => (line === lines[1] ? lines[0] : line)); // 한 줄을 다른 줄로 바꾼다
        assert.notDeepEqual(actual, wrong, `${algorithmId}: 어긋난 매핑은 달라야 한다`);
    }
});

test('C 탐침: 줄 수와 코드 구조는 그대로이고, 알아보지 못하는 줄이 생기면 예외를 던진다', () => {
    for (const algorithmId of ALGORITHMS) {
        const bundle = bundleOf(algorithmId);
        const original = bundle.codes.c.lines;
        const probed = instrumentC(original);
        assert.equal(probed.length, original.length, algorithmId);
        // 탐침 호출과 괄호를 걷어내면 원본의 문장과 같다(로직을 바꾸지 않고 줄 번호만 기록한다).
        const strip = (line) => line.replace(/\(?P\(\d+\)[;,] ?/g, '').replace(/[()]/g, '');
        const used = new Set([...bundle.eventLines.c.values()].flat());
        probed.forEach((line, i) => {
            assert.equal(strip(line), strip(original[i]), `${algorithmId} ${i + 1}번 줄`);
            const probes = [...line.matchAll(/P\((\d+)\)/g)].map((match) => Number(match[1]));
            assert.ok(probes.length <= 1 && probes.every((n) => n === i + 1), `${algorithmId} ${i + 1}번 줄의 탐침 번호: ${probes}`);
            // 탐침이 들어가는 줄은 어떤 operation의 줄로 쓰이는 줄이다(함수 머리·닫는 줄·#define·else는 아니다).
            if (probes.length > 0) assert.ok(used.has(i + 1), `${algorithmId}: ${i + 1}번 줄은 매핑에 쓰이지 않는데 탐침이 있습니다`);
        });
    }
    const original = bundleOf('bfs').codes.c.lines;
    assert.throws(() => instrumentC([...original.slice(0, 3), '    switch (start) {', ...original.slice(4)]), /탐침을 넣는 방법을 모르는 C 줄/);
});
