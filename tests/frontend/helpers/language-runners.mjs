// 시각화에 보여 주는 Python·JavaScript·C 코드를 실제로 실행해서 "어느 줄이 어떤 순서로 실행되었는지"와 "결과"를 얻는다.
// 코드는 bundle(frontend/js/data/<알고리즘>/<예제>.json)에서 그대로 가져오며, 입력만 바꿔서 여러 번 실행한다.
// 실행기가 없으면(find* 함수가 이유를 돌려준다) 테스트는 "실행하지 않음"으로 건너뛰며, 통과한 것처럼 기록하지 않는다.
// 이 파일은 테스트가 아니므로 node --test가 직접 실행하지 않는다.
//
// 알고리즘마다 달라지는 것은 "코드를 어떻게 부르고 무엇을 결과로 읽는가"뿐이다(아래 PYTHON·JAVASCRIPT·C 표).
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { traceJavaScriptLines } from './js-line-trace.mjs';

const run = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', timeout: 60000, ...options });

/** 알고리즘마다 코드 안의 함수 이름(Python은 co_name, JavaScript는 호출 이름). */
export const FUNCTION_NAMES = Object.freeze({
    bfs: { python: 'bfs', javascript: 'bfs' },
    dfs: { python: 'dfs', javascript: 'dfs' },
    'binary-search': { python: 'binary_search', javascript: 'binarySearch' },
    'bubble-sort': { python: 'bubble_sort', javascript: 'bubbleSort' },
});

// ---------- 실행기 찾기 ----------

/** @returns {{command: string}|{reason: string}} */
export function findPython() {
    for (const command of ['python', 'python3', 'py']) {
        const result = run(command, ['-I', '-c', 'import sys; print(sys.version_info >= (3, 8))']);
        if (result.status === 0 && result.stdout.trim() === 'True') return { command };
    }
    return { reason: 'Python 3.8 이상 실행 파일(python, python3, py)을 찾지 못했습니다.' };
}

/** @returns {{gcc: string, gcov: string}|{reason: string}} */
export function findC() {
    const gcc = run('gcc', ['--version']);
    if (gcc.status !== 0) return { reason: 'C 컴파일러(gcc)를 찾지 못했습니다.' };
    const gcov = run('gcov', ['--version']);
    if (gcov.status !== 0) return { reason: 'gcov를 찾지 못했습니다(줄 실행 횟수를 확인할 수 없습니다).' };
    return { gcc: 'gcc', gcov: 'gcov' };
}

