// 시각화 예제(trace bundle)를 만드는 빌더. 알고리즘마다 지원 언어의 코드·설명·줄 매핑, 입력에서 단계(step)를 만드는 함수,
// 등록할 예제 목록을 가진다. scripts/generate-traces.mjs가 이 빌더로 frontend/js/data를 만들고,
// 테스트는 같은 빌더를 "기대하는 단계 순서"를 얻는 데 쓴다.
//
// 이 빌더가 만든 단계가 맞는지는 이 파일과 상관없는 두 가지가 확인한다.
//   1) 검증기(trace-validator.js)의 상태·전이 규칙과, 입력에서 따로 계산한 정답(reference) 비교
//   2) 보여 주는 코드를 실제로 실행해 얻은 줄 실행 순서와 결과(tests/frontend/language-execution.test.mjs)
//
// 주의: 코드나 줄 매핑을 고치면 `node scripts/generate-traces.mjs`로 data를 다시 만들고 contentVersion을 올린다.

import { LANGUAGE_IDS } from '../frontend/js/trace-contract.js';
import { CPP_CODES, CPP_EVENT_LINES } from './cpp-traces.mjs';
import { EXTRA_CODES, EXTRA_EVENT_LINES } from './extra-language-traces.mjs';
import { GRID_EXAMPLES, LEARNING_EXAMPLES, LEARNING_TITLES } from './learning-traces.mjs';

export const LANGUAGES = LANGUAGE_IDS;

// ---------- 문장 도구 ----------

/** 영문 한 글자 노드 이름 뒤의 조사. 이름을 한국어로 읽었을 때 받침이 있는 글자는 L(엘) M(엠) N(엔) R(알)뿐이다. */
const FINAL_CONSONANT_LETTERS = new Set(['L', 'M', 'N', 'R', 'l', 'm', 'n', 'r']);
const hasFinal = (name) => FINAL_CONSONANT_LETTERS.has(name[name.length - 1]);
const obj = (name) => `${name}${hasFinal(name) ? '을' : '를'}`;
const subj = (name) => `${name}${hasFinal(name) ? '이' : '가'}`;
const ordinal = (k) => (k === 0 ? '첫' : '다음');

const clone = (value) => structuredClone(value);

// ============================================================================
// BFS
// ============================================================================

const BFS_CODES = {
    python: {
        lines: [
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
        ],
        notes: 'visited는 코드의 집합이며 trace의 discovered와 대응합니다. queue는 collections.deque이고 popleft()는 맨 앞 원소를 O(1)에 꺼냅니다. '
            + 'processed는 학습용 보조 상태라서 코드에 변수가 없습니다. 노드의 이웃을 모두 검사해 for 반복이 끝나는 지점(7번 줄)에서 처리 완료로 표시합니다.',
    },
    javascript: {
        lines: [
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
        ],
        notes: 'visited는 Set이며 trace의 discovered와 대응합니다. queue는 배열이고 shift()를 쓰지 않습니다. 대신 head 인덱스가 맨 앞 원소를 가리키며 queue[head++]로 읽고 head만 늘리므로 꺼낼 때 원소를 옮기지 않습니다. '
            + '꺼낸 원소도 배열에 남으므로 화면의 큐는 queue 전체가 아니라 head부터 끝까지입니다. processed는 학습용 보조 상태라서 코드에 변수가 없으며, for…of 반복이 끝나는 지점(7번 줄)에서 처리 완료로 표시합니다.',
    },
    c: {
        lines: [
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
        ],
        notes: '노드 A, B, C, D는 0, 1, 2, 3으로 나타내며 adj[node][i]는 node의 i번째 이웃, deg[node]는 이웃의 수입니다. visited[x]가 1이면 발견한 노드(trace의 discovered)입니다. '
            + '큐는 배열 하나와 head·tail 두 인덱스이며, 꺼내면 head만 늘어나 꺼낸 원소도 배열에 남으므로 화면의 큐는 queue[head]부터 queue[tail - 1]까지입니다(발견한 순서는 queue 배열에 남습니다). '
            + 'processed는 학습용 보조 상태라서 코드에 변수가 없으며, for 반복이 끝나는 지점(9번 줄)에서 처리 완료로 표시합니다.',
    },
};

const BFS_EVENT_LINES = {
    python: { initial: [], 'mark-start': [3], 'enqueue-start': [4], 'dequeue-node': [5, 6], 'check-neighbor': [7, 8], 'mark-neighbor': [9], 'enqueue-neighbor': [10], 'process-node': [7], finish: [5] },
    javascript: { initial: [], 'mark-start': [2], 'enqueue-start': [3, 4], 'dequeue-node': [5, 6], 'check-neighbor': [7, 8], 'mark-neighbor': [9], 'enqueue-neighbor': [10], 'process-node': [7], finish: [5] },
    c: { initial: [], 'mark-start': [3, 4], 'enqueue-start': [5, 6], 'dequeue-node': [7, 8], 'check-neighbor': [9, 10, 11], 'mark-neighbor': [12], 'enqueue-neighbor': [13], 'process-node': [9], finish: [7] },
};

