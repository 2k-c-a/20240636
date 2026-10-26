// JavaScript 파일을 V8 인스펙터(Chrome DevTools Protocol)로 한 문장씩 실행하며, 실제로 멈춘 줄 번호를 순서대로 모은다.
// 소스를 고치지 않고 있는 그대로 실행한다. 자식 Node 프로세스를 `--inspect-brk=0`(무작위 포트)로 띄우고 WebSocket으로 제어한다.
// 이 파일은 테스트가 아니므로 node --test가 직접 실행하지 않는다.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** 줄 추적을 쓸 수 있는 환경인지. 쓸 수 없으면 이유(문자열)를, 쓸 수 있으면 null을 돌려준다. */
export function lineTraceUnavailableReason() {
    return typeof WebSocket === 'function' ? null : '이 Node에는 전역 WebSocket이 없어 인스펙터를 제어할 수 없습니다(Node 22 이상 필요).';
}

/**
 * @param {string} file  실행할 .js 파일(절대 경로 또는 현재 폴더 기준)
 * @param {{timeoutMs?: number, maxPauses?: number}} [options]
 * @returns {Promise<{lines: number[], stdout: string, pauses: number}>}
 *   lines: 이 파일 안에서 실행이 멈춘 줄(1부터)을 멈춘 순서대로. 한 줄에서 연속으로 여러 번 멈추면 그만큼 들어 있다.
 */
export async function traceJavaScriptLines(file, { timeoutMs = 30000, maxPauses = 20000 } = {}) {
    const path = resolve(file);
    const target = pathToFileURL(path).href;
    const child = spawn(process.execPath, ['--inspect-brk=0', path], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });

    let socket;
    let scriptEnded;
    const timer = setTimeout(() => child.kill(), timeoutMs);
    try {
        const url = await new Promise((resolveUrl, reject) => {
            let buffer = '';
            child.stderr.on('data', (chunk) => {
                buffer += chunk;
                const found = buffer.match(/ws:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]+/);
                if (found) resolveUrl(found[0]);
                // 스크립트가 끝나면 Node는 디버거가 연결을 끊을 때까지 기다린다. 이 안내가 나오면 끝난 것이다.
                if (buffer.includes('Waiting for the debugger to disconnect')) scriptEnded?.();
            });
            child.on('exit', () => reject(new Error(`디버거 주소를 받기 전에 프로세스가 끝났습니다.\n${buffer}`)));
        });

        socket = new WebSocket(url);
        await new Promise((resolveOpen, reject) => { socket.onopen = resolveOpen; socket.onerror = () => reject(new Error('인스펙터에 연결하지 못했습니다.')); });

        let nextId = 1;
        const waiting = new Map();
        const send = (method, params = {}) => new Promise((resolveCall) => {
            const id = nextId++;
            waiting.set(id, resolveCall);
            socket.send(JSON.stringify({ id, method, params }));
        });

        const mine = new Set();
        const lines = [];
        let pauses = 0;
        let finished;
        const done = new Promise((resolveDone) => { finished = resolveDone; });
        socket.onclose = () => finished();
        child.on('exit', () => finished());
        scriptEnded = () => socket.close();

        socket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.id !== undefined && waiting.has(message.id)) {
                waiting.get(message.id)(message.result);
                waiting.delete(message.id);
                return;
            }
            if (message.method === 'Debugger.scriptParsed') {
                if (message.params.url === target) mine.add(message.params.scriptId);
                return;
            }
            if (message.method !== 'Debugger.paused') return;

            pauses += 1;
            const frames = message.params.callFrames;
            if (pauses > maxPauses) { send('Debugger.resume'); return; }
            if (mine.has(frames[0].location.scriptId)) {
                lines.push(frames[0].location.lineNumber + 1);
                send('Debugger.stepInto');
            } else if (frames.some((frame) => mine.has(frame.location.scriptId))) {
                send('Debugger.stepOut'); // 내 코드가 부른 내장 함수 안이므로 바로 빠져나온다
            } else {
                send('Debugger.resume'); // 내 코드가 모두 끝났다
            }
        };

        await send('Runtime.enable');
        await send('Debugger.enable');
        await send('Runtime.runIfWaitingForDebugger');
        await done;
        if (pauses > maxPauses) throw new Error(`멈춘 횟수가 ${maxPauses}번을 넘었습니다.`);
        return { lines, stdout, pauses };
    } finally {
        clearTimeout(timer);
        try { socket?.close(); } catch { /* 이미 닫힘 */ }
        if (child.exitCode === null) child.kill();
    }
}
