// trace 로더(loadCatalog, loadBundle)를 가짜 fetch로 검사한다. 서버나 네트워크를 쓰지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIMITS } from '../../frontend/js/trace-contract.js';
import { LOAD_ERROR_CODES, TraceLoadError, loadBundle, loadCatalog, withObjectParticle } from '../../frontend/js/trace-loader.js';

const DATA_DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), '../..'), 'frontend/js/data');
const BASE = new URL('http://127.0.0.1:8000/web/js/data/');

const readText = (name) => readFileSync(join(DATA_DIR, name), 'utf8');
const readJson = (name) => JSON.parse(readText(name));

/** URL 경로 -> 응답 본문(문자열) 또는 Response를 만드는 함수. 요청 기록을 남긴다. */
function makeFetch(routes) {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        const route = routes[new URL(url).pathname.replace('/web/js/data/', '')];
        if (route === undefined) return new Response('not found', { status: 404 });
        return typeof route === 'function' ? route(url, init) : new Response(route, { status: 200 });
    };
    fetchImpl.calls = calls;
    return fetchImpl;
}

const goodRoutes = () => ({ 'catalog.json': readText('catalog.json'), 'bfs/diamond.json': readText('bfs/diamond.json') });
const options = (extra = {}) => ({ baseUrl: BASE, fetch: makeFetch(goodRoutes()), ...extra });

async function rejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    assert.fail('거부되어야 합니다');
}

async function assertLoadError(promise, code) {
    const error = await rejection(promise);
    assert.ok(error instanceof TraceLoadError, `TraceLoadError여야 합니다: ${error}`);
    assert.equal(error.code, code, `${error.message} ${error.details.join(' / ')}`);
    assert.ok(LOAD_ERROR_CODES.includes(error.code));
    assert.match(error.message, /[가-힣]/, '사용자에게 보일 설명은 한국어여야 합니다');
    return error;
}

test('withObjectParticle: 받침 유무에 따라 을/를을 고른다', () => {
    assert.equal(withObjectParticle('예제 목록'), '예제 목록을');
    assert.equal(withObjectParticle('예제 데이터'), '예제 데이터를');
    assert.equal(withObjectParticle('값'), '값을');
    assert.equal(withObjectParticle('큐'), '큐를');
    assert.equal(withObjectParticle('BFS'), 'BFS를'); // 한글이 아니면 기본값
});

// ---------- 성공 ----------

test('loadBundle: 등록된 예제를 읽어 검증하고 bundle을 돌려준다', async () => {
    const opts = options();
    const bundle = await loadBundle('bfs', 'diamond', opts);
    assert.equal(bundle.contentVersion, 'bfs-diamond-v4');
    assert.equal(bundle.steps.length, 22);
    assert.deepEqual(opts.fetch.calls.map((call) => call.url), [
        'http://127.0.0.1:8000/web/js/data/catalog.json',
        'http://127.0.0.1:8000/web/js/data/bfs/diamond.json',
    ]);
});

test('loadBundle: 돌려주는 bundle은 깊게 얼려 있어 어느 step의 상태도 바꿀 수 없다', async () => {
    const bundle = await loadBundle('bfs', 'diamond', options());
    assert.ok(Object.isFrozen(bundle));
    assert.ok(Object.isFrozen(bundle.steps));
    assert.ok(Object.isFrozen(bundle.steps[3]));
    assert.ok(Object.isFrozen(bundle.steps[3].state.discovered));
    assert.ok(Object.isFrozen(bundle.input.graph.A));
    assert.ok(Object.isFrozen(bundle.codes.python.lines));
    // ES 모듈은 strict mode라서 얼린 배열을 바꾸면 TypeError가 난다.
    assert.throws(() => bundle.steps[3].state.discovered.push('Z'), TypeError);
    assert.throws(() => { bundle.steps[1].message = '바꿈'; }, TypeError);
    assert.throws(() => { bundle.steps.length = 0; }, TypeError);
});