function buildBfs({ graph, start }) {
    const state = { discovered: [], processed: [], queue: [], current: null, neighbor: null };
    const steps = [];
    const emit = (eventId, operation, message) => steps.push({ eventId, operation, state: clone(state), message });

    emit('initial', 'initial', '실행 전 상태입니다.');
    state.discovered.push(start);
    emit('mark-start', 'discover', `시작 노드 ${obj(start)} 발견한 노드로 기록합니다.`);
    state.queue.push(start);
    emit('enqueue-start', 'enqueue', `발견한 ${obj(start)} 큐에 넣습니다.`);

    while (state.queue.length > 0) {
        const node = state.queue.shift();
        state.current = node;
        state.neighbor = null;
        emit('dequeue-node', 'dequeue', `큐 앞에서 ${obj(node)} 꺼내 현재 노드로 삼습니다.`);

        graph[node].forEach((neighbor, k) => {
            state.neighbor = neighbor;
            const fresh = !state.discovered.includes(neighbor);
            emit('check-neighbor', 'check-neighbor',
                `${node}의 ${ordinal(k)} 이웃 ${obj(neighbor)} 검사합니다. ${fresh ? '아직 발견하지 않은 노드입니다.' : '이미 발견한 노드라서 건너뜁니다.'}`);
            if (fresh) {
                state.discovered.push(neighbor);
                emit('mark-neighbor', 'discover', `${obj(neighbor)} 발견한 노드로 기록합니다.`);
                state.queue.push(neighbor);
                emit('enqueue-neighbor', 'enqueue', `발견한 ${obj(neighbor)} 큐 뒤에 넣습니다.`);
            }
        });

        state.processed.push(node);
        state.current = null;
        state.neighbor = null;
        emit('process-node', 'process', graph[node].length === 0
            ? `${node}에는 이웃이 없습니다. ${node}의 처리를 마칩니다.`
            : `${node}의 이웃을 모두 검사했습니다. ${node}의 처리를 마칩니다.`);
    }
    emit('finish', 'finish', '큐가 비었으므로 반복을 끝냅니다. 시작 노드에서 갈 수 있는 모든 노드를 처리했습니다.');
    return steps;
}

// ============================================================================
// DFS (재귀)
// ============================================================================

const DFS_CODES = {
    python: {
        lines: [
            'def dfs(graph, node, visited):',
            '    visited.add(node)',
            '    for nxt in graph[node]:',
            '        if nxt not in visited:',
            '            dfs(graph, nxt, visited)',
        ],
        notes: 'visited는 집합이며 trace의 discovered와 대응합니다. dfs를 다시 부를 때마다 호출 스택에 한 칸이 쌓이고(frames), 함수가 끝나면 한 칸이 빠집니다. '
            + 'nextNeighborIndex는 for 반복이 다음에 볼 이웃의 위치입니다. frames와 processed는 학습용 표시라서 코드에 변수가 없으며, for 반복이 끝나는 지점(3번 줄)에서 처리 완료로 표시합니다. '
            + '처음 호출 dfs(graph, start, set())은 이 코드 밖에서 합니다. Python은 재귀 깊이에 제한(기본 약 1000)이 있습니다.',
    },
    javascript: {
        lines: [
            'function dfs(graph, node, visited) {',
            '    visited.add(node);',
            '    for (const nxt of graph[node]) {',
            '        if (!visited.has(nxt)) {',
            '            dfs(graph, nxt, visited);',
            '        }',
            '    }',
            '}',
        ],
        notes: 'visited는 Set이며 trace의 discovered와 대응합니다. dfs를 다시 부를 때마다 호출 스택에 한 칸이 쌓이고(frames), 함수가 끝나면 한 칸이 빠집니다. '
            + 'nextNeighborIndex는 for…of 반복이 다음에 볼 이웃의 위치입니다. frames와 processed는 학습용 표시라서 코드에 변수가 없으며, for…of 반복이 끝나는 지점(3번 줄)에서 처리 완료로 표시합니다. '
            + '처음 호출 dfs(graph, start, new Set())은 이 코드 밖에서 합니다. 호출 스택이 너무 깊어지면 오류가 나므로 아주 깊은 그래프에는 반복문 방식이 필요합니다.',
    },
    c: {
        lines: [
            '#define N 4',
            'void dfs(int adj[N][N], int deg[N], int node, int visited[N]) {',
            '    visited[node] = 1;',
            '    for (int i = 0; i < deg[node]; i++) {',
            '        int nxt = adj[node][i];',
            '        if (!visited[nxt]) {',
            '            dfs(adj, deg, nxt, visited);',
            '        }',
            '    }',
            '}',
        ],
        notes: '노드 A, B, C, …는 0, 1, 2, …로 나타내며 adj[node][i]는 node의 i번째 이웃, deg[node]는 이웃의 수입니다. visited[x]가 1이면 발견한 노드(trace의 discovered)입니다. '
            + 'dfs를 다시 부를 때마다 C의 호출 스택에 한 칸(스택 프레임)이 쌓이고(frames), 함수가 끝나면 빠집니다. 변수 i는 for 반복이 다음에 볼 이웃의 위치(nextNeighborIndex)에 해당합니다. '
            + 'frames와 processed는 학습용 표시라서 코드에 변수가 없으며, for 반복이 끝나는 지점(4번 줄)에서 처리 완료로 표시합니다. 처음 호출 dfs(adj, deg, start, visited)는 이 코드 밖에서 합니다.',
    },
};

