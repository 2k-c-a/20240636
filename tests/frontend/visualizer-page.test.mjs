// 시각화 페이지 전체(visualizer.html의 요소 + visualizer.js)를 가짜 DOM으로 구동해, 버튼과 언어 선택 상자를 실제 이벤트로 조작한다.
// 가짜 DOM은 브라우저의 포커스 규칙을 흉내 내지만 레이아웃·스크린 리더는 없다. 실제 브라우저 확인은 docs/ACCEPTANCE.md에 따로 적는다.
import test from 'node:test';
import { algorithmInfo } from '../../frontend/js/algorithm-info.js';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import { byClass } from './helpers/fake-dom.mjs';
import { abortable, bootPage, deferred, snapshot } from './helpers/fake-page.mjs';
import { loadFixture } from './helpers/load-fixture.mjs';

const { bundle } = await loadFixture();
const LAST = bundle.steps.length - 1;
const LABEL = { python: 'Python', javascript: 'JavaScript', c: 'C' };

const click = (page, id, times = 1) => { for (let i = 0; i < times; i += 1) page.el(id).click(); };
/** 사용자가 선택 상자에서 값을 고른다(value를 바꾼 뒤 change 이벤트). */
const choose = (page, value) => { page.el('lang-select').value = value; page.el('lang-select').fire('change'); page.doc.settle(); };

test('처음 화면: Python 코드와 설명이 보이고 선택 상자에는 세 언어가 있다', async () => {
    const page = await bootPage();
    assert.deepEqual(page.errors, []);
    assert.equal(page.el('viz-status').hidden, true);
    assert.equal(page.el('viz-body').hidden, false);
    const view = snapshot(page);
    assert.match(view.title, /^너비 우선 탐색 \(BFS\) · Python · /);
    assert.equal(view.codeLabel, 'Python 코드');
    assert.deepEqual(view.lines, bundle.codes.python.lines);
    assert.equal(view.notes, bundle.codes.python.notes);
    assert.equal(view.progress, '단계 0 / 21');
    assert.deepEqual(page.el('lang-select').children.map((option) => [option.value, option.textContent]), [['python', 'Python'], ['cpp', 'C++'], ['java', 'Java'], ['kotlin', 'Kotlin'], ['rust', 'Rust'], ['c', 'C'], ['javascript', 'JavaScript']]);
    assert.equal(view.select, 'python');
    assert.equal(page.el('lang-select').disabled, false);
});

test('주소의 language 값이 시작 언어가 되고, 없는 언어는 안내와 함께 Python으로 열린다', async () => {
    for (const language of ['javascript', 'c']) {
        const page = await bootPage({ search: `?language=${language}` });
        const view = snapshot(page);
        assert.equal(view.select, language);
        assert.deepEqual(view.lines, bundle.codes[language].lines);
        assert.match(view.title, new RegExp(` · ${LABEL[language]} · `));
        assert.equal(page.el('viz-notices').children.length, 0);
    }
    const unknown = await bootPage({ search: '?language=ruby' });
    assert.equal(snapshot(unknown).select, 'python');
    assert.match(unknown.el('viz-notices').textContent, /언어 “ruby”은\(는\) 이 예제에서 사용할 수 없어 기본 언어 “Python”을\(를\) 보여 줍니다/);
});

for (const index of [0, 9, LAST]) {
    test(`step ${index}에서 언어를 바꾸면 단계·그래프·설명은 그대로이고 코드·강조 줄·설명·제목만 바뀐다`, async () => {
        const page = await bootPage();
        click(page, 'btn-next', index);
        const before = snapshot(page);
        assert.equal(before.progress, `단계 ${index} / 21`);
        assert.deepEqual(before.highlighted, bundle.steps[index].lines.python);

        for (const language of ['javascript', 'c', 'python']) {
            choose(page, language);
            const after = snapshot(page);
            assert.equal(after.progress, before.progress, `${language}: 단계 유지`);
            assert.equal(after.phase, before.phase);
            assert.equal(after.graph, before.graph, `${language}: 그래프·큐 화면은 같다`);
            assert.equal(after.message, before.message, `${language}: 단계 설명은 같다`);
            assert.equal(after.operation, before.operation);
            assert.deepEqual(after.disabled, before.disabled, `${language}: 버튼 상태 유지`);

            assert.deepEqual(after.lines, bundle.codes[language].lines, `${language}: 코드`);
            assert.deepEqual(after.highlighted, bundle.steps[index].lines[language], `${language}: 강조 줄`);
            assert.equal(after.notes, bundle.codes[language].notes, `${language}: 설명`);
            assert.equal(after.codeLabel, `${LABEL[language]} 코드`);
            assert.match(after.title, new RegExp(` · ${LABEL[language]} · `));
            assert.equal(after.select, language);
            assert.deepEqual(page.errors, []);
        }
    });
}

