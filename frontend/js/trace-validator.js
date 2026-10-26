// trace bundle과 catalog를 검증한다. 브라우저와 Node에서 모두 동작하며 예외를 던지지 않는다.
// 규칙의 근거는 docs/CONTRACTS.md(R1~R10, §4, §5)이다.
//
// 구조(R1~R6, R8~R10)와 입력 제한은 모든 알고리즘에 적용한다.
// 상태·전이 규칙(R7)은 알고리즘마다 규칙 함수가 필요하다(BFS, DFS, 이분 탐색, 버블 정렬).
// 규칙 함수가 없는 알고리즘의 bundle은 검증하지 않은 채 통과시키지 않고 오류로 거부한다.
// 각 규칙 함수는 전이 규칙과 별개로, 입력에서 알고리즘을 직접 계산한 정답(reference)을 최종 상태와 비교한다.

import {
    ALGORITHM_IDS,
    BUNDLE_KEYS,
    CATALOG_ALGORITHM_KEYS,
    CATALOG_EXAMPLE_KEYS,
    CATALOG_KEYS,
    CODE_KEYS,
    HANGUL,
    INPUT_KEYS,
    LANGUAGE_IDS,
    LIMITS,
    OPERATIONS,
    PATTERNS,
    SCHEMA_VERSION,
    STATE_KEYS,
    STEP_KEYS,
    TERMINAL_ONLY_OPERATIONS,
    TERMINAL_OPERATIONS,
} from './trace-contract.js';
import { checkLearningInput, EXTENDED_IDS } from './learning-programs.js';
import { sameLearning, validateLearning } from './learning-validator.js';
import { gridInput } from './grid-bfs.js';

const MAX_ERRORS = 50;
const MAX_DEPTH = 12;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

// ---------- 공통 도구 ----------

class Collector {
    constructor() {
        this.errors = [];
        this.total = 0;
    }

    add(message) {
        this.total += 1;
        if (this.errors.length < MAX_ERRORS) this.errors.push(message);
    }

    result() {
        const errors = [...this.errors];
        if (this.total > errors.length) errors.push(`… 오류가 ${this.total}개라서 앞의 ${errors.length}개만 표시합니다.`);
        return { valid: this.total === 0, errors };
    }
}

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const codePointLength = (text) => [...text].length;

function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function sameArray(a, b) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => value === b[i]);
}