// return-*은 함수가 끝나 호출한 곳으로 돌아오는 순간이라 그 자체로 실행되는 줄이 없다. 호출한 줄(또는 함수 머리 줄)을 보여 준다.
const DFS_EVENT_LINES = {
    python: { initial: [], 'call-start': [1], 'call-neighbor': [1, 5], discover: [2], 'check-neighbor': [3, 4], process: [3], 'return-start': [1], 'return-neighbor': [5] },
    javascript: { initial: [], 'call-start': [1], 'call-neighbor': [1, 5], discover: [2], 'check-neighbor': [3, 4], process: [3], 'return-start': [1], 'return-neighbor': [5] },
    c: { initial: [], 'call-start': [2], 'call-neighbor': [2, 7], discover: [3], 'check-neighbor': [4, 5, 6], process: [4], 'return-start': [2], 'return-neighbor': [7] },
};

function buildDfs({ graph, start }) {
    const state = { frames: [], discovered: [], processed: [], current: null };
    const steps = [];
    const emit = (eventId, operation, message) => steps.push({ eventId, operation, state: clone(state), message });
    const top = () => state.frames[state.frames.length - 1];

    emit('initial', 'initial', '실행 전 상태입니다.');

    const visit = (node, from) => {
        state.frames.push({ node, nextNeighborIndex: 0 });
        state.current = node;
        emit(from === null ? 'call-start' : 'call-neighbor', 'call', from === null
            ? `시작 노드 ${node}에 대해 dfs를 처음 호출합니다. 호출 스택에 ${subj(node)} 쌓입니다.`
            : `${from}에서 이웃 ${node}로 dfs를 호출합니다. 호출 스택에 ${subj(node)} 쌓입니다.`);

        state.discovered.push(node);
        emit('discover', 'discover', `${obj(node)} 발견한 노드로 기록합니다.`);

        graph[node].forEach((neighbor, k) => {
            top().nextNeighborIndex = k + 1;
            const fresh = !state.discovered.includes(neighbor);
            emit('check-neighbor', 'check-neighbor',
                `${node}의 ${ordinal(k)} 이웃 ${obj(neighbor)} 검사합니다. ${fresh ? '아직 발견하지 않았으므로 바로 호출합니다.' : '이미 발견한 노드라서 건너뜁니다.'}`);
            if (fresh) visit(neighbor, node);
        });

        state.processed.push(node);
        emit('process', 'process', graph[node].length === 0
            ? `${node}에는 이웃이 없습니다. ${node}의 처리를 마칩니다.`
            : `${node}의 이웃을 모두 검사했습니다. ${node}의 처리를 마칩니다.`);

        state.frames.pop();
        state.current = state.frames.length > 0 ? top().node : null;
        emit(from === null ? 'return-start' : 'return-neighbor', 'return', from === null
            ? `${node}의 호출이 끝났습니다. 호출 스택이 비어 탐색을 마칩니다.`
            : `${node}의 호출이 끝나 ${from}로 돌아갑니다. 호출 스택에서 ${subj(node)} 빠집니다.`);
    };
    visit(start, null);
    return steps;
}

// ============================================================================
// 이분 탐색
// ============================================================================

