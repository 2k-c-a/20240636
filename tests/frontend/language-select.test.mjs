// 언어 선택 상자(language-select.js)와 코드 영역(renderCode)의 키보드 포커스·스크롤 유지.
// 실제 브라우저의 포커스 규칙을 흉내 낸 가짜 DOM으로 검사한다. 화면 전체(visualizer.js)의 동작은 브라우저에서 따로 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';

import { updateControls } from '../../frontend/js/controls.js';
import { updateLanguageSelect } from '../../frontend/js/language-select.js';
import { ACTIONS, createPlayerState, reducePlayer, selectView } from '../../frontend/js/player-state.js';
import { renderCode, scrollIntoViewWithin } from '../../frontend/js/renderers/code.js';
import { FakeDocument, FakeElement, makeRoot } from './helpers/fake-dom.mjs';
import { makeBfsBundle } from './helpers/bfs-bundle.mjs';
import { loadFixture } from './helpers/load-fixture.mjs';

const { bundle } = await loadFixture();
const LAST = bundle.steps.length - 1;
const MODES = [['포커스를 즉시 정리하는 브라우저', {}], ['포커스를 다음 렌더링 때 정리하는 브라우저', { lazyBlur: true }]];

/** visualizer.js의 render()와 같은 순서로 선택 상자, 코드 영역, 버튼을 갱신하는 화면. */
function makePage(stepIndex, languageId = 'python', options = {}, pageBundle = bundle) {
    const doc = new FakeDocument(options);
    const select = doc.createElement('select');
    const codeRoot = doc.createElement('div');
    const buttons = { next: doc.createElement('button'), prev: doc.createElement('button'), reset: doc.createElement('button') };
    let state = reducePlayer(createPlayerState(pageBundle, languageId), { type: ACTIONS.SEEK, index: stepIndex });

    const render = ({ languageChanged = false } = {}) => {
        const view = selectView(pageBundle, state);
        updateLanguageSelect(doc, select, state);
        renderCode(codeRoot, view.codeLines, view.activeLines, { label: `${view.languageId} 코드`, resetScroll: languageChanged });
        updateControls(doc, buttons, state);
    };
    render();

    return {
        doc, select, codeRoot, buttons,
        get state() { return state; },
        get pre() { return codeRoot.children[0]; },
        /** 사용자가 선택 상자에서 언어를 고른다(브라우저는 value를 먼저 바꾼 뒤 change 이벤트를 보낸다). */
        choose(value) {
            select.value = value;
            const next = reducePlayer(state, { type: ACTIONS.SWITCH_LANGUAGE, languageId: select.value });
            const languageChanged = next.languageId !== state.languageId;
            if (next !== state) { state = next; render({ languageChanged }); }
            updateLanguageSelect(doc, select, state); // 목록에 없는 값이면 되돌린다
            doc.settle();
        },
        press(name) {
            if (buttons[name].disabled) return;
            const next = reducePlayer(state, { type: { next: ACTIONS.NEXT, prev: ACTIONS.PREVIOUS, reset: ACTIONS.RESET }[name] });
            if (next !== state) { state = next; render(); }
            doc.settle();
        },
    };
}

test('updateLanguageSelect: 코드가 있는 언어를 bundle 순서대로 보여 주고 현재 언어를 선택한다', () => {
    const page = makePage(0, 'javascript');
    assert.deepEqual(page.select.children.map((option) => [option.value, option.textContent]), [['python', 'Python'], ['cpp', 'C++'], ['java', 'Java'], ['kotlin', 'Kotlin'], ['rust', 'Rust'], ['c', 'C'], ['javascript', 'JavaScript']]);
    assert.equal(page.select.value, 'javascript');
    assert.equal(page.select.disabled, false);
});

test('updateLanguageSelect: 고를 수 있는 언어가 하나뿐이면 선택 상자를 비활성으로 둔다', () => {
    const single = makeBfsBundle({ A: [] }, 'A');
    const page = makePage(0, 'python', {}, single);
    assert.equal(page.select.children.length, 1);
    assert.equal(page.select.disabled, true);
});

