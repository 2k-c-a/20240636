// 유한한 학습용 정수 프로그램 계약. 입력은 작은 고정 예제이며 사용자 코드를 eval하지 않는다.
// 같은 연산 정의에서 7개 언어와 trace를 만들고, 별도 정답 계산/실제 실행 테스트로 검증한다.
export const EXTENDED_IDS = Object.freeze(['union-find', 'dijkstra', 'knapsack', 'topological-sort', 'two-pointers']);
export const INF = 1000000;
const at = (a, i) => ['at', a, i];
const op = (symbol, a, b) => [symbol, a, b];
const add = (a, b) => op('+', a, b);
const sub = (a, b) => op('-', a, b);
const mul = (a, b) => op('*', a, b);
const lt = (a, b) => op('<', a, b);
const eq = (a, b) => op('==', a, b);
const and = (a, b) => op('&&', a, b);
const set = (target, value, event) => ({ type: 'set', target, value, event });
const branch = (condition, yes, no = []) => ({ type: 'if', condition, yes, no });
const loop = (condition, body) => ({ type: 'while', condition, body });
const range = (counter, end, body, start = 0) => [set(counter, start), loop(lt(counter, end), [...body, set(counter, add(counter, 1))])];
const zeros = (n) => Array(n).fill(0);

export const EXTENDED_LABELS = Object.freeze({
    'union-find': { initial: '실행 전', 'select-a': '첫 노드 선택', 'select-b': '둘째 노드 선택', 'find-a': '첫 노드의 루트 찾기', 'compress-a': '첫 경로 압축', 'find-b': '둘째 노드의 루트 찾기', 'compress-b': '둘째 경로 압축', union: '집합 합치기', rank: '랭크 갱신', query: '같은 집합 확인', finish: '종료' },
    dijkstra: { initial: '실행 전', start: '시작 거리 설정', settle: '최소 거리 확정', candidate: '후보 거리 계산', relax: '더 짧은 거리 갱신', parent: '이전 노드 기록', finish: '종료' },
    knapsack: { initial: '실행 전', skip: '물건을 선택하지 않기', candidate: '선택한 경우의 가치', take: '더 큰 가치 선택', finish: '종료' },
    'topological-sort': { initial: '실행 전', 'enqueue-start': '시작 가능한 노드 넣기', dequeue: '큐에서 꺼내기', output: '순서에 추가', decrease: '진입 차수 감소', enqueue: '새로 가능한 노드 넣기', finish: '종료·사이클 확인' },
    'two-pointers': { initial: '실행 전', expand: '오른쪽 경계 늘리기', shrink: '왼쪽 경계 줄이기', found: '목표 합 구간 발견', finish: '종료' },
});