const BINARY_SEARCH_CODES = {
    python: {
        lines: [
            'def binary_search(values, target):',
            '    left, right = 0, len(values) - 1',
            '    while left <= right:',
            '        mid = (left + right) // 2',
            '        if values[mid] == target:',
            '            return mid',
            '        elif values[mid] < target:',
            '            left = mid + 1',
            '        else:',
            '            right = mid - 1',
            '    return -1',
        ],
        notes: 'left와 right는 양끝을 포함하는 구간입니다. mid = (left + right) // 2는 정수 나눗셈(내림)입니다. 같은 값이 여러 개면 그중 하나의 인덱스를 돌려주며 첫 번째 위치라는 보장은 없습니다. '
            + '찾지 못하면 -1을 돌려줍니다. else 줄(9번)은 실행 중에 따로 멈추는 줄이 아니라서 강조하지 않고 right = mid - 1(10번)만 강조합니다.',
    },
    javascript: {
        lines: [
            'function binarySearch(values, target) {',
            '    let left = 0, right = values.length - 1;',
            '    while (left <= right) {',
            '        const mid = Math.floor((left + right) / 2);',
            '        if (values[mid] === target) {',
            '            return mid;',
            '        } else if (values[mid] < target) {',
            '            left = mid + 1;',
            '        } else {',
            '            right = mid - 1;',
            '        }',
            '    }',
            '    return -1;',
            '}',
        ],
        notes: 'left와 right는 양끝을 포함하는 구간입니다. JavaScript의 /는 실수 나눗셈이라서 Math.floor로 내림해 정수 인덱스를 만듭니다. 같은 값이 여러 개면 그중 하나의 인덱스를 돌려주며 첫 번째 위치라는 보장은 없습니다. '
            + '찾지 못하면 -1을 돌려줍니다. else 줄(9번)은 실행 중에 따로 멈추는 줄이 아니라서 강조하지 않고 right = mid - 1(10번)만 강조합니다.',
    },
    c: {
        lines: [
            'int binary_search(const int values[], int n, int target) {',
            '    int left = 0, right = n - 1;',
            '    while (left <= right) {',
            '        int mid = (left + right) / 2;',
            '        if (values[mid] == target) {',
            '            return mid;',
            '        } else if (values[mid] < target) {',
            '            left = mid + 1;',
            '        } else {',
            '            right = mid - 1;',
            '        }',
            '    }',
            '    return -1;',
            '}',
        ],
        notes: 'C는 배열의 길이를 알 수 없어서 n을 함께 받습니다. int끼리의 /는 소수점 아래를 버리는 정수 나눗셈이며, 이 코드에서는 left와 right가 음수가 아니라서 내림과 같습니다. '
            + '배열이 아주 크면 left + right가 int 범위를 넘을 수 있어 left + (right - left) / 2를 쓰지만 이 예제는 입력이 작아 결과가 같습니다. 같은 값이 여러 개면 그중 하나의 인덱스를 돌려줍니다.',
    },
};

const BINARY_SEARCH_EVENT_LINES = {
    python: {
        initial: [], 'first-mid': [2, 3, 4], 'compute-mid': [3, 4], 'compare-equal': [5], 'compare-smaller': [5, 7], 'compare-larger': [5, 7],
        found: [6], 'set-left': [8], 'set-right': [10], 'first-finish': [2, 3, 11], finish: [3, 11],
    },
    javascript: {
        initial: [], 'first-mid': [2, 3, 4], 'compute-mid': [3, 4], 'compare-equal': [5], 'compare-smaller': [5, 7], 'compare-larger': [5, 7],
        found: [6], 'set-left': [8], 'set-right': [10], 'first-finish': [2, 3, 13], finish: [3, 13],
    },
    c: {
        initial: [], 'first-mid': [2, 3, 4], 'compute-mid': [3, 4], 'compare-equal': [5], 'compare-smaller': [5, 7], 'compare-larger': [5, 7],
        found: [6], 'set-left': [8], 'set-right': [10], 'first-finish': [2, 3, 13], finish: [3, 13],
    },
};

function buildBinarySearch({ values, target }) {
    const state = { values: [...values], target, left: 0, right: values.length - 1, mid: null, result: null };
    const steps = [];
    const emit = (eventId, operation, message) => steps.push({ eventId, operation, state: clone(state), message });
    const range = () => (state.left <= state.right ? `인덱스 ${state.left}~${state.right}` : '없음');

    emit('initial', 'initial', values.length === 0
        ? '실행 전 상태입니다. 배열이 비어 있어 left = 0, right = -1입니다.'
        : `실행 전 상태입니다. 인덱스 0~${values.length - 1} 전체에서 target = ${target} 찾기를 시작합니다.`);

    let first = true;
    for (;;) {
        if (state.left > state.right) {
            state.mid = null;
            state.result = -1;
            emit(first ? 'first-finish' : 'finish', 'finish', first
                ? `배열이 비어 있어 처음부터 구간이 없습니다(left = ${state.left} > right = ${state.right}). 찾는 값이 없으므로 result = -1입니다.`
                : `구간이 비었습니다(left = ${state.left} > right = ${state.right}). 찾는 값이 없으므로 result = -1입니다.`);
            return steps;
        }
        state.mid = Math.floor((state.left + state.right) / 2);
        emit(first ? 'first-mid' : 'compute-mid', 'compute-mid',
            `중간 위치를 계산합니다: mid = (${state.left} + ${state.right}) // 2 = ${state.mid}.`);
        first = false;

        const value = state.values[state.mid];
        const where = `values[${state.mid}] = ${value}, target = ${target}`;
        if (value === target) {
            emit('compare-equal', 'compare', `${where}: 두 값이 같습니다.`);
            const found = state.mid;
            state.result = found;
            state.mid = null;
            emit('found', 'found', `찾았습니다: values[${found}] = ${target}. result = ${found}.`);
            return steps;
        }
        if (value < target) {
            emit('compare-smaller', 'compare', `${where}: ${value} < ${target}, 찾는 값은 오른쪽에 있습니다.`);
            state.left = state.mid + 1;
            emit('set-left', 'set-left', `left = mid + 1 = ${state.left}. 남은 구간: ${range()}.`);
        } else {
            emit('compare-larger', 'compare', `${where}: ${value} > ${target}, 찾는 값은 왼쪽에 있습니다.`);
            state.right = state.mid - 1;
            emit('set-right', 'set-right', `right = mid - 1 = ${state.right}. 남은 구간: ${range()}.`);
        }
    }
}