for (const [label, options] of MODES) {
    test(`[${label}] 언어를 바꿔도 선택 상자는 그대로이고 키보드 포커스가 남는다`, () => {
        for (const index of [0, 9, LAST]) {
            const page = makePage(index, 'python', options);
            const optionsBefore = [...page.select.children];
            page.select.focus();
            for (const language of ['javascript', 'c', 'python', 'c']) {
                page.choose(language);
                assert.equal(page.state.languageId, language);
                assert.equal(page.state.stepIndex, index, '단계가 유지된다');
                assert.equal(page.doc.activeElement, page.select, `step ${index} → ${language}: 포커스가 선택 상자에 남아야 한다`);
                assert.equal(page.select.value, language);
                // deepEqual은 모양만 비교하므로 같은 요소인지(===)를 따로 확인한다.
                assert.ok(page.select.children.length === optionsBefore.length && page.select.children.every((option, i) => option === optionsBefore[i]), 'option 요소를 다시 만들지 않는다(다시 만들면 포커스·열린 목록을 잃을 수 있다)');
            }
        }
    });

    test(`[${label}] 언어를 바꿀 때 조작 버튼의 포커스와 활성 상태를 건드리지 않는다`, () => {
        for (const index of [0, 5, LAST]) {
            const page = makePage(index, 'python', options);
            const flags = () => Object.fromEntries(Object.entries(page.buttons).map(([name, button]) => [name, button.disabled]));
            const before = flags();

            // 버튼에 포커스가 있을 때(마우스·터치로 언어를 바꾸는 경우를 포함) 포커스가 옮겨지지 않는다.
            const enabled = Object.values(page.buttons).find((button) => !button.disabled);
            enabled.focus();
            page.choose('c');
            assert.equal(page.doc.activeElement, enabled);
            assert.deepEqual(flags(), before, `step ${index}: 버튼의 비활성 상태는 단계가 같으므로 같다`);
        }
    });

    test(`[${label}] 언어를 바꾼 뒤에도 단계 이동은 정상이고, 마지막 단계의 포커스 이동 규칙이 그대로다`, () => {
        const page = makePage(LAST - 1, 'python', options);
        page.choose('javascript');
        page.buttons.next.focus();
        page.press('next');
        assert.equal(page.state.stepIndex, LAST);
        assert.equal(page.state.languageId, 'javascript');
        assert.equal(page.doc.activeElement, page.buttons.prev, '마지막 단계에서 "다음"이 비활성이 되면 포커스가 "이전"으로 옮겨진다');
        page.press('reset');
        assert.equal(page.state.languageId, 'javascript', '처음으로를 눌러도 언어는 유지된다');
        assert.equal(page.doc.activeElement, page.buttons.next);
    });

    test(`[${label}] 목록에 없는 값이 들어와도 상태는 그대로이고 선택 상자는 현재 언어로 되돌아온다`, () => {
        const page = makePage(7, 'c', options);
        page.select.focus();
        const before = page.state;
        for (const value of ['ruby', '__proto__', '', 'JavaScript']) {
            page.choose(value);
            assert.equal(page.state, before, String(value));
            assert.equal(page.select.value, 'c', `${value}: 선택 상자가 현재 언어로 돌아온다`);
            assert.equal(page.doc.activeElement, page.select);
        }
    });
}

// ---------- 코드 영역(pre)의 포커스와 스크롤 ----------

test('코드 영역: 단계와 언어가 바뀌어도 같은 pre를 쓰므로 포커스를 가진 코드 영역이 포커스를 잃지 않는다', () => {
    const page = makePage(3);
    const pre = page.pre;
    pre.focus();
    assert.equal(page.doc.activeElement, pre);
    page.press('next');
    page.press('next');
    assert.equal(page.pre, pre);
    assert.equal(page.doc.activeElement, pre, '단계를 옮긴 뒤에도 포커스가 코드 영역에 남는다');
    page.choose('c');
    assert.equal(page.pre, pre);
    assert.equal(page.doc.activeElement, pre, '언어를 바꾼 뒤에도 포커스가 코드 영역에 남는다');
    assert.equal(pre.getAttribute('aria-label'), 'c 코드');
    assert.equal(pre.getAttribute('tabindex'), '0');
});

test('코드 영역: 단계를 옮길 때는 스크롤 위치를 유지하고, 언어를 바꿀 때만 처음으로 되돌린다', () => {
    const page = makePage(3);
    page.pre.scrollLeft = 40;
    page.pre.scrollTop = 25;
    page.press('next');
    assert.deepEqual([page.pre.scrollLeft, page.pre.scrollTop], [40, 25], '단계 이동은 스크롤을 건드리지 않는다');
    page.press('prev');
    assert.deepEqual([page.pre.scrollLeft, page.pre.scrollTop], [40, 25]);
    page.choose('javascript');
    assert.deepEqual([page.pre.scrollLeft, page.pre.scrollTop], [0, 0], '다른 언어의 코드이므로 처음부터 보여 준다');
});

test('코드 영역: 처음 그릴 때와 다시 그릴 때의 결과 줄 수·강조가 같다(재사용해도 이전 내용이 남지 않는다)', () => {
    const page = makePage(0);
    page.choose('c'); // 17줄
    page.choose('python'); // 10줄
    assert.equal(page.pre.children[0].children.length, bundle.codes.python.lines.length, '이전 언어의 줄이 남지 않는다');
    page.press('next');
    const highlighted = page.pre.children[0].children.filter((line) => line.getAttribute('class').includes('hl'));
    assert.deepEqual(highlighted.map((line) => Number(line.getAttribute('data-line'))), bundle.steps[1].lines.python);
});