function show(value) {
    let text;
    try {
        text = JSON.stringify(value);
    } catch {
        text = undefined;
    }
    if (text === undefined) text = String(value);
    return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

function typeName(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return '배열';
    return typeof value;
}

/** 한국어로 읽을 때 받침이 있는 operation 이름(콜, 리턴, 스왑, 이니셜) 뒤에는 "이어야", 나머지는 "여야"가 붙는다. */
const COPULA_AFTER_CONSONANT = new Set(['call', 'return', 'swap', 'initial']);
const withCopula = (operation) => `${operation}${COPULA_AFTER_CONSONANT.has(operation) ? '이어야' : '여야'}`;

/** 객체의 키 집합이 expected와 정확히 같은지 확인한다. 같으면 true. */
function checkKeys(object, expected, path, c) {
    const before = c.total;
    const missing = expected.filter((key) => !has(object, key));
    const extra = Object.keys(object).filter((key) => !expected.includes(key));
    if (missing.length > 0) c.add(`${path}: 필수 키가 없습니다 (${missing.join(', ')})`);
    if (extra.length > 0) c.add(`${path}: 허용되지 않은 키가 있습니다 (${extra.join(', ')})`);
    return c.total === before;
}

/** 같은 객체·배열이 두 곳 이상에 들어 있거나(공유) 순환하는 경우를 찾는다. */
function findSharedReferences(root, c) {
    // 경로는 다른 오류와 같은 형식(`steps[3].state.queue`)으로 쓴다. 루트 자신은 'bundle'로 표시한다.
    const seen = new Map();
    const stack = [[root, '', 0]];
    while (stack.length > 0) {
        const [value, path, depth] = stack.pop();
        if (value === null || typeof value !== 'object') continue;
        if (depth > MAX_DEPTH) {
            c.add(`${path}: 중첩이 너무 깊거나 순환합니다`);
            continue;
        }
        if (seen.has(value)) {
            c.add(`${path}: ${seen.get(value) || 'bundle'}와(과) 같은 객체를 공유합니다. 스냅샷은 서로 독립된 객체여야 합니다`);
            continue;
        }
        seen.set(value, path);
        const keys = Object.keys(value);
        for (let i = keys.length - 1; i >= 0; i -= 1) {
            const key = keys[i];
            const childPath = Array.isArray(value) ? `${path}[${key}]` : (path === '' ? key : `${path}.${key}`);
            stack.push([value[key], childPath, depth + 1]);
        }
    }
}

// ---------- 입력(input) ----------

function checkInteger(value, path, c) {
    if (!Number.isInteger(value)) {
        c.add(`${path}: 정수여야 합니다 (${show(value)})`);
        return false;
    }
    if (value < LIMITS.minInt || value > LIMITS.maxInt) {
        c.add(`${path}: ${LIMITS.minInt}~${LIMITS.maxInt} 범위를 벗어났습니다 (${value})`);
        return false;
    }
    return true;
}

function checkIntegerArray(values, path, c) {
    if (!Array.isArray(values)) {
        c.add(`${path}: 배열이어야 합니다 (${typeName(values)})`);
        return false;
    }
    let ok = true;
    if (values.length > LIMITS.maxArrayLength) {
        c.add(`${path}: 원소는 ${LIMITS.maxArrayLength}개 이하여야 합니다 (${values.length}개)`);
        ok = false;
    }
    values.slice(0, LIMITS.maxArrayLength).forEach((value, i) => {
        if (!checkInteger(value, `${path}[${i}]`, c)) ok = false;
    });
    return ok;
}

function checkGraphInput(input, c) {
    const path = 'input';
    const before = c.total;
    if (input.directed !== true) c.add(`${path}.directed: 방향 그래프만 지원하므로 true여야 합니다`);

    const { graph, start, layout } = input;
    if (!isPlainObject(graph)) {
        c.add(`${path}.graph: 객체여야 합니다 (${typeName(graph)})`);
        return false;
    }
    const nodes = Object.keys(graph);
    if (nodes.length < 1 || nodes.length > LIMITS.maxNodes) {
        c.add(`${path}.graph: 노드는 1~${LIMITS.maxNodes}개여야 합니다 (${nodes.length}개)`);
    }
    let edges = 0;
    for (const node of nodes) {
        if (!PATTERNS.nodeId.test(node)) c.add(`${path}.graph: 노드 ID ${show(node)}는 영문·숫자 1~3자여야 합니다`);
        const neighbors = graph[node];
        if (!Array.isArray(neighbors)) {
            c.add(`${path}.graph.${node}: 이웃 배열이어야 합니다 (${typeName(neighbors)})`);
            continue;
        }
        edges += neighbors.length;
        const unique = new Set();
        for (const neighbor of neighbors) {
            if (typeof neighbor !== 'string' || !has(graph, neighbor)) {
                c.add(`${path}.graph.${node}: 이웃 ${show(neighbor)}는 graph에 없는 노드입니다`);
            } else if (unique.has(neighbor)) {
                c.add(`${path}.graph.${node}: 이웃 ${neighbor}가 중복되었습니다`);
            }
            unique.add(neighbor);
        }
    }
    if (edges > LIMITS.maxEdges) c.add(`${path}.graph: 간선은 ${LIMITS.maxEdges}개 이하여야 합니다 (${edges}개)`);
    if (typeof start !== 'string' || !has(graph, start)) c.add(`${path}.start: 시작 노드 ${show(start)}는 graph에 없습니다`);

    if (!isPlainObject(layout)) {
        c.add(`${path}.layout: 객체여야 합니다 (${typeName(layout)})`);
    } else {
        const layoutNodes = Object.keys(layout);
        const missing = nodes.filter((node) => !has(layout, node));
        const extra = layoutNodes.filter((node) => !has(graph, node));
        if (missing.length > 0) c.add(`${path}.layout: 위치가 없는 노드가 있습니다 (${missing.join(', ')})`);
        if (extra.length > 0) c.add(`${path}.layout: graph에 없는 노드의 위치가 있습니다 (${extra.join(', ')})`);
        for (const node of layoutNodes) {
            const point = layout[node];
            if (!isPlainObject(point) || !checkKeys(point, ['x', 'y'], `${path}.layout.${node}`, c)) {
                if (!isPlainObject(point)) c.add(`${path}.layout.${node}: {x, y} 객체여야 합니다`);
                continue;
            }
            for (const axis of ['x', 'y']) {
                const value = point[axis];
                if (typeof value !== 'number' || !Number.isFinite(value) || value < LIMITS.layoutMin || value > LIMITS.layoutMax) {
                    c.add(`${path}.layout.${node}.${axis}: ${LIMITS.layoutMin}~${LIMITS.layoutMax} 범위의 숫자여야 합니다 (${show(value)})`);
                }
            }
        }
    }
    return c.total === before;
}

function checkInput(algorithmId, input, c) {
    if (!isPlainObject(input)) {
        c.add(`input: 객체여야 합니다 (${typeName(input)})`);
        return false;
    }
    const before = c.total;
    if (EXTENDED_IDS.includes(algorithmId)) {
        try { checkLearningInput(algorithmId, input); } catch (error) { c.add(error.message); }
        return c.total === before;
    }
    const grid = algorithmId === 'bfs' && Object.hasOwn(input, 'grid');
    if (!checkKeys(input, grid ? [...INPUT_KEYS[algorithmId], 'grid'] : INPUT_KEYS[algorithmId], 'input', c)) return false;
    if (grid) {
        try { if (!sameLearning(input, gridInput(input.grid))) c.add('input.grid: 격자의 벽·이웃 순서·좌표와 그래프가 일치하지 않습니다.'); }
        catch (error) { c.add(`input.grid: ${error.message}`); }
    }

    if (algorithmId === 'bfs' || algorithmId === 'dfs') {
        checkGraphInput(input, c);
    } else if (algorithmId === 'binary-search') {
        if (checkIntegerArray(input.values, 'input.values', c)) {
            for (let i = 1; i < input.values.length; i += 1) {
                if (input.values[i] < input.values[i - 1]) {
                    c.add(`input.values: 오름차순(비내림차순)이어야 합니다 (${i - 1}번과 ${i}번이 거꾸로입니다)`);
                    break;
                }
            }
        }
        checkInteger(input.target, 'input.target', c);
    } else if (algorithmId === 'bubble-sort') {
        checkIntegerArray(input.values, 'input.values', c);
    }
    return c.total === before;
}

// ---------- 코드(codes) ----------

/** 검증을 통과한 언어 ID 목록을 돌려준다. codes 자체가 잘못되면 null. */
function checkCodes(codes, c) {
    if (!isPlainObject(codes)) {
        c.add(`codes: 객체여야 합니다 (${typeName(codes)})`);
        return null;
    }
    const languages = Object.keys(codes);
    if (languages.length === 0) {
        c.add('codes: 언어가 하나 이상 있어야 합니다');
        return null;
    }
    const before = c.total;
    for (const language of languages) {
        const path = `codes.${language}`;
        if (!LANGUAGE_IDS.includes(language)) {
            c.add(`${path}: 지원하지 않는 언어입니다 (허용: ${LANGUAGE_IDS.join(', ')})`);
            continue;
        }
        const section = codes[language];
        if (!isPlainObject(section)) {
            c.add(`${path}: 객체여야 합니다 (${typeName(section)})`);
            continue;
        }
        checkKeys(section, CODE_KEYS, path, c);

        const { lines, notes } = section;
        if (!Array.isArray(lines)) {
            c.add(`${path}.lines: 배열이어야 합니다 (${typeName(lines)})`);
        } else {
            if (lines.length < 1 || lines.length > LIMITS.maxCodeLines) {
                c.add(`${path}.lines: 코드는 1~${LIMITS.maxCodeLines}줄이어야 합니다 (${lines.length}줄)`);
            }
            lines.slice(0, LIMITS.maxCodeLines).forEach((line, i) => {
                if (typeof line !== 'string') {
                    c.add(`${path}.lines[${i}]: 문자열이어야 합니다 (${typeName(line)})`);
                } else if (/[\n\r\t]/.test(line)) {
                    c.add(`${path}.lines[${i}]: 줄바꿈이나 탭 문자를 쓸 수 없습니다 (들여쓰기는 공백으로 합니다)`);
                } else if (codePointLength(line) > LIMITS.maxCodeLineLength) {
                    c.add(`${path}.lines[${i}]: 한 줄은 ${LIMITS.maxCodeLineLength}자 이하여야 합니다 (${codePointLength(line)}자)`);
                }
            });
        }
        if (typeof notes !== 'string' || notes.trim() === '') {
            c.add(`${path}.notes: 설명 문자열이 필요합니다 (${show(notes)})`);
        } else {
            if (codePointLength(notes) > LIMITS.maxNotesLength) c.add(`${path}.notes: ${LIMITS.maxNotesLength}자 이하여야 합니다 (${codePointLength(notes)}자)`);
            if (!HANGUL.test(notes)) c.add(`${path}.notes: 한국어 설명이어야 합니다 (한글이 없습니다)`);
        }
    }
    return c.total === before ? languages : null;
}

// ---------- step의 공통 구조 ----------

/**
 * R1~R6, R8, R9의 구조 검사. state의 내용은 알고리즘 규칙에서 검사한다.
 * 이후 전이 검사를 해도 안전한 구조이면 true.
 */
function checkSteps(bundle, algorithmId, languages, c) {
    const { steps } = bundle;
    const before = c.total;
    if (!Array.isArray(steps)) {
        c.add(`steps: 배열이어야 합니다 (${typeName(steps)})`);
        return false;
    }
    if (steps.length < LIMITS.minSteps) c.add(`steps: 최소 ${LIMITS.minSteps}개(initial과 종료)가 필요합니다 (${steps.length}개)`);
    if (steps.length > LIMITS.maxSteps) {
        c.add(`steps: ${LIMITS.maxSteps}개 이하여야 합니다 (${steps.length}개)`);
        return false;
    }

    const operations = OPERATIONS[algorithmId];
    const terminalOnly = TERMINAL_ONLY_OPERATIONS[algorithmId];
    const lastIndex = steps.length - 1;
    const byEventId = new Map();

    steps.forEach((step, i) => {
        const path = `steps[${i}]`;
        if (!isPlainObject(step)) {
            c.add(`${path}: 객체여야 합니다 (${typeName(step)})`);
            return;
        }
        if (!checkKeys(step, STEP_KEYS, path, c)) return;

        if (step.index !== i) c.add(`${path}.index: ${i}이어야 합니다 (${show(step.index)}). index는 0부터 빠짐없이 이어져야 합니다`);

        if (typeof step.eventId !== 'string' || !PATTERNS.eventId.test(step.eventId) || step.eventId.length > LIMITS.maxEventIdLength) {
            c.add(`${path}.eventId: 소문자·숫자·하이픈 형식의 ${LIMITS.maxEventIdLength}자 이하 문자열이어야 합니다 (${show(step.eventId)})`);
        }

        const operation = step.operation;
        if (!operations.includes(operation)) {
            c.add(`${path}.operation: 알 수 없는 operation ${show(operation)} (${algorithmId}의 허용 값: ${operations.join(', ')})`);
        } else {
            if (i === 0 && operation !== 'initial') c.add(`${path}.operation: 첫 step은 initial이어야 합니다 (${operation})`);
            if (i > 0 && operation === 'initial') c.add(`${path}.operation: initial은 step 0에만 쓸 수 있습니다`);
            if (terminalOnly.includes(operation) && i !== lastIndex) c.add(`${path}.operation: ${operation}은(는) 마지막 step에만 쓸 수 있습니다`);
            if (i === lastIndex && !TERMINAL_OPERATIONS[algorithmId].includes(operation)) {
                c.add(`${path}.operation: 마지막 step은 ${TERMINAL_OPERATIONS[algorithmId].join(' 또는 ')}이어야 합니다 (${operation})`);
            }
        }
        if (i === 0 && step.eventId !== 'initial') c.add(`${path}.eventId: 첫 step의 eventId는 initial이어야 합니다 (${show(step.eventId)})`);

        // lines(R2, R3, R4)
        if (!isPlainObject(step.lines)) {
            c.add(`${path}.lines: 언어별 줄 번호 객체여야 합니다 (${typeName(step.lines)})`);
        } else if (languages !== null) {
            const keys = Object.keys(step.lines);
            const missing = languages.filter((language) => !keys.includes(language));
            const extra = keys.filter((language) => !languages.includes(language));
            if (missing.length > 0) c.add(`${path}.lines: 코드가 있는 언어의 줄 번호가 없습니다 (${missing.join(', ')})`);
            if (extra.length > 0) c.add(`${path}.lines: codes에 없는 언어의 줄 번호가 있습니다 (${extra.join(', ')})`);
            for (const language of languages) {
                if (!has(step.lines, language)) continue;
                checkLineNumbers(step.lines[language], `${path}.lines.${language}`, bundle.codes[language].lines.length, i === 0, c);
            }
        }

        // message(R9)
        if (typeof step.message !== 'string' || step.message.trim() === '') {
            c.add(`${path}.message: 설명 문자열이 필요합니다 (${show(step.message)})`);
        } else {
            const length = codePointLength(step.message);
            if (length > LIMITS.maxMessageLength) c.add(`${path}.message: ${LIMITS.maxMessageLength}자 이하여야 합니다 (${length}자)`);
            if (!HANGUL.test(step.message)) c.add(`${path}.message: 한국어 설명이어야 합니다 (한글이 없습니다)`);
            if (CONTROL_CHARS.test(step.message)) c.add(`${path}.message: 제어 문자를 쓸 수 없습니다`);
        }

        // R5: 같은 eventId는 같은 operation과 같은 줄을 가진다
        if (typeof step.eventId === 'string') {
            // 언어 키의 순서가 달라도 같은 매핑으로 본다.
            const linesKey = isPlainObject(step.lines) ? Object.keys(step.lines).sort().map((language) => [language, step.lines[language]]) : step.lines;
            const fingerprint = JSON.stringify([step.operation, linesKey]);
            const first = byEventId.get(step.eventId);
            if (first === undefined) {
                byEventId.set(step.eventId, { index: i, fingerprint, operation: step.operation });
            } else if (first.operation !== step.operation) {
                c.add(`${path}.eventId: ${show(step.eventId)}가 steps[${first.index}]에서는 operation ${show(first.operation)}인데 여기서는 ${show(step.operation)}입니다`);
            } else if (first.fingerprint !== fingerprint) {
                c.add(`${path}.lines: eventId ${show(step.eventId)}는 steps[${first.index}]와 같은 줄을 가리켜야 합니다 (줄 매핑이 일관되지 않습니다)`);
            }
        }
    });
    return c.total === before;
}

function checkLineNumbers(numbers, path, lineCount, isInitial, c) {
    if (!Array.isArray(numbers)) {
        c.add(`${path}: 줄 번호 배열이어야 합니다 (${typeName(numbers)})`);
        return;
    }
    if (isInitial && numbers.length > 0) c.add(`${path}: step 0은 실행한 줄이 없으므로 빈 배열이어야 합니다`);
    if (!isInitial && numbers.length === 0) c.add(`${path}: step 1 이후에는 실행한 줄이 하나 이상 있어야 합니다`);
    numbers.forEach((n, i) => {
        if (!Number.isInteger(n)) {
            c.add(`${path}[${i}]: 줄 번호는 정수여야 합니다 (${show(n)})`);
        } else if (n < 1 || n > lineCount) {
            c.add(`${path}[${i}]: 줄 번호 ${n}가 코드의 줄 범위 1~${lineCount}를 벗어났습니다`);
        } else if (i > 0 && Number.isInteger(numbers[i - 1]) && n <= numbers[i - 1]) {
            c.add(`${path}[${i}]: 줄 번호는 오름차순이며 중복될 수 없습니다 (${numbers[i - 1]} 다음에 ${n})`);
        }
    });
}

// ---------- 알고리즘별 상태·전이 규칙(R7) ----------

function checkNodeList(value, key, path, graph, c) {
    if (!Array.isArray(value)) {
        c.add(`${path}.${key}: 노드 배열이어야 합니다 (${typeName(value)})`);
        return;
    }
    const unique = new Set();
    value.forEach((node, i) => {
        if (typeof node !== 'string' || !has(graph, node)) {
            c.add(`${path}.${key}[${i}]: ${show(node)}는 graph에 없는 노드입니다`);
        } else if (unique.has(node)) {
            c.add(`${path}.${key}[${i}]: ${node}가 중복되었습니다`);
        }
        unique.add(node);
    });
}

function checkOptionalNode(value, key, path, graph, c) {
    if (value !== null && (typeof value !== 'string' || !has(graph, value))) {
        c.add(`${path}.${key}: null이거나 graph에 있는 노드여야 합니다 (${show(value)})`);
    }
}

/** BFS state의 모양과 불변식. 전이 검사를 해도 안전하면 true. */
function checkBfsState(state, path, graph, c) {
    if (!isPlainObject(state)) {
        c.add(`${path}: 객체여야 합니다 (${typeName(state)})`);
        return false;
    }
    const before = c.total;
    if (!checkKeys(state, STATE_KEYS.bfs, path, c)) return false;
    for (const key of ['discovered', 'processed', 'queue']) checkNodeList(state[key], key, path, graph, c);
    for (const key of ['current', 'neighbor']) checkOptionalNode(state[key], key, path, graph, c);
    if (c.total !== before) return false;

    const discovered = new Set(state.discovered);
    state.queue.forEach((node) => {
        if (!discovered.has(node)) c.add(`${path}.queue: ${node}는 아직 발견하지 않은 노드입니다 (discovered에 없음)`);
    });
    state.processed.forEach((node) => {
        if (!discovered.has(node)) c.add(`${path}.processed: ${node}는 아직 발견하지 않은 노드입니다 (discovered에 없음)`);
        if (state.queue.includes(node)) c.add(`${path}: ${node}가 queue와 processed에 동시에 있습니다`);
    });
    if (state.current !== null) {
        if (!discovered.has(state.current)) c.add(`${path}.current: ${state.current}는 발견하지 않은 노드입니다`);
        if (state.queue.includes(state.current)) c.add(`${path}.current: ${state.current}는 이미 큐에서 꺼냈으므로 queue에 있으면 안 됩니다`);
        if (state.processed.includes(state.current)) c.add(`${path}.current: ${state.current}는 이미 처리를 마친 노드입니다`);
    }
    if (state.neighbor !== null) {
        if (state.current === null) c.add(`${path}.neighbor: current가 없는데 이웃을 검사할 수 없습니다`);
        else if (!graph[state.current].includes(state.neighbor)) c.add(`${path}.neighbor: ${state.neighbor}는 ${state.current}의 이웃이 아닙니다`);
    }
    return c.total === before;
}

/** 입력만으로 계산한 BFS의 발견 순서와 처리 순서. 전이 규칙과 별개의 기준(oracle)이다. */
function referenceBfs(graph, start) {
    const discovered = [start];
    const processed = [];
    const queue = [start];
    while (queue.length > 0) {
        const node = queue.shift();
        for (const neighbor of graph[node]) {
            if (!discovered.includes(neighbor)) {
                discovered.push(neighbor);
                queue.push(neighbor);
            }
        }
        processed.push(node);
    }
    return { discovered, processed };
}

function validateBfs(bundle, c) {
    const { graph, start } = bundle.input;
    const { steps } = bundle;

    let shapeOk = true;
    steps.forEach((step, i) => {
        if (!checkBfsState(step.state, `steps[${i}].state`, graph, c)) shapeOk = false;
    });
    if (!shapeOk) return;

    const initial = steps[0].state;
    if (initial.discovered.length + initial.processed.length + initial.queue.length > 0 || initial.current !== null || initial.neighbor !== null) {
        c.add('steps[0].state: 초기 상태는 배열이 모두 비어 있고 current·neighbor가 null이어야 합니다');
    }

    // 아래 전이 규칙은 "어떤 operation이 나타났을 때" 적용된다. 시작 노드의 발견이 아예 없는 trace
    // (initial 바로 다음이 finish 등)는 어느 규칙에도 걸리지 않으므로 첫 연산을 명시적으로 요구한다.
    // steps는 구조 검사에서 2개 이상임이 확인되었다.
    if (steps[1].operation !== 'discover') {
        c.add(`steps[1](${steps[1].operation}): 첫 연산은 시작 노드 ${start}의 발견(discover)이어야 합니다. 시작 노드를 발견하지 않고는 탐색할 수 없습니다`);
    }

    const checked = new Map(); // current 노드 -> 지금까지 검사한 이웃 수
    for (let i = 1; i < steps.length; i += 1) {
        const prev = steps[i - 1].state;
        const cur = steps[i].state;
        const operation = steps[i].operation;
        const next = steps[i + 1];
        const at = `steps[${i}](${operation})`;
        const keep = (...keys) => {
            for (const key of keys) {
                const same = Array.isArray(prev[key]) ? sameArray(prev[key], cur[key]) : prev[key] === cur[key];
                if (!same) c.add(`${at}: ${key}은(는) 이 operation에서 바뀌면 안 됩니다`);
            }
        };

        switch (operation) {
            case 'discover': {
                const appended = cur.discovered.length === prev.discovered.length + 1 && sameArray(cur.discovered.slice(0, -1), prev.discovered);
                if (!appended) {
                    c.add(`${at}: discovered는 이전 목록 끝에 노드 하나만 추가해야 합니다`);
                } else {
                    const node = cur.discovered[cur.discovered.length - 1];
                    if (prev.neighbor === null) {
                        if (prev.discovered.length !== 0 || node !== start) c.add(`${at}: 이웃 검사 없이 발견할 수 있는 노드는 시작 노드 ${start}뿐입니다 (${node})`);
                        if (cur.neighbor !== null) c.add(`${at}: 시작 노드를 발견할 때 neighbor는 null이어야 합니다`);
                    } else {
                        if (node !== prev.neighbor) c.add(`${at}: 방금 검사한 이웃 ${prev.neighbor}만 발견으로 기록할 수 있습니다 (${node})`);
                        if (cur.neighbor !== prev.neighbor) c.add(`${at}: neighbor는 ${prev.neighbor}로 유지되어야 합니다`);
                    }
                }
                keep('processed', 'queue', 'current');
                if (next && next.operation !== 'enqueue') c.add(`${at}: 발견한 노드는 바로 큐에 넣어야 하므로 다음 step은 enqueue여야 합니다 (${next.operation})`);
                break;
            }
            case 'enqueue': {
                if (steps[i - 1].operation !== 'discover') c.add(`${at}: enqueue는 discover 바로 다음에만 올 수 있습니다 (${steps[i - 1].operation} 다음)`);
                const lastDiscovered = prev.discovered[prev.discovered.length - 1];
                if (!sameArray(cur.queue, [...prev.queue, lastDiscovered])) c.add(`${at}: queue 끝에 방금 발견한 노드 ${lastDiscovered}만 추가해야 합니다`);
                keep('discovered', 'processed', 'current', 'neighbor');
                break;
            }
            case 'dequeue': {
                if (prev.queue.length === 0) {
                    c.add(`${at}: 큐가 비어 있어 꺼낼 수 없습니다`);
                } else {
                    if (!sameArray(cur.queue, prev.queue.slice(1))) c.add(`${at}: queue 맨 앞의 ${prev.queue[0]}만 꺼내야 합니다`);
                    if (cur.current !== prev.queue[0]) c.add(`${at}: current는 꺼낸 노드 ${prev.queue[0]}여야 합니다 (${show(cur.current)})`);
                }
                if (prev.current !== null) c.add(`${at}: 아직 처리 중인 노드 ${prev.current}가 있는데 새 노드를 꺼낼 수 없습니다`);
                if (cur.neighbor !== null) c.add(`${at}: neighbor는 null이어야 합니다`);
                keep('discovered', 'processed');
                break;
            }
            case 'check-neighbor': {
                if (prev.current === null) {
                    c.add(`${at}: 현재 노드가 없는데 이웃을 검사할 수 없습니다`);
                } else {
                    const neighbors = graph[prev.current];
                    const index = checked.get(prev.current) ?? 0;
                    if (index >= neighbors.length) {
                        c.add(`${at}: ${prev.current}의 이웃을 이미 모두 검사했습니다`);
                    } else if (cur.neighbor !== neighbors[index]) {
                        c.add(`${at}: ${prev.current}의 ${index + 1}번째 이웃 ${neighbors[index]}를 검사해야 합니다. 이웃은 입력 배열의 순서대로 한 번씩 검사합니다 (${show(cur.neighbor)})`);
                    }
                    checked.set(prev.current, index + 1);
                }
                keep('discovered', 'processed', 'queue', 'current');
                if (next && cur.neighbor !== null) {
                    const undiscovered = !cur.discovered.includes(cur.neighbor);
                    if (undiscovered && next.operation !== 'discover') {
                        c.add(`${at}: 아직 발견하지 않은 이웃 ${cur.neighbor}를 건너뛰었습니다. 다음 step은 discover여야 합니다 (${next.operation})`);
                    }
                    if (!undiscovered && !['check-neighbor', 'process'].includes(next.operation)) {
                        c.add(`${at}: 이미 발견한 이웃 ${cur.neighbor}는 건너뛰어야 합니다. 다음 step은 check-neighbor 또는 process여야 합니다 (${next.operation})`);
                    }
                }
                break;
            }
            case 'process': {
                if (prev.current === null) {
                    c.add(`${at}: 현재 노드가 없는데 처리를 마칠 수 없습니다`);
                } else {
                    const total = graph[prev.current].length;
                    const done = checked.get(prev.current) ?? 0;
                    if (done !== total) c.add(`${at}: ${prev.current}의 이웃 ${total}개 중 ${done}개만 검사했습니다. 모두 검사한 뒤에 처리를 마칠 수 있습니다`);
                    if (!sameArray(cur.processed, [...prev.processed, prev.current])) c.add(`${at}: processed 끝에 ${prev.current}만 추가해야 합니다`);
                }
                if (cur.current !== null || cur.neighbor !== null) c.add(`${at}: current와 neighbor는 null이어야 합니다`);
                keep('discovered', 'queue');
                if (next) {
                    const expected = cur.queue.length > 0 ? 'dequeue' : 'finish';
                    if (next.operation !== expected) c.add(`${at}: 큐가 ${cur.queue.length > 0 ? '남아 있으므로' : '비었으므로'} 다음 step은 ${expected}여야 합니다 (${next.operation})`);
                }
                break;
            }
            case 'finish': {
                if (prev.queue.length > 0) c.add(`${at}: 큐에 ${prev.queue.length}개가 남아 있어 종료할 수 없습니다`);
                if (prev.current !== null) c.add(`${at}: 처리 중인 노드 ${prev.current}가 있어 종료할 수 없습니다`);
                keep('discovered', 'processed', 'queue', 'current', 'neighbor');
                break;
            }
            default:
                // initial·알 수 없는 operation은 구조 검사에서 이미 보고했다.
                break;
        }
    }
    // 최종 결과를 입력에서 따로 계산한 BFS와 비교한다. 규칙이 완전하다면 항상 같지만, 규칙에 빈틈이 있을 때
    // (예: 시작 노드를 발견하지 않고 종료하는 trace가 한때 통과했다) 이 독립 계산이 마지막 방어선이 된다.
    const expected = referenceBfs(graph, start);
    const last = steps[steps.length - 1].state;
    if (!sameArray(last.discovered, expected.discovered)) {
        c.add(`최종 상태: discovered가 BFS 결과와 다릅니다 (기대 ${show(expected.discovered)}, 실제 ${show(last.discovered)})`);
    }
    if (!sameArray(last.processed, expected.processed)) {
        c.add(`최종 상태: processed가 BFS 처리 순서와 다릅니다 (기대 ${show(expected.processed)}, 실제 ${show(last.processed)})`);
    }
}

// ---------- DFS ----------

/** DFS state의 모양과 불변식. 전이 검사를 해도 안전하면 true. */
function checkDfsState(state, path, graph, c) {
    if (!isPlainObject(state)) {
        c.add(`${path}: 객체여야 합니다 (${typeName(state)})`);
        return false;
    }
    const before = c.total;
    if (!checkKeys(state, STATE_KEYS.dfs, path, c)) return false;

    if (!Array.isArray(state.frames)) {
        c.add(`${path}.frames: 배열이어야 합니다 (${typeName(state.frames)})`);
    } else {
        const onStack = new Set();
        state.frames.forEach((frame, i) => {
            const framePath = `${path}.frames[${i}]`;
            if (!isPlainObject(frame) || !checkKeys(frame, ['node', 'nextNeighborIndex'], framePath, c)) {
                if (!isPlainObject(frame)) c.add(`${framePath}: {node, nextNeighborIndex} 객체여야 합니다`);
                return;
            }
            if (typeof frame.node !== 'string' || !has(graph, frame.node)) {
                c.add(`${framePath}.node: ${show(frame.node)}는 graph에 없는 노드입니다`);
                return;
            }
            if (onStack.has(frame.node)) c.add(`${framePath}.node: ${frame.node}가 호출 스택에 두 번 있습니다(이미 발견한 노드는 다시 호출하지 않습니다)`);
            onStack.add(frame.node);
            const total = graph[frame.node].length;
            if (!Number.isInteger(frame.nextNeighborIndex) || frame.nextNeighborIndex < 0 || frame.nextNeighborIndex > total) {
                c.add(`${framePath}.nextNeighborIndex: 0~${total} 범위의 정수여야 합니다 (${show(frame.nextNeighborIndex)})`);
            }
        });
    }
    for (const key of ['discovered', 'processed']) checkNodeList(state[key], key, path, graph, c);
    checkOptionalNode(state.current, 'current', path, graph, c);
    if (c.total !== before) return false;

    const discovered = new Set(state.discovered);
    const top = state.frames[state.frames.length - 1];
    if (state.current !== (top === undefined ? null : top.node)) {
        c.add(`${path}.current: 호출 스택의 꼭대기 노드와 같아야 합니다 (기대 ${show(top === undefined ? null : top.node)}, 실제 ${show(state.current)})`);
    }
    state.frames.forEach((frame, i) => {
        // 방금 호출한 꼭대기 frame만 아직 발견으로 기록되기 전일 수 있다(call과 discover 사이).
        const justCalled = i === state.frames.length - 1 && frame.nextNeighborIndex === 0;
        if (!discovered.has(frame.node) && !justCalled) c.add(`${path}.frames[${i}].node: ${frame.node}는 아직 발견하지 않은 노드입니다`);
    });
    state.processed.forEach((node) => {
        if (!discovered.has(node)) c.add(`${path}.processed: ${node}는 아직 발견하지 않은 노드입니다 (discovered에 없음)`);
        const frame = state.frames.find((item) => item.node === node);
        if (frame !== undefined && frame !== top) c.add(`${path}.processed: ${node}는 처리를 마쳤는데 호출 스택의 꼭대기가 아닙니다`);
    });
    return c.total === before;
}

/** 입력만으로 계산한 DFS(재귀)의 발견 순서(전위)와 처리 순서(후위). 전이 규칙과 별개의 기준(oracle)이다. */
function referenceDfs(graph, start) {
    const discovered = [];
    const processed = [];
    const visit = (node) => {
        discovered.push(node);
        for (const neighbor of graph[node]) if (!discovered.includes(neighbor)) visit(neighbor);
        processed.push(node);
    };
    visit(start);
    return { discovered, processed };
}

const sameFrames = (a, b) => a.length === b.length && a.every((frame, i) => frame.node === b[i].node && frame.nextNeighborIndex === b[i].nextNeighborIndex);

function validateDfs(bundle, c) {
    const { graph, start } = bundle.input;
    const { steps } = bundle;

    let shapeOk = true;
    steps.forEach((step, i) => {
        if (!checkDfsState(step.state, `steps[${i}].state`, graph, c)) shapeOk = false;
    });
    if (!shapeOk) return;

    const initial = steps[0].state;
    if (initial.frames.length + initial.discovered.length + initial.processed.length > 0 || initial.current !== null) {
        c.add('steps[0].state: 초기 상태는 frames·discovered·processed가 비어 있고 current가 null이어야 합니다');
    }
    if (steps[1].operation !== 'call') {
        c.add(`steps[1](${steps[1].operation}): 첫 연산은 시작 노드 ${start}의 호출(call)이어야 합니다`);
    }

    for (let i = 1; i < steps.length; i += 1) {
        const prev = steps[i - 1].state;
        const cur = steps[i].state;
        const prevOperation = steps[i - 1].operation;
        const operation = steps[i].operation;
        const next = steps[i + 1];
        const at = `steps[${i}](${operation})`;
        const prevTop = prev.frames[prev.frames.length - 1];
        const keep = (...keys) => {
            for (const key of keys) {
                const same = key === 'frames' ? sameFrames(prev.frames, cur.frames) : Array.isArray(prev[key]) ? sameArray(prev[key], cur[key]) : prev[key] === cur[key];
                if (!same) c.add(`${at}: ${key}은(는) 이 operation에서 바뀌면 안 됩니다`);
            }
        };
        const resumed = ['discover', 'check-neighbor', 'return'];

        switch (operation) {
            case 'call': {
                const pushed = cur.frames.length === prev.frames.length + 1 && sameFrames(cur.frames.slice(0, -1), prev.frames);
                const frame = cur.frames[cur.frames.length - 1];
                if (!pushed) {
                    c.add(`${at}: frames 끝에 frame 하나만 추가해야 합니다`);
                } else {
                    if (frame.nextNeighborIndex !== 0) c.add(`${at}: 새 frame의 nextNeighborIndex는 0이어야 합니다 (${frame.nextNeighborIndex})`);
                    if (prevTop === undefined) {
                        if (frame.node !== start || prev.discovered.length !== 0) c.add(`${at}: 처음 호출은 시작 노드 ${start}여야 합니다 (${frame.node})`);
                    } else {
                        const neighbor = graph[prevTop.node][prevTop.nextNeighborIndex - 1];
                        if (prevOperation !== 'check-neighbor') c.add(`${at}: 이웃 호출은 check-neighbor 바로 다음에만 올 수 있습니다 (${prevOperation} 다음)`);
                        else if (frame.node !== neighbor) c.add(`${at}: 방금 검사한 이웃 ${neighbor}만 호출할 수 있습니다 (${frame.node})`);
                        else if (prev.discovered.includes(neighbor)) c.add(`${at}: 이미 발견한 노드 ${neighbor}는 다시 호출하지 않습니다`);
                    }
                }
                keep('discovered', 'processed');
                if (next && next.operation !== 'discover') c.add(`${at}: 호출한 노드는 바로 발견으로 기록해야 하므로 다음 step은 discover여야 합니다 (${next.operation})`);
                break;
            }
            case 'discover': {
                if (prevOperation !== 'call') c.add(`${at}: discover는 call 바로 다음에만 올 수 있습니다 (${prevOperation} 다음)`);
                if (prev.current === null || !sameArray(cur.discovered, [...prev.discovered, prev.current])) c.add(`${at}: discovered 끝에 방금 호출한 노드 ${show(prev.current)}만 추가해야 합니다`);
                keep('frames', 'processed', 'current');
                break;
            }
            case 'check-neighbor': {
                if (!resumed.includes(prevOperation)) c.add(`${at}: 이웃 검사는 discover, check-neighbor, return 다음에만 올 수 있습니다 (${prevOperation} 다음)`);
                if (prevTop === undefined) {
                    c.add(`${at}: 호출 스택이 비어 있어 이웃을 검사할 수 없습니다`);
                } else if (prevTop.nextNeighborIndex >= graph[prevTop.node].length) {
                    c.add(`${at}: ${prevTop.node}의 이웃을 이미 모두 검사했습니다`);
                } else {
                    const expected = [...prev.frames.slice(0, -1), { node: prevTop.node, nextNeighborIndex: prevTop.nextNeighborIndex + 1 }];
                    if (!sameFrames(cur.frames, expected)) c.add(`${at}: 꼭대기 frame(${prevTop.node})의 nextNeighborIndex만 ${prevTop.nextNeighborIndex}에서 ${prevTop.nextNeighborIndex + 1}로 1 늘려야 합니다`);
                    if (next) {
                        const neighbor = graph[prevTop.node][prevTop.nextNeighborIndex];
                        const remaining = prevTop.nextNeighborIndex + 1 < graph[prevTop.node].length;
                        const undiscovered = !cur.discovered.includes(neighbor);
                        const expectedNext = undiscovered ? 'call' : remaining ? 'check-neighbor' : 'process';
                        if (next.operation !== expectedNext) {
                            c.add(`${at}: 이웃 ${neighbor}는 ${undiscovered ? '아직 발견하지 않았으므로 호출' : remaining ? '이미 발견했으므로 건너뛰고 다음 이웃 검사' : '이미 발견했고 남은 이웃이 없으므로 처리 완료'}로 이어져야 합니다. 다음 step은 ${withCopula(expectedNext)} 합니다 (${next.operation})`);
                        }
                    }
                }
                keep('discovered', 'processed', 'current');
                break;
            }
            case 'process': {
                if (!resumed.includes(prevOperation)) c.add(`${at}: 처리 완료는 discover, check-neighbor, return 다음에만 올 수 있습니다 (${prevOperation} 다음)`);
                if (prevTop === undefined) {
                    c.add(`${at}: 호출 스택이 비어 있어 처리를 마칠 수 없습니다`);
                } else {
                    const total = graph[prevTop.node].length;
                    if (prevTop.nextNeighborIndex !== total) c.add(`${at}: ${prevTop.node}의 이웃 ${total}개 중 ${prevTop.nextNeighborIndex}개만 검사했습니다. 모두 검사한 뒤에 처리를 마칠 수 있습니다`);
                    if (!sameArray(cur.processed, [...prev.processed, prevTop.node])) c.add(`${at}: processed 끝에 ${prevTop.node}만 추가해야 합니다`);
                }
                keep('frames', 'discovered', 'current');
                if (next && next.operation !== 'return') c.add(`${at}: 처리를 마친 노드는 호출이 끝나야 하므로 다음 step은 return이어야 합니다 (${next.operation})`);
                break;
            }
            case 'return': {
                if (prevOperation !== 'process') c.add(`${at}: return은 process 바로 다음에만 올 수 있습니다 (${prevOperation} 다음)`);
                if (prevTop === undefined || !sameFrames(cur.frames, prev.frames.slice(0, -1))) c.add(`${at}: frames의 꼭대기 frame 하나만 빼야 합니다`);
                keep('discovered', 'processed');
                if (next) {
                    const top = cur.frames[cur.frames.length - 1];
                    if (top === undefined) {
                        c.add(`${at}: 호출 스택이 비었으므로 마지막 step이어야 합니다`);
                    } else {
                        const expectedNext = top.nextNeighborIndex < graph[top.node].length ? 'check-neighbor' : 'process';
                        if (next.operation !== expectedNext) c.add(`${at}: ${top.node}로 돌아왔으므로 다음 step은 ${withCopula(expectedNext)} 합니다 (${next.operation})`);
                    }
                }
                break;
            }
            default:
                break;
        }
    }

    // 마지막 step이 return이면 호출 스택이 비어 있어야 한다.
    const last = steps[steps.length - 1].state;
    if (last.frames.length > 0) c.add(`최종 상태: 호출 스택에 ${last.frames.length}개가 남아 있습니다. 모든 호출이 끝나야 합니다`);

    const expected = referenceDfs(graph, start);
    if (!sameArray(last.discovered, expected.discovered)) c.add(`최종 상태: discovered가 DFS 결과와 다릅니다 (기대 ${show(expected.discovered)}, 실제 ${show(last.discovered)})`);
    if (!sameArray(last.processed, expected.processed)) c.add(`최종 상태: processed가 DFS 처리(후위) 순서와 다릅니다 (기대 ${show(expected.processed)}, 실제 ${show(last.processed)})`);
}

// ---------- 이분 탐색 ----------

function checkBinarySearchState(state, path, input, c) {
    if (!isPlainObject(state)) {
        c.add(`${path}: 객체여야 합니다 (${typeName(state)})`);
        return false;
    }
    const before = c.total;
    if (!checkKeys(state, STATE_KEYS['binary-search'], path, c)) return false;
    const n = input.values.length;
    if (!sameArray(state.values, input.values)) c.add(`${path}.values: input.values와 같아야 합니다 (이분 탐색은 배열을 바꾸지 않습니다)`);
    if (state.target !== input.target) c.add(`${path}.target: input.target(${input.target})과 같아야 합니다 (${show(state.target)})`);
    const inRange = (value, min, max, key) => {
        if (!Number.isInteger(value) || value < min || value > max) c.add(`${path}.${key}: ${min}~${max} 범위의 정수여야 합니다 (${show(value)})`);
    };
    inRange(state.left, 0, n, 'left');
    inRange(state.right, -1, n - 1, 'right');
    if (state.mid !== null) inRange(state.mid, 0, n - 1, 'mid');
    if (state.result !== null) inRange(state.result, -1, n - 1, 'result');
    return c.total === before;
}

/** 입력만으로 계산한 이분 탐색의 결과 인덱스(같은 값이 여럿이면 이 알고리즘이 처음 만나는 인덱스). 전이 규칙과 별개의 기준이다. */
function referenceBinarySearch(values, target) {
    let left = 0;
    let right = values.length - 1;
    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        if (values[mid] === target) return mid;
        if (values[mid] < target) left = mid + 1;
        else right = mid - 1;
    }
    return -1;
}