test('언어 전환 안내(스크린 리더용): 전환 직후에만 바뀐 언어를 알리고, 다음 이동부터는 단계만 알린다', async () => {
    const page = await bootPage();
    click(page, 'btn-next', 4);
    assert.equal(snapshot(page).srProgress, '단계 4 / 21. ');
    choose(page, 'c');
    assert.equal(snapshot(page).srProgress, 'C 코드로 바꿨습니다. 단계 4 / 21. ');
    click(page, 'btn-next');
    assert.equal(snapshot(page).srProgress, '단계 5 / 21. ');
    choose(page, 'c'); // 같은 언어를 다시 고르면 아무 일도 없다
    assert.equal(snapshot(page).srProgress, '단계 5 / 21. ');
});

test('언어를 바꾼 뒤에도 이전·다음·처음으로가 그 언어의 줄로 정확히 움직인다', async () => {
    const page = await bootPage();
    choose(page, 'javascript');
    click(page, 'btn-next', 3);
    assert.deepEqual(snapshot(page).highlighted, bundle.steps[3].lines.javascript);
    choose(page, 'c');
    click(page, 'btn-next');
    assert.deepEqual(snapshot(page).highlighted, bundle.steps[4].lines.c);
    click(page, 'btn-prev');
    assert.deepEqual(snapshot(page).highlighted, bundle.steps[3].lines.c);
    click(page, 'btn-reset');
    const reset = snapshot(page);
    assert.equal(reset.progress, '단계 0 / 21');
    assert.deepEqual(reset.highlighted, []);
    assert.equal(reset.select, 'c', '처음으로를 눌러도 언어는 유지된다');
    assert.equal(reset.operation, '실행 전', 'step 0에는 "방금 실행한 연산:" 접두어가 없다');
});

for (const lazyBlur of [false, true]) {
    test(`[${lazyBlur ? '포커스를 다음 렌더링 때 정리하는' : '포커스를 즉시 정리하는'} 브라우저] 언어를 바꿔도 키보드 포커스가 선택 상자에 남는다`, async () => {
        const page = await bootPage({ lazyBlur });
        const select = page.el('lang-select');
        const options = [...select.children];
        select.focus();
        for (const index of [0, 6, LAST]) {
            page.el('btn-reset').click();
            click(page, 'btn-next', index);
            select.focus();
            for (const language of ['javascript', 'c', 'python']) {
                choose(page, language);
                assert.equal(page.doc.activeElement, select, `step ${index} → ${language}`);
                assert.ok(select.children.length === options.length && select.children.every((option, i) => option === options[i]), 'option 요소를 다시 만들지 않는다(같은 요소여야 한다)');
            }
        }
    });

    test(`[${lazyBlur ? '포커스를 다음 렌더링 때 정리하는' : '포커스를 즉시 정리하는'} 브라우저] 언어를 바꾼 뒤 마지막 단계에서도 버튼 포커스 규칙이 유지된다`, async () => {
        const page = await bootPage({ lazyBlur });
        click(page, 'btn-next', LAST - 1);
        choose(page, 'javascript');
        page.el('btn-next').focus();
        click(page, 'btn-next');
        page.doc.settle();
        assert.equal(snapshot(page).progress, `단계 ${LAST} / 21`);
        assert.equal(page.doc.activeElement, page.el('btn-prev'), '다음이 비활성이 되면 이전으로 포커스가 옮겨진다');
        click(page, 'btn-reset');
        page.doc.settle();
        assert.equal(page.doc.activeElement, page.el('btn-next'));
        assert.equal(snapshot(page).select, 'javascript');
    });
}

test('코드 영역(pre)에 포커스가 있을 때 단계를 옮기거나 언어를 바꿔도 포커스를 잃지 않는다', async () => {
    const page = await bootPage();
    const pre = page.el('code-root').children[0];
    pre.focus();
    click(page, 'btn-next', 2);
    choose(page, 'c');
    assert.equal(page.el('code-root').children[0], pre);
    assert.equal(page.doc.activeElement, pre);
});

test('목록에 없는 언어 값이 선택 상자에 들어와도(개발자 도구로 값을 바꾼 경우) 화면은 그대로이고 선택 상자가 되돌아온다', async () => {
    const page = await bootPage({ search: '?language=javascript' });
    click(page, 'btn-next', 5);
    const before = snapshot(page);
    for (const value of ['ruby', '__proto__', '']) {
        choose(page, value);
        assert.deepEqual(snapshot(page), before, String(value));
    }
    assert.deepEqual(page.errors, []);
});

test('코드 영역 스크롤은 단계 이동에서는 유지하고 언어를 바꿀 때만 처음으로 되돌린다', async () => {
    const page = await bootPage();
    const pre = page.el('code-root').children[0];
    pre.scrollLeft = 30;
    pre.scrollTop = 12;
    click(page, 'btn-next', 2);
    assert.deepEqual([pre.scrollLeft, pre.scrollTop], [30, 12]);
    choose(page, 'javascript');
    assert.deepEqual([pre.scrollLeft, pre.scrollTop], [0, 0]);
});