test('scrollIntoViewWithin: 강조한 줄이 보이지 않을 때만 코드 영역을 세로로 스크롤한다', () => {
    const area = (scrollTop) => ({ scrollTop, clientHeight: 100 });
    const line = (offsetTop) => ({ offsetTop, offsetHeight: 20 });

    const hiddenBelow = area(0);
    scrollIntoViewWithin(hiddenBelow, line(160));
    assert.equal(hiddenBelow.scrollTop, 80, '줄의 아래 끝이 보이는 영역의 아래 끝에 맞는다');

    const hiddenAbove = area(200);
    scrollIntoViewWithin(hiddenAbove, line(60));
    assert.equal(hiddenAbove.scrollTop, 60, '줄의 위 끝이 보이는 영역의 위 끝에 맞는다');

    const visible = area(50);
    scrollIntoViewWithin(visible, line(90));
    assert.equal(visible.scrollTop, 50, '이미 보이면 움직이지 않는다');

    // 여러 줄을 강조할 때(C의 check-neighbor는 3줄)는 범위 전체가 보여야 한다.
    const range = area(0);
    scrollIntoViewWithin(range, line(100), line(140));
    assert.equal(range.scrollTop, 60, '범위의 아래 끝(160)이 영역의 아래 끝에 맞는다');
    const rangeAbove = area(300);
    scrollIntoViewWithin(rangeAbove, line(100), line(140));
    assert.equal(rangeAbove.scrollTop, 100, '범위의 위 끝이 영역의 위 끝에 맞는다');
    const rangeVisible = area(90);
    scrollIntoViewWithin(rangeVisible, line(100), line(140));
    assert.equal(rangeVisible.scrollTop, 90, '범위 전체가 이미 보이면 움직이지 않는다');
    const tooTall = area(0);
    scrollIntoViewWithin(tooTall, line(200), line(380));
    assert.equal(tooTall.scrollTop, 200, '범위가 영역보다 크면 첫 줄이 맨 위에 온다');

    const none = area(30);
    scrollIntoViewWithin(none, null);
    assert.equal(none.scrollTop, 30, '강조한 줄이 없으면(step 0) 움직이지 않는다');

    // 화면 배치 정보가 없는 환경(숨김 상태, 가짜 DOM)에서는 아무것도 하지 않는다.
    for (const broken of [{ scrollTop: 5, clientHeight: 0 }, { scrollTop: 5, clientHeight: undefined }]) {
        scrollIntoViewWithin(broken, line(500));
        assert.equal(broken.scrollTop, 5);
    }
    const noLayout = area(5);
    scrollIntoViewWithin(noLayout, {});
    assert.equal(noLayout.scrollTop, 5);
});

test('renderCode: 강조한 줄이 여러 줄이면 첫 줄부터 마지막 줄까지 모두 보이도록 코드 영역을 스크롤한다', () => {
    // 가짜 DOM에는 레이아웃이 없으므로, 줄 하나를 20px로 보는 배치 정보를 잠깐 붙인다.
    const proto = FakeElement.prototype;
    Object.defineProperty(proto, 'offsetTop', { configurable: true, get() { return (Number(this.getAttribute('data-line')) - 1) * 20; } });
    Object.defineProperty(proto, 'offsetHeight', { configurable: true, get() { return 20; } });
    Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return this.localName === 'pre' ? 80 : 0; } });
    Object.defineProperty(proto, 'scrollTop', { configurable: true, get() { return this._scrollTop ?? 0; }, set(value) { this._scrollTop = value; } });
    try {
        const root = makeRoot();
        const lines = bundle.codes.c.lines;
        renderCode(root, lines, [9, 10, 11], { label: 'C 코드' });
        // 9~11번 줄은 위쪽 160px부터 220px까지다. 영역(80px)의 아래 끝이 220px에 맞는다 → 140px.
        assert.equal(root.children[0].scrollTop, 140, '마지막 강조 줄(11번)의 아래 끝이 보여야 한다');
        renderCode(root, lines, [3, 4], { label: 'C 코드' });
        assert.equal(root.children[0].scrollTop, 40, '위로 벗어났으면 첫 강조 줄(3번)의 위 끝에 맞춘다');
        renderCode(root, lines, [], { label: 'C 코드' });
        assert.equal(root.children[0].scrollTop, 40, '강조한 줄이 없으면(step 0) 움직이지 않는다');
    } finally {
        for (const name of ['offsetTop', 'offsetHeight', 'clientHeight', 'scrollTop']) delete proto[name];
    }
});
