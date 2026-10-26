// 조작 버튼의 비활성 상태와 키보드 포커스(controls.js).
// 검토에서 "마지막 단계에서 처음으로를 누르면 포커스가 사라진다"가 재현되었다. 실제 브라우저의 포커스 규칙을 흉내 낸
// 가짜 DOM(비활성 요소에는 focus()가 실패, 포커스를 가진 요소가 비활성이 되면 포커스 유실)으로 이를 자동 검사한다.
import test from 'node:test';
import assert from 'node:assert/strict';

import { controlFlags, describePlayButton, describeScrubber, updateControls, updatePlayButton, updateScrubber } from '../../frontend/js/controls.js';
import { ACTIONS, createPlayerState, reducePlayer } from '../../frontend/js/player-state.js';
import { FakeDocument } from './helpers/fake-dom.mjs';
import { loadFixture } from './helpers/load-fixture.mjs';

const { bundle } = await loadFixture();
const LAST = bundle.steps.length - 1;
const ACTION_OF = { next: ACTIONS.NEXT, prev: ACTIONS.PREVIOUS, reset: ACTIONS.RESET };

/** 사용자가 바로 쓸 수 있는 화면: 버튼 3개와 컨트롤 밖의 링크 하나. 처음 화면은 아직 어떤 요소에도 포커스가 없다. */
function makePage(stepIndex, options) {
    const doc = new FakeDocument(options);
    const buttons = { next: doc.createElement('button'), prev: doc.createElement('button'), reset: doc.createElement('button') };
    const link = doc.createElement('a');
    let state = reducePlayer(createPlayerState(bundle, 'python'), { type: ACTIONS.SEEK, index: stepIndex });
    updateControls(doc, buttons, state);

    return {
        doc, buttons, link,
        get state() { return state; },
        /** 키보드 사용자가 포커스를 가진 버튼을 누른다(Enter·Space). 비활성 버튼은 눌러도 아무 일도 없다. */
        press(name) {
            if (buttons[name].disabled) return;
            const next = reducePlayer(state, { type: ACTION_OF[name] });
            if (next !== state) {
                state = next;
                updateControls(doc, buttons, state);
            }
            doc.settle();
        },
        /** 포커스가 있는 요소의 이름: 'next' | 'prev' | 'reset' | 'link' | 'body' */
        get focus() {
            const found = Object.entries(buttons).find(([, button]) => button === doc.activeElement);
            return found ? found[0] : doc.activeElement === link ? 'link' : doc.activeElement === doc.body ? 'body' : '?';
        },
    };
}

const MODES = [['포커스를 즉시 정리하는 브라우저', {}], ['포커스를 다음 렌더링 때 정리하는 브라우저', { lazyBlur: true }]];

test('controlFlags: 처음에서는 이전·처음으로, 마지막에서는 다음이 비활성이다', () => {
    const at = (index) => controlFlags(reducePlayer(createPlayerState(bundle, 'python'), { type: ACTIONS.SEEK, index }));
    assert.deepEqual(at(0), { next: false, prev: true, reset: true });
    assert.deepEqual(at(10), { next: false, prev: false, reset: false });
    assert.deepEqual(at(LAST), { next: true, prev: false, reset: false });
});

test('updateControls: 버튼의 비활성 상태가 현재 단계와 같다', () => {
    for (const index of [0, 1, 10, LAST - 1, LAST]) {
        const page = makePage(index);
        const flags = { next: index === LAST, prev: index === 0, reset: index === 0 };
        assert.deepEqual({ next: page.buttons.next.disabled, prev: page.buttons.prev.disabled, reset: page.buttons.reset.disabled }, flags, `step ${index}`);
    }
});

