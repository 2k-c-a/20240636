// 같은 origin의 /api/... 호출용 클라이언트. 현재 access token을 Bearer로 보낸다.
// 재전송 정책(docs/CONTRACTS.md §8.6): 401은 서버가 요청을 처리하기 전에 거부한 것이므로
// 세션 갱신으로 토큰이 바뀐 경우에 한해 한 번만 다시 보낸다. 네트워크 오류·503·그 밖의 응답은 다시 보내지 않는다.

export class ApiError extends Error {
    constructor({ status, code, message, fields = null, requestId = null }) {
        super(message);
        this.name = 'ApiError';
        this.status = status; // 네트워크 오류는 0
        this.code = code;
        this.fields = fields;
        this.requestId = requestId;
    }
}

function delay(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }, { once: true });
    });
}

const NETWORK_MESSAGE = '서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.';

async function readError(response) {
    let error = null;
    try {
        error = (await response.json())?.error ?? null;
    } catch {
        // 본문이 JSON이 아니면 상태 코드만 사용한다.
    }
    return new ApiError({
        status: response.status,
        code: typeof error?.code === 'string' ? error.code : 'unknown',
        message: typeof error?.message === 'string' ? error.message : '요청을 처리하지 못했습니다.',
        fields: error?.fields && typeof error.fields === 'object' ? error.fields : null,
        requestId: typeof error?.request_id === 'string' ? error.request_id : response.headers?.get?.('X-Request-ID') ?? null,
    });
}

/**
 * @param {object} deps
 * @param {() => Promise<string|null>} deps.getAccessToken 현재 access token(없으면 null)
 * @param {() => Promise<string|null>} [deps.refreshAccessToken] 세션을 갱신하고 새 token을 돌려준다
 * @param {typeof fetch} [deps.fetchFn]
 */
export function createApiClient({ getAccessToken, refreshAccessToken, fetchFn = globalThis.fetch }) {
    async function send(method, path, { body, headers = {}, auth, signal }, token) {
        const init = { method, headers: { Accept: 'application/json', ...headers }, cache: 'no-store', signal };
        if (auth && token) init.headers.Authorization = `Bearer ${token}`;
        if (body !== undefined) {
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(body);
        }
        try {
            return await fetchFn(path, init);
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            throw new ApiError({ status: 0, code: 'network_error', message: NETWORK_MESSAGE });
        }
    }

    /**
     * 읽기(GET)만 `options.retries`번까지 다시 시도한다(네트워크 오류·503일 때만, 점점 길게 기다린다).
     * 쓰기는 응답을 받지 못했을 때 처리되었을 수 있으므로 어떤 경우에도 다시 보내지 않는다.
     */
    async function request(method, path, options = {}) {
        const retries = method === 'GET' ? Math.max(0, Math.min(options.retries ?? 0, 3)) : 0;
        for (let attempt = 0; ; attempt += 1) {
            try {
                return await requestOnce(method, path, options);
            } catch (error) {
                const transient = error instanceof ApiError && (error.status === 0 || error.status === 503);
                if (!transient || attempt >= retries) throw error;
                await delay((options.retryDelayMs ?? 400) * (attempt + 1), options.signal);
            }
        }
    }

    async function requestOnce(method, path, options = {}) {
        // 토큰을 다른 주소로 보내지 않도록 같은 origin의 API 경로만 허용한다.
        if (typeof path !== 'string' || !path.startsWith('/api/') || path.startsWith('//')) {
            throw new TypeError('API 경로는 /api/ 로 시작해야 합니다.');
        }
        const auth = options.auth !== false;
        const token = auth ? await getAccessToken() : null;
        let response = await send(method, path, { ...options, auth }, token);

        if (response.status === 401 && auth && refreshAccessToken) {
            const fresh = await refreshAccessToken();
            if (fresh && fresh !== token) response = await send(method, path, { ...options, auth }, fresh);
        }
        if (!response.ok) throw await readError(response);
        if (response.status === 204) return { data: null, headers: response.headers, status: 204 };
        let data = null;
        try {
            data = await response.json();
        } catch {
            throw new ApiError({ status: response.status, code: 'invalid_response', message: '서버 응답을 읽지 못했습니다.' });
        }
        return { data, headers: response.headers, status: response.status };
    }

    return {
        request,
        get: (path, options) => request('GET', path, options),
        post: (path, body, options) => request('POST', path, { ...options, body }),
        patch: (path, body, options) => request('PATCH', path, { ...options, body }),
        delete: (path, options) => request('DELETE', path, options),
    };
}