function must(result, label) {
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${label} 실패 (종료 코드 ${result.status})\n${result.stdout}\n${result.stderr}`);
    return result;
}

// ---------- Python: sys.settrace로 줄 실행 순서를 그대로 기록 ----------

/** 코드를 부르는 부분. 결과는 `_ORDER`(탐색 순서), `_RESULT`(반환값 또는 정렬된 배열)에 담는다. */
const PYTHON_CALL = {
    bfs: `
class _Graph(dict):
    def __getitem__(self, key):
        _ORDER.append(key)
        return dict.__getitem__(self, key)
_CALL = lambda: bfs(_Graph(_data['graph']), _data['start'])
`,
    dfs: `
class _Visited(set):
    def add(self, key):
        _ORDER.append(key)
        set.add(self, key)
_CALL = lambda: dfs(_data['graph'], _data['start'], _Visited())
`,
    'binary-search': `
_CALL = lambda: _RESULT.append(binary_search(list(_data['values']), _data['target']))
`,
    'bubble-sort': `
def _call():
    values = list(_data['values'])
    bubble_sort(values)
    _RESULT.append(values)
_CALL = _call
`,
};

const pythonDriver = (algorithmId) => `
import json as _json, os as _os, sys as _sys

_ORDER = []
_LINES = []
_RESULT = []
${PYTHON_CALL[algorithmId]}
def _tracer(frame, event, arg):
    if frame.f_code.co_name == '${FUNCTION_NAMES[algorithmId].python}' and frame.f_code.co_filename == __file__:
        if event == 'line':
            _LINES.append(frame.f_lineno)
        return _tracer
    return None

with open(_os.path.join(_os.path.dirname(__file__), 'input.json'), encoding='utf-8') as _f:
    _data = _json.load(_f)
_sys.settrace(_tracer)
_CALL()
_sys.settrace(None)
print(_json.dumps({'lines': _LINES, 'order': _ORDER, 'result': _RESULT[0] if _RESULT else None}))
`;

/**
 * @returns {{lines: number[], order: string[], result: any}}
 *   lines: 함수 안에서 실행된 줄(1부터)을 실행 순서대로, order: BFS는 graph[node]를 읽은 노드 순서·DFS는 visited에 넣은 순서,
 *   result: 이분 탐색의 반환값·버블 정렬이 정렬한 배열
 */
export function runPython(python, dir, algorithmId, codeLines, input) {
    const file = join(dir, 'algorithm.py');
    writeFileSync(file, `${codeLines.join('\n')}\n${pythonDriver(algorithmId)}`, 'utf8');
    writeFileSync(join(dir, 'input.json'), JSON.stringify(input), 'utf8');
    return JSON.parse(must(run(python.command, ['-I', file]), 'Python 실행').stdout);
}

// ---------- JavaScript: V8 인스펙터로 줄 실행 순서를 그대로 기록 ----------

const JAVASCRIPT_CALL = {
    bfs: `
const __graph = new Proxy(__data.graph, { get(target, key) { if (typeof key === 'string') __order.push(key); return target[key]; } });
bfs(__graph, __data.start);
`,
    dfs: `
class __Visited extends Set { add(key) { __order.push(key); return super.add(key); } }
dfs(__data.graph, __data.start, new __Visited());
`,
    'binary-search': `
__result = binarySearch([...__data.values], __data.target);
`,
    'bubble-sort': `
__result = [...__data.values];
bubbleSort(__result);
`,
};

/**
 * @returns {Promise<{lines: number[], order: string[], result: any}>}
 *   lines: 코드 줄(1..codeLines.length)에서 멈춘 순서. 같은 줄에서 연속으로 멈춘 것은 한 번으로 합친다.
 */
export async function runJavaScript(dir, algorithmId, codeLines, input) {
    const driver = `
const __data = ${JSON.stringify(input)};
const __order = [];
let __result = null;
${JAVASCRIPT_CALL[algorithmId]}
console.log(JSON.stringify({ order: __order, result: __result }));
`;
    const file = join(dir, 'algorithm.cjs');
    writeFileSync(file, `${codeLines.join('\n')}\n${driver}`, 'utf8');
    const traced = await traceJavaScriptLines(file);

    // 코드 줄 밖(위의 driver)은 버린다. 닫는 중괄호만 있는 줄은 실행할 문장이 아니라 블록이 끝나는 지점이므로 뺀다.
    const inCode = traced.lines.filter((line) => line <= codeLines.length && codeLines[line - 1].trim() !== '}');
    // V8은 한 줄 안의 여러 위치에서 멈출 수 있어(for…of의 반복자 호출 등) 같은 줄에서 연속으로 멈춘 것은 한 번으로 본다.
    const lines = inCode.filter((line, i) => i === 0 || line !== inCode[i - 1]);
    const printed = JSON.parse(traced.stdout.trim().split('\n').at(-1));
    return { lines, order: printed.order, result: printed.result };
}

// ---------- C: 컴파일해서 실행. 원본은 gcov 횟수로, 탐침을 넣은 사본은 줄 순서로 확인 ----------

/** 그래프 입력을 C 배열 초기화 문자열로 만든다(노드는 입력 순서대로 0, 1, 2, …). */
function graphArrays(input) {
    const nodes = Object.keys(input.graph);
    const n = nodes.length;
    const index = new Map(nodes.map((node, i) => [node, i]));
    const rows = nodes.map((node) => `{${Array.from({ length: n }, (_, k) => (k < input.graph[node].length ? index.get(input.graph[node][k]) : 0)).join(', ')}}`);
    return {
        nodes,
        declarations: `    int adj[N][N] = {${rows.join(', ')}};\n    int deg[N] = {${nodes.map((node) => input.graph[node].length).join(', ')}};`,
        start: index.get(input.start),
    };
}

/** C의 main. 결과는 `RESULT ...` 줄로 출력하고, 탐침을 넣은 실행은 `TRACE_DUMP()`가 줄 순서를 출력한다. */
function cMain(algorithmId, input) {
    if (algorithmId === 'bfs') {
        const { nodes, declarations, start } = graphArrays(input);
        return {
            nodes,
            source: `
int main(void) {
${declarations}
    int queue[N];
    for (int k = 0; k < N; k++) queue[k] = -1;
    bfs(adj, deg, ${start}, queue);
    printf("RESULT");
    for (int k = 0; k < N; k++) printf(" %d", queue[k]);
    printf("\\n");
    TRACE_DUMP();
    return 0;
}
`,
        };
    }
    if (algorithmId === 'dfs') {
        const { nodes, declarations, start } = graphArrays(input);
        return {
            nodes,
            source: `
int main(void) {
${declarations}
    int visited[N] = {0};
    dfs(adj, deg, ${start}, visited);
    printf("RESULT");
    for (int k = 0; k < N; k++) printf(" %d", visited[k]);
    printf("\\n");
    TRACE_DUMP();
    return 0;
}
`,
        };
    }
    const values = input.values;
    const n = values.length;
    const array = `int values[${Math.max(n, 1)}] = {${values.length > 0 ? values.join(', ') : '0'}};`;
    if (algorithmId === 'binary-search') {
        return {
            nodes: null,
            source: `
int main(void) {
    ${array}
    printf("RESULT %d\\n", binary_search(values, ${n}, ${input.target}));
    TRACE_DUMP();
    return 0;
}
`,
        };
    }
    return {
        nodes: null,
        source: `
int main(void) {
    ${array}
    bubble_sort(values, ${n});
    printf("RESULT");
    for (int k = 0; k < ${n}; k++) printf(" %d", values[k]);
    printf("\\n");
    TRACE_DUMP();
    return 0;
}
`,
    };
}

/** 코드의 첫 줄(#define N …)만 노드 수에 맞춘다. 나머지 줄은 한 글자도 바꾸지 않는다. */
function withNodeCount(codeLines, n) {
    if (!/^#define N \d+$/.test(codeLines[0])) throw new Error(`C 코드의 첫 줄이 "#define N <숫자>"가 아닙니다: ${codeLines[0]}`);
    return [`#define N ${n}`, ...codeLines.slice(1)];
}