function integer(value, low, high) { return Number.isInteger(value) && value >= low && value <= high; }
function exact(value, keys) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|'); }
export function checkLearningInput(id, input) {
    const fail = (text) => { throw new Error(`input: ${text}`); };
    if (id === 'union-find') {
        if (!exact(input, ['n', 'operations']) || !integer(input.n, 1, 8) || !Array.isArray(input.operations) || input.operations.length > 8) fail('집합 수는 1~8, 연산은 최대 8개여야 합니다.');
        for (const row of input.operations) if (!Array.isArray(row) || row.length !== 3 || !integer(row[0], 0, 1) || !row.slice(1).every(x => integer(x, 0, input.n - 1))) fail('연산은 [0(합치기)/1(조회), 노드, 노드] 형식이어야 합니다.');
    } else if (id === 'dijkstra' || id === 'topological-sort') {
        const weighted = id === 'dijkstra';
        if (!exact(input, weighted ? ['n', 'edges', 'start'] : ['n', 'edges']) || !integer(input.n, 1, 6) || !Array.isArray(input.edges) || input.edges.length > 12) fail('노드 1~6개, 간선 최대 12개여야 합니다.');
        if (weighted && !integer(input.start, 0, input.n - 1)) fail('시작 노드가 범위를 벗어났습니다.');
        const seen = new Set();
        for (const edge of input.edges) {
            if (!Array.isArray(edge) || edge.length !== (weighted ? 3 : 2) || !edge.slice(0, 2).every(x => integer(x, 0, input.n - 1)) || (weighted && !integer(edge[2], 0, 20))) fail('간선 끝점 또는 가중치(0~20)가 잘못되었습니다.');
            const key = `${edge[0]}:${edge[1]}`;
            if (seen.has(key)) fail('같은 방향의 중복 간선은 허용하지 않습니다.');
            seen.add(key);
        }
    } else if (id === 'knapsack') {
        if (!exact(input, ['weights', 'values', 'capacity']) || !Array.isArray(input.weights) || !Array.isArray(input.values) || input.weights.length !== input.values.length || input.weights.length > 5 || !integer(input.capacity, 0, 12) || !input.weights.every(x => integer(x, 1, 12)) || !input.values.every(x => integer(x, 0, 30))) fail('물건 최대 5개, 양의 무게, 가치 0~30, 용량 0~12여야 합니다.');
    } else if (id === 'two-pointers') {
        if (!exact(input, ['values', 'target']) || !Array.isArray(input.values) || input.values.length > 12 || !input.values.every(x => integer(x, 1, 20)) || !integer(input.target, 1, 100)) fail('원소 최대 12개인 양의 정수 배열과 양의 목표 합이 필요합니다.');
    } else fail('지원하지 않는 학습 알고리즘입니다.');
}

