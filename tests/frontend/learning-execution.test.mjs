// 표시 코드를 실제 실행한다. 새 프로그램은 입력 선언을 포함하므로 예제별 결과를 독립 정답과 비교한다.
// Python은 원본 줄 추적, JS/C/C++/Java는 이벤트 탐침을 넣은 사본의 순서도 검사한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LEARNING_EXAMPLES, buildLearningBundle } from '../../scripts/learning-traces.mjs';
import { learningAnswer } from './helpers/learning-reference.mjs';
import { findPython } from './helpers/language-runners.mjs';

const run = (cmd, args, options = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 60000, windowsHide: true, maxBuffer: 8 * 1024 * 1024, ...options });
const must = (result) => { assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stderr}`); return result; };
const values = (text) => text.trim() ? text.trim().split(/\s+/).map(Number) : [];
const bundles = LEARNING_EXAMPLES.map(buildLearningBundle);
const outputs = LEARNING_EXAMPLES.map(example => learningAnswer(example.algorithmId, example.input));
const python = findPython();

test('Python 원본: 모든 새 예제의 최종 결과·줄 실행 뒤 전체 상태가 trace와 일치한다', { skip: python.reason || false, timeout: 60000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'learning-python-'));
    try {
        for (let i = 0; i < bundles.length; i++) {
            const bundle = bundles[i], file = join(dir, 'example.py');
            writeFileSync(file, bundle.codes.python.lines.join('\n'));
            const lineEvents = Object.fromEntries(bundle.steps.slice(1).map(step => [step.lines.python[0], step.eventId]));
            const keys = Object.keys(bundle.steps[0].state.vars);
            const wrapper = `import sys,runpy,json,copy\npath=sys.argv[1]\nevents=json.loads(sys.argv[2])\nkeys=json.loads(sys.argv[3])\nseen=[]\nprevious=None\ndef trace(frame,event,arg):\n global previous\n if frame.f_code.co_filename!=path: return trace\n if event in ('line','return'):\n  if previous in events: seen.append({'event':events[previous],'vars':copy.deepcopy({k:frame.f_locals[k] for k in keys})})\n  previous=str(frame.f_lineno) if event=='line' else None\n return trace\nsys.settrace(trace)\nrunpy.run_path(path)\nsys.settrace(None)\nprint(json.dumps(seen),file=sys.stderr)\n`;
            const result = must(run(python.command, ['-I', '-c', wrapper, file, JSON.stringify(lineEvents), JSON.stringify(keys)]));
            assert.deepEqual(values(result.stdout), outputs[i], `${bundle.algorithmId}/${bundle.exampleId}`);
            assert.deepEqual(JSON.parse(result.stderr), bundle.steps.slice(1).map(step => ({ event: step.eventId, vars: step.state.vars })), `${bundle.algorithmId}/${bundle.exampleId}: 상태 추적`);
        }
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

function probes(bundle, language, index) {
    const marks = new Map(bundle.steps.slice(1).map(step => [step.lines[language][0], step.eventId]));
    return bundle.codes[language].lines.flatMap((line, i) => {
        const event = marks.get(i + 1);
        if (!event) return [line];
        const text = `${index}:${event}`, indent = line.match(/^\s*/)[0];
        const emit = {
            javascript: `process.stderr.write(${JSON.stringify(text + '\n')});`,
            c: `fprintf(stderr, "${text}\\n");`, cpp: `std::cerr << "${text}\\n";`, java: `System.err.println("${text}");`, kotlin: `System.err.println("${text}")`, rust: `eprintln!("${text}");`,
        }[language];
        return [line, indent + emit];
    }).join('\n');
}

test('JavaScript 원본 결과와 탐침 사본 이벤트 순서가 모든 예제에서 일치한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'learning-js-'));
    try {
        for (let i = 0; i < bundles.length; i++) {
            const b = bundles[i], file = join(dir, 'example.cjs');
            writeFileSync(file, b.codes.javascript.lines.join('\n'));
            assert.deepEqual(values(must(run(process.execPath, [file])).stdout), outputs[i]);
            writeFileSync(file, probes(b, 'javascript', i));
            const result = must(run(process.execPath, [file]));
            assert.deepEqual(values(result.stdout), outputs[i]);
            assert.deepEqual(result.stderr.trim().split(/\r?\n/), b.steps.slice(1).map(step => `${i}:${step.eventId}`));
        }
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const [language, command, version] of [['c','gcc','--version'],['cpp','g++','--version'],['java','javac','-version'],['kotlin','kotlinc','-version'],['rust','rustc','--version']]) {
    const installed = run(command, [version]).status === 0;
    test(`${language}: 전체 새 예제 원본과 탐침 사본 컴파일·실행`, { skip: installed ? false : `${command} 실행기가 없어 미실행`, timeout: 180000 }, () => {
        const dir = mkdtempSync(join(tmpdir(), `learning-${language}-`));
        try {
            for (const instrumented of [false, true]) {
                const cases = bundles.map((b, i) => {
                    const source = instrumented ? probes(b, language, i) : b.codes[language].lines.join('\n');
                    return language === 'java' ? source.replace('public class Main', `class Case${i}`) : source.replace(/\bmain\(/, `case${i}(`);
                });
                let text = cases.join('\n'), file, compile, execute;
                const calls = bundles.map((_, i) => language === 'java' ? `Case${i}.main(args);` : `case${i}();`).join('\n');
                if (language === 'c' || language === 'cpp') {
                    text += `\nint main(void) {\n${calls}\nreturn 0;\n}`;
                    file = join(dir, language === 'c' ? 'main.c' : 'main.cpp');
                    compile = [command, [language === 'c' ? '-std=c11' : '-std=c++17', file, '-o', join(dir, 'main.exe')]];
                    execute = [join(dir, 'main.exe'), []];
                } else if (language === 'java') {
                    text += `\npublic class Main { public static void main(String[] args) {\n${calls}\n} }`;
                    file = join(dir, 'Main.java'); compile = [command, ['-encoding','UTF-8', file]]; execute = ['java', ['-cp',dir,'Main']];
                } else if (language === 'kotlin') {
                    text += `\nfun main() {\n${calls}\n}`;
                    file = join(dir, 'Main.kt'); compile = [command, [file,'-include-runtime','-d',join(dir,'main.jar')]]; execute = ['java',['-jar',join(dir,'main.jar')]];
                } else {
                    text += `\nfn main() {\n${calls}\n}`;
                    file = join(dir, 'main.rs'); compile = [command,['--edition=2021',file,'-o',join(dir,'main.exe')]]; execute = [join(dir,'main.exe'),[]];
                }
                writeFileSync(file, text); must(run(...compile));
                const result = must(run(...execute));
                assert.deepEqual(result.stdout.trim().split(/\r?\n/).map(values), outputs);
                if (instrumented) assert.deepEqual(result.stderr.trim().split(/\r?\n/), bundles.flatMap((b,i) => b.steps.slice(1).map(step => `${i}:${step.eventId}`)));
            }
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
}