function validateBinarySearch(bundle, c) {
    const { input, steps } = bundle;
    const n = input.values.length;

    let shapeOk = true;
    steps.forEach((step, i) => {
        if (!checkBinarySearchState(step.state, `steps[${i}].state`, input, c)) shapeOk = false;
    });
    if (!shapeOk) return;

    const initial = steps[0].state;
    if (initial.left !== 0 || initial.right !== n - 1 || initial.mid !== null || initial.result !== null) {
        c.add(`steps[0].state: 초기 상태는 left = 0, right = ${n - 1}, mid·result는 null이어야 합니다`);
    }
    // 구간이 있으면 중간 위치부터 계산하고, 없으면(빈 배열) 바로 종료한다.
    const expectedFirst = n > 0 ? 'compute-mid' : 'finish';
    if (steps[1].operation !== expectedFirst) c.add(`steps[1](${steps[1].operation}): 첫 연산은 ${withCopula(expectedFirst)} 합니다 (${n === 0 ? '배열이 비어 있어 구간이 없습니다' : '구간이 있으므로 중간 위치부터 계산합니다'})`);

    // 한 라운드(initial, set-left, set-right) 뒤에는 구간이 남았는지로 다음 연산이 정해진다.
    const expectAfterRound = (state) => (state.left <= state.right ? 'compute-mid' : 'finish');

    for (let i = 1; i < steps.length; i += 1) {
        const prev = steps[i - 1].state;
        const cur = steps[i].state;
        const prevOperation = steps[i - 1].operation;
        const operation = steps[i].operation;
        const next = steps[i + 1];
        const at = `steps[${i}](${operation})`;
        const keep = (...keys) => {
            for (const key of keys) if (prev[key] !== cur[key]) c.add(`${at}: ${key}은(는) 이 operation에서 바뀌면 안 됩니다 (${show(prev[key])} → ${show(cur[key])})`);
        };
        const startsRound = ['initial', 'set-left', 'set-right'].includes(prevOperation);

        switch (operation) {
            case 'compute-mid': {
                if (!startsRound) c.add(`${at}: 중간 위치 계산은 initial, set-left, set-right 다음에만 올 수 있습니다 (${prevOperation} 다음)`);
                if (prev.left > prev.right) c.add(`${at}: 구간이 비어 있는데(left = ${prev.left} > right = ${prev.right}) 중간 위치를 계산할 수 없습니다`);
                else if (cur.mid !== Math.floor((prev.left + prev.right) / 2)) c.add(`${at}: mid는 floor((${prev.left} + ${prev.right}) / 2) = ${Math.floor((prev.left + prev.right) / 2)}여야 합니다 (${show(cur.mid)})`);
                keep('left', 'right', 'result');
                if (next && next.operation !== 'compare') c.add(`${at}: 다음 step은 compare여야 합니다 (${next.operation})`);
                break;
            }
            case 'compare': {
                if (prevOperation !== 'compute-mid') c.add(`${at}: compare는 compute-mid 바로 다음에만 올 수 있습니다 (${prevOperation} 다음)`);
                keep('left', 'right', 'mid', 'result');
                if (next && cur.mid !== null) {
                    const value = cur.values[cur.mid];
                    const expectedNext = value === cur.target ? 'found' : value < cur.target ? 'set-left' : 'set-right';
                    if (next.operation !== expectedNext) c.add(`${at}: values[${cur.mid}] = ${value}, target = ${cur.target}이므로 다음 step은 ${withCopula(expectedNext)} 합니다 (${next.operation})`);
                }
                break;
            }
            case 'set-left': {
                if (prevOperation !== 'compare' || prev.mid === null) c.add(`${at}: set-left는 compare 바로 다음에만 올 수 있습니다 (${prevOperation} 다음)`);
                else if (!(prev.values[prev.mid] < prev.target)) c.add(`${at}: values[${prev.mid}] = ${prev.values[prev.mid]}이 target ${prev.target}보다 작을 때만 왼쪽 경계를 옮길 수 있습니다`);
                if (prev.mid !== null && cur.left !== prev.mid + 1) c.add(`${at}: left는 mid + 1 = ${prev.mid + 1}이어야 합니다 (${show(cur.left)})`);
                keep('right', 'mid', 'result');
                if (next && next.operation !== expectAfterRound(cur)) c.add(`${at}: 구간이 ${cur.left <= cur.right ? '남았으므로' : '비었으므로'} 다음 step은 ${withCopula(expectAfterRound(cur))} 합니다 (${next.operation})`);
                break;
            }
            case 'set-right': {
                if (prevOperation !== 'compare' || prev.mid === null) c.add(`${at}: set-right는 compare 바로 다음에만 올 수 있습니다 (${prevOperation} 다음)`);
                else if (!(prev.values[prev.mid] > prev.target)) c.add(`${at}: values[${prev.mid}] = ${prev.values[prev.mid]}이 target ${prev.target}보다 클 때만 오른쪽 경계를 옮길 수 있습니다`);
                if (prev.mid !== null && cur.right !== prev.mid - 1) c.add(`${at}: right는 mid - 1 = ${prev.mid - 1}이어야 합니다 (${show(cur.right)})`);
                keep('left', 'mid', 'result');
                if (next && next.operation !== expectAfterRound(cur)) c.add(`${at}: 구간이 ${cur.left <= cur.right ? '남았으므로' : '비었으므로'} 다음 step은 ${withCopula(expectAfterRound(cur))} 합니다 (${next.operation})`);
                break;
            }
            case 'found': {
                if (prevOperation !== 'compare' || prev.mid === null) c.add(`${at}: found는 compare 바로 다음에만 올 수 있습니다 (${prevOperation} 다음)`);
                else if (prev.values[prev.mid] !== prev.target) c.add(`${at}: values[${prev.mid}] = ${prev.values[prev.mid]}이 target ${prev.target}과 다른데 찾았다고 할 수 없습니다`);
                if (cur.result !== prev.mid || cur.mid !== null) c.add(`${at}: result는 mid(${show(prev.mid)})이고 mid는 null이어야 합니다 (result ${show(cur.result)}, mid ${show(cur.mid)})`);
                keep('left', 'right');
                break;
            }
            case 'finish': {
                if (!startsRound) c.add(`${at}: 구간이 비어서 끝나는 finish는 initial, set-left, set-right 다음에만 올 수 있습니다 (${prevOperation} 다음)`);
                if (prev.left <= prev.right) c.add(`${at}: 구간이 아직 남아 있는데(left = ${prev.left} <= right = ${prev.right}) 종료할 수 없습니다`);
                if (cur.result !== -1 || cur.mid !== null) c.add(`${at}: 찾지 못했으므로 result는 -1이고 mid는 null이어야 합니다 (result ${show(cur.result)}, mid ${show(cur.mid)})`);
                keep('left', 'right');
                break;
            }
            default:
                break;
        }
    }

    const expected = referenceBinarySearch(input.values, input.target);
    const last = steps[steps.length - 1].state;
    if (last.result !== expected) c.add(`최종 상태: result가 이분 탐색 결과와 다릅니다 (기대 ${expected}, 실제 ${show(last.result)})`);
}