test('HTML의 언어 선택 상자에는 연결된 <label>이 있다(접근 가능한 이름)', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync(new URL('../../frontend/html/visualizer.html', import.meta.url), 'utf8');
    assert.match(html, /<label for="lang-select">언어<\/label>\s*<select id="lang-select"><\/select>/);
});

// ============================================================================
// 알고리즘·예제 선택 (06단계)
// ============================================================================

const optionTexts = (select) => select.children.map((option) => [option.value, option.textContent]);
const choosePicker = (page, id, value) => { page.el(id).value = value; page.el(id).fire('change'); page.doc.settle(); };
/** 불러오기(비동기)가 끝나 화면에 반영될 때까지 기다린다. */
async function settled(page) {
    // setTimeout이 아니라 setImmediate로 기다린다(자동 재생 시험에서 setTimeout을 가짜 시계로 바꿔도 멈추지 않는다).
    for (let i = 0; i < 400; i += 1) {
        await new Promise((done) => setImmediate(done));
        if (page.el('viz-status').hidden === true || !page.el('viz-retry').hidden) return;
    }
}
const stepAll = (page) => { for (let i = 0; i < 60 && !page.el('btn-next').disabled; i += 1) page.el('btn-next').click(); };

test('선택 상자: 알고리즘 9개와 그 알고리즘의 예제를 보여 주고, 처음에는 BFS의 첫 예제이다', async () => {
    const page = await bootPage();
    assert.deepEqual(optionTexts(page.el('algo-select')), [
        ['bfs', '너비 우선 탐색 (BFS)'], ['dfs', '깊이 우선 탐색 (DFS, 재귀)'], ['binary-search', '이분 탐색'], ['bubble-sort', '버블 정렬'],
        ['union-find', '유니온 파인드'], ['dijkstra', '다익스트라 (배열 기반)'], ['knapsack', '0/1 배낭 DP'], ['topological-sort', '위상 정렬 (Kahn)'], ['two-pointers', '투 포인터 (연속 구간 합)'],
    ]);
    assert.equal(page.el('algo-select').value, 'bfs');
    assert.deepEqual(optionTexts(page.el('example-select')).map(([id]) => id), ['diamond', 'cycle', 'disconnected', 'grid-maze', 'grid-open', 'grid-unreachable']);
    assert.equal(page.el('example-select').value, 'diamond');
    assert.equal(page.el('algo-select').disabled, false);
    assert.equal(page.el('example-select').disabled, false);
    assert.match(snapshot(page).title, /^너비 우선 탐색 \(BFS\) · Python · 마름모 그래프/);
});

test('주소의 algorithm·example·language 값으로 시작 화면이 정해지고 선택 상자가 그 값을 보여 준다', async () => {
    const page = await bootPage({ search: '?algorithm=binary-search&example=not-found&language=c' });
    assert.deepEqual([page.el('algo-select').value, page.el('example-select').value, page.el('lang-select').value], ['binary-search', 'not-found', 'c']);
    assert.match(snapshot(page).title, /^이분 탐색 · C · 찾는 값이 없는 경우/);
    assert.equal(page.el('viz-state-heading').textContent, '배열과 상태');
});