test('loadBundle: catalog를 넘기면 다시 읽지 않는다', async () => {
    const opts = options();
    const catalog = await loadCatalog(opts);
    opts.fetch.calls.length = 0;
    await loadBundle('bfs', 'diamond', { ...opts, catalog });
    assert.deepEqual(opts.fetch.calls.map((call) => new URL(call.url).pathname), ['/web/js/data/bfs/diamond.json']);
});

// 넘겨받은 catalog도 같은 검증을 거친다. 검토에서 경로를 `bfs/../bfs/diamond.json`으로 바꾼 catalog가
// validateCatalog는 거부하는데 loadBundle은 파일을 요청해 성공하는 것이 재현되었다.
test('loadBundle: 넘겨받은 catalog도 검증하고, 잘못되었으면 파일을 요청하지 않는다', async () => {
    const withPath = (path) => {
        const catalog = readJson('catalog.json');
        catalog.algorithms[0].examples[0].path = path;
        return catalog;
    };
    const invalid = {
        '경로 안의 ..(검토에서 재현된 사례)': withPath('bfs/../bfs/diamond.json'),
        '폴더 밖': withPath('../bfs/diamond.json'),
        '외부 주소': withPath('https://example.com/bfs/diamond.json'),
        '다른 예제의 경로': withPath('bfs/other.json'),
        '알 수 없는 알고리즘': { ...readJson('catalog.json'), algorithms: [{ ...readJson('catalog.json').algorithms[0], id: 'quick-sort' }] },
        '빈 객체': {},
        '배열': [],
        '문자열': 'catalog',
        '숫자': 7,
        null: null,
    };
    for (const [label, catalog] of Object.entries(invalid)) {
        const opts = options();
        await assertLoadError(loadBundle('bfs', 'diamond', { ...opts, catalog }), 'invalid-catalog');
        assert.equal(opts.fetch.calls.length, 0, `${label}: 요청하면 안 됩니다`);
    }
});

test('loadBundle: 함수 등 복사할 수 없는 값이 든 catalog도 예외 없이 invalid-catalog로 거부한다', async () => {
    const catalog = readJson('catalog.json');
    catalog.algorithms[0].examples[0].path = () => 'bfs/diamond.json';
    const opts = options();
    await assertLoadError(loadBundle('bfs', 'diamond', { ...opts, catalog }), 'invalid-catalog');
    assert.equal(opts.fetch.calls.length, 0);
});

test('loadBundle: 넘겨받은 catalog를 복사해 쓰므로, 검증 뒤 요청 도중에 원본을 바꿔도 영향이 없다', async () => {
    const catalog = readJson('catalog.json');
    const routes = goodRoutes();
    // bundle을 돌려주는 순간에 호출자가 원본 catalog를 바꾼다(검증 이후이므로 사본에는 영향이 없어야 한다).
    routes['bfs/diamond.json'] = () => {
        catalog.algorithms[0].examples[0].languages = ['c'];
        catalog.algorithms[0].examples[0].path = 'bfs/../etc/passwd';
        return new Response(readText('bfs/diamond.json'), { status: 200 });
    };
    const fetchImpl = makeFetch(routes);
    const bundle = await loadBundle('bfs', 'diamond', { baseUrl: BASE, fetch: fetchImpl, catalog });
    assert.equal(bundle.contentVersion, 'bfs-diamond-v4');
    assert.deepEqual(fetchImpl.calls.map((call) => new URL(call.url).pathname), ['/web/js/data/bfs/diamond.json']);
    // 호출자의 객체는 얼리거나 바꾸지 않는다(바꾼 값 그대로다).
    assert.equal(Object.isFrozen(catalog), false);
    assert.deepEqual(catalog.algorithms[0].examples[0].languages, ['c']);
});

