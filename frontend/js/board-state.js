// 게시판 화면의 순수 로직(DOM·네트워크 없음): 목록 상태, 초안 검사, 글 화면 상태 전이, API 오류 분류.
// 서버가 최종 판정을 하며(docs/CONTRACTS.md §8) 여기의 검사는 사용자에게 빨리 알려 주는 용도다.

export const TITLE_MAX = 100;
export const BODY_MAX = 10_000;
export const ALGORITHMS = Object.freeze([
    { id: 'bfs', label: 'BFS (너비 우선 탐색)' },
    { id: 'dfs', label: 'DFS (깊이 우선 탐색)' },
    { id: 'binary-search', label: '이분 탐색' },
    { id: 'bubble-sort', label: '버블 정렬' },
    { id: 'union-find', label: '유니온 파인드' },
    { id: 'dijkstra', label: '다익스트라' },
    { id: 'knapsack', label: '0/1 배낭 DP' },
    { id: 'topological-sort', label: '위상 정렬' },
    { id: 'two-pointers', label: '투 포인터' },
]);

export function algorithmLabel(id) {
    return ALGORITHMS.find((algorithm) => algorithm.id === id)?.label ?? null;
}

// ---------- 초안 검사 ----------

/** 서버와 같은 규칙(제목 앞뒤 공백 제거 1~100자, 본문 1~10,000자·공백만 불가, 알고리즘은 목록 또는 비움). */
export function validateDraft(draft) {
    const fields = {};
    const title = typeof draft?.title === 'string' ? draft.title.trim() : '';
    const body = typeof draft?.body === 'string' ? draft.body : '';
    const algorithmId = draft?.algorithmId ? String(draft.algorithmId) : null;
    if ([...title].length < 1 || [...title].length > TITLE_MAX) fields.title = `제목은 1~${TITLE_MAX}자여야 합니다.`;
    if ([...body].length < 1 || [...body].length > BODY_MAX || body.trim() === '') fields.body = `본문은 1~${BODY_MAX.toLocaleString('ko-KR')}자여야 하며 공백만으로 이루어질 수 없습니다.`;
    if (algorithmId !== null && !algorithmLabel(algorithmId)) fields.algorithmId = '알 수 없는 알고리즘입니다.';
    for (const [field, value] of [['title', title], ['body', body]]) {
        if ([...value].some((char) => char === '\u0000' || (char.codePointAt(0) >= 0xD800 && char.codePointAt(0) <= 0xDFFF))) {
            fields[field] ??= '쓸 수 없는 문자가 있습니다.';
        }
    }
    return Object.keys(fields).length ? { ok: false, fields } : { ok: true, value: { title, body, algorithm_id: algorithmId } };
}

/** 수정 요청 본문: 원래 글에서 바뀐 필드만 담는다(바뀐 것이 없으면 null). */
export function changesFrom(post, value) {
    const changes = {};
    if (value.title !== post.title) changes.title = value.title;
    if (value.body !== post.body) changes.body = value.body;
    if (value.algorithm_id !== post.algorithm_id) changes.algorithm_id = value.algorithm_id;
    return Object.keys(changes).length ? changes : null;
}

// ---------- API 오류 분류 ----------

/**
 * ApiError(status, code, fields)를 화면이 다룰 종류로 나눈다.
 * 쓰기 요청이 응답 없이 끝난 경우('uncertain')는 처리되었는지 알 수 없으므로 자동으로 다시 보내지 않고 확인을 안내한다.
 */
