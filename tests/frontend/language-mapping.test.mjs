// BFS 예제의 세 언어(Python, JavaScript, C) 코드와 줄 매핑을 검사한다.
//
// 아래 표는 bundle이나 테스트 도우미에서 가져오지 않고 손으로 따로 적었다. 줄 번호가 코드 범위 안인지만 보는 것이 아니라,
// 강조되는 줄의 "소스 문장"이 그 operation의 의미와 맞는지를 문장 그대로 비교한다(범위 검사로 의미 검증을 대신하지 않는다).
// 코드를 실제로 실행해 이 매핑이 맞는지 확인하는 테스트는 language-execution.test.mjs에 있다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ACTIONS, createPlayerState, reducePlayer, selectView } from '../../frontend/js/player-state.js';
import { renderCode } from '../../frontend/js/renderers/code.js';
import { renderGraph } from '../../frontend/js/renderers/graph.js';
import { byClass, makeRoot, walk } from './helpers/fake-dom.mjs';
import { DATA_DIR, loadFixture } from './helpers/load-fixture.mjs';

const { bundle } = await loadFixture();
const LANGUAGES = ['python', 'javascript', 'c'];
const LAST = bundle.steps.length - 1;

/** eventId → 언어 → 강조해야 하는 줄 번호. */
const LINE_TABLE = {
    initial: { python: [], javascript: [], c: [] },
    'mark-start': { python: [3], javascript: [2], c: [3, 4] },
    'enqueue-start': { python: [4], javascript: [3, 4], c: [5, 6] },
    'dequeue-node': { python: [5, 6], javascript: [5, 6], c: [7, 8] },
    'check-neighbor': { python: [7, 8], javascript: [7, 8], c: [9, 10, 11] },
    'mark-neighbor': { python: [9], javascript: [9], c: [12] },
    'enqueue-neighbor': { python: [10], javascript: [10], c: [13] },
    'process-node': { python: [7], javascript: [7], c: [9] },
    finish: { python: [5], javascript: [5], c: [7] },
};

/** eventId → 언어 → 강조되는 줄의 소스 문장(앞뒤 공백 제외). operation의 의미를 문장으로 적은 것이다. */
const SOURCE_TABLE = {
    initial: { python: [], javascript: [], c: [] },
    // 시작 노드를 "발견한 노드"로 기록한다
    'mark-start': { python: ['visited = {start}'], javascript: ['const visited = new Set([start]);'], c: ['int visited[N] = {0};', 'visited[start] = 1;'] },
    // 시작 노드를 큐에 넣는다(JS는 큐 맨 앞을 가리키는 head, C는 head·tail 인덱스를 함께 준비한다)
    'enqueue-start': { python: ['queue = deque([start])'], javascript: ['const queue = [start];', 'let head = 0;'], c: ['int head = 0, tail = 0;', 'queue[tail++] = start;'] },
    // 큐가 비어 있지 않은 동안 반복하고, 맨 앞 노드를 꺼낸다
    'dequeue-node': {
        python: ['while queue:', 'node = queue.popleft()'],
        javascript: ['while (head < queue.length) {', 'const node = queue[head++];'],
        c: ['while (head < tail) {', 'int node = queue[head++];'],
    },
    // 현재 노드의 이웃 하나를 고르고 발견하지 않았는지 검사한다
    'check-neighbor': {
        python: ['for nxt in graph[node]:', 'if nxt not in visited:'],
        javascript: ['for (const nxt of graph[node]) {', 'if (!visited.has(nxt)) {'],
        c: ['for (int i = 0; i < deg[node]; i++) {', 'int nxt = adj[node][i];', 'if (!visited[nxt]) {'],
    },
    // 검사한 이웃을 발견한 노드로 기록한다
    'mark-neighbor': { python: ['visited.add(nxt)'], javascript: ['visited.add(nxt);'], c: ['visited[nxt] = 1;'] },
    // 발견한 이웃을 큐 뒤에 넣는다
    'enqueue-neighbor': { python: ['queue.append(nxt)'], javascript: ['queue.push(nxt);'], c: ['queue[tail++] = nxt;'] },
    // 이웃 반복문이 끝나는 지점(더 검사할 이웃이 없다)
    'process-node': { python: ['for nxt in graph[node]:'], javascript: ['for (const nxt of graph[node]) {'], c: ['for (int i = 0; i < deg[node]; i++) {'] },
    // 큐가 비어 바깥 반복문의 조건이 거짓이 되는 지점
    finish: { python: ['while queue:'], javascript: ['while (head < queue.length) {'], c: ['while (head < tail) {'] },
};