test('loadBundle: 올바른 catalog를 넘기면 검증을 통과해 파일만 요청한다', async () => {
    const opts = options();
    const bundle = await loadBundle('bfs', 'diamond', { ...opts, catalog: readJson('catalog.json') });
    assert.equal(bundle.steps.length, 22);
    assert.deepEqual(opts.fetch.calls.map((call) => new URL(call.url).pathname), ['/web/js/data/bfs/diamond.json']);
});

test('loadBundle: catalog를 생략(undefined)하면 읽어 오고, null은 "없음"이 아니라 잘못된 값이다', async () => {
    const omitted = options();
    await loadBundle('bfs', 'diamond', { ...omitted, catalog: undefined });
    assert.equal(omitted.fetch.calls.length, 2);

    const explicitNull = options();
    await assertLoadError(loadBundle('bfs', 'diamond', { ...explicitNull, catalog: null }), 'invalid-catalog');
    assert.equal(explicitNull.fetch.calls.length, 0);
});

test('loadCatalog: 검증을 통과한 catalog를 얼려서 돌려준다', async () => {
    const catalog = await loadCatalog(options());
    assert.equal(catalog.algorithms[0].examples[0].path, 'bfs/diamond.json');
    assert.ok(Object.isFrozen(catalog.algorithms[0].examples[0].languages));
});

test('요청에 signal과 같은 출처 정책, no-cache를 전달한다', async () => {
    const opts = options();
    const controller = new AbortController();
    await loadBundle('bfs', 'diamond', { ...opts, signal: controller.signal });
    for (const call of opts.fetch.calls) {
        assert.equal(call.init.signal, controller.signal);
        assert.equal(call.init.credentials, 'same-origin');
        assert.equal(call.init.cache, 'no-cache');
    }
});

// ---------- 경로 안전: ID는 catalog에서 찾기만 한다 ----------

test('catalog에 없는 ID나 경로처럼 보이는 ID는 거부하고 bundle을 요청하지 않는다', async () => {
    const hostile = [
        ['bfs', 'nope'], ['dfs', 'diamond'], ['nope', 'diamond'],
        ['bfs', '../catalog'], ['bfs', 'diamond.json'], ['bfs/diamond', ''], ['..', '..'],
        ['bfs', 'https://example.com/x'], ['bfs', '//example.com/x'], ['bfs', 'C:\\Windows\\win.ini'],
        ['__proto__', 'diamond'], ['constructor', 'diamond'], ['bfs', '__proto__'], ['bfs', 'toString'],
        [undefined, undefined], [null, null], [{}, []], [7, 8],
    ];
    for (const [algorithmId, exampleId] of hostile) {
        const opts = options();
        const catalog = await loadCatalog(opts);
        opts.fetch.calls.length = 0;
        await assertLoadError(loadBundle(algorithmId, exampleId, { ...opts, catalog }), 'unknown-example');
        assert.equal(opts.fetch.calls.length, 0, `${JSON.stringify([algorithmId, exampleId])}: 파일을 요청하면 안 됩니다`);
    }
});

test('catalog의 경로가 폴더 밖이거나 외부 주소이면 catalog 검증에서 막혀 요청하지 않는다', async () => {
    for (const path of ['../x.json', 'https://example.com/x.json', '/etc/passwd', 'bfs/../../x.json']) {
        const catalog = readJson('catalog.json');
        catalog.algorithms[0].examples[0].path = path;
        const fetchImpl = makeFetch({ 'catalog.json': JSON.stringify(catalog), 'x.json': readText('bfs/diamond.json') });
        await assertLoadError(loadBundle('bfs', 'diamond', { baseUrl: BASE, fetch: fetchImpl }), 'invalid-catalog');
        assert.deepEqual(fetchImpl.calls.map((call) => new URL(call.url).pathname), ['/web/js/data/catalog.json'], path);
    }
});

// ---------- 실패 종류 ----------

