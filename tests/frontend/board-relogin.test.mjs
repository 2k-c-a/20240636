import test from 'node:test';
import assert from 'node:assert/strict';
import { setupRelogin } from '../../frontend/js/board-common.js';
import { FakeDocument } from './helpers/fake-dom.mjs';

test('인라인 재로그인은 중복을 막고 비밀번호를 비우며 원래 글 초안에 포커스를 돌려준다', async () => {
    const saved = globalThis.FormData;
    const doc = new FakeDocument();
    doc.strictFocus = true;
    const form = doc.createElement('form');
    const password = doc.createElement('input');
    password.value = 'private-password';
    const button = doc.createElement('button');
    const message = doc.createElement('p');
    const draft = doc.createElement('input');
    draft.value = '작성 중인 제목';
    doc.body.append(form, draft);
    form.append(password, button, message);
    form.querySelector = () => message;
    form.querySelectorAll = (selector) => selector === 'input[type="password"]' ? [password] : [password, button];
    form.reset = () => { password.value = ''; };
    button.focus();
    let resolve, requests = 0;
    globalThis.FormData = class {
        constructor() { this.values = { email: 'test@example.test', password: password.value }; }
        get(key) { return this.values[key]; }
    };
    try {
        setupRelogin(form, { signIn: async (data) => {
            requests++;
            assert.equal(data.password, 'private-password');
            await new Promise((done) => { resolve = done; });
        } }, () => draft.focus());
        const submit = form._listeners.get('submit')[0];
        const pending = submit({ preventDefault() {} });
        await submit({ preventDefault() {} });
        assert.equal(requests, 1);
        assert.equal(password.value, '');
        assert.equal(doc.activeElement, message);
        resolve();
        await pending;
        assert.equal(form.hidden, true);
        assert.equal(draft.value, '작성 중인 제목');
        assert.equal(doc.activeElement, draft);
        assert.equal(button.disabled, false);
    } finally {
        globalThis.FormData = saved;
    }
});