const NO_TRACE = '#define TRACE_DUMP() ((void)0)\n';
const PROBE_HEADER = `
static int trace_lines[8192];
static int trace_count = 0;
static int watch_values[8192];
static int watch_count = 0;
#define P(line) (trace_lines[trace_count++] = (line))
#define W(value) (watch_values[watch_count++] = (value))
#define TRACE_DUMP() do { printf("TRACE"); for (int t = 0; t < trace_count; t++) printf(" %d", trace_lines[t]); printf("\\n"); printf("WATCH"); for (int t = 0; t < watch_count; t++) printf(" %d", watch_values[t]); printf("\\n"); } while (0)
`;

function compile(c, dir, algorithmId, codeLines, input, { coverage, header }) {
    const { nodes, source } = cMain(algorithmId, input);
    writeFileSync(join(dir, 'probe.h'), `#include <stdio.h>\n${header}`, 'utf8');
    const lines = nodes === null ? codeLines : withNodeCount(codeLines, nodes.length);
    writeFileSync(join(dir, 'main.c'), `${lines.join('\n')}\n${source}`, 'utf8');
    const flags = ['-std=c99', '-O0', '-g', '-Wall', '-Wextra', '-include', 'probe.h', ...(coverage ? ['--coverage'] : [])];
    const compiled = must(run(c.gcc, [...flags, '-o', 'algorithm-test.exe', 'main.c'], { cwd: dir }), 'C 컴파일');
    const executed = must(run(join(dir, 'algorithm-test.exe'), [], { cwd: dir }), 'C 실행');
    const output = executed.stdout.split(/\r?\n/);
    const numbers = (prefix) => (output.find((line) => line.startsWith(prefix)) ?? prefix).trim().split(/\s+/).slice(1).map(Number);
    const raw = numbers('RESULT');
    let result;
    if (algorithmId === 'bfs') result = raw.filter((value) => value >= 0).map((value) => nodes[value]); // queue 배열: 발견한 순서
    else if (algorithmId === 'dfs') result = raw.map((flag, k) => (flag === 1 ? nodes[k] : null)).filter((node) => node !== null); // 발견한 노드 집합(노드 순서)
    else if (algorithmId === 'binary-search') result = raw[0]; // 반환값
    else result = raw; // 정렬된 배열
    return { warnings: compiled.stderr, result, trace: numbers('TRACE'), watch: numbers('WATCH'), nodes };
}