export function learningProgram(id, input) {
    checkLearningInput(id, input);
    let vars, body, output, message;
    if (id === 'union-find') {
        const operations = input.operations;
        vars = { n: input.n, parent: Array.from({ length: input.n }, (_, i) => i), rank: zeros(input.n), kind: operations.map(x => x[0]), a: operations.map(x => x[1]), b: operations.map(x => x[2]), result: Array(operations.length).fill(-1), k: 0, x: 0, y: 0, tmp: 0 };
        const find = (v, event) => loop(op('!=', at('parent', v), v), [set(at('parent', v), at('parent', at('parent', v)), `compress-${event}`), set(v, at('parent', v), `find-${event}`)]);
        body = range('k', operations.length, [
            set('x', at('a', 'k'), 'select-a'), find('x', 'a'), set('y', at('b', 'k'), 'select-b'), find('y', 'b'),
            branch(eq(at('kind', 'k'), 1), [set(at('result', 'k'), ['choose', eq('x', 'y'), 1, 0], 'query')], [
                branch(op('!=', 'x', 'y'), [branch(lt(at('rank', 'x'), at('rank', 'y')), [set('tmp', 'x'), set('x', 'y'), set('y', 'tmp')]), set(at('parent', 'y'), 'x', 'union'), branch(eq(at('rank', 'x'), at('rank', 'y')), [set(at('rank', 'x'), add(at('rank', 'x'), 1), 'rank')])]),
            ]),
        ]);
        output = 'result';
        message = (event, s) => event === 'query' ? `${s.a[s.k]}번과 ${s.b[s.k]}번은 ${s.result[s.k] === 1 ? '같은' : '서로 다른'} 집합입니다.` : event === 'union' ? `${s.y}번 루트의 부모를 ${s.x}번 루트로 바꿉니다. 랭크가 작은 트리를 큰 쪽에 붙입니다.` : event.startsWith('compress') ? '부모를 조부모로 바꾸는 경로 반감으로 다음 루트 탐색을 짧게 만듭니다.' : event === 'rank' ? '두 루트의 랭크가 같았으므로 새 루트의 랭크를 1 늘립니다.' : '부모 배열을 따라 루트를 찾습니다. 루트는 자기 자신을 부모로 가집니다.';
    } else if (id === 'dijkstra') {
        const weights = Array(input.n * input.n).fill(INF);
        for (const [a, b, w] of input.edges) weights[a * input.n + b] = w;
        vars = { n: input.n, weights, dist: Array(input.n).fill(INF), done: zeros(input.n), parent: Array(input.n).fill(-1), round: 0, v: 0, u: -1, best: INF, candidate: 0 };
        const weight = at('weights', add(mul('u', 'n'), 'v'));
        body = [set(at('dist', input.start), 0, 'start'), ...range('round', 'n', [
            set('u', -1), set('best', INF), ...range('v', 'n', [branch(and(eq(at('done', 'v'), 0), lt(at('dist', 'v'), 'best')), [set('best', at('dist', 'v')), set('u', 'v')])]),
            branch(op('!=', 'u', -1), [set(at('done', 'u'), 1, 'settle'), ...range('v', 'n', [branch(and(lt(weight, INF), eq(at('done', 'v'), 0)), [set('candidate', add(at('dist', 'u'), weight), 'candidate'), branch(lt('candidate', at('dist', 'v')), [set(at('dist', 'v'), 'candidate', 'relax'), set(at('parent', 'v'), 'u', 'parent')])])])]),
        ])];
        output = 'dist';
        message = (event, s) => event === 'start' ? `${input.start}번에서 시작하므로 시작 거리는 0입니다. ∞는 아직 경로를 모른다는 뜻입니다.` : event === 'settle' ? `미확정 노드 중 거리가 가장 작은 ${s.u}번의 거리 ${s.dist[s.u]}를 확정합니다.` : event === 'candidate' ? `${s.u}번을 거쳐 ${s.v}번으로 가면 거리 ${s.candidate}입니다. 현재 거리와 비교합니다.` : event === 'relax' ? `${s.v}번의 거리를 더 짧은 ${s.dist[s.v]}로 바꿉니다.` : `${s.v}번 최단 경로의 이전 노드를 ${s.u}번으로 기록합니다.`;
    } else if (id === 'knapsack') {
        const width = input.capacity + 1;
        vars = { n: input.weights.length, cap: input.capacity, width, weights: [...input.weights], values: [...input.values], dp: zeros((input.weights.length + 1) * width), i: 0, c: 0, pos: 0, previous: 0, candidate: 0, result: 0 };
        body = [...range('i', add('n', 1), [...range('c', 'width', [
            set('pos', add(mul('i', 'width'), 'c')), set('previous', add(mul(sub('i', 1), 'width'), 'c')), set(at('dp', 'pos'), at('dp', 'previous'), 'skip'),
            branch(op('<=', at('weights', sub('i', 1)), 'c'), [set('candidate', add(at('dp', sub('previous', at('weights', sub('i', 1)))), at('values', sub('i', 1))), 'candidate'), branch(lt(at('dp', 'pos'), 'candidate'), [set(at('dp', 'pos'), 'candidate', 'take')])]),
        ])], 1), set('result', at('dp', add(mul('n', 'width'), 'cap')))];
        output = 'result';
        message = (event, s) => event === 'skip' ? `물건 ${s.i}개, 용량 ${s.c}인 칸에 이전 행의 값 ${s.dp[s.pos]}를 먼저 복사합니다. 이번 물건을 고르지 않은 경우입니다.` : event === 'candidate' ? `이번 물건을 고르면 이전 행의 남은 용량 칸에 가치를 더해 ${s.candidate}가 됩니다. 같은 물건을 다시 사용하지 않습니다.` : `선택한 경우가 더 크므로 현재 칸을 ${s.dp[s.pos]}로 바꿉니다.`;
    } else if (id === 'topological-sort') {
        const edges = [], starts = [0], indegree = zeros(input.n);
        for (const [, b] of input.edges) indegree[b]++;
        for (let u = 0; u < input.n; u++) { edges.push(...input.edges.filter(edge => edge[0] === u).map(edge => edge[1])); starts.push(edges.length); }
        vars = { n: input.n, starts, edges, indegree, queue: Array(input.n).fill(-1), head: 0, tail: 0, order: Array(input.n).fill(-1), count: 0, v: 0, current: -1, e: 0 };
        body = [...range('v', 'n', [branch(eq(at('indegree', 'v'), 0), [set(at('queue', 'tail'), 'v'), set('tail', add('tail', 1), 'enqueue-start')])]), loop(lt('head', 'tail'), [
            set('current', at('queue', 'head')), set('head', add('head', 1), 'dequeue'), set(at('order', 'count'), 'current'), set('count', add('count', 1), 'output'),
            set('e', at('starts', 'current')), loop(lt('e', at('starts', add('current', 1))), [set('v', at('edges', 'e')), set(at('indegree', 'v'), sub(at('indegree', 'v'), 1), 'decrease'), branch(eq(at('indegree', 'v'), 0), [set(at('queue', 'tail'), 'v'), set('tail', add('tail', 1), 'enqueue')]), set('e', add('e', 1))]),
        ])];
        output = 'order';
        message = (event, s) => event.startsWith('enqueue') ? `${s.v}번의 진입 차수가 0이므로 처리 가능한 큐 뒤에 넣습니다.` : event === 'dequeue' ? `${s.current}번을 큐 앞에서 꺼냅니다.` : event === 'output' ? `${s.current}번을 결과 순서에 추가했습니다. 현재 ${s.count}개를 처리했습니다.` : `${s.current}번에서 ${s.v}번으로 가는 간선을 제거한 것으로 보고 진입 차수를 ${s.indegree[s.v]}로 줄입니다.`;
    } else {
        vars = { values: [...input.values], n: input.values.length, target: input.target, left: 0, right: 0, sum: 0, count: 0 };
        body = [loop(lt('right', 'n'), [set('sum', add('sum', at('values', 'right'))), set('right', add('right', 1), 'expand'), loop(and(lt('target', 'sum'), lt('left', 'right')), [set('sum', sub('sum', at('values', 'left'))), set('left', add('left', 1), 'shrink')]), branch(eq('sum', 'target'), [set('count', add('count', 1), 'found')])])];
        output = 'count';
        message = (event, s) => event === 'found' ? `[${s.left}, ${s.right}) 구간의 합이 ${s.target}입니다. 찾은 구간 수는 ${s.count}개입니다.` : event === 'expand' ? `오른쪽 경계를 ${s.right}로 늘려 합이 ${s.sum}이 되었습니다. right는 구간에 포함되지 않는 경계입니다.` : `합이 목표보다 커 왼쪽 값을 빼고 경계를 ${s.left}로 옮겼습니다. 현재 합은 ${s.sum}입니다.`;
    }
    return { id, variables: vars, body, output, message };
}

