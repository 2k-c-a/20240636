import test from 'node:test';
import assert from 'node:assert/strict';
import { mountNavigation } from '../../frontend/js/site.js';

test('마우스 하위 메뉴, 터치 기본 동작, 포커스 유지, Escape와 바깥 클릭', () => {
    const docEvents = {};
    let focused = null;
    const makeGroup = () => {
        const handlers = {};
        const summary = { focus() { focused = summary; } };
        return { open: false, handlers, summary,
            contains(node) { return node === summary; },
            addEventListener(type, handler) { handlers[type] = handler; },
            querySelector() { return summary; },
        };
    };
    const a = makeGroup(), b = makeGroup();
    const doc = { activeElement: null, querySelectorAll: () => [a, b], addEventListener: (name, handler) => { docEvents[name] = handler; } };
    mountNavigation(doc);
    a.handlers.pointerenter({ pointerType: 'touch' });
    assert.equal(a.open, false); // Native summary tap remains in charge on touch.
    a.handlers.pointerenter({ pointerType: 'mouse' });
    assert.equal(a.open, true);
    b.handlers.pointerenter({ pointerType: 'mouse' });
    assert.equal(a.open, false);
    doc.activeElement = b.summary;
    b.handlers.pointerleave();
    assert.equal(b.open, true); // Keyboard focus must not disappear with the pointer.
    b.handlers.keydown({ key: 'Escape' });
    assert.equal(b.open, false);
    assert.equal(focused, b.summary);
    a.handlers.pointerenter({ pointerType: 'mouse' });
    docEvents.click({ target: { closest: () => null } });
    assert.equal(a.open, false);
});