test('HTTP 오류와 네트워크 오류를 구분한다', async () => {
    await assertLoadError(loadBundle('bfs', 'diamond', { baseUrl: BASE, fetch: makeFetch({ 'catalog.json': readText('catalog.json') }) }), 'not-found');
    await assertLoadError(loadCatalog({ baseUrl: BASE, fetch: makeFetch({}) }), 'not-found');

    const serverError = makeFetch({ 'catalog.json': () => new Response('boom', { status: 500 }) });
    const error = await assertLoadError(loadCatalog({ baseUrl: BASE, fetch: serverError }), 'http');
    assert.match(error.message, /HTTP 500/);

    // 사용자에게 보이는 문장의 조사가 단어에 맞아야 한다(받침이 있으면 '을', 없으면 '를').
    const noCatalog = await rejection(loadCatalog({ baseUrl: BASE, fetch: makeFetch({}) }));
    assert.match(noCatalog.message, /^예제 목록을 찾을 수 없거나/);
    const noBundle = await rejection(loadBundle('bfs', 'diamond', { baseUrl: BASE, fetch: makeFetch({ 'catalog.json': readText('catalog.json') }) }));
    assert.match(noBundle.message, /^예제 데이터를 찾을 수 없거나/);
    const networkDown = await rejection(loadCatalog({ baseUrl: BASE, fetch: async () => { throw new TypeError('x'); } }));
    assert.match(networkDown.message, /^예제 목록을 불러오지 못했습니다/);

    const offline = async () => { throw new TypeError('Failed to fetch'); };
    await assertLoadError(loadCatalog({ baseUrl: BASE, fetch: offline }), 'network');

    const cut = makeFetch({ 'catalog.json': () => ({ ok: true, status: 200, text: async () => { throw new TypeError('terminated'); } }) });
    await assertLoadError(loadCatalog({ baseUrl: BASE, fetch: cut }), 'network');
});

test('JSON이 아니거나 너무 크면 거부한다', async () => {
    const routes = goodRoutes();
    routes['bfs/diamond.json'] = '{ "schemaVersion": ';
    await assertLoadError(loadBundle('bfs', 'diamond', { baseUrl: BASE, fetch: makeFetch(routes) }), 'invalid-json');

    routes['bfs/diamond.json'] = ' '.repeat(LIMITS.maxBundleBytes + 1);
    await assertLoadError(loadBundle('bfs', 'diamond', { baseUrl: BASE, fetch: makeFetch(routes) }), 'too-large');
});

test('검증에 실패한 bundle은 오류 이유와 함께 거부한다', async () => {
    const bundle = readJson('bfs/diamond.json');
    bundle.steps[3].lines.python = [11];
    bundle.steps[5].operation = 'teleport';
    const routes = goodRoutes();
    routes['bfs/diamond.json'] = JSON.stringify(bundle);
    const error = await assertLoadError(loadBundle('bfs', 'diamond', { baseUrl: BASE, fetch: makeFetch(routes) }), 'invalid-bundle');
    assert.ok(error.details.some((message) => /줄 번호 11가 코드의 줄 범위/.test(message)));
    assert.ok(error.details.some((message) => /알 수 없는 operation "teleport"/.test(message)));
});

test('catalog와 bundle의 내용이 다르면 거부한다', async () => {
    // 다른 예제의 bundle을 이 경로에 둔 경우
    const other = readJson('bfs/diamond.json');
    other.exampleId = 'other';
    other.contentVersion = 'bfs-other-v1';
    const routes = goodRoutes();
    routes['bfs/diamond.json'] = JSON.stringify(other);
    const wrongExample = await assertLoadError(loadBundle('bfs', 'diamond', { baseUrl: BASE, fetch: makeFetch(routes) }), 'mismatch');
    assert.ok(wrongExample.details.some((message) => /exampleId: diamond이어야/.test(message)));

    // catalog가 약속한 언어와 bundle의 언어가 다른 경우
    const catalog = readJson('catalog.json');
    catalog.algorithms[0].examples[0].languages = ['python', 'c'];
    const languageRoutes = goodRoutes();
    languageRoutes['catalog.json'] = JSON.stringify(catalog);
    const wrongLanguages = await assertLoadError(loadBundle('bfs', 'diamond', { baseUrl: BASE, fetch: makeFetch(languageRoutes) }), 'mismatch');
    assert.ok(wrongLanguages.details.some((message) => /언어: catalog는 c,python, bundle은 c,cpp,java,javascript,kotlin,python,rust/.test(message)));
});