export function classifyError(error, { write = false } = {}) {
    const status = error?.status;
    const code = error?.code;
    if (status === 401) return { kind: 'login', message: '로그인이 만료되었습니다. 아래에서 다시 로그인하면 작성 중인 내용이 유지됩니다.' };
    if (status === 403 && code === 'profile_required') return { kind: 'profile', message: '글을 쓰려면 먼저 프로필(닉네임)을 만들어 주세요.' };
    if (status === 403) return { kind: 'forbidden', message: '본인이 쓴 글만 수정하거나 삭제할 수 있습니다.' };
    if (status === 404) return { kind: 'gone', message: '글이 없거나 이미 삭제되었습니다.' };
    if (status === 412) return { kind: 'conflict', message: '다른 곳에서 글이 먼저 바뀌었습니다.' };
    if (status === 422) return { kind: 'validation', message: error.message || '입력값을 확인해 주세요.', fields: error.fields ?? {} };
    if (status === 428) return { kind: 'unexpected', message: '화면 정보가 오래되었습니다. 새로고침한 뒤 다시 시도해 주세요.' };
    if (status === 429) return { kind: 'rate', message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' };
    if (status === 0 || status === 503) {
        return write
            ? { kind: 'uncertain', message: '서버 응답을 받지 못했습니다. 요청이 처리되었는지 알 수 없어 자동으로 다시 보내지 않았습니다. 글 목록에서 확인한 뒤 필요하면 다시 시도해 주세요.' }
            : { kind: 'unavailable', message: '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
    }
    return { kind: 'unknown', message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
}

// ---------- 목록 상태 ----------

export function emptyList(filter = null) {
    return Object.freeze({ filter, items: [], nextCursor: null, status: 'loading', error: null, generation: 0 });
}

/**
 * 목록 상태 전이.
 * - filter: 필터를 바꾼다. 목록·cursor를 버리고 새 세대로 처음부터 읽는다(이전 요청의 늦은 응답은 무시된다).
 * - more: 다음 페이지. 읽는 중이거나 다음이 없으면 상태를 바꾸지 않는다(중복 클릭 방지).
 * - retry: 실패한 읽기를 같은 위치에서 다시 한다.
 * - loaded/failed: 요청이 시작될 때의 generation이 지금과 같을 때만 반영한다.
 */
export function reduceList(state, action) {
    switch (action.type) {
        case 'filter':
            return Object.freeze({ ...emptyList(action.filter ?? null), generation: state.generation + 1 });
        case 'more':
            return canLoadMore(state) ? Object.freeze({ ...state, status: 'loading', error: null }) : state;
        case 'retry':
            return state.status === 'error' ? Object.freeze({ ...state, status: 'loading', error: null }) : state;
        case 'loaded': {
            if (action.generation !== state.generation || state.status !== 'loading') return state;
            const seen = new Set(state.items.map((item) => item.id));
            const fresh = action.page.items.filter((item) => !seen.has(item.id));
            return Object.freeze({ ...state, items: [...state.items, ...fresh], nextCursor: action.page.next_cursor ?? null, status: 'ready', error: null });
        }
        case 'failed':
            if (action.generation !== state.generation || state.status !== 'loading') return state;
            return Object.freeze({ ...state, status: 'error', error: action.error }); // 이미 읽은 글은 그대로 둔다
        default:
            return state;
    }
}

export function canLoadMore(state) {
    return state.status === 'ready' && typeof state.nextCursor === 'string' && state.nextCursor !== '';
}

/** 다음에 서버에 보낼 쿼리. 필터를 바꾸면 cursor는 항상 없다. */
export function listQuery(state, limit = 20) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (state.filter) params.set('algorithm', state.filter);
    if (state.items.length > 0 && state.nextCursor) params.set('cursor', state.nextCursor);
    return params.toString();
}

// ---------- 글 화면 상태 ----------

/** 처음 상태: 글을 읽는 중. */
export function loadingPost() {
    return Object.freeze({ phase: 'loading', post: null, draft: null, fields: {}, message: '', conflictWith: null, resume: null });
}

const freeze = (state) => Object.freeze(state);

/**
 * 글 화면 상태 전이. phase:
 * loading → viewing ⇄ editing → saving → viewing,
 * editing/saving 중 412 → conflict(최신 글을 보여 주고 초안은 유지), 404 → gone(초안 유지), 401 → relogin(초안 유지),
 * viewing → confirming-delete → deleting → removed (실패하면 viewing으로 돌아가 안내, 401이면 relogin).
 * 초안(draft)은 사용자가 취소·성공하기 전에는 어떤 오류에서도 지우지 않는다.
 */
export function reducePost(state, action) {
    switch (action.type) {
        case 'loaded':
            return freeze({ ...loadingPost(), phase: 'viewing', post: action.post });
        case 'load-failed':
            return freeze({ ...state, phase: action.kind === 'gone' ? 'gone' : 'load-error', message: action.message });
        case 'edit':
            return state.phase === 'viewing'
                ? freeze({ ...state, phase: 'editing', draft: { title: state.post.title, body: state.post.body, algorithmId: state.post.algorithm_id ?? '' }, fields: {}, message: '' })
                : state;
        case 'draft':
            return ['editing', 'conflict', 'relogin', 'gone'].includes(state.phase) && state.draft ? freeze({ ...state, draft: { ...state.draft, ...action.draft } }) : state;
        case 'cancel-edit':
            return ['editing', 'conflict', 'relogin', 'gone'].includes(state.phase) && state.draft ? freeze({ ...state, phase: state.phase === 'gone' ? 'gone' : 'viewing', draft: null, fields: {}, message: state.phase === 'gone' ? state.message : '', conflictWith: null }) : state;
        case 'save':
            return ['editing', 'conflict'].includes(state.phase) ? freeze({ ...state, phase: 'saving', fields: {}, message: '', resume: state.phase }) : state;
        case 'saved':
            return state.phase === 'saving' ? freeze({ ...loadingPost(), phase: 'viewing', post: action.post, message: '저장했습니다.' }) : state;
        case 'save-failed': {
            if (state.phase !== 'saving') return state;
            const back = state.resume ?? 'editing';
            switch (action.kind) {
                case 'conflict': return freeze({ ...state, phase: 'conflict', conflictWith: action.latest ?? null, message: action.message });
                case 'gone': return freeze({ ...state, phase: 'gone', message: action.message });
                case 'login': return freeze({ ...state, phase: 'relogin', message: action.message });
                case 'validation': return freeze({ ...state, phase: back, fields: action.fields ?? {}, message: action.message });
                default: return freeze({ ...state, phase: back, message: action.message });
            }
        }
        case 'use-latest': // 충돌 뒤: 최신 글을 기준으로 삼되 초안은 그대로 둔다(다음 저장은 최신 version을 쓴다)
            return state.phase === 'conflict' && state.conflictWith ? freeze({ ...state, phase: 'editing', post: state.conflictWith, conflictWith: null, message: '최신 글을 기준으로 바꿨습니다. 초안을 확인하고 저장해 주세요.' }) : state;
        case 'relogged':
            return state.phase === 'relogin' ? freeze({ ...state, phase: state.draft ? 'editing' : 'viewing', message: '다시 로그인했습니다. 내용을 확인하고 저장해 주세요.' }) : state;
        case 'ask-delete':
            return state.phase === 'viewing' ? freeze({ ...state, phase: 'confirming-delete', message: '' }) : state;
        case 'cancel-delete':
            return state.phase === 'confirming-delete' ? freeze({ ...state, phase: 'viewing' }) : state;
        case 'delete':
            return state.phase === 'confirming-delete' ? freeze({ ...state, phase: 'deleting', message: '' }) : state;
        case 'deleted':
            return state.phase === 'deleting' ? freeze({ ...state, phase: 'removed', post: null, message: '글을 삭제했습니다.' }) : state;
        case 'delete-failed':
            if (state.phase !== 'deleting') return state;
            if (action.kind === 'gone') return freeze({ ...state, phase: 'gone', message: action.message });
            if (action.kind === 'conflict') return freeze({ ...state, phase: 'viewing', post: action.latest ?? state.post, message: '다른 곳에서 글이 먼저 바뀌어 삭제하지 않았습니다. 최신 내용을 확인한 뒤 다시 삭제해 주세요.' });
            return freeze({ ...state, phase: action.kind === 'login' ? 'relogin' : 'viewing', message: action.message }); // 삭제할 글은 그대로, 로그인만 다시
        default:
            return state;
    }
}

/** 버튼을 눌러도 되는 단계인지. 요청 중에는 모두 잠근다. */
export function isBusy(state) {
    return ['loading', 'saving', 'deleting'].includes(state.phase);
}