/** 어떤 operation에도 연결하지 않는 줄: 선언(함수·import·매크로)과 닫는 중괄호뿐이다. */
const UNMAPPED = { python: [1, 2], javascript: [1, 11, 12, 13, 14], c: [1, 2, 14, 15, 16, 17] };
const DECLARATION = /^(\}|from .+|def .+|function .+|void .+|#define .+)$/;

const textsOf = (language, lines) => lines.map((n) => bundle.codes[language].lines[n - 1].trim());

test('코드 줄 수: 세 언어 모두 계약의 한계 안이고 줄 번호 표가 코드 길이와 맞는다', () => {
    assert.deepEqual(Object.keys(bundle.codes).filter(id => ['python', 'javascript', 'c'].includes(id)).sort(), [...LANGUAGES].sort());
    assert.deepEqual(LANGUAGES.map((language) => bundle.codes[language].lines.length), [10, 14, 17]);
});

test('모든 step의 줄 번호가 손으로 적은 표와 같다(같은 eventId는 같은 줄)', () => {
    for (const step of bundle.steps) {
        assert.ok(Object.hasOwn(LINE_TABLE, step.eventId), `표에 없는 eventId: ${step.eventId}`);
        for (const language of LANGUAGES) {
            assert.deepEqual(step.lines[language], LINE_TABLE[step.eventId][language], `step ${step.index} (${step.eventId}) ${language}`);
        }
    }
    // 표의 모든 eventId가 실제로 쓰였다(쓰이지 않은 항목이 남지 않는다)
    assert.deepEqual([...new Set(bundle.steps.map((step) => step.eventId))].sort(), Object.keys(LINE_TABLE).sort());
});

test('강조되는 줄의 소스 문장이 operation의 의미와 맞다(줄 번호가 범위 안인지만 보지 않는다)', () => {
    for (const step of bundle.steps) {
        for (const language of LANGUAGES) {
            assert.deepEqual(textsOf(language, step.lines[language]), SOURCE_TABLE[step.eventId][language], `step ${step.index} (${step.eventId}) ${language}`);
        }
    }
});