// ---------- 버블 정렬 ----------

function checkBubbleSortState(state, path, input, c) {
    if (!isPlainObject(state)) {
        c.add(`${path}: 객체여야 합니다 (${typeName(state)})`);
        return false;
    }
    const before = c.total;
    if (!checkKeys(state, STATE_KEYS['bubble-sort'], path, c)) return false;
    const n = input.values.length;
    if (!checkIntegerArray(state.values, `${path}.values`, c)) return false;
    if (state.values.length !== n) c.add(`${path}.values: 길이가 input.values와 같아야 합니다 (${state.values.length}개, 기대 ${n}개)`);
    else if (!sameArray([...state.values].sort((a, b) => a - b), [...input.values].sort((a, b) => a - b))) c.add(`${path}.values: input.values와 같은 원소를 가진 순열이어야 합니다 (교환만으로는 원소가 늘거나 줄지 않습니다)`);

    const indices = state.compareIndices;
    if (indices !== null) {
        if (!Array.isArray(indices) || indices.length !== 2 || !indices.every(Number.isInteger)) c.add(`${path}.compareIndices: null이거나 정수 두 개의 배열이어야 합니다 (${show(indices)})`);
        else if (indices[0] < 0 || indices[1] !== indices[0] + 1 || indices[1] >= n) c.add(`${path}.compareIndices: 배열 안의 인접한 두 위치 [j, j + 1]이어야 합니다 (${show(indices)})`);
    }
    if (typeof state.swapped !== 'boolean') c.add(`${path}.swapped: true 또는 false여야 합니다 (${show(state.swapped)})`);
    if (!Number.isInteger(state.sortedFrom) || state.sortedFrom < 0 || state.sortedFrom > n) c.add(`${path}.sortedFrom: 0~${n} 범위의 정수여야 합니다 (${show(state.sortedFrom)})`);
    return c.total === before;
}

