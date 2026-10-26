// 예제 trace를 읽어 온다. catalog에 등록된 경로만 읽으며, 읽은 bundle은 검증하고 깊게 얼린(freeze) 채로 돌려준다.
// 중단(AbortSignal)은 오류로 감싸지 않고 AbortError 그대로 던진다. 호출한 쪽이 오래된 요청을 버리는 신호로 쓴다.

import { LIMITS } from './trace-contract.js';
import { validateBundle, validateCatalog } from './trace-validator.js';

/** 이 파일 기준 data/ 폴더. 서버에서는 /web/js/data/ 이다. */
const DEFAULT_BASE_URL = new URL('./data/', import.meta.url);

export const LOAD_ERROR_CODES = Object.freeze([
    'network',           // 요청 자체가 실패(연결 끊김 등)
    'not-found',         // 404
    'http',              // 그 밖의 HTTP 오류
    'too-large',         // 크기 제한 초과
    'invalid-json',      // JSON이 아님
    'invalid-catalog',   // catalog 구조 오류
    'invalid-bundle',    // bundle 검증 실패
    'unknown-example',   // catalog에 없는 알고리즘·예제
    'mismatch',          // catalog와 bundle의 내용이 서로 다름
]);

export class TraceLoadError extends Error {
    /**
     * @param {string} code      LOAD_ERROR_CODES 중 하나
     * @param {string} message   사용자에게 보여줄 수 있는 한국어 설명
     * @param {string[]} details 개발자용 상세(검증 오류 목록 등)
     */
    constructor(code, message, details = []) {
        super(message);
        this.name = 'TraceLoadError';
        this.code = code;
        this.details = details;
    }
}

/** 마지막 글자의 받침 유무에 따라 목적격 조사를 붙인다. ('예제 목록' -> '예제 목록을', '예제 데이터' -> '예제 데이터를') */
export function withObjectParticle(word) {
    const last = word.charCodeAt(word.length - 1);
    const hasFinalConsonant = last >= 0xAC00 && last <= 0xD7A3 && (last - 0xAC00) % 28 !== 0;
    return word + (hasFinalConsonant ? '을' : '를');
}

function isAbortError(error) {
    return error !== null && typeof error === 'object' && error.name === 'AbortError';
}

function throwIfAborted(signal) {
    if (signal && signal.aborted) {
        throw signal.reason ?? new DOMException('요청이 중단되었습니다.', 'AbortError');
    }
}

function deepFreeze(value) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
}

async function fetchJson(url, { signal, fetchImpl, maxBytes, what }) {
    throwIfAborted(signal);
    let response;
    try {
        response = await fetchImpl(url, { signal, cache: 'no-cache', credentials: 'same-origin' });
    } catch (error) {
        if (isAbortError(error) || (signal && signal.aborted)) throw error;
        throw new TraceLoadError('network', `${withObjectParticle(what)} 불러오지 못했습니다. 네트워크 연결을 확인해 주세요.`);
    }
    if (!response.ok) {
        const code = response.status === 404 ? 'not-found' : 'http';
        throw new TraceLoadError(code, `${withObjectParticle(what)} 찾을 수 없거나 서버가 오류를 돌려주었습니다. (HTTP ${response.status})`);
    }

    let text;
    try {
        text = await response.text();
    } catch (error) {
        if (isAbortError(error) || (signal && signal.aborted)) throw error;
        throw new TraceLoadError('network', `${withObjectParticle(what)} 읽는 중 연결이 끊어졌습니다.`);
    }
    throwIfAborted(signal);

    const bytes = new TextEncoder().encode(text).length;
    if (bytes > maxBytes) {
        throw new TraceLoadError('too-large', `${what}의 크기가 제한(${maxBytes}바이트)을 넘습니다.`, [`${bytes}바이트`]);
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new TraceLoadError('invalid-json', `${what}의 형식이 올바르지 않습니다.`);
    }
}

/**
 * 호출자가 넘긴 catalog를 믿을 수 있는 사본으로 바꾼다. 복사한 뒤 사본을 검증하고 얼려서 돌려준다.
 * 원본을 그대로 검증하면 검증 뒤 await 사이에 호출자가 객체를 바꿔도 검증하지 않은 값을 쓰게 된다.
 */