test('catalog 구조가 잘못되면 invalid-catalog로 거부한다', async () => {
    const catalog = readJson('catalog.json');
    catalog.algorithms[0].id = 'quick-sort';
    const fetchImpl = makeFetch({ 'catalog.json': JSON.stringify(catalog) });
    const error = await assertLoadError(loadCatalog({ baseUrl: BASE, fetch: fetchImpl }), 'invalid-catalog');
    assert.ok(error.details.length > 0);
});

// ---------- 중단(AbortSignal) ----------

/** 요청이 끝나지 않다가 signal이 중단되면 AbortError로 거부되는 fetch. */
function hangingFetch() {
    const fetchImpl = (url, { signal }) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason));
    });
    return fetchImpl;
}

test('이미 중단된 signal이면 요청하지 않고 AbortError로 끝난다', async () => {
    const controller = new AbortController();
    controller.abort();
    const opts = options({ signal: controller.signal });
    const error = await rejection(loadBundle('bfs', 'diamond', opts));
    assert.equal(error.name, 'AbortError');
    assert.ok(!(error instanceof TraceLoadError));
    assert.equal(opts.fetch.calls.length, 0);
});

test('요청 중에 중단하면 TraceLoadError로 감싸지 않고 AbortError를 그대로 던진다', async () => {
    const controller = new AbortController();
    const pending = loadBundle('bfs', 'diamond', { baseUrl: BASE, fetch: hangingFetch(), signal: controller.signal });
    controller.abort();
    const error = await rejection(pending);
    assert.equal(error.name, 'AbortError');
    assert.ok(!(error instanceof TraceLoadError));
});

test('본문을 읽는 중에 중단해도 AbortError이며, 읽은 내용을 결과로 쓰지 않는다', async () => {
    const controller = new AbortController();
    const slowBody = makeFetch({
        'catalog.json': () => ({
            ok: true,
            status: 200,
            text: async () => {
                controller.abort();
                return readText('catalog.json'); // 중단 이후에 도착한 본문
            },
        }),
    });
    const error = await rejection(loadCatalog({ baseUrl: BASE, fetch: slowBody, signal: controller.signal }));
    assert.equal(error.name, 'AbortError');
});

test('catalog를 읽은 뒤 bundle을 읽는 도중 중단해도 AbortError이다', async () => {
    const controller = new AbortController();
    const routes = goodRoutes();
    routes['bfs/diamond.json'] = (url, { signal }) => new Promise((_, reject) => {
        controller.abort();
        reject(signal.reason);
    });
    const error = await rejection(loadBundle('bfs', 'diamond', { baseUrl: BASE, fetch: makeFetch(routes), signal: controller.signal }));
    assert.equal(error.name, 'AbortError');
});

test('나중에 시작한 요청의 결과가 먼저 끝난 오래된 요청의 중단과 섞이지 않는다', async () => {
    const stale = new AbortController();
    const fresh = new AbortController();
    const first = loadBundle('bfs', 'diamond', { baseUrl: BASE, fetch: hangingFetch(), signal: stale.signal });
    const second = loadBundle('bfs', 'diamond', { ...options(), signal: fresh.signal });
    stale.abort();
    assert.equal((await rejection(first)).name, 'AbortError');
    assert.equal((await second).contentVersion, 'bfs-diamond-v4');
});