/** 입력만으로 센 정렬 결과, 교환 횟수(= 역순 쌍의 수), 비교 횟수. 전이 규칙과 별개의 기준이다. */
function referenceBubbleSort(values) {
    const n = values.length;
    let inversions = 0;
    for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) if (values[i] > values[j]) inversions += 1;
    return { sorted: [...values].sort((a, b) => a - b), swaps: inversions, compares: n < 2 ? 0 : (n * (n - 1)) / 2 };
}

function validateBubbleSort(bundle, c) {
    const { input, steps } = bundle;
    const n = input.values.length;

    let shapeOk = true;
    steps.forEach((step, i) => {
        if (!checkBubbleSortState(step.state, `steps[${i}].state`, input, c)) shapeOk = false;
    });
    if (!shapeOk) return;

    const initial = steps[0].state;
    if (!sameArray(initial.values, input.values) || initial.compareIndices !== null || initial.swapped !== false || initial.sortedFrom !== n) {
        c.add(`steps[0].state: 초기 상태는 values가 input과 같고 compareIndices는 null, swapped는 false, sortedFrom은 ${n}이어야 합니다`);
    }

    const expectedFirst = n >= 2 ? 'compare' : 'finish';
    if (steps[1].operation !== expectedFirst) c.add(`steps[1](${steps[1].operation}): 첫 연산은 ${withCopula(expectedFirst)} 합니다 (원소가 ${n}개)`);

    const afterCompareOrSwap = (state) => (state.compareIndices[1] + 1 < state.sortedFrom ? 'compare' : 'mark-sorted');
    for (let i = 1; i < steps.length; i += 1) {
        const prev = steps[i - 1].state;
        const cur = steps[i].state;
        const prevOperation = steps[i - 1].operation;
        const operation = steps[i].operation;
        const next = steps[i + 1];
        const at = `steps[${i}](${operation})`;
        const keepValues = () => {
            if (!sameArray(prev.values, cur.values)) c.add(`${at}: values는 이 operation에서 바뀌면 안 됩니다`);
        };

        switch (operation) {
            case 'compare': {
                if (!['initial', 'compare', 'swap', 'mark-sorted'].includes(prevOperation)) c.add(`${at}: 비교는 initial, compare, swap, mark-sorted 다음에만 올 수 있습니다 (${prevOperation} 다음)`);
                // 새 패스(initial, mark-sorted 다음)는 0번 위치부터, 같은 패스에서는 한 칸씩 오른쪽으로 간다.
                const j = ['initial', 'mark-sorted'].includes(prevOperation) || prev.compareIndices === null ? 0 : prev.compareIndices[0] + 1;
                if (cur.compareIndices === null || cur.compareIndices[0] !== j) c.add(`${at}: compareIndices는 [${j}, ${j + 1}]이어야 합니다 (${show(cur.compareIndices)})`);
                const comparedEnd = cur.compareIndices === null ? j + 1 : cur.compareIndices[1];
                if (Math.max(j + 1, comparedEnd) >= cur.sortedFrom) c.add(`${at}: 인덱스 ${Math.max(j + 1, comparedEnd)}은 이미 자리가 확정된 구간(sortedFrom = ${cur.sortedFrom})이라 비교할 수 없습니다`);
                if (cur.swapped !== false) c.add(`${at}: 비교 직후에는 swapped가 false여야 합니다`);
                keepValues();
                if (prev.sortedFrom !== cur.sortedFrom) c.add(`${at}: sortedFrom은 이 operation에서 바뀌면 안 됩니다`);
                if (next && cur.compareIndices !== null) {
                    const [a, b] = cur.compareIndices;
                    const expectedNext = cur.values[a] > cur.values[b] ? 'swap' : afterCompareOrSwap(cur);
                    if (next.operation !== expectedNext) c.add(`${at}: values[${a}] = ${cur.values[a]}, values[${b}] = ${cur.values[b]}이므로 다음 step은 ${withCopula(expectedNext)} 합니다 (${next.operation})`);
                }
                break;
            }
            case 'swap': {
                if (prevOperation !== 'compare' || prev.compareIndices === null) {
                    c.add(`${at}: 교환은 compare 바로 다음에만 올 수 있습니다 (${prevOperation} 다음)`);
                } else {
                    const [a, b] = prev.compareIndices;
                    if (!(prev.values[a] > prev.values[b])) c.add(`${at}: values[${a}] = ${prev.values[a]}이 values[${b}] = ${prev.values[b]}보다 클 때만 교환할 수 있습니다(같은 값은 교환하지 않습니다)`);
                    const expected = [...prev.values];
                    [expected[a], expected[b]] = [expected[b], expected[a]];
                    if (!sameArray(cur.values, expected)) c.add(`${at}: values의 ${a}번과 ${b}번 원소만 서로 바꿔야 합니다`);
                    if (!sameArray(cur.compareIndices ?? [], prev.compareIndices)) c.add(`${at}: compareIndices는 비교한 위치 [${a}, ${b}]를 유지해야 합니다`);
                }
                if (cur.swapped !== true) c.add(`${at}: 교환 직후에는 swapped가 true여야 합니다`);
                if (prev.sortedFrom !== cur.sortedFrom) c.add(`${at}: sortedFrom은 이 operation에서 바뀌면 안 됩니다`);
                if (next && cur.compareIndices !== null && next.operation !== afterCompareOrSwap(cur)) c.add(`${at}: 다음 step은 ${withCopula(afterCompareOrSwap(cur))} 합니다 (${next.operation})`);
                break;
            }
            case 'mark-sorted': {
                if (!['compare', 'swap'].includes(prevOperation) || prev.compareIndices === null) {
                    c.add(`${at}: 정렬 확정은 compare 또는 swap 다음에만 올 수 있습니다 (${prevOperation} 다음)`);
                } else if (prev.compareIndices[1] + 1 !== prev.sortedFrom) {
                    c.add(`${at}: 패스가 아직 끝나지 않았습니다(마지막으로 비교한 위치 ${prev.compareIndices[1]}, 확정된 구간 시작 ${prev.sortedFrom})`);
                }
                if (cur.sortedFrom !== prev.sortedFrom - 1) c.add(`${at}: sortedFrom은 ${prev.sortedFrom}에서 1 줄어든 ${prev.sortedFrom - 1}이어야 합니다 (${cur.sortedFrom})`);
                if (cur.compareIndices !== null || cur.swapped !== false) c.add(`${at}: compareIndices는 null, swapped는 false여야 합니다`);
                keepValues();
                if (next) {
                    const expectedNext = cur.sortedFrom > 1 ? 'compare' : 'finish';
                    if (next.operation !== expectedNext) c.add(`${at}: ${cur.sortedFrom > 1 ? '다음 패스가 남았으므로' : '모든 패스가 끝났으므로'} 다음 step은 ${withCopula(expectedNext)} 합니다 (${next.operation})`);
                }
                break;
            }
            case 'finish': {
                if (prevOperation === 'initial') {
                    if (n >= 2) c.add(`${at}: 원소가 ${n}개라서 비교 없이 끝날 수 없습니다`);
                } else if (prevOperation !== 'mark-sorted' || prev.sortedFrom !== 1) {
                    c.add(`${at}: finish는 마지막 패스를 마친 뒤(mark-sorted, sortedFrom = 1)에만 올 수 있습니다 (${prevOperation} 다음)`);
                }
                if (cur.sortedFrom !== 0 || cur.compareIndices !== null || cur.swapped !== false) c.add(`${at}: sortedFrom은 0, compareIndices는 null, swapped는 false여야 합니다`);
                keepValues();
                for (let k = 1; k < cur.values.length; k += 1) {
                    if (cur.values[k - 1] > cur.values[k]) {
                        c.add(`${at}: 종료했는데 values가 오름차순이 아닙니다 (${k - 1}번과 ${k}번)`);
                        break;
                    }
                }
                break;
            }
            default:
                break;
        }
    }

    // 최종 결과와 교환·비교 횟수를 입력에서 따로 계산한 값과 비교한다(교환 횟수는 입력의 역순 쌍의 수와 같다).
    const expected = referenceBubbleSort(input.values);
    const last = steps[steps.length - 1].state;
    if (!sameArray(last.values, expected.sorted)) c.add(`최종 상태: values가 입력을 오름차순으로 정렬한 결과와 다릅니다 (기대 ${show(expected.sorted)}, 실제 ${show(last.values)})`);
    const swaps = steps.filter((step) => step.operation === 'swap').length;
    const compares = steps.filter((step) => step.operation === 'compare').length;
    if (swaps !== expected.swaps) c.add(`교환 횟수가 입력의 역순 쌍의 수와 다릅니다 (기대 ${expected.swaps}번, 실제 ${swaps}번)`);
    if (compares !== expected.compares) c.add(`비교 횟수가 n(n - 1) / 2와 다릅니다 (기대 ${expected.compares}번, 실제 ${compares}번)`);
}