// ============================================================================
// 버블 정렬
// ============================================================================

const BUBBLE_SORT_CODES = {
    python: {
        lines: [
            'def bubble_sort(values):',
            '    n = len(values)',
            '    for i in range(n - 1):',
            '        for j in range(n - 1 - i):',
            '            if values[j] > values[j + 1]:',
            '                values[j], values[j + 1] = values[j + 1], values[j]',
        ],
        notes: '바깥 반복 i는 패스(한 바퀴) 횟수이고, 안쪽 반복 j는 인접한 두 원소 values[j]와 values[j + 1]을 비교합니다. 앞의 값이 더 클 때만 맞바꾸므로 같은 값은 교환하지 않습니다. '
            + '한 패스가 끝날 때마다 가장 큰 값이 뒤쪽에 확정되며(sortedFrom), sortedFrom은 학습용 표시라서 코드에 변수가 없습니다. 조기 종료가 없는 기본형이라 정렬된 입력에서도 모든 비교를 합니다.',
    },
    javascript: {
        lines: [
            'function bubbleSort(values) {',
            '    const n = values.length;',
            '    for (let i = 0; i < n - 1; i++) {',
            '        for (let j = 0; j < n - 1 - i; j++) {',
            '            if (values[j] > values[j + 1]) {',
            '                [values[j], values[j + 1]] = [values[j + 1], values[j]];',
            '            }',
            '        }',
            '    }',
            '}',
        ],
        notes: '바깥 반복 i는 패스(한 바퀴) 횟수이고, 안쪽 반복 j는 인접한 두 원소 values[j]와 values[j + 1]을 비교합니다. 교환은 구조 분해 대입으로 한 줄에 합니다. 앞의 값이 더 클 때만 맞바꾸므로 같은 값은 교환하지 않습니다. '
            + '한 패스가 끝날 때마다 가장 큰 값이 뒤쪽에 확정되며(sortedFrom), sortedFrom은 학습용 표시라서 코드에 변수가 없습니다. 조기 종료가 없는 기본형입니다.',
    },
    c: {
        lines: [
            'void bubble_sort(int values[], int n) {',
            '    for (int i = 0; i < n - 1; i++) {',
            '        for (int j = 0; j < n - 1 - i; j++) {',
            '            if (values[j] > values[j + 1]) {',
            '                int tmp = values[j];',
            '                values[j] = values[j + 1];',
            '                values[j + 1] = tmp;',
            '            }',
            '        }',
            '    }',
            '}',
        ],
        notes: 'C는 배열의 길이를 알 수 없어서 n을 함께 받습니다. 교환은 임시 변수 tmp를 거쳐 세 줄(5~7번)로 합니다. 앞의 값이 더 클 때만 맞바꾸므로 같은 값은 교환하지 않습니다. '
            + '한 패스가 끝날 때마다 가장 큰 값이 뒤쪽에 확정되며(sortedFrom), sortedFrom은 학습용 표시라서 코드에 변수가 없습니다. n이 0이면 n - 1이 -1이라서 반복이 한 번도 실행되지 않습니다.',
    },
};

const BUBBLE_SORT_EVENT_LINES = {
    python: { initial: [], 'first-compare': [2, 3, 4, 5], 'pass-compare': [3, 4, 5], compare: [4, 5], swap: [6], 'mark-sorted': [4], finish: [3], 'finish-empty': [2, 3] },
    javascript: { initial: [], 'first-compare': [2, 3, 4, 5], 'pass-compare': [3, 4, 5], compare: [4, 5], swap: [6], 'mark-sorted': [4], finish: [3], 'finish-empty': [2, 3] },
    c: { initial: [], 'first-compare': [2, 3, 4], 'pass-compare': [2, 3, 4], compare: [3, 4], swap: [5, 6, 7], 'mark-sorted': [3], finish: [2], 'finish-empty': [2] },
};

