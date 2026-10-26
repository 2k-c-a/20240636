import { EXTRA_CODES, EXTRA_EVENT_LINES } from '../../../scripts/extra-language-traces.mjs';
// 테스트용 BFS trace 생성기. 계약 §4.1의 전이 규칙을 그대로 따라 "정답" trace를 만든다.
// 이 파일은 테스트가 아니므로 node --test가 직접 실행하지 않는다.

export const PYTHON_BFS = [
    'from collections import deque',
    'def bfs(graph, start):',
    '    visited = {start}',
    '    queue = deque([start])',
    '    while queue:',
    '        node = queue.popleft()',
    '        for nxt in graph[node]:',
    '            if nxt not in visited:',
    '                visited.add(nxt)',
    '                queue.append(nxt)',
];

export const JAVASCRIPT_BFS = [
    'function bfs(graph, start) {',
    '    const visited = new Set([start]);',
    '    const queue = [start];',
    '    let head = 0;',
    '    while (head < queue.length) {',
    '        const node = queue[head++];',
    '        for (const nxt of graph[node]) {',
    '            if (!visited.has(nxt)) {',
    '                visited.add(nxt);',
    '                queue.push(nxt);',
    '            }',
    '        }',
    '    }',
    '}',
];

export const C_BFS = [
    '#define N 4',
    'void bfs(int adj[N][N], int deg[N], int start, int queue[N]) {',
    '    int visited[N] = {0};',
    '    visited[start] = 1;',
    '    int head = 0, tail = 0;',
    '    queue[tail++] = start;',
    '    while (head < tail) {',
    '        int node = queue[head++];',
    '        for (int i = 0; i < deg[node]; i++) {',
    '            int nxt = adj[node][i];',
    '            if (!visited[nxt]) {',
    '                visited[nxt] = 1;',
    '                queue[tail++] = nxt;',
    '            }',
    '        }',
    '    }',
    '}',
];

export const CPP_BFS = [
    "#include <vector>",
    "#include <queue>",
    "void bfs(const std::vector<std::vector<int>>& graph, int start) {",
    "    std::vector<bool> visited(graph.size(), false);",
    "    visited[start] = true;",
    "    std::queue<int> queue;",
    "    queue.push(start);",
    "    while (!queue.empty()) {",
    "        int node = queue.front();",
    "        queue.pop();",
    "        for (int nxt : graph[node]) {",
    "            if (!visited[nxt]) {",
    "                visited[nxt] = true;",
    "                queue.push(nxt);",
    "            }",
    "        }",
    "    }",
    "}"
];

export const BFS_CODE_LINES = { cpp: CPP_BFS, python: PYTHON_BFS, javascript: JAVASCRIPT_BFS, c: C_BFS };

/** eventId -> 언어별 실행 줄. 같은 eventId는 모든 step에서 같은 줄을 가리킨다(R5). */
export const EVENT_LINES_BY_LANGUAGE = {
    cpp: {"initial":[],"mark-start":[4,5],"enqueue-start":[6,7],"dequeue-node":[8,9,10],"check-neighbor":[11,12],"mark-neighbor":[13],"enqueue-neighbor":[14],"process-node":[11],"finish":[8]},
    python: {
        initial: [], 'mark-start': [3], 'enqueue-start': [4], 'dequeue-node': [5, 6], 'check-neighbor': [7, 8],
        'mark-neighbor': [9], 'enqueue-neighbor': [10], 'process-node': [7], finish: [5],
    },
    javascript: {
        initial: [], 'mark-start': [2], 'enqueue-start': [3, 4], 'dequeue-node': [5, 6], 'check-neighbor': [7, 8],
        'mark-neighbor': [9], 'enqueue-neighbor': [10], 'process-node': [7], finish: [5],
    },
    c: {
        initial: [], 'mark-start': [3, 4], 'enqueue-start': [5, 6], 'dequeue-node': [7, 8], 'check-neighbor': [9, 10, 11],
        'mark-neighbor': [12], 'enqueue-neighbor': [13], 'process-node': [9], finish: [7],
    },
};
for (const language of ['java', 'kotlin', 'rust']) {
    BFS_CODE_LINES[language] = EXTRA_CODES[language].bfs.lines;
    EVENT_LINES_BY_LANGUAGE[language] = EXTRA_EVENT_LINES[language].bfs;
}
export const EVENT_LINES = EVENT_LINES_BY_LANGUAGE.python;

/**
 * @param {object} graph
 * @param {string} start
 * @param {object} [layout]
 * @param {string[]} [languages]  bundle에 넣을 언어. 기본은 Python 하나(대부분의 테스트가 쓰는 작은 bundle).
 */
export function makeBfsBundle(graph, start, layout, languages = ['python']) {
    const nodes = Object.keys(graph);
    layout ??= Object.fromEntries(nodes.map((node, i) => [node, { x: 10 + ((i * 8) % 80), y: 10 + ((i * 13) % 80) }]));
    const state = { discovered: [], processed: [], queue: [], current: null, neighbor: null };
    const steps = [];
    const emit = (eventId, operation, message) => steps.push({
        index: steps.length, eventId, operation,
        lines: Object.fromEntries(languages.map((language) => [language, [...EVENT_LINES_BY_LANGUAGE[language][eventId]]])),
        state: structuredClone(state), message,
    });

    emit('initial', 'initial', '실행 전 상태입니다.');
    state.discovered.push(start);
    emit('mark-start', 'discover', '시작 노드를 발견했습니다.');
    state.queue.push(start);
    emit('enqueue-start', 'enqueue', '시작 노드를 큐에 넣습니다.');
    while (state.queue.length > 0) {
        state.current = state.queue.shift();
        state.neighbor = null;
        emit('dequeue-node', 'dequeue', '큐 앞에서 노드를 꺼냅니다.');
        for (const neighbor of graph[state.current]) {
            state.neighbor = neighbor;
            emit('check-neighbor', 'check-neighbor', '이웃을 검사합니다.');
            if (!state.discovered.includes(neighbor)) {
                state.discovered.push(neighbor);
                emit('mark-neighbor', 'discover', '이웃을 발견했습니다.');
                state.queue.push(neighbor);
                emit('enqueue-neighbor', 'enqueue', '이웃을 큐에 넣습니다.');
            }
        }
        state.processed.push(state.current);
        state.current = null;
        state.neighbor = null;
        emit('process-node', 'process', '노드의 처리를 마칩니다.');
    }
    emit('finish', 'finish', '큐가 비어 종료합니다.');

    return {
        schemaVersion: 1, contentVersion: 'bfs-test-v1', algorithmId: 'bfs', exampleId: 'test',
        input: { directed: true, graph, start, layout },
        codes: Object.fromEntries(languages.map((language) => [language, { lines: [...BFS_CODE_LINES[language]], notes: '테스트용 설명입니다.' }])),
        steps,
    };
}

/** step 목록에서 검증 결과를 좌우하는 (operation, 상태)만 뽑는다. */
export const coreOf = (steps) => steps.map((step) => ({ operation: step.operation, state: step.state }));