/** 알고리즘별 상태·전이 규칙 함수. 규칙 함수가 없는 알고리즘은 검증할 수 없으므로 거부한다. */
const ALGORITHM_RULES = Object.freeze({
    ...Object.fromEntries(EXTENDED_IDS.map(id => [id, validateLearning])),
    bfs: validateBfs,
    dfs: validateDfs,
    'binary-search': validateBinarySearch,
    'bubble-sort': validateBubbleSort,
});

// ---------- 공개 함수 ----------

/**
 * trace bundle을 검증한다. 어떤 값이 들어와도 예외를 던지지 않는다.
 * @param {unknown} bundle
 * @returns {import('./trace-contract.js').ValidationResult}
 */
export function validateBundle(bundle) {
    const c = new Collector();
    try {
        validateInto(bundle, c);
    } catch (error) {
        c.add(`검증 중 예기치 않은 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`);
    }
    return c.result();
}

function validateInto(bundle, c) {
    if (!isPlainObject(bundle)) {
        c.add(`bundle: 객체여야 합니다 (${typeName(bundle)})`);
        return;
    }
    findSharedReferences(bundle, c);

    try {
        const bytes = new TextEncoder().encode(JSON.stringify(bundle)).length;
        if (bytes > LIMITS.maxBundleBytes) c.add(`bundle: 크기가 ${LIMITS.maxBundleBytes}바이트를 넘습니다 (${bytes}바이트)`);
    } catch {
        c.add('bundle: JSON으로 변환할 수 없습니다(순환 참조 등)');
        return;
    }

    checkKeys(bundle, BUNDLE_KEYS, 'bundle', c);

    if (bundle.schemaVersion !== SCHEMA_VERSION) c.add(`schemaVersion: ${SCHEMA_VERSION}이어야 합니다 (${show(bundle.schemaVersion)})`);

    const algorithmId = ALGORITHM_IDS.includes(bundle.algorithmId) ? bundle.algorithmId : null;
    if (algorithmId === null) c.add(`algorithmId: 알 수 없는 알고리즘입니다 (${show(bundle.algorithmId)}, 허용: ${ALGORITHM_IDS.join(', ')})`);

    const exampleIdOk = typeof bundle.exampleId === 'string' && PATTERNS.exampleId.test(bundle.exampleId) && bundle.exampleId.length <= LIMITS.maxExampleIdLength;
    if (!exampleIdOk) c.add(`exampleId: 소문자·숫자·하이픈 형식의 ${LIMITS.maxExampleIdLength}자 이하여야 합니다 (${show(bundle.exampleId)})`);

    if (algorithmId !== null && exampleIdOk) {
        const prefix = `${algorithmId}-${bundle.exampleId}-v`;
        const version = typeof bundle.contentVersion === 'string' && bundle.contentVersion.startsWith(prefix) ? bundle.contentVersion.slice(prefix.length) : null;
        if (version === null || !/^[1-9][0-9]*$/.test(version)) {
            c.add(`contentVersion: ${prefix}<1 이상의 정수> 형식이어야 합니다 (${show(bundle.contentVersion)})`);
        }
    } else if (typeof bundle.contentVersion !== 'string') {
        c.add(`contentVersion: 문자열이어야 합니다 (${show(bundle.contentVersion)})`);
    }

    const languages = checkCodes(bundle.codes, c);
    const inputOk = algorithmId !== null && checkInput(algorithmId, bundle.input, c);
    if (algorithmId === null) return;

    const stepsOk = checkSteps(bundle, algorithmId, languages, c);
    if (!inputOk || !stepsOk) return;

    const rules = ALGORITHM_RULES[algorithmId];
    if (rules === undefined) {
        c.add(`state: ${algorithmId}의 상태·전이 규칙 검증기가 아직 없어 이 bundle을 승인할 수 없습니다`);
        return;
    }
    rules(bundle, c);
}

