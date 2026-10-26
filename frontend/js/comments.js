import { formatDate, h, onAuthChange, say, setBusy } from './board-common.js';
import { exclusiveWrite } from './board-requests.js';

export function validateCommentBody(value) {
    return typeof value === 'string' && value.trim() !== '' && Array.from(value).length <= 2000
        && !/[\u0000\uD800-\uDFFF]/u.test(value);
}

export function canDeleteComment(comment, user) {
    return Boolean(user?.id && comment.author_id === user.id);
}

export function mountComments({ id, api, auth, user: initialUser }) {
    const section = document.querySelector('#comments-section');
    const list = section.querySelector('#comments-list');
    const form = section.querySelector('#comment-form');
    const status = section.querySelector('#comments-status');
    const message = section.querySelector('#comment-message');
    const gate = section.querySelector('#comment-gate');
    const more = section.querySelector('#comments-more');
    const retry = section.querySelector('#comments-retry');
    const counter = section.querySelector('#comment-count');
    let user = initialUser;
    let items = [];
    let cursor = null;
    let loading = false;
    let saving = false;
    let loadGeneration = 0;
    let failed = false;
    let unavailable = false;
    const path = `/api/posts/${id}/comments`;
    const returnPath = `/web/html/post.html?id=${id}`;

    function render() {
        form.hidden = !user || unavailable;
        setBusy(form, saving);
        gate.replaceChildren();
        if (unavailable) gate.textContent = '글이 삭제되어 댓글을 작성할 수 없습니다.';
        else if (!user) gate.append('댓글을 남기려면 ', h('a', { href: `login.html?next=${encodeURIComponent(returnPath)}`, text: '로그인' }), '해 주세요.');
        else gate.textContent = '서로 존중하며 생각을 나눠주세요.';
        more.hidden = !cursor;
        more.disabled = loading || saving;
        retry.hidden = !failed;
        retry.disabled = loading || saving;
        list.setAttribute('aria-busy', String(loading));
        list.replaceChildren(...items.map((comment) => {
            const article = h('li', { class: 'comment-item' });
            const meta = h('div', { class: 'comment-meta' }, h('strong', { text: comment.author_display_name }), h('time', { datetime: comment.created_at, text: formatDate(comment.created_at) }));
            article.append(meta, h('p', { class: 'comment-body', text: comment.body }));
            if (canDeleteComment(comment, user)) {
                const remove = h('button', { type: 'button', class: 'comment-delete', text: '삭제', disabled: saving });
                const confirmation = h('div', { class: 'comment-confirm', hidden: true });
                const yes = h('button', { type: 'button', class: 'board-danger', text: '댓글 삭제' });
                const no = h('button', { type: 'button', class: 'button-secondary', text: '취소' });
                confirmation.append(h('p', { text: '이 댓글을 삭제할까요?' }), yes, no);
                remove.addEventListener('click', () => { confirmation.hidden = false; yes.focus(); });
                no.addEventListener('click', () => { confirmation.hidden = true; remove.focus(); });
                yes.addEventListener('click', exclusiveWrite(async () => {
                    if (saving) return;
                    saving = true;
                    setBusy(confirmation, true);
                    setBusy(form, true);
                    try {
                        await api.delete(`${path}/${comment.id}`);
                        items = items.filter((item) => item.id !== comment.id);
                        say(status, '댓글을 삭제했습니다.', 'ok');
                    } catch (error) {
                        say(status, error.status === 401 ? '로그인이 만료됐습니다. 다시 로그인해 주세요.' : '댓글을 삭제하지 못했습니다. 새로고침해 처리 여부를 확인해 주세요.', 'error');
                    } finally {
                        saving = false;
                        render();
                        status.focus();
                    }
                }));
                meta.append(remove);
                article.append(confirmation);
            }
            return article;
        }));
    }

    async function load(reset = false) {
        if (loading && !reset) return;
        const generation = ++loadGeneration;
        const after = reset ? null : cursor;
        loading = true;
        failed = false;
        render();
        say(status, '댓글을 불러오는 중입니다…');
        try {
            const { data } = await api.get(`${path}${after ? `?cursor=${encodeURIComponent(after)}` : ''}`, { auth: false });
            if (generation !== loadGeneration) return;
            const existing = reset ? [] : items;
            const seen = new Set(existing.map((item) => item.id));
            items = [...existing, ...data.items.filter((item) => !seen.has(item.id))];
            cursor = data.next_cursor;
            unavailable = false;
            say(status, items.length ? '' : '아직 댓글이 없습니다. 첫 의견을 남겨보세요.');
        } catch (error) {
            if (generation !== loadGeneration) return;
            failed = true;
            unavailable = error.status === 404;
            say(status, unavailable ? '글이 없거나 이미 삭제되었습니다.' : '댓글을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.', 'error');
        } finally {
            if (generation === loadGeneration) { loading = false; render(); }
        }
    }

    form.elements.body.addEventListener('input', () => {
        counter.textContent = `${Array.from(form.elements.body.value).length.toLocaleString()} / 2,000`;
    });
    form.addEventListener('submit', exclusiveWrite(async () => {
        if (saving || !user || unavailable) return;
        const body = form.elements.body.value;
        if (!validateCommentBody(body)) {
            say(message, '댓글은 공백이 아닌 내용을 포함해 1~2,000자로 입력해 주세요.', 'error');
            form.elements.body.focus();
            return;
        }
        const authorId = user.id;
        saving = true;
        render();
        say(message, '댓글을 등록하는 중입니다…');
        try {
            await api.post(path, { body });
            if (user?.id === authorId) {
                form.reset();
                counter.textContent = '0 / 2,000';
                say(message, '댓글을 등록했습니다.', 'ok');
            }
            await load(true);
        } catch (error) {
            if (error.status === 401) {
                say(message, '로그인이 만료됐습니다. 내용을 복사한 뒤 다시 로그인해 주세요.', 'error');
                message.append(' ', h('a', { href: `login.html?next=${encodeURIComponent(returnPath)}`, text: '다시 로그인' }));
            } else if (error.data?.error?.code === 'profile_required' || error.code === 'profile_required') {
                say(message, '댓글을 쓰려면 닉네임을 먼저 설정해 주세요.', 'error');
                message.append(' ', h('a', { href: `profile.html?next=${encodeURIComponent(returnPath)}`, text: '내 정보로 이동' }));
            } else {
                say(message, '댓글 등록을 확인하지 못했습니다. 초안은 유지됩니다. 목록을 새로고침해 등록 여부를 확인해 주세요.', 'error');
            }
        } finally { saving = false; render(); }
    }));
    more.addEventListener('click', () => { if (!saving) void load(); });
    retry.addEventListener('click', () => { if (!saving) void load(true); });
    onAuthChange(auth, (next) => { user = next; render(); });
    render();
    void load(true);
}