/**
 * 원본 코드를 그대로 컴파일(-Wall -Wextra)해 실행하고 gcov로 줄마다 실행된 횟수를 얻는다.
 * @returns {{warnings: string, result: any, counts: Map<number, number>}}
 *   counts: 실행 가능한 줄 번호 → 실행 횟수(한 번도 실행되지 않은 줄은 0, 실행 가능한 코드가 없는 줄은 없다)
 */
export function runCWithCoverage(c, dir, algorithmId, codeLines, input) {
    const { warnings, result } = compile(c, dir, algorithmId, codeLines, input, { coverage: true, header: NO_TRACE });
    const report = JSON.parse(must(run(c.gcov, ['--json-format', '--stdout', 'algorithm-test-main.gcda'], { cwd: dir }), 'gcov').stdout);
    const file = report.files.find((entry) => entry.file.endsWith('main.c'));
    if (file === undefined) throw new Error('gcov 결과에 main.c가 없습니다.');
    return { warnings, result, counts: new Map(file.lines.map((line) => [line.line_number, line.count])) };
}

/**
 * 각 문장 앞(조건식은 조건을 계산할 때마다)에 "이 줄을 실행했다"는 탐침을 넣은 사본을 실행해 줄 실행 순서를 얻는다.
 * 줄 수와 줄 번호는 그대로이며 로직은 바꾸지 않는다. 원본이 아니라 사본을 실행한 결과다.
 * @param {{watch?: Record<number, string>}} [options]  watch: 줄 번호 → 그 줄을 실행할 때 기록할 변수(예: DFS의 발견한 노드)
 * @returns {{result: any, lines: number[], watched: number[], nodes: string[]|null}}
 */
export function runCWithProbes(c, dir, algorithmId, codeLines, input, { watch = {} } = {}) {
    const { result, trace, watch: watched, nodes } = compile(c, dir, algorithmId, instrumentC(codeLines, { watch }), input, { coverage: false, header: PROBE_HEADER });
    return { result, lines: trace, watched, nodes };
}

/** 알아보는 줄 모양이 아니면 예외를 던진다(코드가 바뀌면 이 함수도 의식적으로 고치게 한다). */
export function instrumentC(codeLines, { watch = {} } = {}) {
    return codeLines.map((line, i) => {
        const n = i + 1;
        const text = line.trim();
        const indent = line.slice(0, line.length - line.trimStart().length);
        const record = Object.hasOwn(watch, n) ? `W(${watch[n]}); ` : '';
        let match;
        if (text === '}' || text === '} else {' || text.startsWith('#define ') || /^(void|int) \w+\(.*\) \{$/.test(text)) return line;
        if ((match = /^while \((.+)\) \{$/.exec(text))) return `${indent}while ((P(${n}), ${match[1]})) {`;
        if ((match = /^for \((.+?); (.+?); (.+?)\) \{$/.exec(text))) return `${indent}for (${match[1]}; (P(${n}), ${match[2]}); ${match[3]}) {`;
        if ((match = /^if \((.+)\) \{$/.exec(text))) return `${indent}if ((P(${n}), ${match[1]})) {`;
        if ((match = /^\} else if \((.+)\) \{$/.exec(text))) return `${indent}} else if ((P(${n}), ${match[1]})) {`;
        if (text.endsWith(';')) return `${indent}P(${n}); ${record}${text}`;
        throw new Error(`탐침을 넣는 방법을 모르는 C 줄입니다 (${n}번 줄): ${line}`);
    });
}