function buildBubbleSort({ values }) {
    const n = values.length;
    const state = { values: [...values], compareIndices: null, swapped: false, sortedFrom: n };
    const steps = [];
    const emit = (eventId, operation, message) => steps.push({ eventId, operation, state: clone(state), message });

    emit('initial', 'initial', n === 0
        ? '실행 전 상태입니다. 배열이 비어 있습니다.'
        : `실행 전 상태입니다. 오름차순으로 정렬할 배열: ${values.join(', ')}.`);

    if (n <= 1) {
        state.sortedFrom = 0;
        emit('finish-empty', 'finish', n === 0
            ? '원소가 없어 비교할 쌍이 없습니다. 이미 정렬된 상태입니다.'
            : '원소가 하나뿐이라 비교할 쌍이 없습니다. 이미 정렬된 상태입니다.');
        return steps;
    }

    let firstOverall = true;
    for (let pass = 0; pass < n - 1; pass += 1) {
        for (let j = 0; j < n - 1 - pass; j += 1) {
            state.compareIndices = [j, j + 1];
            state.swapped = false;
            const [a, b] = [state.values[j], state.values[j + 1]];
            const eventId = firstOverall ? 'first-compare' : j === 0 ? 'pass-compare' : 'compare';
            firstOverall = false;
            emit(eventId, 'compare', `values[${j}] = ${a}, values[${j + 1}] = ${b}: ${a > b ? `${a} > ${b}, 순서가 거꾸로이므로 교환합니다.` : `${a} <= ${b}, 교환하지 않습니다.`}`);
            if (a > b) {
                [state.values[j], state.values[j + 1]] = [b, a];
                state.swapped = true;
                emit('swap', 'swap', `두 값을 맞바꿉니다: values[${j}] = ${b}, values[${j + 1}] = ${a}.`);
            }
        }
        state.sortedFrom -= 1;
        state.compareIndices = null;
        state.swapped = false;
        emit('mark-sorted', 'mark-sorted', `${pass + 1}번째 패스가 끝났습니다. 인덱스 ${state.sortedFrom} 이상의 값은 자리가 확정되었습니다.`);
    }
    state.sortedFrom = 0;
    emit('finish', 'finish', `모든 패스가 끝났습니다. 정렬 결과: ${state.values.join(', ')}.`);
    return steps;
}

// ============================================================================
// 알고리즘 표와 예제 목록
// ============================================================================

for (const [id, codes, eventLines] of [
    ['bfs', BFS_CODES, BFS_EVENT_LINES], ['dfs', DFS_CODES, DFS_EVENT_LINES],
    ['binary-search', BINARY_SEARCH_CODES, BINARY_SEARCH_EVENT_LINES],
    ['bubble-sort', BUBBLE_SORT_CODES, BUBBLE_SORT_EVENT_LINES],
]) {
    codes.cpp = CPP_CODES[id];
    eventLines.cpp = CPP_EVENT_LINES[id];
    for (const language of ['java', 'kotlin', 'rust']) {
        codes[language] = EXTRA_CODES[language][id];
        eventLines[language] = EXTRA_EVENT_LINES[language][id];
    }
}

export const ALGORITHMS = Object.freeze({
    bfs: { title: '너비 우선 탐색 (BFS)', codes: BFS_CODES, eventLines: BFS_EVENT_LINES, build: buildBfs },
    dfs: { title: '깊이 우선 탐색 (DFS, 재귀)', codes: DFS_CODES, eventLines: DFS_EVENT_LINES, build: buildDfs },
    'binary-search': { title: '이분 탐색', codes: BINARY_SEARCH_CODES, eventLines: BINARY_SEARCH_EVENT_LINES, build: buildBinarySearch },
    'bubble-sort': { title: '버블 정렬', codes: BUBBLE_SORT_CODES, eventLines: BUBBLE_SORT_EVENT_LINES, build: buildBubbleSort },
});

const CYCLE_GRAPH = { A: ['B'], B: ['C'], C: ['A', 'D'], D: [] };
const CYCLE_LAYOUT = { A: { x: 50, y: 12 }, B: { x: 86, y: 45 }, C: { x: 14, y: 45 }, D: { x: 50, y: 88 } };
const SPLIT_GRAPH = { A: ['B'], B: [], C: ['D'], D: [] };
const SPLIT_LAYOUT = { A: { x: 25, y: 15 }, B: { x: 25, y: 70 }, C: { x: 75, y: 15 }, D: { x: 75, y: 70 } };