function toTrustedCatalog(catalog) {
    let copy;
    try {
        copy = structuredClone(catalog);
    } catch {
        throw new TraceLoadError('invalid-catalog', '예제 목록을 읽을 수 없습니다. 함수 등이 들어 있지 않은 일반 객체여야 합니다.');
    }
    const { valid, errors } = validateCatalog(copy);
    if (!valid) throw new TraceLoadError('invalid-catalog', '예제 목록의 구조가 올바르지 않습니다.', errors);
    return deepFreeze(copy);
}

/**
 * catalog를 읽고 검증한다.
 * @param {{signal?: AbortSignal, fetch?: typeof fetch, baseUrl?: URL}} [options]
 * @returns {Promise<import('./trace-contract.js').Catalog>}
 */
export async function loadCatalog({ signal, fetch: fetchImpl = globalThis.fetch, baseUrl = DEFAULT_BASE_URL } = {}) {
    const catalog = await fetchJson(new URL('catalog.json', baseUrl), {
        signal, fetchImpl, maxBytes: LIMITS.maxBundleBytes, what: '예제 목록',
    });
    const { valid, errors } = validateCatalog(catalog);
    if (!valid) throw new TraceLoadError('invalid-catalog', '예제 목록의 구조가 올바르지 않습니다.', errors);
    return deepFreeze(catalog);
}

/**
 * catalog에 등록된 예제 하나를 읽어 검증하고, 깊게 얼린 bundle을 돌려준다.
 * 알고리즘·예제 ID는 catalog에서 찾는 데만 쓰며 경로 문자열로 직접 쓰지 않는다.
 *
 * @param {string} algorithmId
 * @param {string} exampleId
 * @param {{signal?: AbortSignal, fetch?: typeof fetch, baseUrl?: URL, catalog?: object}} [options]
 *        catalog를 이미 읽었다면 넘겨서 다시 읽지 않게 할 수 있다. 넘긴 catalog도 반드시 다시 검증하며
 *        (null 포함, undefined만 "없음"), 호출자의 객체가 아니라 얼린 사본을 쓴다.
 * @returns {Promise<import('./trace-contract.js').TraceBundle>}
 */
export async function loadBundle(algorithmId, exampleId, options = {}) {
    const { signal, fetch: fetchImpl = globalThis.fetch, baseUrl = DEFAULT_BASE_URL } = options;
    const catalog = options.catalog !== undefined
        ? toTrustedCatalog(options.catalog)
        : await loadCatalog({ signal, fetch: fetchImpl, baseUrl });

    const algorithm = catalog.algorithms.find((item) => item.id === algorithmId);
    const example = algorithm && algorithm.examples.find((item) => item.id === exampleId);
    if (!algorithm || !example) {
        throw new TraceLoadError('unknown-example', '선택한 알고리즘이나 예제를 찾을 수 없습니다.');
    }

    const url = new URL(example.path, baseUrl);
    if (!url.href.startsWith(baseUrl.href)) {
        throw new TraceLoadError('invalid-catalog', '예제 목록의 경로가 허용된 폴더 밖을 가리킵니다.');
    }

    const bundle = await fetchJson(url, { signal, fetchImpl, maxBytes: LIMITS.maxBundleBytes, what: '예제 데이터' });

    const { valid, errors } = validateBundle(bundle);
    if (!valid) throw new TraceLoadError('invalid-bundle', '예제 데이터가 올바르지 않아 표시할 수 없습니다.', errors);

    const problems = [];
    if (bundle.algorithmId !== algorithmId) problems.push(`algorithmId: ${algorithmId}이어야 합니다 (${bundle.algorithmId})`);
    if (bundle.exampleId !== exampleId) problems.push(`exampleId: ${exampleId}이어야 합니다 (${bundle.exampleId})`);
    const bundleLanguages = Object.keys(bundle.codes).sort().join(',');
    const catalogLanguages = [...example.languages].sort().join(',');
    if (bundleLanguages !== catalogLanguages) problems.push(`언어: catalog는 ${catalogLanguages}, bundle은 ${bundleLanguages}입니다`);
    if (problems.length > 0) throw new TraceLoadError('mismatch', '예제 목록과 예제 데이터의 내용이 서로 다릅니다.', problems);

    return deepFreeze(bundle);
}
