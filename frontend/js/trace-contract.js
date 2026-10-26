// trace(실행 기록) 계약의 상수와 타입. 사람이 읽는 최종 계약은 docs/CONTRACTS.md이며,
// 값이 다르면 문서와 이 파일을 같은 변경에서 함께 고친다.

import { EXTENDED_IDS, EXTENDED_LABELS } from './learning-programs.js';
export const SCHEMA_VERSION = 1;

// 최종 표시 순서. 아직 콘텐츠가 없는 언어는 선택 목록에 넣지 않는다.
export const LANGUAGE_ORDER = Object.freeze(['python', 'cpp', 'java', 'kotlin', 'rust', 'c', 'javascript']);
export const LANGUAGE_IDS = LANGUAGE_ORDER;
export const ALGORITHM_IDS = Object.freeze(['bfs', 'dfs', 'binary-search', 'bubble-sort', ...EXTENDED_IDS]);

/** 콘텐츠 제한(제안값). 바꾸면 CONTRACTS.md §1도 고친다. */
export const LIMITS = Object.freeze({
    maxSteps: 2000,
    minSteps: 2,
    maxNodes: 12,
    maxEdges: 24,
    maxArrayLength: 20,
    minInt: -999,
    maxInt: 999,
    maxBundleBytes: 200 * 1024,
    maxCodeLines: 120,
    maxCodeLineLength: 120,
    maxNotesLength: 500,
    maxMessageLength: 200,
    maxEventIdLength: 40,
    maxExampleIdLength: 32,
    layoutMin: 0,
    layoutMax: 100,
});

export const PATTERNS = Object.freeze({
    exampleId: /^[a-z0-9]+(-[a-z0-9]+)*$/,
    nodeId: /^[A-Za-z0-9]{1,3}$/,
    eventId: /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
    /** catalog의 bundle 경로. `<algorithmId>/<exampleId>.json`만 허용한다. */
    bundlePath: /^[a-z0-9-]+\/[a-z0-9-]+\.json$/,
});

/** 한글 음절이 하나 이상 있어야 "한국어 설명"으로 본다. */
export const HANGUL = /[가-힣]/;

// 객체의 키 집합은 정확히 일치해야 한다(누락·추가 모두 오류).
export const BUNDLE_KEYS = Object.freeze(['schemaVersion', 'contentVersion', 'algorithmId', 'exampleId', 'input', 'codes', 'steps']);
export const CODE_KEYS = Object.freeze(['lines', 'notes']);
export const STEP_KEYS = Object.freeze(['index', 'eventId', 'operation', 'lines', 'state', 'message']);
export const CATALOG_KEYS = Object.freeze(['schemaVersion', 'algorithms']);
export const CATALOG_ALGORITHM_KEYS = Object.freeze(['id', 'title', 'examples']);
export const CATALOG_EXAMPLE_KEYS = Object.freeze(['id', 'title', 'path', 'languages']);

export const INPUT_KEYS = Object.freeze({
    'union-find': Object.freeze(['n', 'operations']), dijkstra: Object.freeze(['n', 'edges', 'start']), knapsack: Object.freeze(['weights', 'values', 'capacity']), 'topological-sort': Object.freeze(['n', 'edges']), 'two-pointers': Object.freeze(['values', 'target']),
    bfs: Object.freeze(['directed', 'graph', 'start', 'layout']),
    dfs: Object.freeze(['directed', 'graph', 'start', 'layout']),
    'binary-search': Object.freeze(['values', 'target']),
    'bubble-sort': Object.freeze(['values']),
});

export const STATE_KEYS = Object.freeze({
    ...Object.fromEntries(EXTENDED_IDS.map(id => [id, Object.freeze(['vars'])])),
    bfs: Object.freeze(['discovered', 'processed', 'queue', 'current', 'neighbor']),
    dfs: Object.freeze(['frames', 'discovered', 'processed', 'current']),
    'binary-search': Object.freeze(['values', 'target', 'left', 'right', 'mid', 'result']),
    'bubble-sort': Object.freeze(['values', 'compareIndices', 'swapped', 'sortedFrom']),
});

export const OPERATIONS = Object.freeze({
    ...Object.fromEntries(EXTENDED_IDS.map(id => [id, Object.freeze(Object.keys(EXTENDED_LABELS[id]))])),
    bfs: Object.freeze(['initial', 'discover', 'enqueue', 'dequeue', 'check-neighbor', 'process', 'finish']),
    dfs: Object.freeze(['initial', 'call', 'discover', 'check-neighbor', 'process', 'return']),
    'binary-search': Object.freeze(['initial', 'compute-mid', 'compare', 'set-left', 'set-right', 'found', 'finish']),
    'bubble-sort': Object.freeze(['initial', 'compare', 'swap', 'mark-sorted', 'finish']),
});