/** 등록할 예제. 순서가 catalog의 순서(화면의 선택 순서)이며 첫 예제가 그 알고리즘의 기본 예제다. contentVersion의 숫자만 여기서 올린다. */
export const EXAMPLES = Object.freeze([
    {
        algorithmId: 'bfs', id: 'diamond', version: 4, title: '마름모 그래프 (A→B, A→C, B→D, C→D)',
        input: { directed: true, graph: { A: ['B', 'C'], B: ['D'], C: ['D'], D: [] }, start: 'A', layout: { A: { x: 50, y: 10 }, B: { x: 20, y: 50 }, C: { x: 80, y: 50 }, D: { x: 50, y: 90 } } },
    },
    { algorithmId: 'bfs', id: 'cycle', version: 3, title: '순환이 있는 그래프 (C→A로 되돌아감)', input: { directed: true, graph: CYCLE_GRAPH, start: 'A', layout: CYCLE_LAYOUT } },
    { algorithmId: 'bfs', id: 'disconnected', version: 3, title: '도달할 수 없는 노드가 있는 그래프', input: { directed: true, graph: SPLIT_GRAPH, start: 'A', layout: SPLIT_LAYOUT } },
    {
        algorithmId: 'dfs', id: 'basic', version: 3, title: '트리 모양 그래프 (A→B, C / B→D, E / C→F)',
        input: {
            directed: true, graph: { A: ['B', 'C'], B: ['D', 'E'], C: ['F'], D: [], E: [], F: [] }, start: 'A',
            layout: { A: { x: 50, y: 10 }, B: { x: 25, y: 42 }, C: { x: 75, y: 42 }, D: { x: 12, y: 80 }, E: { x: 38, y: 80 }, F: { x: 75, y: 80 } },
        },
    },
    { algorithmId: 'dfs', id: 'cycle', version: 3, title: '순환이 있는 그래프 (C→A로 되돌아감)', input: { directed: true, graph: CYCLE_GRAPH, start: 'A', layout: CYCLE_LAYOUT } },
    { algorithmId: 'dfs', id: 'disconnected', version: 3, title: '도달할 수 없는 노드가 있는 그래프', input: { directed: true, graph: SPLIT_GRAPH, start: 'A', layout: SPLIT_LAYOUT } },
    { algorithmId: 'binary-search', id: 'basic', version: 3, title: '기본: 값을 찾는 경우', input: { values: [2, 5, 8, 12, 16, 23, 38, 56, 72, 91], target: 23 } },
    { algorithmId: 'binary-search', id: 'empty', version: 3, title: '빈 배열', input: { values: [], target: 5 } },
    { algorithmId: 'binary-search', id: 'single', version: 3, title: '원소가 하나', input: { values: [7], target: 7 } },
    { algorithmId: 'binary-search', id: 'not-found', version: 3, title: '찾는 값이 없는 경우', input: { values: [1, 3, 5, 7, 9, 11], target: 4 } },
    { algorithmId: 'binary-search', id: 'duplicates', version: 3, title: '같은 값이 여러 개', input: { values: [1, 2, 2, 2, 3, 4], target: 2 } },
    { algorithmId: 'bubble-sort', id: 'basic', version: 3, title: '기본 (5, 1, 4, 2, 8)', input: { values: [5, 1, 4, 2, 8] } },
    { algorithmId: 'bubble-sort', id: 'empty', version: 3, title: '빈 배열', input: { values: [] } },
    { algorithmId: 'bubble-sort', id: 'single', version: 3, title: '원소가 하나', input: { values: [3] } },
    { algorithmId: 'bubble-sort', id: 'sorted', version: 3, title: '이미 정렬된 배열', input: { values: [1, 2, 3, 4] } },
    { algorithmId: 'bubble-sort', id: 'negative-duplicates', version: 3, title: '음수와 같은 값이 있는 배열', input: { values: [3, -1, 3, 0, -1] } },
]);

/** 입력에서 단계를 만들고 언어별 줄 번호를 붙인다. */
export function buildSteps(algorithmId, input) {
    const { build, eventLines } = ALGORITHMS[algorithmId];
    return build(input).map((step, index) => ({
        index,
        eventId: step.eventId,
        operation: step.operation,
        lines: Object.fromEntries(LANGUAGES.map((language) => [language, [...eventLines[language][step.eventId]]])),
        state: step.state,
        message: step.message,
    }));
}

/** 예제 하나의 bundle. C 코드의 `#define N`은 노드 수에 맞춘다(그래프 알고리즘). */
export function buildBundle(example) {
    const { codes } = ALGORITHMS[example.algorithmId];
    const bundleCodes = Object.fromEntries(LANGUAGES.map((language) => [language, { lines: [...codes[language].lines], notes: codes[language].notes }]));
    if (example.input.graph !== undefined) {
        // C 코드의 첫 줄 `#define N <노드 수>`만 예제에 맞춘다. 나머지 줄은 같다.
        bundleCodes.c.lines[0] = `#define N ${Object.keys(example.input.graph).length}`;
    }
    if (example.input.grid) for (const code of Object.values(bundleCodes)) code.notes = '격자의 이동 가능한 칸을 A, B, … 순서의 노드로 바꾼 BFS 응용입니다. 거리·경로는 발견 상태에서 유도한 학습 표시이며 코드 변수는 아닙니다. 도착점 발견 뒤에도 전체 탐색을 계속합니다. ' + code.notes;
    return {
        schemaVersion: 1,
        contentVersion: `${example.algorithmId}-${example.id}-v${example.version}`,
        algorithmId: example.algorithmId,
        exampleId: example.id,
        input: example.input,
        codes: bundleCodes,
        steps: buildSteps(example.algorithmId, example.input),
    };
}

