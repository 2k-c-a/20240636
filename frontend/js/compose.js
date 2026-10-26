import { ApiError } from './api.js';
import { classifyError, validateDraft } from './board-state.js';
import { bootBoard, fillAlgorithmSelect, h, onAuthChange, say, setBusy, setupRelogin, showFieldErrors } from './board-common.js';
import { createProfileRefresh, exclusiveWrite } from './board-requests.js';
const $ = (selector) => document.querySelector(selector);
async function main() {
    const writeGate = $('#board-write-gate');
    const form = $('#board-form');
    const formMessage = $('#board-form-message');
    const relogin = $('#relogin-form');
    fillAlgorithmSelect(form.elements.algorithm);
    const { auth, user: initialUser, api } = await bootBoard();
    let user = initialUser;
    let nickname = null;
    // ---------- 글쓰기 ----------
    function renderGate() {
        form.hidden = true;
        writeGate.replaceChildren();
        if (!user) {
            writeGate.append(
                '글을 쓰려면 ', h('a', { href: 'login.html?next=/web/html/write.html', text: '로그인' }),
                '이 필요합니다. 계정이 없다면 ', h('a', { href: 'signup.html', text: '회원가입' }), '을 해 주세요.',
            );
        } else if (nickname === null) {
            writeGate.append('글을 쓰려면 먼저 ', h('a', { href: 'profile.html?next=/web/html/write.html', text: '프로필(닉네임)' }), '을 만들어 주세요.');
        } else {
            writeGate.append(`${nickname} 님으로 글을 씁니다.`);
            form.hidden = false;
        }
    }

    const loadProfile = createProfileRefresh({
        api,
        onLoading: () => { nickname = null; renderGate(); },
        onLoaded: (profile) => { nickname = profile?.nickname ?? null; renderGate(); },
        onError: (error) => { form.hidden = true; writeGate.textContent = classifyError(error).message; },
    });
    const refreshProfile = () => loadProfile(user);

    form.addEventListener('submit', exclusiveWrite(async () => {
        const draft = { title: form.elements.title.value, body: form.elements.body.value, algorithmId: form.elements.algorithm.value };
        const checked = validateDraft(draft);
        showFieldErrors(form, checked.ok ? {} : checked.fields, { algorithm: 'algorithmId' });
        if (!checked.ok) {
            say(formMessage, '입력값을 확인해 주세요.', 'error');
            return;
        }
        setBusy(form, true);
        say(formMessage, '저장하는 중입니다…');
        try {
            const { data } = await api.post('/api/posts', checked.value);
            location.assign(`post.html?id=${encodeURIComponent(data.id)}`);
        } catch (error) {
            const info = classifyError(error instanceof ApiError ? error : { status: -1 }, { write: true });
            // 초안은 입력창에 그대로 남아 있다. 어떤 오류에서도 지우지 않는다.
            if (info.kind === 'validation') showFieldErrors(form, info.fields, { algorithm: 'algorithm_id' });
            if (info.kind === 'login') relogin.hidden = false;
            if (info.kind === 'profile') await refreshProfile();
            say(formMessage, info.message, 'error');
        } finally {
            setBusy(form, false);
        }
    }));

    if (auth) {
        setupRelogin(relogin, auth, async () => {
            await refreshProfile();
            say(formMessage, '다시 로그인했습니다. 내용을 확인하고 다시 올려 주세요.', 'ok');
            const target = form.hidden ? writeGate : formMessage;
            target.setAttribute('tabindex', '-1');
            target.focus();
        });
        onAuthChange(auth, (next) => {
            const changed = next?.id !== user?.id;
            user = next;
            if (changed) void refreshProfile();
        });
    }
    await refreshProfile();
}
main().catch(() => { $('#board-write-gate').textContent = '로그인 상태를 확인하지 못했습니다. 새로고침해 주세요.'; });