function evaluate(expression, vars) {
    if (typeof expression === 'number') return expression;
    if (typeof expression === 'string') return vars[expression];
    const [symbol, a, b] = expression;
    if (symbol === 'choose') return evaluate(a, vars) ? evaluate(b, vars) : evaluate(expression[3], vars);
    if (symbol === 'at') {
        const index = evaluate(b, vars);
        if (!Number.isInteger(index) || index < 0 || index >= vars[a].length) throw new Error('학습 연산의 배열 범위 오류');
        return vars[a][index];
    }
    const x = evaluate(a, vars);
    if (symbol === '&&') return x && evaluate(b, vars);
    const y = evaluate(b, vars);
    return ({ '+': () => x + y, '-': () => x - y, '*': () => x * y, '<': () => x < y, '<=': () => x <= y, '==': () => x === y, '!=': () => x !== y })[symbol]();
}

export function executeLearning(program) {
    const vars = structuredClone(program.variables), steps = [];
    let budget = 100000;
    const emit = (event) => {
        if (steps.length >= 2000) throw new Error('학습 단계 한도 초과');
        let message = event === 'initial' ? '예제 데이터와 작업 배열을 준비한 실행 전 상태입니다. 코드의 초기화 선언은 별도 단계로 재생하지 않습니다.' : event === 'finish' ? '모든 학습 연산을 마쳤습니다. 결과와 남은 상태를 확인하세요.' : program.message(event, vars);
        if (event === 'finish' && program.id === 'topological-sort') message = vars.count === vars.n ? '모든 노드를 처리했습니다. 결과는 선행 조건을 만족하는 위상 순서입니다.' : `${vars.n - vars.count}개 노드를 처리하지 못했습니다. 방향 사이클이 있어 전체 위상 순서를 만들 수 없습니다.`;
        steps.push({ operation: event, eventId: event, state: { vars: structuredClone(vars) }, message });
    };
    const run = (nodes) => {
        for (const node of nodes) {
            if (--budget < 0) throw new Error('학습 연산 한도 초과');
            if (node.type === 'set') {
                const value = evaluate(node.value, vars);
                if (Array.isArray(node.target)) {
                    const [, name, expr] = node.target, index = evaluate(expr, vars);
                    if (index < 0 || index >= vars[name].length) throw new Error('학습 대입 범위 오류');
                    vars[name][index] = value;
                } else vars[node.target] = value;
                if (node.event) emit(node.event);
            } else if (node.type === 'if') run(evaluate(node.condition, vars) ? node.yes : node.no);
            else while (evaluate(node.condition, vars)) { if (--budget < 0) throw new Error('학습 반복 한도 초과'); run(node.body); }
        }
    };
    emit('initial'); run(program.body); emit('finish');
    return steps;
}