/**
 * catalog를 검증한다. 파일이 실제로 있는지는 확인하지 않는다(그것은 scripts/validate-traces.mjs의 일이다).
 * @param {unknown} catalog
 * @returns {import('./trace-contract.js').ValidationResult}
 */
export function validateCatalog(catalog) {
    const c = new Collector();
    try {
        validateCatalogInto(catalog, c);
    } catch (error) {
        c.add(`catalog 검증 중 예기치 않은 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`);
    }
    return c.result();
}

function validateCatalogInto(catalog, c) {
    if (!isPlainObject(catalog)) {
        c.add(`catalog: 객체여야 합니다 (${typeName(catalog)})`);
        return;
    }
    checkKeys(catalog, CATALOG_KEYS, 'catalog', c);
    if (catalog.schemaVersion !== SCHEMA_VERSION) c.add(`catalog.schemaVersion: ${SCHEMA_VERSION}이어야 합니다 (${show(catalog.schemaVersion)})`);
    if (!Array.isArray(catalog.algorithms)) {
        c.add(`catalog.algorithms: 배열이어야 합니다 (${typeName(catalog.algorithms)})`);
        return;
    }

    const seenAlgorithms = new Set();
    catalog.algorithms.forEach((algorithm, i) => {
        const path = `catalog.algorithms[${i}]`;
        if (!isPlainObject(algorithm)) {
            c.add(`${path}: 객체여야 합니다 (${typeName(algorithm)})`);
            return;
        }
        if (!checkKeys(algorithm, CATALOG_ALGORITHM_KEYS, path, c)) return;
        if (!ALGORITHM_IDS.includes(algorithm.id)) c.add(`${path}.id: 알 수 없는 알고리즘입니다 (${show(algorithm.id)})`);
        else if (seenAlgorithms.has(algorithm.id)) c.add(`${path}.id: ${algorithm.id}가 중복되었습니다`);
        seenAlgorithms.add(algorithm.id);
        if (typeof algorithm.title !== 'string' || algorithm.title.trim() === '') c.add(`${path}.title: 제목이 필요합니다`);
        if (!Array.isArray(algorithm.examples) || algorithm.examples.length === 0) {
            c.add(`${path}.examples: 예제가 하나 이상 필요합니다`);
            return;
        }

        const seenExamples = new Set();
        algorithm.examples.forEach((example, j) => {
            const examplePath = `${path}.examples[${j}]`;
            if (!isPlainObject(example)) {
                c.add(`${examplePath}: 객체여야 합니다 (${typeName(example)})`);
                return;
            }
            if (!checkKeys(example, CATALOG_EXAMPLE_KEYS, examplePath, c)) return;
            const idOk = typeof example.id === 'string' && PATTERNS.exampleId.test(example.id) && example.id.length <= LIMITS.maxExampleIdLength;
            if (!idOk) c.add(`${examplePath}.id: 소문자·숫자·하이픈 형식의 ${LIMITS.maxExampleIdLength}자 이하여야 합니다 (${show(example.id)})`);
            else if (seenExamples.has(example.id)) c.add(`${examplePath}.id: ${example.id}가 ${algorithm.id} 안에서 중복되었습니다`);
            seenExamples.add(example.id);
            if (typeof example.title !== 'string' || example.title.trim() === '') c.add(`${examplePath}.title: 제목이 필요합니다`);

            const expectedPath = `${algorithm.id}/${example.id}.json`;
            if (typeof example.path !== 'string' || !PATTERNS.bundlePath.test(example.path) || example.path !== expectedPath) {
                c.add(`${examplePath}.path: ${show(expectedPath)}이어야 합니다 (${show(example.path)}). 경로에 .., 절대 경로, 주소를 쓸 수 없습니다`);
            }
            if (!Array.isArray(example.languages) || example.languages.length === 0) {
                c.add(`${examplePath}.languages: 언어가 하나 이상 필요합니다`);
            } else {
                const unique = new Set();
                for (const language of example.languages) {
                    if (!LANGUAGE_IDS.includes(language)) c.add(`${examplePath}.languages: 지원하지 않는 언어입니다 (${show(language)})`);
                    else if (unique.has(language)) c.add(`${examplePath}.languages: ${language}가 중복되었습니다`);
                    unique.add(language);
                }
            }
        });
    });
}