test('알고리즘을 바꾸면 그 알고리즘의 첫 예제가 step 0에서 열리고, 언어·제목·범례 이름이 알고리즘에 맞게 바뀐다', async () => {
    const page = await bootPage({ search: '?language=javascript' });
    click(page, 'btn-next', 9);
    assert.equal(snapshot(page).progress, '단계 9 / 21');

    choosePicker(page, 'algo-select', 'dfs');
    await settled(page);
    let view = snapshot(page);
    assert.equal(view.progress, '단계 0 / 29', 'step 0에서 시작');
    assert.equal(page.el('example-select').value, 'basic');
    assert.deepEqual(optionTexts(page.el('example-select')).map(([id]) => id), ['basic', 'cycle', 'disconnected']);
    assert.equal(view.select, 'javascript', '언어는 유지된다');
    assert.match(view.title, /^깊이 우선 탐색 \(DFS, 재귀\) · JavaScript · 트리 모양 그래프/);
    assert.equal(page.el('viz-state-heading').textContent, '그래프와 호출 스택');
    assert.match(view.lines[0], /^function dfs\(/);
    assert.deepEqual(view.highlighted, []);
    assert.equal(page.el('btn-next').disabled, false);
    assert.equal(page.el('btn-prev').disabled, true);

    choosePicker(page, 'algo-select', 'bubble-sort');
    await settled(page);
    view = snapshot(page);
    assert.match(view.title, /^버블 정렬 · JavaScript · 기본/);
    assert.equal(page.el('viz-state-heading').textContent, '배열과 상태');
    assert.equal(page.el('viz-legend-title').textContent, '범례: 칸 모양과 표시 보는 법');
    assert.match(view.lines[0], /^function bubbleSort\(/);
    assert.equal(byClass(page.el('graph-root'), 'cell').length, 5);
    assert.deepEqual(page.errors, []);
});

test('같은 알고리즘에서 예제를 바꾸어도 step 0에서 시작하고, 예제에 맞는 코드(C의 #define N)와 상태로 바뀐다', async () => {
    const page = await bootPage({ search: '?algorithm=dfs&language=c' });
    assert.equal(snapshot(page).lines[0], '#define N 6');
    click(page, 'btn-next', 12);
    assert.equal(snapshot(page).progress, '단계 12 / 29');

    choosePicker(page, 'example-select', 'cycle');
    await settled(page);
    const view = snapshot(page);
    assert.equal(view.progress, '단계 0 / 20');
    assert.equal(view.lines[0], '#define N 4', 'C 코드의 노드 수가 예제에 맞는다');
    assert.equal(page.el('algo-select').value, 'dfs');
    assert.equal(view.select, 'c');
    assert.match(view.title, /순환이 있는 그래프/);
    assert.deepEqual(view.disabled, { 'btn-reset': true, 'btn-prev': true, 'btn-next': false });
});

test('모든 알고리즘·예제·언어를 선택 상자로 열어 처음부터 끝까지 다음 버튼으로 재생할 수 있다', async () => {
    const page = await bootPage();
    const catalog = JSON.parse(readFileSync(new URL('../../frontend/js/data/catalog.json', import.meta.url), 'utf8'));
    let opened = 0;
    for (const algorithm of catalog.algorithms) {
        choosePicker(page, 'algo-select', algorithm.id);
        await settled(page);
        for (const example of algorithm.examples) {
            if (page.el('example-select').value !== example.id) { choosePicker(page, 'example-select', example.id); await settled(page); }
            for (const language of example.languages) {
                choose(page, language);
                click(page, 'btn-reset');
                const bundle = JSON.parse(readFileSync(new URL(`../../frontend/js/data/${example.path}`, import.meta.url), 'utf8'));
                assert.equal(snapshot(page).progress, `단계 0 / ${bundle.steps.length - 1}`, `${example.path} ${language}`);
                assert.ok(page.el('algorithm-info').textContent.includes(algorithmInfo(bundle).time), `${example.path}: 구현에 맞는 복잡도`);
                stepAll(page);
                const view = snapshot(page);
                assert.equal(view.phase, '실행 끝', `${example.path} ${language}`);
                assert.deepEqual(view.highlighted, bundle.steps.at(-1).lines[language], `${example.path} ${language}: 마지막 단계의 강조 줄`);
                assert.ok(page.el('graph-root').children.length > 0);
                opened += 1;
            }
        }
    }
    assert.equal(opened, 36 * 7);
    assert.deepEqual(page.errors, []);
});

test('선택 상자에서 같은 값이나 목록에 없는 값이 오면 화면을 다시 불러오지 않고 선택 상자만 되돌린다', async () => {
    let requests = 0;
    const page = await bootPage({ route: async (url, init, disk) => { requests += 1; return disk(); } });
    const before = requests;
    click(page, 'btn-next', 4);
    for (const [id, value] of [['algo-select', 'bfs'], ['algo-select', 'quick-sort'], ['algo-select', '__proto__'], ['example-select', 'diamond'], ['example-select', 'nope'], ['example-select', '']]) {
        choosePicker(page, id, value);
        await settled(page);
        assert.equal(snapshot(page).progress, '단계 4 / 21', `${id}=${value}: 화면이 그대로다`);
        assert.equal(page.el('algo-select').value, 'bfs');
        assert.equal(page.el('example-select').value, 'diamond');
    }
    assert.equal(requests, before, '서버를 다시 부르지 않았다');
});

test('불러오는 동안에는 이전 화면을 숨기고 조작 버튼을 막는다(이전 예제를 조작하다가 바뀌는 일이 없다)', async () => {
    const hold = deferred();
    const page = await bootPage({ route: (url, init, disk) => (url.endsWith('dfs/basic.json') ? abortable(hold.promise.then(disk), init?.signal) : disk()) });
    choosePicker(page, 'algo-select', 'dfs');
    assert.equal(page.el('viz-body').hidden, true);
    assert.equal(page.el('viz-status').hidden, false);
    assert.equal(page.el('viz-status-text').textContent, '예제를 불러오는 중입니다…');
    assert.deepEqual(['btn-reset', 'btn-prev', 'btn-next'].map((id) => page.el(id).disabled), [true, true, true]);
    assert.equal(page.el('algo-select').value, 'dfs', '선택 상자는 사용자가 고른 값을 보여 준다');
    assert.equal(page.el('algo-select').disabled, false, '선택 상자는 계속 조작할 수 있다');
    hold.resolve();
    await settled(page);
    assert.equal(page.el('viz-body').hidden, false);
    assert.equal(snapshot(page).progress, '단계 0 / 29');
});

for (const [label, respectsAbort] of [['중단 신호를 따르는 fetch', true], ['중단 신호를 무시하고 늦게 도착하는 fetch(오래된 응답)', false]]) {
    test(`오래된 로딩 결과가 새 화면을 덮어쓰지 않는다: ${label}`, async () => {
        const slow = deferred();
        const route = (url, init, disk) => {
            if (!url.endsWith('dfs/basic.json')) return disk();
            const late = slow.promise.then(disk);
            return respectsAbort ? abortable(late, init?.signal) : late;
        };
        const page = await bootPage({ route });
        choosePicker(page, 'algo-select', 'dfs'); // 느린 요청을 시작하고
        choosePicker(page, 'algo-select', 'bubble-sort'); // 곧바로 다른 알고리즘을 고른다
        await settled(page);
        assert.match(snapshot(page).title, /^버블 정렬 /);
        assert.equal(page.el('viz-status').hidden, true);

        slow.resolve(); // 먼저 요청한 DFS 응답이 이제야 도착한다
        await new Promise((done) => setTimeout(done, 60));
        const view = snapshot(page);
        assert.match(view.title, /^버블 정렬 /, '늦게 도착한 DFS가 화면을 덮어쓰지 않는다');
        assert.equal(page.el('algo-select').value, 'bubble-sort');
        assert.equal(page.el('viz-state-heading').textContent, '배열과 상태');
        assert.equal(view.progress, '단계 0 / 19');
        assert.deepEqual(page.errors, []);
    });
}

test('예제 불러오기에 실패하면 한국어 이유와 "다시 시도"를 보이고, 선택 상자는 그대로 쓸 수 있으며, 다른 예제를 고르면 복구된다', async () => {
    let failing = true;
    const route = (url, init, disk) => (failing && url.endsWith('dfs/cycle.json') ? Promise.resolve(new Response('없음', { status: 404 })) : disk());
    const page = await bootPage({ search: '?algorithm=dfs', route });
    choosePicker(page, 'example-select', 'cycle');
    await settled(page);
    assert.equal(page.el('viz-body').hidden, true);
    assert.equal(page.el('viz-status').hidden, false);
    assert.match(page.el('viz-status-text').textContent, /불러오지 못했습니다|찾을 수 없습니다|404/);
    assert.equal(page.el('viz-retry').hidden, false);
    assert.equal(page.el('example-select').value, 'cycle', '사용자가 고른 값을 보여 준다');
    assert.equal(page.el('example-select').disabled, false);
    assert.deepEqual(['btn-reset', 'btn-prev', 'btn-next'].map((id) => page.el(id).disabled), [true, true, true]);

    // 다시 시도: 서버가 복구되면 같은 예제가 열린다
    failing = false;
    page.el('viz-retry').click();
    await settled(page);
    assert.equal(page.el('viz-body').hidden, false);
    assert.match(snapshot(page).title, /순환이 있는 그래프/);
    assert.equal(page.el('viz-retry').hidden, true);

    // 실패한 상태에서 다른 예제를 고르면 오류가 사라진다
    failing = true;
    choosePicker(page, 'example-select', 'disconnected');
    await settled(page);
    assert.equal(page.el('viz-body').hidden, false);
    choosePicker(page, 'example-select', 'cycle');
    await settled(page);
    assert.equal(page.el('viz-retry').hidden, false);
    choosePicker(page, 'example-select', 'basic');
    await settled(page);
    assert.equal(page.el('viz-body').hidden, false);
    assert.equal(page.el('viz-retry').hidden, true);
    assert.equal(page.el('viz-error-details').hidden, true);
});

test('화면을 그리다 예외가 나면 오류를 보이고 상태·재생을 비우며 조작을 막는다(숨겨진 화면에 계속 그리지 않는다)', async () => {
    const page = await bootPage({ search: '?algorithm=dfs' });
    // 다음 예제를 열 때 render()가 중간에 던지게 한다(검증을 통과한 bundle이라도 renderer가 실패할 수 있다).
    Object.defineProperty(page.el('code-notes'), 'textContent', { configurable: true, set() { throw new Error('render failed'); }, get() { return ''; } });
    choosePicker(page, 'example-select', 'cycle');
    await settled(page);
    assert.equal(page.el('viz-body').hidden, true);
    assert.equal(page.el('viz-retry').hidden, false);
    assert.deepEqual(['btn-reset', 'btn-prev', 'btn-next', 'btn-play', 'viz-slider', 'speed-select'].map((id) => page.el(id).disabled), [true, true, true, true, true, true]);
    // 상태가 비워졌으므로 남은 조작이 숨겨진 화면을 다시 그리지 못한다.
    const before = page.el('viz-message').textContent;
    page.el('btn-next').click();
    page.el('viz-slider').value = '3';
    page.el('viz-slider').fire('input');
    page.doc.settle();
    assert.equal(page.el('viz-message').textContent, before);
    assert.equal(page.el('viz-body').hidden, true);
});

test('알고리즘을 바꿔도 언어 선택 상자의 option 요소와 포커스, 전환 규칙이 유지된다', async () => {
    const page = await bootPage();
    const options = [...page.el('lang-select').children];
    page.el('algo-select').focus();
    choosePicker(page, 'algo-select', 'binary-search');
    await settled(page);
    assert.equal(page.doc.activeElement, page.el('algo-select'), '선택 상자에 포커스가 남는다');
    const after = page.el('lang-select').children;
    assert.ok(after.length === options.length && after.every((option, i) => option === options[i]), '같은 언어 목록이면 option 요소를 다시 만들지 않는다');
    choose(page, 'c');
    assert.equal(snapshot(page).lines[0], 'int binary_search(const int values[], int n, int target) {');
    click(page, 'btn-next', 3);
    assert.equal(snapshot(page).progress, '단계 3 / 9');
});

test('새 요청을 시작하면 먼저 요청한 예제의 요청은 중단 신호를 받는다', async () => {
    const signals = [];
    const hold = deferred();
    const route = (url, init, disk) => {
        if (url.endsWith('dfs/basic.json')) { signals.push(init.signal); return abortable(hold.promise.then(disk), init.signal); }
        return disk();
    };
    const page = await bootPage({ route });
    choosePicker(page, 'algo-select', 'dfs');
    assert.equal(signals.length, 1);
    assert.equal(signals[0].aborted, false, '아직 최신 요청이다');
    choosePicker(page, 'algo-select', 'bubble-sort');
    assert.equal(signals[0].aborted, true, '다른 예제를 고르면 이전 요청이 중단된다');
    await settled(page);
    assert.match(snapshot(page).title, /^버블 정렬 /);
});

test('오래된 요청이 나중에 (중단이 아닌) 오류로 끝나도 새 화면에 오류를 띄우지 않는다', async () => {
    const slow = deferred();
    const route = (url, init, disk) => (url.endsWith('dfs/basic.json') ? slow.promise.then(() => { throw new TypeError('Failed to fetch'); }) : disk());
    const page = await bootPage({ route });
    choosePicker(page, 'algo-select', 'dfs'); // 느린 요청
    choosePicker(page, 'algo-select', 'binary-search'); // 곧바로 다른 알고리즘
    await settled(page);
    slow.resolve(); // 이전 요청이 이제야 네트워크 오류로 끝난다
    await new Promise((done) => setTimeout(done, 60));
    assert.equal(page.el('viz-retry').hidden, true, '오래된 요청의 오류가 화면에 나오지 않는다');
    assert.equal(page.el('viz-body').hidden, false);
    assert.match(snapshot(page).title, /^이분 탐색 /);
    assert.deepEqual(page.errors, [], '오래된 요청의 오류는 콘솔에도 남기지 않는다');
});

test('알고리즘을 바꾸면 범례도 그 알고리즘의 것으로 다시 그려진다', async () => {
    const page = await bootPage();
    const legend = () => page.el('legend-root').textContent;
    assert.match(legend(), /큐에서 차례를 기다리는 노드/);
    choosePicker(page, 'algo-select', 'dfs');
    await settled(page);
    assert.match(legend(), /호출 스택에서 돌아오기를 기다리는 노드/);
    assert.doesNotMatch(legend(), /큐에서 차례를 기다리는/);
    choosePicker(page, 'algo-select', 'binary-search');
    await settled(page);
    assert.match(legend(), /탐색 구간 안의 칸/);
    choosePicker(page, 'algo-select', 'bubble-sort');
    await settled(page);
    assert.match(legend(), /지금 비교하는 이웃한 두 칸/);
    assert.doesNotMatch(legend(), /탐색 구간/);
});

test('새 예제를 열면 코드 영역의 스크롤은 처음으로 돌아간다(다른 코드이므로)', async () => {
    const page = await bootPage();
    const pre = page.el('code-root').children[0];
    pre.scrollTop = 30;
    pre.scrollLeft = 12;
    choosePicker(page, 'example-select', 'cycle');
    await settled(page);
    assert.deepEqual([pre.scrollTop, pre.scrollLeft], [0, 0]);
});

// ============================================================================
// 오류 화면에서 키보드 포커스 (06단계 검토 지적: "다시 시도"로 복구하면 포커스가 사라진다)
// 포커스를 가진 버튼·요약·본문이 숨겨질 때 포커스가 body로 떨어지면 키보드 사용자는 처음부터 다시 Tab으로 찾아가야 한다.
// ============================================================================

const FOCUS_MODES = [['포커스를 즉시 정리하는 브라우저', false], ['포커스를 다음 렌더링 때 정리하는 브라우저', true]];

/** cycle 예제 요청의 응답을 테스트가 정한다: 'fail'은 404, 'ok'는 정상, 그 밖에는 응답을 보류할 Promise를 돌려준다. */
function cycleRoute(control) {
    return (url, init, disk) => {
        if (!url.endsWith('dfs/cycle.json')) return disk();
        if (control.mode === 'fail') return Promise.resolve(new Response('없음', { status: 404 }));
        if (control.mode === 'ok') return disk();
        return control.hold.promise.then(() => (control.after === 'fail' ? new Response('없음', { status: 404 }) : disk()));
    };
}

async function pageWithError({ lazyBlur }) {
    const control = { mode: 'fail', hold: null, after: 'ok' };
    const page = await bootPage({ search: '?algorithm=dfs', route: cycleRoute(control), lazyBlur });
    choosePicker(page, 'example-select', 'cycle');
    await settled(page);
    assert.equal(page.el('viz-retry').hidden, false, '오류 화면이 보인다');
    return { page, control };
}

for (const [label, lazyBlur] of FOCUS_MODES) {
    test(`[${label}] "다시 시도"를 눌러 복구해도 키보드 포커스가 사라지지 않는다`, async () => {
        const { page, control } = await pageWithError({ lazyBlur });
        page.el('viz-retry').focus();
        assert.equal(page.doc.activeElement, page.el('viz-retry'));

        control.mode = 'ok';
        page.el('viz-retry').click(); // 키보드 사용자가 Enter를 누른 것과 같다
        assert.notEqual(page.doc.activeElement, page.doc.body, '재시도 버튼을 숨기는 순간 포커스를 잃으면 안 된다');
        assert.equal(page.doc.activeElement, page.el('example-select'), '숨기기 전에 보이는 선택 상자로 옮겨 둔다');
        page.doc.settle();
        assert.equal(page.doc.activeElement, page.el('example-select'), '다음 렌더링 뒤에도 그대로다');
        await settled(page);
        page.doc.settle();
        assert.equal(page.el('viz-body').hidden, false, '예제는 열린다');
        assert.equal(page.doc.activeElement, page.el('example-select'), '복구된 뒤에도 포커스가 보이는 요소에 있다');
        assert.equal(page.doc.activeElement.isHiddenInTree, false);
    });

    test(`[${label}] "다시 시도"가 다시 실패하면 포커스가 재시도 버튼으로 돌아와 다시 누를 수 있다`, async () => {
        const { page, control } = await pageWithError({ lazyBlur });
        page.el('viz-retry').focus();
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            page.el('viz-retry').click();
            assert.notEqual(page.doc.activeElement, page.doc.body, `${attempt}번째 시도: 숨기는 순간`);
            await settled(page);
            page.doc.settle();
            assert.equal(page.el('viz-retry').hidden, false, `${attempt}번째 시도: 다시 실패했으므로 재시도 버튼이 보인다`);
            assert.equal(page.doc.activeElement, page.el('viz-retry'), `${attempt}번째 시도: 포커스가 재시도 버튼에 있다(Enter를 다시 누를 수 있다)`);
        }
        control.mode = 'ok';
        page.el('viz-retry').click();
        await settled(page);
        page.doc.settle();
        assert.equal(page.el('viz-body').hidden, false);
        assert.notEqual(page.doc.activeElement, page.doc.body);
    });

    for (const after of ['ok', 'fail']) {
        test(`[${label}] 불러오는 동안 사용자가 포커스를 다른 곳으로 옮기면 끝난 뒤(${after === 'ok' ? '성공' : '실패'})에도 그 자리에 둔다`, async () => {
            const { page, control } = await pageWithError({ lazyBlur });
            page.el('viz-retry').focus();
            control.mode = 'hold';
            control.hold = deferred();
            control.after = after;
            page.el('viz-retry').click();
            assert.equal(page.doc.activeElement, page.el('example-select'));

            page.el('algo-select').focus(); // 사용자가 기다리다가 다른 선택 상자로 이동한다
            control.hold.resolve();
            await settled(page);
            page.doc.settle();
            assert.equal(page.doc.activeElement, page.el('algo-select'), '사용자가 옮긴 포커스를 빼앗지 않는다');
            assert.equal(page.el('viz-retry').hidden, after === 'ok', after === 'ok' ? '성공하면 재시도 버튼이 없다' : '실패하면 재시도 버튼이 보인다');
        });
    }

    test(`[${label}] 오류 상세(요약)에 포커스가 있을 때 다른 예제를 고르면 포커스가 보이는 선택 상자로 옮겨진다`, async () => {
        const broken = JSON.parse(readFileSync(new URL('../../frontend/js/data/dfs/cycle.json', import.meta.url), 'utf8'));
        broken.steps[2].operation = 'teleport';
        const route = (url, init, disk) => (url.endsWith('dfs/cycle.json') ? Promise.resolve(new Response(JSON.stringify(broken), { status: 200 })) : disk());
        const page = await bootPage({ search: '?algorithm=dfs', route, lazyBlur });
        choosePicker(page, 'example-select', 'cycle');
        await settled(page);
        const details = page.el('viz-error-details');
        assert.equal(details.hidden, false, '검증 오류의 자세한 내용이 보인다');
        const summary = details.children[0];
        summary.focus();
        assert.equal(page.doc.activeElement, summary);

        choosePicker(page, 'example-select', 'basic'); // 요약에 포커스가 있는 채로 다른 예제를 고른다
        assert.notEqual(page.doc.activeElement, page.doc.body);
        assert.equal(page.doc.activeElement, page.el('example-select'));
        await settled(page);
        page.doc.settle();
        assert.equal(page.el('viz-body').hidden, false);
        assert.equal(page.doc.activeElement, page.el('example-select'));
    });

    test(`[${label}] 선택할 수 있는 예제가 하나뿐이어도(선택 상자가 비활성) 다시 시도 뒤 포커스가 사라지지 않는다`, async () => {
        const single = { schemaVersion: 1, algorithms: [{ id: 'bfs', title: '너비 우선 탐색 (BFS)', examples: [{ id: 'diamond', title: '마름모 그래프', path: 'bfs/diamond.json', languages: ['python', 'cpp', 'java', 'kotlin', 'rust', 'c', 'javascript'] }] }] };
        let failing = true;
        const route = (url, init, disk) => {
            if (url.endsWith('catalog.json')) return Promise.resolve(new Response(JSON.stringify(single), { status: 200 }));
            return failing ? Promise.resolve(new Response('없음', { status: 404 })) : disk();
        };
        const page = await bootPage({ route, lazyBlur });
        await settled(page);
        assert.equal(page.el('algo-select').disabled && page.el('example-select').disabled, true, '선택 상자가 모두 비활성이다');
        assert.equal(page.el('viz-retry').hidden, false);

        page.el('viz-retry').focus();
        failing = false;
        page.el('viz-retry').click();
        assert.notEqual(page.doc.activeElement, page.doc.body, '선택 상자를 쓸 수 없어도 포커스를 둘 곳이 있다');
        assert.equal(page.doc.activeElement, page.el('viz-status'), '불러오는 동안은 상태 영역(프로그램으로만 포커스를 받는다)이 포커스를 가진다');
        await settled(page);
        page.doc.settle();
        assert.equal(page.el('viz-body').hidden, false);
        assert.equal(page.doc.activeElement, page.el('btn-next'), '상태 영역이 사라지면 바로 쓸 수 있는 조작 버튼으로 옮긴다');
    });
}

for (const [label, lazyBlur] of FOCUS_MODES) {
    test(`[${label}] 본문(언어 선택 상자)이나 조작 버튼에 포커스가 있을 때 다른 예제를 고르면 포커스가 보이는 선택 상자로 옮겨진다`, async () => {
        for (const id of ['lang-select', 'btn-next', 'btn-reset']) {
            const page = await bootPage({ lazyBlur });
            click(page, 'btn-next', 3); // 처음으로 버튼도 활성이 된다
            page.el(id).focus();
            assert.equal(page.doc.activeElement, page.el(id));
            choosePicker(page, 'algo-select', 'dfs');
            assert.notEqual(page.doc.activeElement, page.doc.body, `${id}: 숨기거나 막기 전에 옮겨야 한다`);
            assert.equal(page.doc.activeElement, page.el('example-select'), id);
            await settled(page);
            page.doc.settle();
            assert.equal(page.doc.activeElement, page.el('example-select'), `${id}: 예제가 열린 뒤에도 그대로다`);
        }
    });

    test(`[${label}] 선택 상자로 고른 예제가 실패해도 포커스를 재시도 버튼으로 가져가지 않는다(재시도 버튼을 누른 경우만 돌려놓는다)`, async () => {
        const control = { mode: 'fail', hold: null, after: 'ok' };
        const page = await bootPage({ search: '?algorithm=dfs', route: cycleRoute(control), lazyBlur });
        page.el('example-select').focus(); // 키보드로 예제를 고르는 중이다
        choosePicker(page, 'example-select', 'cycle');
        await settled(page);
        page.doc.settle();
        assert.equal(page.el('viz-retry').hidden, false, '실패했으므로 재시도 버튼이 보인다');
        assert.equal(page.doc.activeElement, page.el('example-select'), '고르던 선택 상자에 포커스가 그대로 있다');
    });
}

test('가짜 DOM이 브라우저의 규칙을 따른다: 숨긴 요소(와 그 안의 요소)에는 focus()가 실패하고, 포커스를 가진 채 숨기면 포커스가 사라진다', async () => {
    const page = await bootPage();
    const retry = page.el('viz-retry');
    retry.hidden = false;
    retry.focus();
    assert.notEqual(page.doc.activeElement, retry, '상태 영역(조상)이 숨겨져 있으면 안의 버튼에도 포커스가 가지 않는다');
    page.el('viz-status').hidden = false;
    retry.focus();
    assert.equal(page.doc.activeElement, retry);
    retry.hidden = true;
    assert.equal(page.doc.activeElement, page.doc.body, '포커스를 가진 요소를 숨기면 포커스가 body로 간다');
    retry.focus();
    assert.equal(page.doc.activeElement, page.doc.body, '숨긴 요소에는 포커스가 가지 않는다');

    const body = page.el('viz-body');
    page.el('btn-next').focus(); // 조작 버튼은 viz-body 밖이다
    body.hidden = true;
    assert.equal(page.doc.activeElement, page.el('btn-next'), '본문 밖의 요소는 영향이 없다');
    page.el('lang-select').focus();
    assert.notEqual(page.doc.activeElement, page.el('lang-select'), '숨긴 본문 안의 요소에는 포커스가 가지 않는다');
});
