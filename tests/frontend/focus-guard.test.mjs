// 포커스 도구(focus-guard.js): 숨기거나 막을 요소가 포커스를 가지고 있을 때만 보이는 요소로 옮긴다.
import test from 'node:test';
import assert from 'node:assert/strict';

import { firstUsable, moveFocusOutOf } from '../../frontend/js/focus-guard.js';
import { FakeDocument } from './helpers/fake-dom.mjs';

function page(options) {
    const doc = new FakeDocument(options);
    const make = (name, parent = null) => {
        const element = doc.createElement(name);
        element.parent = parent;
        return element;
    };
    const status = make('div');
    const retry = make('button', status);
    const details = make('details', status);
    const summary = make('summary', details);
    const home = make('select');
    const outside = make('a');
    return { doc, status, retry, details, summary, home, outside };
}

test('moveFocusOutOf: 숨길 요소 자신이 포커스를 가지고 있으면 보이는 요소로 옮긴다', () => {
    const { doc, retry, home } = page();
    retry.focus();
    assert.equal(moveFocusOutOf(doc, [retry], home), true);
    assert.equal(doc.activeElement, home);
    retry.hidden = true; // 이제 숨겨도 포커스를 잃지 않는다
    assert.equal(doc.activeElement, home);
});

test('moveFocusOutOf: 숨길 요소 안의 요소(후손)가 포커스를 가지고 있어도 옮긴다', () => {
    const { doc, status, summary, home } = page();
    summary.focus();
    assert.equal(moveFocusOutOf(doc, [status], home), true, '조상만 숨겨도 후손의 포커스는 사라진다');
    assert.equal(doc.activeElement, home);
});

test('moveFocusOutOf: 포커스가 다른 곳에 있거나 어디에도 없으면 건드리지 않는다', () => {
    const { doc, retry, outside, home } = page();
    assert.equal(moveFocusOutOf(doc, [retry], home), false, '아무 곳에도 포커스가 없다(body)');
    assert.equal(doc.activeElement, doc.body, '새로 포커스를 가져가지 않는다');
    outside.focus();
    assert.equal(moveFocusOutOf(doc, [retry], home), false);
    assert.equal(doc.activeElement, outside, '다른 곳의 포커스를 빼앗지 않는다');
});

test('moveFocusOutOf: 옮길 곳이 없으면(null) 아무것도 하지 않는다', () => {
    const { doc, retry } = page();
    retry.focus();
    assert.equal(moveFocusOutOf(doc, [retry], null), false);
    assert.equal(doc.activeElement, retry);
});

test('moveFocusOutOf: 여러 영역 중 하나라도 포커스를 가지고 있으면 옮긴다', () => {
    const { doc, retry, details, summary, home } = page();
    summary.focus();
    assert.equal(moveFocusOutOf(doc, [retry, details], home), true);
    assert.equal(doc.activeElement, home);
});

test('firstUsable: 비활성이거나 숨겨진 후보는 건너뛰고, 쓸 수 있는 것이 없으면 null이다', () => {
    const { home, outside, retry } = page();
    home.disabled = true;
    retry.hidden = true;
    assert.equal(firstUsable(home, retry, outside), outside);
    outside.disabled = true;
    assert.equal(firstUsable(home, retry, outside), null);
    assert.equal(firstUsable(null, undefined), null);
    assert.equal(firstUsable(), null);
    home.disabled = false;
    assert.equal(firstUsable(null, home), home, 'null은 건너뛴다');
});

test('옮길 곳이 비활성이면 focus()가 실패해 포커스를 잃는다 → firstUsable로 활성인 곳만 고른다(순서가 중요하다)', () => {
    const { doc, retry, home, outside } = page();
    home.disabled = true;
    retry.focus();
    moveFocusOutOf(doc, [retry], home); // 비활성 요소에는 focus()가 실패한다
    retry.hidden = true;
    assert.equal(doc.activeElement, doc.body, '잘못 고르면 포커스를 잃는다(이 도구를 쓰는 쪽이 firstUsable로 골라야 하는 이유)');

    retry.hidden = false;
    retry.focus();
    moveFocusOutOf(doc, [retry], firstUsable(home, outside));
    retry.hidden = true;
    assert.equal(doc.activeElement, outside);
});