export function buildCatalog() {
    const algorithms = [];
    for (const algorithmId of Object.keys(ALGORITHMS)) {
        const examples = [...EXAMPLES, ...GRID_EXAMPLES].filter((example) => example.algorithmId === algorithmId).map((example) => ({
            id: example.id, title: example.title, path: `${algorithmId}/${example.id}.json`, languages: [...LANGUAGES],
        }));
        algorithms.push({ id: algorithmId, title: ALGORITHMS[algorithmId].title, examples });
    }
    for (const [id, title] of Object.entries(LEARNING_TITLES)) algorithms.push({ id, title, examples: LEARNING_EXAMPLES.filter(example => example.algorithmId === id).map(example => ({ id: example.id, title: example.title, path: `${id}/${example.id}.json`, languages: [...LANGUAGES] })) });
    return { schemaVersion: 1, algorithms };
}

// ---------- JSON 출력(사람이 읽기 쉬운 형식) ----------

const compact = (value) => {
    if (Array.isArray(value)) return `[${value.map(compact).join(', ')}]`;
    if (value !== null && typeof value === 'object') return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${compact(item)}`).join(', ')}}`;
    return JSON.stringify(value);
};

export function formatBundle(bundle) {
    const j = JSON.stringify;
    const out = ['{'];
    out.push(`  "schemaVersion": ${bundle.schemaVersion},`);
    out.push(`  "contentVersion": ${j(bundle.contentVersion)},`);
    out.push(`  "algorithmId": ${j(bundle.algorithmId)},`);
    out.push(`  "exampleId": ${j(bundle.exampleId)},`);
    out.push('  "input": {');
    const inputKeys = Object.keys(bundle.input);
    inputKeys.forEach((key, i) => {
        const comma = i < inputKeys.length - 1 ? ',' : '';
        if (key === 'layout') {
            out.push('    "layout": {');
            const nodes = Object.keys(bundle.input.layout);
            nodes.forEach((node, k) => out.push(`      ${j(node)}: ${compact(bundle.input.layout[node])}${k < nodes.length - 1 ? ',' : ''}`));
            out.push(`    }${comma}`);
        } else {
            out.push(`    ${j(key)}: ${compact(bundle.input[key])}${comma}`);
        }
    });
    out.push('  },');
    out.push('  "codes": {');
    const languages = Object.keys(bundle.codes);
    languages.forEach((language, li) => {
        const { lines, notes } = bundle.codes[language];
        out.push(`    "${language}": {`);
        out.push('      "lines": [');
        lines.forEach((line, i) => out.push(`        ${j(line)}${i < lines.length - 1 ? ',' : ''}`));
        out.push('      ],');
        out.push(`      "notes": ${j(notes)}`);
        out.push(`    }${li < languages.length - 1 ? ',' : ''}`);
    });
    out.push('  },');
    out.push('  "steps": [');
    bundle.steps.forEach((step, i) => {
        out.push('    {');
        out.push(`      "index": ${step.index}, "eventId": ${j(step.eventId)}, "operation": ${j(step.operation)},`);
        out.push(`      "lines": ${compact(step.lines)},`);
        out.push(`      "state": ${compact(step.state)},`);
        out.push(`      "message": ${j(step.message)}`);
        out.push(`    }${i < bundle.steps.length - 1 ? ',' : ''}`);
    });
    out.push('  ]');
    out.push('}');
    return `${out.join('\n')}\n`;
}

export function formatCatalog(catalog) {
    const j = JSON.stringify;
    const out = ['{', '  "schemaVersion": 1,', '  "algorithms": ['];
    catalog.algorithms.forEach((algorithm, ai) => {
        out.push('    {');
        out.push(`      "id": ${j(algorithm.id)},`);
        out.push(`      "title": ${j(algorithm.title)},`);
        out.push('      "examples": [');
        algorithm.examples.forEach((example, ei) => {
            out.push('        {');
            out.push(`          "id": ${j(example.id)},`);
            out.push(`          "title": ${j(example.title)},`);
            out.push(`          "path": ${j(example.path)},`);
            out.push(`          "languages": ${compact(example.languages)}`);
            out.push(`        }${ei < algorithm.examples.length - 1 ? ',' : ''}`);
        });
        out.push('      ]');
        out.push(`    }${ai < catalog.algorithms.length - 1 ? ',' : ''}`);
    });
    out.push('  ]', '}');
    return `${out.join('\n')}\n`;
}