/** 화면에 보이는 언어 이름. */
export const LANGUAGE_LABELS = Object.freeze({ python: 'Python', cpp: 'C++', java: 'Java', kotlin: 'Kotlin', rust: 'Rust', c: 'C', javascript: 'JavaScript' });

/**
 * 화면에 보이는 operation 이름(한국어). OPERATIONS의 모든 operation에 이름이 있어야 하며 테스트가 확인한다.
 * "방금 실행한 연산: <이름>" 형태로 표시한다.
 */
export const OPERATION_LABELS = Object.freeze({
    ...Object.fromEntries(EXTENDED_IDS.map(id => [id, Object.freeze(EXTENDED_LABELS[id])])),
    bfs: Object.freeze({
        initial: '실행 전', discover: '발견 기록', enqueue: '큐에 넣기', dequeue: '큐에서 꺼내기',
        'check-neighbor': '이웃 검사', process: '처리 완료', finish: '종료',
    }),
    dfs: Object.freeze({
        initial: '실행 전', call: '함수 호출', discover: '발견 기록', 'check-neighbor': '이웃 검사',
        process: '처리 완료', return: '호출 복귀',
    }),
    'binary-search': Object.freeze({
        initial: '실행 전', 'compute-mid': '중간 위치 계산', compare: '값 비교', 'set-left': '왼쪽 경계 이동',
        'set-right': '오른쪽 경계 이동', found: '찾음', finish: '종료(찾지 못함)',
    }),
    'bubble-sort': Object.freeze({
        initial: '실행 전', compare: '두 원소 비교', swap: '교환', 'mark-sorted': '정렬 확정', finish: '종료',
    }),
});

/** 마지막 step의 operation은 이 중 하나여야 한다. */
export const TERMINAL_OPERATIONS = Object.freeze({
    ...Object.fromEntries(EXTENDED_IDS.map(id => [id, Object.freeze(['finish'])])),
    bfs: Object.freeze(['finish']),
    dfs: Object.freeze(['return']),
    'binary-search': Object.freeze(['found', 'finish']),
    'bubble-sort': Object.freeze(['finish']),
});

/** 마지막 step 이외에는 나타날 수 없는 operation. DFS의 return은 중간에도 쓰이므로 비어 있다. */
export const TERMINAL_ONLY_OPERATIONS = Object.freeze({
    ...Object.fromEntries(EXTENDED_IDS.map(id => [id, Object.freeze(['finish'])])),
    bfs: Object.freeze(['finish']),
    dfs: Object.freeze([]),
    'binary-search': Object.freeze(['found', 'finish']),
    'bubble-sort': Object.freeze(['finish']),
});

/**
 * @typedef {'python'|'cpp'|'java'|'kotlin'|'rust'|'c'|'javascript'} LanguageId
 * @typedef {'bfs'|'dfs'|'binary-search'|'bubble-sort'} AlgorithmId
 *
 * @typedef {Object} CodeSection
 * @property {string[]} lines  소스를 줄 단위로 나눈 배열
 * @property {string} notes    그 언어 구현의 차이를 설명하는 한국어 문자열
 *
 * @typedef {Object} BfsState
 * @property {string[]} discovered
 * @property {string[]} processed
 * @property {string[]} queue
 * @property {string|null} current
 * @property {string|null} neighbor
 *
 * @typedef {Object} TraceStep
 * @property {number} index
 * @property {string} eventId
 * @property {string} operation
 * @property {Object<string, number[]>} lines  언어별 줄 번호(1부터)
 * @property {BfsState|Object} state           알고리즘별 상태(실행 후)
 * @property {string} message                  한국어 설명
 *
 * @typedef {Object} TraceBundle
 * @property {1} schemaVersion
 * @property {string} contentVersion   `<algorithmId>-<exampleId>-v<N>`
 * @property {AlgorithmId} algorithmId
 * @property {string} exampleId
 * @property {Object} input
 * @property {Object<string, CodeSection>} codes
 * @property {TraceStep[]} steps
 *
 * @typedef {Object} CatalogExample
 * @property {string} id
 * @property {string} title
 * @property {string} path            `<algorithmId>/<exampleId>.json`
 * @property {LanguageId[]} languages
 *
 * @typedef {Object} Catalog
 * @property {1} schemaVersion
 * @property {{id: AlgorithmId, title: string, examples: CatalogExample[]}[]} algorithms
 *
 * @typedef {Object} ValidationResult
 * @property {boolean} valid
 * @property {string[]} errors  사람이 읽는 한국어 오류. 비어 있으면 valid.
 */
