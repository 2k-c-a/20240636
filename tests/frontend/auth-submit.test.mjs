import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthSubmitHandler } from '../../frontend/js/auth-submit.js';
import { FakeDocument } from './helpers/fake-dom.mjs';

function setup(handler, read) {
    const doc = new FakeDocument();
    doc.strictFocus = true;
    const form = doc.createElement('form');
    const password = doc.createElement('input');
    password.value = 'private-password';
    const button = doc.createElement('button');
    const locked = doc.createElement('input');
    locked.disabled = true;
    const message = doc.createElement('p');
    doc.body.append(form, message);
    form.append(password, button, locked);
    form.querySelectorAll = (selector) => selector === 'input[type="password"]' ? [password] : [password, button, locked];
    button.focus();
    let reads = 0;
    const submit = createAuthSubmitHandler({ form, message, handler,
        readData: () => {
            reads++;
            assert.equal(button.disabled, false, '읽기 전에 비활성화하면 안 된다');
            if (read) return read();
            return { password: password.value };
        },
        showMessage: (el, value) => { el.textContent = value instanceof Error ? value.message : value; el.hidden = !el.textContent; },
    });
    return { doc, form, password, button, locked, message, submit: () => submit({ preventDefault() {} }), reads: () => reads };
}

test('제출 중 재진입을 막고 비밀번호를 즉시 비우며 완료 뒤 다시 제출할 수 있다', async () => {
    let finish;
    let calls = 0;
    const ui = setup(async (data) => { calls++; assert.equal(data.password, 'private-password'); await new Promise((r) => { finish = r; }); });
    const pending = ui.submit();
    assert.equal(ui.password.value, '');
    assert.equal(ui.button.disabled, true);
    assert.equal(ui.doc.activeElement, ui.message);
    await ui.submit();
    assert.equal(calls, 1);
    assert.equal(ui.reads(), 1);
    finish();
    await pending;
    assert.equal(ui.doc.activeElement, ui.button);
    assert.equal(ui.button.disabled, false);
    assert.equal(ui.locked.disabled, true);
    assert.equal(ui.form.getAttribute('aria-busy'), 'false');
    ui.password.value = 'private-password';
    const second = ui.submit();
    finish();
    await second;
    assert.equal(calls, 2);
});

test('제출 실패는 안내하고 비밀번호·busy를 정리하며 다시 시도할 수 있다', async () => {
    const ui = setup(async () => { throw new Error('잠시 후 다시 시도해 주세요.'); });
    await ui.submit();
    assert.equal(ui.message.textContent, '잠시 후 다시 시도해 주세요.');
    assert.equal(ui.password.value, '');
    assert.equal(ui.button.disabled, false);
    assert.equal(ui.doc.activeElement, ui.button);
    await ui.submit();
    assert.equal(ui.reads(), 2);
});

test('대기 중 포커스를 다른 곳으로 옮기면 완료 시 가져오지 않는다', async () => {
    let finish;
    const ui = setup(() => new Promise((r) => { finish = r; }));
    const pending = ui.submit();
    const outside = ui.doc.createElement('button');
    ui.doc.body.append(outside);
    outside.focus();
    finish();
    await pending;
    assert.equal(ui.doc.activeElement, outside);
});

test('성공 패널로 이동한 포커스와 성공 안내를 보존한다', async () => {
    const ui = setup(async () => {
        ui.form.hidden = true;
        ui.message.textContent = '저장했습니다.';
        ui.success.focus();
    });
    ui.success = ui.doc.createElement('div');
    ui.success.setAttribute('tabindex', '-1');
    ui.doc.body.append(ui.success);
    await ui.submit();
    assert.equal(ui.doc.activeElement, ui.success);
    assert.equal(ui.message.textContent, '저장했습니다.');
});

test('FormData 생성 실패도 잠금을 해제하고 비밀번호를 정리한다', async () => {
    const ui = setup(() => assert.fail('호출되면 안 된다'), () => { throw new Error('입력을 확인해 주세요.'); });
    await ui.submit();
    assert.equal(ui.password.value, '');
    assert.equal(ui.form.getAttribute('aria-busy'), 'false');
    assert.equal(ui.button.disabled, false);
    assert.equal(ui.message.textContent, '입력을 확인해 주세요.');
});
