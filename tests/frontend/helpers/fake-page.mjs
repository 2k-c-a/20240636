// 시각화 페이지(visualizer.html + visualizer.js)를 가짜 DOM으로 띄운다.
// 요소 목록은 HTML 파일의 id 속성을 그대로 읽어 만든다. 그래서 스크립트가 찾는 id가 HTML에서 빠지면 테스트가 실패한다.
// 이 파일은 테스트가 아니므로 node --test가 직접 실행하지 않는다.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { FakeDocument, byClass, walk } from './fake-dom.mjs';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
let instance = 0;

const VOID_TAGS = new Set(['meta', 'link', 'br', 'img', 'input', 'hr', 'source']);

/**
 * visualizer.html의 `<tag ... id="x" ...>` 시작 태그에서 요소를 만든다(hidden·disabled 속성은 초기값으로 반영한다).
 * 태그의 여닫는 순서를 따라 id가 있는 요소끼리 부모·자손 관계도 연결한다(자손이 숨겨지는지, 포커스가 그 안에 있는지 판단하는 데 쓴다).
 */
export function buildPage(options) {
    const html = readFileSync(join(WEB_ROOT, 'frontend/html/visualizer.html'), 'utf8');
    const doc = new FakeDocument(options);
    doc.strictFocus = true; // 이 페이지에서는 button·select 등 포커스를 받을 수 있는 요소만 focus()가 성공한다
    const open = []; // 아직 닫히지 않은 태그: {tag, element|null}
    for (const match of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
        const [, closing, tag, rest] = match;
        if (closing) {
            while (open.length > 0 && open.at(-1).tag !== tag) open.pop();
            open.pop();
            continue;
        }
        const id = /\sid="([^"]+)"/.exec(rest)?.[1];
        let element = null;
        if (id !== undefined) {
            element = doc.register(id, doc.createElement(tag));
            element.id = id;
            element.hidden = /\shidden\b/.test(rest);
            const tabindex = /\stabindex="([^"]*)"/.exec(rest);
            if (tabindex !== null) element.setAttribute('tabindex', tabindex[1]);
            if (/\sdisabled\b/.test(rest)) element.disabled = true;
            element.parent = [...open].reverse().find((item) => item.element !== null)?.element ?? null;
        }
        if (!VOID_TAGS.has(tag.toLowerCase())) open.push({ tag, element });
    }
    return doc;
}

/** 중단 신호(AbortSignal)가 울리면 거부하는 Promise. 브라우저의 fetch가 요청을 중단했을 때와 같다. */
export function abortable(promise, signal) {
    if (!signal) return promise;
    return new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException('요청이 중단되었습니다.', 'AbortError'));
        if (signal.aborted) abort();
        signal.addEventListener('abort', abort, { once: true });
        promise.then(resolve, reject);
    });
}

/** 밖에서 끝낼 수 있는 Promise(응답이 도착하는 때를 테스트가 정한다). */
export function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

/**
 * 페이지를 띄우고 예제를 불러와 그려질 때까지 기다린다.
 * @param {{search?: string, lazyBlur?: boolean, route?: (url: string, init: object|undefined, disk: () => Promise<Response>) => Promise<Response>}} [options]
 *   route: 요청마다 응답을 직접 정한다(지연, 실패 등). 생략하면 디스크의 파일을 바로 돌려준다.
 * @returns {Promise<{doc: FakeDocument, el: (id: string) => any, errors: any[]}>}
 */
export async function bootPage({ search = '', lazyBlur = false, route = null } = {}) {
    const doc = buildPage({ lazyBlur });
    const errors = [];
    // 페이지의 스크립트는 클릭 같은 이벤트를 처리할 때도 전역 document를 읽으므로, 테스트가 끝날 때까지 이 값들을 유지한다.
    // 한 파일에서 페이지를 여러 개 띄우면 마지막에 띄운 페이지가 전역이 되므로, 테스트는 자기 페이지를 띄운 직후에 쓴다.
    globalThis.document = doc;
    const windowListeners = new Map();
    globalThis.window = {
        location: { search, reload() {} },
        addEventListener(type, listener) { windowListeners.set(type, [...(windowListeners.get(type) ?? []), listener]); },
        /** 창에 이벤트를 보낸다(예: pagehide). */
        fire(type, event = {}) { for (const listener of windowListeners.get(type) ?? []) listener({ type, ...event }); },
    };
    const disk = async (url) => new Response(readFileSync(fileURLToPath(url), 'utf8'), { status: 200 });
    globalThis.fetch = (url, init) => (route === null ? disk(url) : route(String(url), init, () => disk(url)));
    console.error = (...args) => { errors.push(args); };
    instance += 1;
    // 쿼리 문자열을 붙여 매번 새 모듈 인스턴스로 읽는다(모듈은 읽는 순간 start()를 실행한다).
    await import(`${pathToFileURL(join(WEB_ROOT, 'frontend/js/visualizer.js')).href}?page=${instance}`);
    const status = doc.getElementById('viz-status');
    // setTimeout이 아니라 setImmediate로 기다린다. 테스트가 setTimeout을 가짜 시계로 바꿔도(자동 재생 시험) 기다리기는 멈추지 않는다.
    for (let i = 0; i < 2000 && status.hidden === false && errors.length === 0; i += 1) await new Promise((done) => setImmediate(done));
    return { doc, el: (id) => doc.getElementById(id), win: globalThis.window, errors };
}

/** 화면에 보이는 값들을 한 번에 읽는다(테스트가 단계·언어 전환 전후를 비교할 때 쓴다). */
export function snapshot({ el }) {
    const code = el('code-root');
    const lines = byClass(code, 'src').map((node) => node.textContent);
    const highlighted = byClass(code, 'hl').map((node) => Number(node.getAttribute('data-line')));
    let graph = '';
    walk(el('graph-root'), (node) => { graph += `<${node.localName} ${[...node.attributes].map(([k, v]) => `${k}=${v}`).sort().join(' ')}>${node.nodeType === 1 && node.childNodes.every((n) => n.nodeType === 3) ? node.textContent : ''}`; });
    return {
        title: el('viz-title').textContent,
        progress: el('viz-progress').textContent,
        phase: el('viz-phase').textContent,
        srProgress: el('viz-sr-progress').textContent,
        operation: `${el('viz-operation-prefix').textContent}${el('viz-operation').textContent}`,
        message: el('viz-message').textContent,
        notes: el('code-notes').textContent,
        codeLabel: code.children[0]?.getAttribute('aria-label'),
        lines,
        highlighted,
        graph,
        select: el('lang-select').value,
        disabled: Object.fromEntries(['btn-reset', 'btn-prev', 'btn-next'].map((id) => [id, el(id).disabled])),
    };
}