for (const [label, options] of MODES) {
    test(`[${label}] 검토에서 재현된 사례: 마지막 단계에서 처음으로를 누르면 포커스가 "다음"으로 옮겨진다`, () => {
        const page = makePage(LAST, options);
        page.buttons.reset.focus();
        assert.equal(page.focus, 'reset');
        assert.equal(page.buttons.next.disabled, true, '이 시점에 "다음"은 아직 비활성이다(focus()가 실패하던 이유)');

        page.press('reset');
        assert.equal(page.state.stepIndex, 0);
        assert.equal(page.buttons.reset.disabled, true);
        assert.equal(page.buttons.next.disabled, false);
        assert.equal(page.focus, 'next', '포커스를 잃지 않고 다음 버튼으로 옮겨져야 한다');
    });

    test(`[${label}] 마지막 단계에 도착하면 포커스가 "이전"으로, 처음으로 돌아오면 "다음"으로 옮겨진다`, () => {
        const atEnd = makePage(LAST - 1, options);
        atEnd.buttons.next.focus();
        atEnd.press('next');
        assert.equal(atEnd.state.stepIndex, LAST);
        assert.equal(atEnd.focus, 'prev');

        for (const name of ['prev', 'reset']) {
            const atStart = makePage(1, options);
            atStart.buttons[name].focus();
            atStart.press(name);
            assert.equal(atStart.state.stepIndex, 0);
            assert.equal(atStart.focus, 'next', `${name}을 눌러 처음으로 돌아온 경우`);
        }
    });

    test(`[${label}] 포커스를 옮길 필요가 없으면 그대로 둔다(중간 단계, 컨트롤 밖의 요소, 아무 곳도 아닌 경우)`, () => {
        for (const name of ['next', 'prev']) {
            const page = makePage(10, options);
            page.buttons[name].focus();
            page.press(name);
            assert.equal(page.focus, name, `중간 단계에서 ${name}을 눌러도 포커스는 그 버튼에 남는다`);
        }
        // 처음으로는 눌러서 0단계가 되면 자기 자신이 비활성이 되므로 포커스가 "다음"으로 옮겨진다.
        const reset = makePage(10, options);
        reset.buttons.reset.focus();
        reset.press('reset');
        assert.equal(reset.state.stepIndex, 0);
        assert.equal(reset.focus, 'next');

        const outside = makePage(LAST, options);
        outside.link.focus();
        updateControls(outside.doc, outside.buttons, outside.state);
        assert.equal(outside.focus, 'link', '컨트롤 밖의 요소는 건드리지 않는다');

        const nowhere = makePage(LAST, options);
        updateControls(nowhere.doc, nowhere.buttons, nowhere.state);
        assert.equal(nowhere.focus, 'body', '아무 곳에도 포커스가 없으면 새로 가져가지 않는다');
    });

    test(`[${label}] 모든 단계에서 활성인 모든 버튼을 눌러 봐도 포커스는 항상 활성인 버튼에 있다`, () => {
        for (let index = 0; index <= LAST; index += 1) {
            for (const name of ['next', 'prev', 'reset']) {
                const page = makePage(index, options);
                if (page.buttons[name].disabled) continue;
                page.buttons[name].focus();
                const before = page.state.stepIndex;
                page.press(name);
                const where = `step ${index}에서 ${name}을 누른 뒤(${before} -> ${page.state.stepIndex})`;
                assert.notEqual(page.focus, 'body', `${where}: 포커스를 잃었습니다`);
                assert.ok(page.focus in page.buttons, `${where}: 포커스가 버튼에 없습니다 (${page.focus})`);
                assert.equal(page.buttons[page.focus].disabled, false, `${where}: 포커스가 비활성 버튼에 있습니다`);
            }
        }
    });

    test(`[${label}] 키보드 사용자의 무작위 조작 3000번: 포커스를 한 번도 잃지 않고 단계는 항상 범위 안이다`, () => {
        let seed = 12345;
        const rng = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        const page = makePage(0, options);
        page.buttons.next.focus(); // 키보드 사용자가 처음에 "다음"에 도착했다
        for (let i = 0; i < 3000; i += 1) {
            // 가끔 Tab으로 다른 활성 버튼으로 옮긴다
            if (rng() < 0.3) {
                const enabled = Object.entries(page.buttons).filter(([, button]) => !button.disabled);
                enabled[Math.floor(rng() * enabled.length)][1].focus();
            }
            assert.ok(page.focus in page.buttons && !page.buttons[page.focus].disabled, `${i}번째 조작 전에 포커스가 올바르지 않습니다 (${page.focus})`);
            page.press(page.focus);
            assert.ok(page.state.stepIndex >= 0 && page.state.stepIndex <= LAST);
            assert.ok(page.focus in page.buttons, `${i}번째 조작 뒤 포커스 위치: ${page.focus}`);
            assert.equal(page.buttons[page.focus].disabled, false, `${i}번째 조작 뒤 포커스가 비활성 버튼에 있습니다`);
        }
    });
}

test('가짜 DOM이 브라우저의 규칙을 따른다: 비활성 요소에는 focus()가 실패하고, 포커스를 가진 요소를 비활성으로 만들면 포커스가 사라진다', () => {
    const doc = new FakeDocument();
    const button = doc.createElement('button');
    button.disabled = true;
    button.focus();
    assert.equal(doc.activeElement, doc.body, '비활성 버튼에는 포커스가 가지 않는다');
    button.disabled = false;
    button.focus();
    assert.equal(doc.activeElement, button);
    button.disabled = true;
    assert.equal(doc.activeElement, doc.body, '즉시 정리하는 브라우저');

    const lazy = new FakeDocument({ lazyBlur: true });
    const other = lazy.createElement('button');
    other.focus();
    other.disabled = true;
    assert.equal(lazy.activeElement, other, '다음 렌더링 전에는 비활성 요소가 포커스를 가진 채로 남는다');
    lazy.settle();
    assert.equal(lazy.activeElement, lazy.body);
});