// 예제 값이 포함된 완전한 실행 프로그램을 생성한다. 모든 배열 인덱스는 검증된 작은 정수다.
export function compileLearning(program, language) {
    const lines = [], mapping = { initial: [] };
    const python = language === 'python', rust = language === 'rust', kotlin = language === 'kotlin';
    const headers = { python: [], javascript: [], cpp: ['#include <iostream>', 'int main() {'], c: ['#include <stdio.h>', 'int main(void) {'], java: ['public class Main {', '    public static void main(String[] args) {'], kotlin: ['fun main() {'], rust: ['fn main() {'] };
    lines.push(...headers[language]);
    const base = ['python', 'javascript'].includes(language) ? 0 : language === 'java' ? 2 : 1;
    const put = (text, indent = 0) => { lines.push('    '.repeat(base + indent) + text); return lines.length; };
    const expression = (expr) => {
        if (!Array.isArray(expr)) return String(expr);
        const [symbol, a, b] = expr;
        if (symbol === 'choose') {
            const condition = expression(a), yes = expression(b), no = expression(expr[3]);
            return python ? `(${yes} if ${condition} else ${no})` : kotlin ? `(if (${condition}) ${yes} else ${no})` : rust ? `(if ${condition} { ${yes} } else { ${no} })` : `(${condition} ? ${yes} : ${no})`;
        }
        if (symbol === 'at') return `${a}[${rust ? `(${expression(b)}) as usize` : expression(b)}]`;
        return `(${expression(a)} ${python && symbol === '&&' ? 'and' : symbol} ${expression(b)})`;
    };
    for (const [name, value] of Object.entries(program.variables)) {
        if (Array.isArray(value)) {
            const opens = { python: `${name} = [`, javascript: `let ${name} = [`, c: `int ${name}[${Math.max(1, value.length)}] = {`, cpp: `int ${name}[${Math.max(1, value.length)}] = {`, java: `int[] ${name} = new int[] {`, kotlin: `val ${name} = intArrayOf(`, rust: `let mut ${name}: Vec<i32> = vec![` };
            put(opens[language]);
            for (let i = 0; i < value.length; i += 12) put(value.slice(i, i + 12).join(', ') + ',', 1);
            if (!value.length && ['c', 'cpp'].includes(language)) put('0,', 1);
            put(python ? ']' : kotlin ? ')' : ['c', 'cpp', 'java'].includes(language) ? '};' : '];');
        } else put(`${python ? '' : language === 'javascript' ? 'let ' : rust ? 'let mut ' : kotlin ? 'var ' : 'int '}${name}${rust ? ': i32' : ''} = ${value}${python || kotlin ? '' : ';'}`);
    }
    const nodes = (body, indent = 0) => {
        if (python && body.length === 0) put('pass', indent);
        for (const node of body) {
            if (node.type === 'set') {
                const line = put(`${expression(node.target)} = ${expression(node.value)}${python || kotlin ? '' : ';'}`, indent);
                if (node.event) mapping[node.event] = [line];
            } else {
                const condition = expression(node.condition);
                const keyword = node.type === 'while' ? 'while' : 'if';
                put(python ? `${keyword} ${condition}:` : rust ? `${keyword} ${condition} {` : `${keyword} (${condition}) {`, indent);
                nodes(node.type === 'while' ? node.body : node.yes, indent + 1);
                if (!python) put('}', indent);
                if (node.type === 'if' && node.no.length) { put(python ? 'else:' : 'else {', indent); nodes(node.no, indent + 1); if (!python) put('}', indent); }
            }
        }
    };
    nodes(program.body);
    const out = program.output, array = Array.isArray(program.variables[out]);
    const print = array ? {
        python: `print(*${out})`, javascript: `console.log(${out}.join(' '));`, kotlin: `println(${out}.joinToString(" "))`, rust: `println!("{}", ${out}.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(" "));`,
        c: `for (int j = 0; j < ${program.variables[out].length}; j++) printf("%d ", ${out}[j]);`, cpp: `for (int j = 0; j < ${program.variables[out].length}; j++) std::cout << ${out}[j] << " ";`, java: `for (int outputValue : ${out}) System.out.print(outputValue + " ");`,
    } : { python: `print(${out})`, javascript: `console.log(${out});`, kotlin: `println(${out})`, rust: `println!("{}", ${out});`, c: `printf("%d", ${out});`, cpp: `std::cout << ${out};`, java: `System.out.print(${out});` };
    mapping.finish = [put(print[language])];
    if (language === 'c') put('printf("\\n");');
    if (language === 'cpp') put('std::cout << "\\n";');
    if (language === 'java') put('System.out.println();');
    if (language === 'c' || language === 'cpp') put('return 0;');
    if (language === 'java') lines.push('    }', '}');
    else if (!['python', 'javascript'].includes(language)) lines.push('}');
    const languageNote = { python: 'Python 리스트를 사용합니다.', javascript: 'JavaScript 배열을 사용하며 예제 값은 정확히 표현되는 작은 정수입니다.', c: 'C 고정 길이 배열을 사용합니다. 빈 배열은 자리 한 칸을 확보하되 논리적 길이는 0입니다.', cpp: 'C++ 고정 길이 배열을 사용합니다.', java: 'Java int 배열을 사용합니다.', kotlin: 'Kotlin IntArray를 사용합니다.', rust: 'Rust Vec<i32>를 사용하며 배열 인덱스를 usize로 바꿉니다.' }[language];
    const detail = program.id === 'topological-sort' ? ' starts[u]부터 starts[u+1] 직전까지가 edges에서 u의 이웃 범위입니다.' : program.id === 'dijkstra' ? ' weights[u*n+v]는 가중치이며 1000000은 ∞ 표시용 상한입니다. 음수 간선은 지원하지 않습니다.' : program.id === 'knapsack' ? ' dp[i*width+c]가 표의 i행 c열이며 이전 행만 참조해 한 물건의 중복 선택을 막습니다.' : '';
    return { lines, mapping, notes: `${languageNote} 현재 예제의 입력을 선언부에 담은 실행 가능한 프로그램입니다. 초기화 선언은 0단계에서 준비하고 강조 연산 뒤의 상태를 보여 줍니다. 인덱스는 0부터 시작하며 마지막 출력은 결과 확인용입니다.${detail}` };
}