test('operation 이름과 연결된 소스 문장의 종류가 언어와 상관없이 같다', () => {
    const kinds = (language, eventId) => SOURCE_TABLE[eventId][language].map((text) => {
        if (/^while\b/.test(text)) return 'while';
        if (/^for\b/.test(text)) return 'for';
        if (/^if\b/.test(text)) return 'if';
        if (/popleft|queue\[head\+\+\]/.test(text)) return 'pop-front';
        if (/\.add\(|visited\[nxt\] = 1/.test(text)) return 'mark-visited';
        if (/append|push|queue\[tail\+\+\] = nxt/.test(text)) return 'push-back';
        return 'other';
    });
    const pythonKinds = (eventId) => kinds('python', eventId).filter((kind) => kind !== 'other');
    // 위에서 분류하는 종류(반복문, 조건문, 꺼내기, 방문 기록, 뒤에 넣기)는 세 언어에서 같은 operation에 같은 순서로 나온다.
    for (const eventId of ['dequeue-node', 'mark-neighbor', 'enqueue-neighbor', 'process-node', 'finish']) {
        assert.deepEqual(kinds('javascript', eventId).filter((kind) => kind !== 'other'), pythonKinds(eventId), `javascript ${eventId}`);
        assert.deepEqual(kinds('c', eventId).filter((kind) => kind !== 'other'), pythonKinds(eventId), `c ${eventId}`);
    }
    // check-neighbor: 반복문 → (C는 이웃을 꺼내는 대입) → 조건문
    for (const language of LANGUAGES) assert.deepEqual(kinds(language, 'check-neighbor').filter((kind) => kind !== 'other'), ['for', 'if'], language);
});

test('매핑하지 않은 줄은 선언과 닫는 중괄호뿐이고, 나머지 줄은 모두 어떤 operation에 연결되어 있다', () => {
    for (const language of LANGUAGES) {
        const lines = bundle.codes[language].lines;
        const mapped = new Set(bundle.steps.flatMap((step) => step.lines[language]));
        const unmapped = lines.map((_, i) => i + 1).filter((n) => !mapped.has(n));
        assert.deepEqual(unmapped, UNMAPPED[language], language);
        for (const n of unmapped) assert.match(lines[n - 1].trim(), DECLARATION, `${language} ${n}번 줄`);
    }
});

test('같은 operation의 줄 수는 언어마다 다를 수 있고, 그것이 정상이다(줄 하나 = 연산 하나가 아니다)', () => {
    const counts = Object.fromEntries(Object.entries(LINE_TABLE).map(([eventId, perLanguage]) => [eventId, LANGUAGES.map((language) => perLanguage[language].length)]));
    assert.deepEqual(counts['mark-start'], [1, 1, 2]);
    assert.deepEqual(counts['enqueue-start'], [1, 2, 2]);
    assert.deepEqual(counts['check-neighbor'], [2, 2, 3]);
    for (const language of LANGUAGES) {
        const total = bundle.steps.reduce((sum, step) => sum + step.lines[language].length, 0);
        assert.ok(total > 0, language);
    }
});

// ---------- 화면: 세 언어를 오가며 같은 단계를 본다 ----------

function serialize(node) {
    if (node.nodeType === 3) return node.data;
    const attrs = [...node.attributes].map(([key, value]) => `${key}=${value}`).sort().join(' ');
    return `<${node.localName} ${attrs}>${node.childNodes.map(serialize).join('')}</${node.localName}>`;
}

test('처음·중간·마지막 단계에서 언어를 바꾸어도 그래프·큐 상태와 설명은 같고, 코드·강조 줄·설명만 달라진다', () => {
    for (const index of [0, 1, 9, 10, 15, LAST]) {
        const base = reducePlayer(createPlayerState(bundle, 'python'), { type: ACTIONS.SEEK, index });
        const rendered = LANGUAGES.map((language) => {
            const state = reducePlayer(base, { type: ACTIONS.SWITCH_LANGUAGE, languageId: language });
            assert.equal(state.stepIndex, index, `${language}: 단계가 유지된다`);
            const view = selectView(bundle, state);

            const graphRoot = makeRoot();
            renderGraph(graphRoot, bundle.input, view.step.state);
            const codeRoot = makeRoot();
            renderCode(codeRoot, view.codeLines, view.activeLines, { label: `${language} 코드` });
            return { language, view, graph: serialize(graphRoot), codeRoot };
        });

        for (const item of rendered.slice(1)) {
            assert.equal(item.graph, rendered[0].graph, `step ${index} ${item.language}: 그래프·큐 화면이 같아야 한다`);
            assert.equal(item.view.step.message, rendered[0].view.step.message);
            assert.equal(item.view.step.operation, rendered[0].view.step.operation);
            assert.notEqual(item.view.notes, rendered[0].view.notes);
        }

        for (const { language, codeRoot, view } of rendered) {
            const highlighted = byClass(codeRoot, 'hl');
            assert.deepEqual(
                highlighted.map((line) => Number(line.getAttribute('data-line'))),
                view.step.lines[language],
                `step ${index} ${language}: 강조된 줄 번호`,
            );
            const sources = highlighted.map((line) => byClass(line, 'src')[0].textContent.trim());
            assert.deepEqual(sources, SOURCE_TABLE[view.step.eventId][language], `step ${index} ${language}: 강조된 줄의 소스`);
            // 다른 언어의 코드가 섞이지 않는다
            const allSource = byClass(codeRoot, 'src').map((line) => line.textContent);
            assert.deepEqual(allSource, bundle.codes[language].lines, language);
        }
    }
});

test('언어를 바꿔도 코드 영역의 pre 요소를 다시 만들지 않는다(포커스와 스크롤 위치 유지)', () => {
    const root = makeRoot();
    renderCode(root, bundle.codes.python.lines, [3], { label: 'Python 코드' });
    const pre = root.children[0];
    renderCode(root, bundle.codes.javascript.lines, [2], { label: 'JavaScript 코드' });
    renderCode(root, bundle.codes.c.lines, [3, 4], { label: 'C 코드', resetScroll: true });
    assert.equal(root.children.length, 1);
    assert.equal(root.children[0], pre, '같은 pre를 계속 쓴다');
    assert.equal(pre.getAttribute('aria-label'), 'C 코드');
    assert.equal(byClass(root, 'line').length, bundle.codes.c.lines.length);
    let preCount = 0;
    walk(root, (node) => { if (node.localName === 'pre') preCount += 1; });
    assert.equal(preCount, 1);
});

// ---------- 설명(notes) ----------

test('설명: Python은 deque, JavaScript는 head 인덱스, C는 head·tail 배열 큐의 차이를 한국어로 설명한다', () => {
    const { python, javascript, c } = Object.fromEntries(LANGUAGES.map((language) => [language, bundle.codes[language].notes]));
    for (const notes of [python, javascript, c]) assert.match(notes, /[가-힣]/);
    assert.match(python, /deque/);
    assert.match(python, /popleft\(\)/);
    assert.match(javascript, /head/);
    assert.match(javascript, /shift\(\)/);
    assert.match(javascript, /queue\[head\+\+\]/);
    assert.match(c, /head/);
    assert.match(c, /tail/);
    assert.match(c, /adj\[node\]\[i\]/);
    assert.match(c, /deg\[node\]/);
    assert.equal(new Set([python, javascript, c]).size, 3, '세 언어의 설명이 서로 달라야 한다');
});

test('설명: JavaScript 큐는 shift()를 쓰지 않으며, 시간복잡도 설명이 실제 구현과 맞다', () => {
    const code = bundle.codes.javascript.lines.join('\n');
    const notes = bundle.codes.javascript.notes;
    assert.doesNotMatch(code, /\.shift\(/, '코드가 shift()를 쓰면 설명도 함께 고쳐야 한다');
    // shift()를 쓰면서 항상 O(1)이라고 설명하는 일은 없어야 한다. 이 코드는 shift()를 쓰지 않으므로 그런 문장이 없어야 한다.
    assert.doesNotMatch(notes, /shift\(\)[^.。]*O\(1\)|O\(1\)[^.。]*shift\(\)/);
    // 설명이 "원소를 옮기지 않는다"고 말하는 근거: 코드는 head만 늘린다
    assert.match(code, /queue\[head\+\+\]/);
    // 세 언어의 코드가 같은 시간복잡도·메모리 사용을 갖는다고 단정하지 않는다
    for (const language of LANGUAGES) assert.doesNotMatch(bundle.codes[language].notes, /(모든|세) 언어[^.]*(같은|동일)/, language);
});

test('코드가 trace와 같은 이웃 순서를 표현한다: 이웃을 앞에서부터 차례로 검사한다', () => {
    // Python·JavaScript는 이웃 배열을 앞에서부터 순회하고, C는 인덱스 0부터 deg[node] 미만까지 순회한다.
    assert.match(bundle.codes.python.lines.join('\n'), /for nxt in graph\[node\]:/);
    assert.match(bundle.codes.javascript.lines.join('\n'), /for \(const nxt of graph\[node\]\) \{/);
    assert.match(bundle.codes.c.lines.join('\n'), /for \(int i = 0; i < deg\[node\]; i\+\+\) \{/);
    // 그리고 입력 그래프의 이웃 순서가 trace의 check-neighbor 순서와 같다.
    for (const [node, neighbors] of Object.entries(bundle.input.graph)) {
        const checked = [];
        let current = null;
        for (const step of bundle.steps) {
            if (step.operation === 'dequeue') current = step.state.current;
            if (step.operation === 'check-neighbor' && current === node) checked.push(step.state.neighbor);
        }
        assert.deepEqual(checked, neighbors, `${node}의 검사 순서`);
    }
});

// ============================================================================
// DFS · 이분 탐색 · 버블 정렬 (06단계). 아래 표도 코드와 빌더에서 가져오지 않고 손으로 따로 적었다.
// ============================================================================

const OTHER_SOURCE_TABLES = {
    dfs: {
        'call-start': { python: ['def dfs(graph, node, visited):'], javascript: ['function dfs(graph, node, visited) {'], c: ['void dfs(int adj[N][N], int deg[N], int node, int visited[N]) {'] },
        'call-neighbor': {
            python: ['def dfs(graph, node, visited):', 'dfs(graph, nxt, visited)'],
            javascript: ['function dfs(graph, node, visited) {', 'dfs(graph, nxt, visited);'],
            c: ['void dfs(int adj[N][N], int deg[N], int node, int visited[N]) {', 'dfs(adj, deg, nxt, visited);'],
        },
        discover: { python: ['visited.add(node)'], javascript: ['visited.add(node);'], c: ['visited[node] = 1;'] },
        'check-neighbor': {
            python: ['for nxt in graph[node]:', 'if nxt not in visited:'],
            javascript: ['for (const nxt of graph[node]) {', 'if (!visited.has(nxt)) {'],
            c: ['for (int i = 0; i < deg[node]; i++) {', 'int nxt = adj[node][i];', 'if (!visited[nxt]) {'],
        },
        process: { python: ['for nxt in graph[node]:'], javascript: ['for (const nxt of graph[node]) {'], c: ['for (int i = 0; i < deg[node]; i++) {'] },
        // return은 함수가 끝나 돌아오는 순간이라 그 자체로 실행되는 줄이 없다. 처음 호출은 함수 머리 줄, 이웃 호출은 호출한 줄을 보여 준다.
        'return-start': { python: ['def dfs(graph, node, visited):'], javascript: ['function dfs(graph, node, visited) {'], c: ['void dfs(int adj[N][N], int deg[N], int node, int visited[N]) {'] },
        'return-neighbor': { python: ['dfs(graph, nxt, visited)'], javascript: ['dfs(graph, nxt, visited);'], c: ['dfs(adj, deg, nxt, visited);'] },
    },
    'binary-search': {
        'first-mid': {
            python: ['left, right = 0, len(values) - 1', 'while left <= right:', 'mid = (left + right) // 2'],
            javascript: ['let left = 0, right = values.length - 1;', 'while (left <= right) {', 'const mid = Math.floor((left + right) / 2);'],
            c: ['int left = 0, right = n - 1;', 'while (left <= right) {', 'int mid = (left + right) / 2;'],
        },
        'compute-mid': {
            python: ['while left <= right:', 'mid = (left + right) // 2'],
            javascript: ['while (left <= right) {', 'const mid = Math.floor((left + right) / 2);'],
            c: ['while (left <= right) {', 'int mid = (left + right) / 2;'],
        },
        'compare-equal': { python: ['if values[mid] == target:'], javascript: ['if (values[mid] === target) {'], c: ['if (values[mid] == target) {'] },
        // 같지 않으면 같은지 먼저 검사(5번)하고 그다음 작은지 검사(7번)한다. 작은지·큰지는 이 두 번째 검사 결과로 갈린다.
        'compare-smaller': {
            python: ['if values[mid] == target:', 'elif values[mid] < target:'],
            javascript: ['if (values[mid] === target) {', '} else if (values[mid] < target) {'],
            c: ['if (values[mid] == target) {', '} else if (values[mid] < target) {'],
        },
        'compare-larger': {
            python: ['if values[mid] == target:', 'elif values[mid] < target:'],
            javascript: ['if (values[mid] === target) {', '} else if (values[mid] < target) {'],
            c: ['if (values[mid] == target) {', '} else if (values[mid] < target) {'],
        },
        found: { python: ['return mid'], javascript: ['return mid;'], c: ['return mid;'] },
        'set-left': { python: ['left = mid + 1'], javascript: ['left = mid + 1;'], c: ['left = mid + 1;'] },
        'set-right': { python: ['right = mid - 1'], javascript: ['right = mid - 1;'], c: ['right = mid - 1;'] },
        'first-finish': {
            python: ['left, right = 0, len(values) - 1', 'while left <= right:', 'return -1'],
            javascript: ['let left = 0, right = values.length - 1;', 'while (left <= right) {', 'return -1;'],
            c: ['int left = 0, right = n - 1;', 'while (left <= right) {', 'return -1;'],
        },
        finish: { python: ['while left <= right:', 'return -1'], javascript: ['while (left <= right) {', 'return -1;'], c: ['while (left <= right) {', 'return -1;'] },
    },
    'bubble-sort': {
        'first-compare': {
            python: ['n = len(values)', 'for i in range(n - 1):', 'for j in range(n - 1 - i):', 'if values[j] > values[j + 1]:'],
            javascript: ['const n = values.length;', 'for (let i = 0; i < n - 1; i++) {', 'for (let j = 0; j < n - 1 - i; j++) {', 'if (values[j] > values[j + 1]) {'],
            c: ['for (int i = 0; i < n - 1; i++) {', 'for (int j = 0; j < n - 1 - i; j++) {', 'if (values[j] > values[j + 1]) {'],
        },
        'pass-compare': {
            python: ['for i in range(n - 1):', 'for j in range(n - 1 - i):', 'if values[j] > values[j + 1]:'],
            javascript: ['for (let i = 0; i < n - 1; i++) {', 'for (let j = 0; j < n - 1 - i; j++) {', 'if (values[j] > values[j + 1]) {'],
            c: ['for (int i = 0; i < n - 1; i++) {', 'for (int j = 0; j < n - 1 - i; j++) {', 'if (values[j] > values[j + 1]) {'],
        },
        compare: {
            python: ['for j in range(n - 1 - i):', 'if values[j] > values[j + 1]:'],
            javascript: ['for (let j = 0; j < n - 1 - i; j++) {', 'if (values[j] > values[j + 1]) {'],
            c: ['for (int j = 0; j < n - 1 - i; j++) {', 'if (values[j] > values[j + 1]) {'],
        },
        swap: {
            python: ['values[j], values[j + 1] = values[j + 1], values[j]'],
            javascript: ['[values[j], values[j + 1]] = [values[j + 1], values[j]];'],
            c: ['int tmp = values[j];', 'values[j] = values[j + 1];', 'values[j + 1] = tmp;'],
        },
        // 안쪽 반복이 끝나는 지점(더 비교할 쌍이 없다)
        'mark-sorted': { python: ['for j in range(n - 1 - i):'], javascript: ['for (let j = 0; j < n - 1 - i; j++) {'], c: ['for (int j = 0; j < n - 1 - i; j++) {'] },
        // 바깥 반복이 끝나는 지점(더 할 패스가 없다)
        finish: { python: ['for i in range(n - 1):'], javascript: ['for (let i = 0; i < n - 1; i++) {'], c: ['for (int i = 0; i < n - 1; i++) {'] },
        'finish-empty': {
            python: ['n = len(values)', 'for i in range(n - 1):'],
            javascript: ['const n = values.length;', 'for (let i = 0; i < n - 1; i++) {'],
            c: ['for (int i = 0; i < n - 1; i++) {'],
        },
    },
};

/** 어떤 operation에도 연결하지 않는 줄: 선언, 닫는 중괄호, 실행 중에 따로 멈추지 않는 else 줄뿐이다. */
const OTHER_UNMAPPED = {
    dfs: { python: [], javascript: [6, 7, 8], c: [1, 8, 9, 10] },
    'binary-search': { python: [1, 9], javascript: [1, 9, 11, 12, 14], c: [1, 9, 11, 12, 14] },
    'bubble-sort': { python: [1], javascript: [1, 7, 8, 9, 10], c: [1, 8, 9, 10, 11] },
};
const OTHER_DECLARATION = /^(\}|\} else \{|else:|def .+|function .+|void .+|int .+\) \{|#define .+)$/;

const catalogExamples = () => JSON.parse(readFileSync(join(DATA_DIR, 'catalog.json'), 'utf8')).algorithms.flatMap((algorithm) => algorithm.examples.map((example) => ({ algorithmId: algorithm.id, exampleId: example.id })));
const EXAMPLES_BY_ALGORITHM = [...catalogExamples().reduce((groups, item) => groups.set(item.algorithmId, [...(groups.get(item.algorithmId) ?? []), item]), new Map())];

for (const [algorithmId, items] of EXAMPLES_BY_ALGORITHM.filter(([id]) => Object.hasOwn(OTHER_SOURCE_TABLES, id))) {
    const table = OTHER_SOURCE_TABLES[algorithmId];

    test(`[${algorithmId}] 강조되는 줄의 소스 문장이 operation의 의미와 맞다(모든 예제의 모든 단계, 세 언어)`, async () => {
        const seen = new Set();
        for (const { exampleId } of items) {
            const { bundle: loaded } = await loadFixture(algorithmId, exampleId);
            for (const step of loaded.steps) {
                assert.ok(Object.hasOwn(table, step.eventId) || step.eventId === 'initial', `${exampleId}: 표에 없는 eventId ${step.eventId}`);
                for (const language of LANGUAGES) {
                    const sources = step.eventId === 'initial' ? [] : table[step.eventId][language];
                    const actual = step.lines[language].map((n) => loaded.codes[language].lines[n - 1].trim());
                    assert.deepEqual(actual, sources, `${algorithmId}/${exampleId} step ${step.index} (${step.eventId}) ${language}`);
                }
                seen.add(step.eventId);
            }
        }
        // 표의 모든 eventId가 어떤 예제에서든 실제로 쓰였다(쓰이지 않은 항목이 남지 않는다)
        assert.deepEqual([...seen].filter((id) => id !== 'initial').sort(), Object.keys(table).sort(), '표와 예제의 eventId가 같아야 한다');
    });

    test(`[${algorithmId}] 매핑하지 않은 줄은 선언·닫는 중괄호·else뿐이고, 나머지 줄은 모두 어떤 operation에 연결되어 있다`, async () => {
        const mapped = Object.fromEntries(LANGUAGES.map((language) => [language, new Set()]));
        let codes;
        for (const { exampleId } of items) {
            const { bundle: loaded } = await loadFixture(algorithmId, exampleId);
            codes = loaded.codes;
            for (const step of loaded.steps) for (const language of LANGUAGES) for (const n of step.lines[language]) mapped[language].add(n);
        }
        for (const language of LANGUAGES) {
            const lines = codes[language].lines;
            const unmapped = lines.map((_, i) => i + 1).filter((n) => !mapped[language].has(n));
            assert.deepEqual(unmapped, OTHER_UNMAPPED[algorithmId][language], `${algorithmId} ${language}`);
            for (const n of unmapped) assert.match(lines[n - 1].trim(), OTHER_DECLARATION, `${algorithmId} ${language} ${n}번 줄`);
        }
    });

    test(`[${algorithmId}] 세 언어를 오가도 단계·상태가 같고 코드·강조 줄·설명만 달라진다`, async () => {
        const { bundle: loaded } = await loadFixture(algorithmId, items[0].exampleId);
        const last = loaded.steps.length - 1;
        for (const index of [0, 1, Math.floor(last / 2), last]) {
            const base = reducePlayer(createPlayerState(loaded, 'python'), { type: ACTIONS.SEEK, index });
            const views = LANGUAGES.map((language) => selectView(loaded, reducePlayer(base, { type: ACTIONS.SWITCH_LANGUAGE, languageId: language })));
            for (const view of views.slice(1)) {
                assert.equal(view.step, views[0].step, `step ${index}`);
                assert.notEqual(view.notes, views[0].notes);
                assert.notDeepEqual(view.codeLines, views[0].codeLines);
            }
            views.forEach((view, i) => assert.deepEqual(view.activeLines, view.step.lines[LANGUAGES[i]]));
        }
    });
}

test('[dfs] 호출·복귀의 표시 줄: 처음 호출과 마지막 복귀는 함수 머리 줄, 이웃 호출과 복귀는 호출한 줄을 보여 준다(복귀는 별도 실행 줄이 없다)', async () => {
    for (const language of LANGUAGES) {
        const { bundle: loaded } = await loadFixture('dfs', 'basic');
        const text = (step) => step.lines[language].map((n) => loaded.codes[language].lines[n - 1].trim());
        const first = loaded.steps.find((step) => step.eventId === 'call-start');
        const last = loaded.steps.at(-1);
        assert.equal(last.eventId, 'return-start');
        assert.deepEqual(text(first), text(last), `${language}: 처음 호출과 마지막 복귀가 같은 줄`);
        const callNeighbor = loaded.steps.find((step) => step.eventId === 'call-neighbor');
        const returnNeighbor = loaded.steps.find((step) => step.eventId === 'return-neighbor');
        assert.ok(text(callNeighbor).includes(text(returnNeighbor)[0]), `${language}: 복귀는 호출한 줄을 보여 준다`);
    }
});

test('설명(notes): DFS는 호출 스택, 이분 탐색은 구간·내림 나눗셈, 버블 정렬은 교환 방식과 sortedFrom을 한국어로 설명한다', async () => {
    const checks = {
        dfs: [[/호출 스택/, /nextNeighborIndex/, /visited/], [/호출 스택/, /nextNeighborIndex/, /Set/], [/스택 프레임/, /deg\[node\]/, /visited\[x\]/]],
        'binary-search': [[/양끝을 포함/, /\/\/ 2/, /첫 번째 위치라는 보장은 없습니다/], [/Math\.floor/, /실수 나눗셈/, /첫 번째 위치라는 보장은 없습니다/], [/정수 나눗셈/, /left \+ \(right - left\) \/ 2/, /그중 하나의 인덱스/]],
        'bubble-sort': [[/sortedFrom/, /같은 값은 교환하지 않습니다/], [/구조 분해 대입/, /sortedFrom/], [/tmp/, /n - 1이 -1/, /sortedFrom/]],
    };
    for (const [algorithmId, perLanguage] of Object.entries(checks)) {
        const { bundle: loaded } = await loadFixture(algorithmId, EXAMPLES_BY_ALGORITHM.find(([id]) => id === algorithmId)[1][0].exampleId);
        LANGUAGES.forEach((language, i) => {
            for (const pattern of perLanguage[i]) assert.match(loaded.codes[language].notes, pattern, `${algorithmId} ${language}`);
        });
        assert.equal(new Set(LANGUAGES.map((language) => loaded.codes[language].notes)).size, 3, `${algorithmId}: 세 언어의 설명이 서로 달라야 한다`);
    }
});