// ---------- 재생 버튼과 단계 슬라이더 ----------

const stateAt = (index, extra = {}) => ({ ...reducePlayer(createPlayerState(bundle, 'python'), { type: ACTIONS.SEEK, index }), ...extra });

test('describePlayButton: 재생 중이면 "일시정지", 마지막 단계에서 멈춰 있으면 "다시 재생", 그 밖에는 "재생"이다', () => {
    assert.equal(describePlayButton(stateAt(0)), '재생');
    assert.equal(describePlayButton(stateAt(10)), '재생');
    assert.equal(describePlayButton(stateAt(LAST - 1)), '재생');
    assert.equal(describePlayButton(stateAt(LAST)), '다시 재생');
    for (const index of [0, 10, LAST - 1]) assert.equal(describePlayButton(stateAt(index, { playing: true })), '일시정지', `step ${index}`);
});

test('updatePlayButton: 글자를 바꾸고 비활성이 아니게 한다(포커스를 가진 재생 버튼이 비활성이 되어 포커스를 잃는 일이 없다)', () => {
    const doc = new FakeDocument();
    const button = doc.createElement('button');
    button.disabled = true; // 불러오는 동안은 막혀 있다
    for (const [state, label] of [[stateAt(0), '재생'], [stateAt(5, { playing: true }), '일시정지'], [stateAt(LAST), '다시 재생']]) {
        updatePlayButton(button, state);
        assert.equal(button.textContent, label);
        assert.equal(button.disabled, false);
    }
    // 포커스를 가진 채로 재생·일시정지·끝까지 가도 포커스가 그대로다
    button.focus();
    for (const state of [stateAt(0, { playing: true }), stateAt(3), stateAt(LAST)]) {
        updatePlayButton(button, state);
        assert.equal(doc.activeElement, button);
    }
});

test('describeScrubber / updateScrubber: 0부터 마지막 단계까지, 값은 현재 단계이고 읽어 줄 문구에 단계와 재생 여부가 들어 있다', () => {
    assert.deepEqual(describeScrubber(stateAt(0)), { min: 0, max: LAST, value: 0, valueText: `단계 0 / ${LAST}` });
    assert.deepEqual(describeScrubber(stateAt(9, { playing: true })), { min: 0, max: LAST, value: 9, valueText: `단계 9 / ${LAST}, 자동 재생 중` });

    const doc = new FakeDocument();
    const slider = doc.createElement('input');
    slider.disabled = true;
    updateScrubber(slider, stateAt(7));
    assert.deepEqual([slider.min, slider.max, slider.value, slider.disabled], ['0', String(LAST), '7', false]);
    assert.equal(slider.getAttribute('aria-valuetext'), `단계 7 / ${LAST}`);
    updateScrubber(slider, stateAt(LAST));
    assert.equal(slider.value, String(LAST));
});

test('updateScrubber: 더 짧은 예제로 바뀌어도 범위를 먼저 바꾸고 값을 넣으므로 값이 새 범위 안에 있다', () => {
    const doc = new FakeDocument();
    const slider = doc.createElement('input');
    // 실제 브라우저의 range는 value를 max로 잘라 낸다. 그 규칙을 흉내 내서 순서(max → value)가 중요함을 확인한다.
    const rangeLike = (initialMax) => {
        let max = String(initialMax);
        let value = '0';
        const el = doc.createElement('input');
        Object.defineProperty(el, 'max', { get: () => max, set: (v) => { max = String(v); value = String(Math.min(Number(value), Number(max))); } });
        Object.defineProperty(el, 'value', { get: () => value, set: (v) => { value = String(Math.min(Number(v), Number(max))); } });
        return el;
    };
    // 더 긴 예제로 바뀌는 경우(이전 범위가 작다): 값을 먼저 넣으면 이전 max로 잘려 마지막 단계가 아닌 값이 남는다
    const growing = rangeLike(3);
    updateScrubber(growing, stateAt(LAST));
    assert.deepEqual([growing.max, growing.value], [String(LAST), String(LAST)], '짧은 범위에서 긴 범위로');
    // 더 짧은 예제로 바뀌는 경우(이전 범위가 크다)
    const shrinking = rangeLike(100);
    updateScrubber(shrinking, stateAt(LAST));
    assert.deepEqual([shrinking.max, shrinking.value], [String(LAST), String(LAST)], '긴 범위에서 짧은 범위로');
    // 중간 단계도 같다
    const middle = rangeLike(2);
    updateScrubber(middle, stateAt(9));
    assert.deepEqual([middle.max, middle.value], [String(LAST), '9']);
});
