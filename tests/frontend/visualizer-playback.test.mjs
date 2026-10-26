// 자동 재생·속도·슬라이더가 화면(visualizer.html + visualizer.js)에서 제대로 동작하는지 확인한다.
// 시간은 node:test의 가짜 시계(t.mock.timers)로 흘린다. 화면 쪽 기다리기는 setImmediate를 쓰므로 가짜 시계의 영향을 받지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { byClass } from './helpers/fake-dom.mjs';
import { bootPage, deferred, snapshot } from './helpers/fake-page.mjs';
import { makeRng } from './helpers/rng.mjs';

const LAST = 21; // bfs/diamond
const click = (page, id, times = 1) => { for (let i = 0; i < times; i += 1) page.el(id).click(); };
const choosePicker = (page, id, value) => { page.el(id).value = value; page.el(id).fire('change'); page.doc.settle(); };
const chooseLanguage = (page, value) => { page.el('lang-select').value = value; page.el('lang-select').fire('change'); page.doc.settle(); };
const setSpeed = (page, value) => { page.el('speed-select').value = String(value); page.el('speed-select').fire('change'); };
/** 슬라이더를 사용자가 움직인다(끌기·키보드 모두 input 이벤트가 온다). */
const drag = (page, value) => { page.el('viz-slider').value = String(value); page.el('viz-slider').fire('input'); };
async function settled(page) {
    for (let i = 0; i < 400; i += 1) {
        await new Promise((done) => setImmediate(done));
        if (page.el('viz-status').hidden === true || !page.el('viz-retry').hidden) return;
    }
}
const stepOf = (page) => Number(/단계 (\d+) \//.exec(page.el('viz-progress').textContent)[1]);
const withClock = async (t, options) => {
    const page = await bootPage(options);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    return page;
};
/**
 * 가짜 시계를 흘린다. node:test의 가짜 시계는 한 번의 tick 안에서 새로 걸린 timer를 tick이 끝난 시각 기준으로 걸기 때문에,
 * 긴 시간을 한 번에 흘리면 연속된 timer가 한 번밖에 실행되지 않는다. 실제 시계처럼 보이도록 50ms씩 나누어 흘린다.
 */
const tick = (t, ms) => {
    for (let left = ms; left > 0; left -= 50) t.mock.timers.tick(Math.min(50, left));
};

test('조작 요소: 재생 버튼·슬라이더·속도 선택 상자가 있고, 불러온 뒤에는 쓸 수 있다', async () => {
    const page = await bootPage();
    assert.equal(page.el('btn-play').textContent, '재생');
    assert.equal(page.el('btn-play').disabled, false);
    const slider = page.el('viz-slider');
    assert.deepEqual([slider.min, slider.max, slider.value, slider.disabled], ['0', String(LAST), '0', false]);
    assert.equal(slider.getAttribute('aria-valuetext'), '단계 0 / 21');
    assert.deepEqual(page.el('speed-select').children.map((o) => [o.value, o.textContent]), [['0.5', '0.5배'], ['1', '1배'], ['2', '2배']]);
    assert.equal(page.el('speed-select').value, '1');
    assert.equal(page.el('speed-select').disabled, false);
    assert.equal(page.el('viz-live').getAttribute('aria-live'), 'polite');
});

test('재생: 1배속에서 1초마다 한 단계씩 나아가고 코드·설명·그래프가 함께 바뀐다', async (t) => {
    const page = await withClock(t);
    click(page, 'btn-play');
    assert.equal(page.el('btn-play').textContent, '일시정지');
    assert.equal(snapshot(page).phase, '자동 재생 중 (1배속)');
    tick(t, 999);
    assert.equal(stepOf(page), 0);
    tick(t, 1);
    assert.equal(stepOf(page), 1);
    tick(t, 4000);
    assert.equal(stepOf(page), 5);

    // 같은 단계를 손으로 간 화면과 같다(코드·강조 줄·설명·그래프·연산)
    const manual = await bootPage();
    click(manual, 'btn-next', 5);
    const a = snapshot(page);
    const b = snapshot(manual);
    for (const key of ['lines', 'highlighted', 'message', 'operation', 'graph', 'progress', 'notes', 'title']) assert.deepEqual(a[key], b[key], key);
});

test('속도: 0.5배는 2초, 2배는 0.5초마다 나아가고, 재생 중에 바꾸면 새 간격으로 이어지며 단계는 되돌아가지 않는다', async (t) => {
    const page = await withClock(t);
    click(page, 'btn-play');
    setSpeed(page, 2);
    assert.equal(page.el('speed-select').value, '2');
    assert.equal(snapshot(page).phase, '자동 재생 중 (2배속)');
    tick(t, 500);
    assert.equal(stepOf(page), 1);
    tick(t, 1000);
    assert.equal(stepOf(page), 3);

    setSpeed(page, 0.5);
    tick(t, 1999);
    assert.equal(stepOf(page), 3);
    tick(t, 1);
    assert.equal(stepOf(page), 4);
    setSpeed(page, 1);
    tick(t, 1000);
    assert.equal(stepOf(page), 5, '1배로 돌아오면 1초마다');
    assert.equal(page.el('btn-play').textContent, '일시정지', '속도를 바꿔도 재생은 계속된다');
});

test('속도 선택 상자에 목록에 없는 값이 들어와도 재생·속도는 그대로이고 선택 상자가 되돌아온다', async (t) => {
    const page = await withClock(t);
    click(page, 'btn-play');
    for (const value of ['3', '0', 'abc', '', '__proto__']) {
        setSpeed(page, value);
        assert.equal(page.el('speed-select').value, '1', value);
    }
    tick(t, 1000);
    assert.equal(stepOf(page), 1);
});

test('일시정지: 버튼으로 멈추면 더는 나아가지 않고, 알림 영역이 다시 켜지며 멈춘 사실과 현재 단계를 한 번 알린다', async (t) => {
    const page = await withClock(t);
    click(page, 'btn-play');
    assert.equal(page.el('viz-live').getAttribute('aria-live'), 'off', '재생 중에는 단계마다 읽지 않는다');
    tick(t, 3000);
    click(page, 'btn-play');
    assert.equal(page.el('btn-play').textContent, '재생');
    assert.equal(page.el('viz-live').getAttribute('aria-live'), 'polite');
    assert.equal(page.el('viz-sr-progress').textContent, '일시정지했습니다. 단계 3 / 21. ');
    tick(t, 60000);
    assert.equal(stepOf(page), 3);
    assert.equal(snapshot(page).phase, '실행 중');
});

test('끝까지 재생하면 마지막 단계에서 저절로 멈추고 "다시 재생"이 되며, 누르면 처음부터 다시 재생한다', async (t) => {
    const page = await withClock(t);
    setSpeed(page, 2);
    click(page, 'btn-play');
    tick(t, 500 * LAST);
    assert.equal(stepOf(page), LAST);
    assert.equal(page.el('btn-play').textContent, '다시 재생');
    assert.equal(snapshot(page).phase, '실행 끝');
    assert.equal(page.el('viz-sr-progress').textContent, '재생이 끝났습니다. 단계 21 / 21. ');
    assert.equal(page.el('viz-live').getAttribute('aria-live'), 'polite');
    tick(t, 60000);
    assert.equal(stepOf(page), LAST, '끝난 뒤에는 움직이지 않는다');

    click(page, 'btn-play');
    assert.equal(stepOf(page), 0, '처음부터');
    assert.equal(page.el('btn-play').textContent, '일시정지');
    tick(t, 500 * 3);
    assert.equal(stepOf(page), 3);
});

test('슬라이더: 임의의 단계로 옮기면 재생이 멈추고 코드·설명·그래프가 그 단계를 가리키며 손으로 간 화면과 같다', async (t) => {
    for (const target of [0, 1, 9, 21]) {
        const page = await withClock(t);
        click(page, 'btn-play');
        tick(t, 2000);
        drag(page, target);
        assert.equal(stepOf(page), target);
        assert.equal(page.el('btn-play').textContent, target === LAST ? '다시 재생' : '재생', `${target}: 재생이 멈춘다`);
        tick(t, 10000);
        assert.equal(stepOf(page), target, `${target}: 시간이 흘러도 그대로`);
        assert.equal(page.el('viz-slider').value, String(target));
        assert.equal(page.el('viz-slider').getAttribute('aria-valuetext'), `단계 ${target} / 21`);

        const manual = await bootPage();
        click(manual, 'btn-next', target);
        const a = snapshot(page);
        const b = snapshot(manual);
        for (const key of ['lines', 'highlighted', 'message', 'operation', 'graph', 'progress', 'phase', 'notes', 'disabled']) assert.deepEqual(a[key], b[key], `${target}: ${key}`);
        t.mock.timers.reset();
    }
});

test('슬라이더를 키보드처럼 한 칸씩 계속 움직이거나 앞뒤로 오가도 단계·버튼 상태가 항상 맞다', async () => {
    const page = await bootPage();
    for (let value = 1; value <= LAST; value += 1) {
        drag(page, value);
        assert.equal(stepOf(page), value);
        assert.equal(page.el('btn-next').disabled, value === LAST);
        assert.equal(page.el('btn-prev').disabled, false);
    }
    for (let value = LAST - 1; value >= 0; value -= 1) drag(page, value);
    assert.equal(stepOf(page), 0);
    assert.equal(page.el('btn-prev').disabled, true);
    for (const bad of ['abc', '', '-3', '1.5', '999']) {
        drag(page, bad);
        const step = stepOf(page);
        assert.ok(step >= 0 && step <= LAST, `${bad}: 범위 안`);
        assert.equal(page.el('viz-slider').value, String(step), `${bad}: 슬라이더가 상태로 되돌아온다`);
    }
});

test('재생 중에 직접 조작(다음·이전·처음으로·슬라이더·언어)을 하면 재생이 멈추고 그 조작의 결과가 그대로 남는다', async (t) => {
    const cases = {
        다음: (page) => click(page, 'btn-next'),
        이전: (page) => click(page, 'btn-prev'),
        처음으로: (page) => click(page, 'btn-reset'),
        슬라이더: (page) => drag(page, 8),
        언어: (page) => chooseLanguage(page, 'javascript'),
    };
    for (const [name, act] of Object.entries(cases)) {
        const page = await withClock(t);
        click(page, 'btn-play');
        tick(t, 4000);
        assert.equal(stepOf(page), 4);
        act(page);
        const after = stepOf(page);
        assert.equal(page.el('btn-play').textContent, '재생', `${name}: 재생이 멈춘다`);
        tick(t, 30000);
        assert.equal(stepOf(page), after, `${name}: 멈춘 뒤에는 움직이지 않는다`);
        t.mock.timers.reset();
    }
});

test('언어를 바꾸면 재생이 멈추지만 단계와 속도는 유지된다', async (t) => {
    const page = await withClock(t);
    setSpeed(page, 2);
    click(page, 'btn-play');
    tick(t, 1500);
    assert.equal(stepOf(page), 3);
    chooseLanguage(page, 'c');
    assert.equal(stepOf(page), 3);
    assert.equal(page.el('speed-select').value, '2');
    assert.equal(snapshot(page).select, 'c');
    tick(t, 10000);
    assert.equal(stepOf(page), 3);
});

test('알고리즘·예제를 바꾸면 재생이 멈추고 새 예제는 step 0에서 멈춘 채 시작하며, 고른 속도는 이어받는다', async (t) => {
    for (const [id, value] of [['algo-select', 'dfs'], ['example-select', 'cycle']]) {
        const page = await withClock(t);
        setSpeed(page, 0.5);
        click(page, 'btn-play');
        tick(t, 4000);
        assert.equal(stepOf(page), 2);
        choosePicker(page, id, value);
        await settled(page);
        assert.equal(stepOf(page), 0, `${id}: step 0에서 시작`);
        assert.equal(page.el('btn-play').textContent, '재생', `${id}: 멈춘 채로 시작`);
        assert.equal(page.el('speed-select').value, '0.5', `${id}: 속도는 이어받는다`);
        tick(t, 60000);
        assert.equal(stepOf(page), 0, `${id}: 이전 예제의 timer가 새 화면을 움직이지 않는다`);
        click(page, 'btn-play');
        tick(t, 2000);
        assert.equal(stepOf(page), 1, `${id}: 이어받은 0.5배속(2초)으로 재생`);
        t.mock.timers.reset();
    }
});

test('불러오는 동안에는 이전 예제의 자동 재생이 멈추고, 늦게 도착한 응답은 멈춘 채 step 0으로 열린다(오래된 callback이 화면을 되돌리지 않는다)', async (t) => {
    const hold = deferred();
    const route = (url, init, disk) => (url.endsWith('dfs/basic.json') ? hold.promise.then(disk) : disk());
    const page = await withClock(t, { route });
    click(page, 'btn-play');
    tick(t, 3000);
    assert.equal(stepOf(page), 3);

    choosePicker(page, 'algo-select', 'dfs'); // DFS 응답이 오기 전까지 기다린다
    assert.equal(page.el('viz-body').hidden, true);
    for (const id of ['btn-play', 'viz-slider', 'speed-select', 'btn-next']) assert.equal(page.el(id).disabled, true, `${id}: 불러오는 동안 막힌다`);
    tick(t, 20000); // 이전 예제의 재생은 이 시간 동안 아무것도 하지 못한다
    assert.equal(page.el('viz-body').hidden, true);
    assert.equal(page.el('viz-progress').textContent, '단계 3 / 21', '숨은 이전 화면이 다시 그려지지 않는다');

    hold.resolve();
    await settled(page);
    assert.equal(stepOf(page), 0);
    assert.equal(page.el('btn-play').textContent, '재생');
    tick(t, 20000);
    assert.equal(stepOf(page), 0, '새 예제도 사용자가 재생하기 전에는 움직이지 않는다');
    assert.deepEqual(page.errors, []);
});

test('불러오는 동안 탭 숨김·페이지 떠남 이벤트가 와도 이전 예제의 상태가 다시 그려지지 않고 조작은 막힌 채로 있다', async (t) => {
    // 이전 예제의 상태를 비우지 않으면 이 이벤트(PAUSE)가 이전 상태를 바꾸고 다시 그리면서 막아 둔 재생 버튼·슬라이더를 풀어 버린다.
    const hold = deferred();
    const route = (url, init, disk) => (url.endsWith('dfs/basic.json') ? hold.promise.then(disk) : disk());
    const page = await withClock(t, { route });
    click(page, 'btn-play');
    tick(t, 3000);
    choosePicker(page, 'algo-select', 'dfs');
    const before = snapshot(page);

    page.doc.hidden = true;
    page.doc.fire('visibilitychange');
    page.doc.hidden = false;
    page.doc.fire('visibilitychange');
    page.win.fire('pagehide', { persisted: true });
    tick(t, 5000);

    assert.equal(page.el('viz-body').hidden, true);
    for (const id of ['btn-play', 'viz-slider', 'speed-select', 'btn-next', 'btn-prev', 'btn-reset']) assert.equal(page.el(id).disabled, true, `${id}: 불러오는 동안 계속 막힌다`);
    assert.deepEqual(snapshot(page), before, '불러오는 동안 이전 화면이 다시 그려지지 않는다');

    hold.resolve();
    await settled(page);
    assert.equal(stepOf(page), 0);
    assert.equal(page.el('btn-play').disabled, false);
    assert.equal(page.el('btn-play').textContent, '재생');
    assert.deepEqual(page.errors, []);
});

test('탭을 숨기면 일시정지하고, 다시 보여도 저절로 이어지지 않는다', async (t) => {
    const page = await withClock(t);
    click(page, 'btn-play');
    tick(t, 2000);
    page.doc.hidden = true;
    page.doc.fire('visibilitychange');
    assert.equal(page.el('btn-play').textContent, '재생');
    tick(t, 30000);
    assert.equal(stepOf(page), 2, '숨겨진 동안 움직이지 않는다');
    page.doc.hidden = false;
    page.doc.fire('visibilitychange');
    tick(t, 30000);
    assert.equal(stepOf(page), 2, '다시 보여도 이어서 재생하지 않는다');

    // 재생 중이 아닐 때 숨기고 보이는 것은 아무 일도 하지 않는다
    page.doc.hidden = true;
    page.doc.fire('visibilitychange');
    page.doc.hidden = false;
    page.doc.fire('visibilitychange');
    assert.equal(stepOf(page), 2);
    click(page, 'btn-play');
    tick(t, 1000);
    assert.equal(stepOf(page), 3, '다시 누르면 재생된다');
});

test('페이지를 떠나면(pagehide) timer가 풀린다. 뒤로 가기 캐시에서 돌아올 수 있는 경우(persisted)에는 재생기가 계속 쓸 수 있다', async (t) => {
    const leaving = await withClock(t);
    click(leaving, 'btn-play');
    tick(t, 1000);
    leaving.win.fire('pagehide', { persisted: false });
    tick(t, 30000);
    assert.equal(stepOf(leaving), 1, '떠난 뒤에는 움직이지 않는다');
    assert.equal(leaving.el('btn-play').textContent, '재생');
    t.mock.timers.reset();

    const cached = await withClock(t);
    click(cached, 'btn-play');
    tick(t, 1000);
    cached.win.fire('pagehide', { persisted: true });
    tick(t, 30000);
    assert.equal(stepOf(cached), 1);
    click(cached, 'btn-play'); // 캐시에서 돌아온 뒤 다시 재생할 수 있다
    tick(t, 2000);
    assert.equal(stepOf(cached), 3);
});

test('빠른 연속 클릭(재생/일시정지 번갈아 50번, 속도 변경 섞기)에도 timer는 하나뿐이다: 시간을 한 번 흘리면 정확히 한 단계만 나아간다', async (t) => {
    const rng = makeRng(5);
    for (let round = 0; round < 20; round += 1) {
        const page = await withClock(t);
        const clicks = 1 + Math.floor(rng() * 50);
        for (let i = 0; i < clicks; i += 1) {
            click(page, 'btn-play');
            if (rng() < 0.3) setSpeed(page, [0.5, 1, 2][Math.floor(rng() * 3)]);
        }
        const playing = page.el('btn-play').textContent === '일시정지';
        assert.equal(playing, clicks % 2 === 1, `${round}: 클릭 ${clicks}번 뒤의 상태`);
        const speed = Number(page.el('speed-select').value);
        const interval = 1000 / speed;
        tick(t, interval - 1);
        assert.equal(stepOf(page), 0, `${round}: 간격 전에는 움직이지 않는다`);
        tick(t, 1);
        assert.equal(stepOf(page), playing ? 1 : 0, `${round}: 재생 중이면 정확히 한 단계`);
        t.mock.timers.reset();
    }
});

test('무작위 조작 600번(재생·정지·속도·이동·슬라이더·언어·탭 숨김·시간 흘리기)에도 화면이 항상 상태와 맞고 오류가 없다', async (t) => {
    const rng = makeRng(2026);
    const page = await withClock(t);
    for (let i = 0; i < 600; i += 1) {
        const roll = rng();
        if (roll < 0.14) click(page, 'btn-play');
        else if (roll < 0.20) click(page, 'btn-next');
        else if (roll < 0.25) click(page, 'btn-prev');
        else if (roll < 0.28) click(page, 'btn-reset');
        else if (roll < 0.34) drag(page, Math.floor(rng() * (LAST + 1)));
        else if (roll < 0.40) setSpeed(page, [0.5, 1, 2][Math.floor(rng() * 3)]);
        else if (roll < 0.43) chooseLanguage(page, ['python', 'javascript', 'c'][Math.floor(rng() * 3)]);
        else if (roll < 0.46) { page.doc.hidden = true; page.doc.fire('visibilitychange'); page.doc.hidden = false; page.doc.fire('visibilitychange'); }
        else tick(t, Math.floor(rng() * 2500));

        const view = snapshot(page);
        const step = stepOf(page);
        assert.ok(step >= 0 && step <= LAST, `${i}: 단계 범위`);
        assert.equal(page.el('viz-slider').value, String(step), `${i}: 슬라이더 = 단계`);
        const playing = page.el('btn-play').textContent === '일시정지';
        assert.equal(view.phase.startsWith('자동 재생 중'), playing, `${i}: 표시한 단계 상태와 재생 버튼이 일치`);
        assert.ok(!playing || step < LAST, `${i}: 재생 중이면 마지막 단계가 아니다`);
        assert.equal(page.el('viz-live').getAttribute('aria-live'), playing ? 'off' : 'polite', `${i}: 알림 영역`);
        // 화면의 모든 부분이 같은 단계를 가리킨다
        const bundle = JSON.parse(readFileSync(new URL('../../frontend/js/data/bfs/diamond.json', import.meta.url), 'utf8'));
        const language = view.select;
        assert.deepEqual(view.highlighted, bundle.steps[step].lines[language], `${i}: 강조 줄`);
        assert.equal(view.message, bundle.steps[step].message, `${i}: 설명`);
        assert.equal(page.el('btn-next').disabled, step === LAST);
    }
    assert.deepEqual(page.errors, []);
});

test('키보드 포커스: 재생 버튼은 재생·일시정지·끝까지 가도 포커스를 잃지 않고, 끝에서 "다음"이 비활성이 되면 활성인 버튼으로 옮겨진다', async (t) => {
    for (const lazyBlur of [false, true]) {
        const page = await withClock(t, { lazyBlur });
        page.el('btn-play').focus();
        click(page, 'btn-play');
        page.doc.settle();
        assert.equal(page.doc.activeElement, page.el('btn-play'));
        tick(t, 3000);
        click(page, 'btn-play');
        page.doc.settle();
        assert.equal(page.doc.activeElement, page.el('btn-play'));
        setSpeed(page, 2);
        click(page, 'btn-play');
        tick(t, 500 * LAST);
        page.doc.settle();
        assert.equal(stepOf(page), LAST);
        assert.equal(page.doc.activeElement, page.el('btn-play'), `${lazyBlur}: 끝까지 가도 재생 버튼의 포커스가 남는다`);
        t.mock.timers.reset();

        // "다음"에 포커스가 있을 때 재생이 끝나 "다음"이 비활성이 되는 경우
        const other = await withClock(t, { lazyBlur });
        setSpeed(other, 2);
        click(other, 'btn-play');
        other.el('btn-next').focus();
        tick(t, 500 * LAST);
        other.doc.settle();
        assert.equal(other.el('btn-next').disabled, true);
        assert.notEqual(other.doc.activeElement, other.doc.body, `${lazyBlur}: 포커스를 잃지 않는다`);
        assert.equal(other.doc.activeElement, other.el('btn-prev'));
        t.mock.timers.reset();
    }
});

test('슬라이더·재생 버튼·속도 선택 상자에 포커스가 있을 때 다른 예제를 고르면 포커스가 보이는 선택 상자로 옮겨진다', async () => {
    for (const lazyBlur of [false, true]) {
        for (const id of ['viz-slider', 'btn-play', 'speed-select']) {
            const page = await bootPage({ lazyBlur });
            page.el(id).focus();
            assert.equal(page.doc.activeElement, page.el(id));
            choosePicker(page, 'algo-select', 'dfs');
            assert.notEqual(page.doc.activeElement, page.doc.body, `${id}: 막기 전에 옮겨야 한다`);
            assert.equal(page.doc.activeElement, page.el('example-select'), id);
            await settled(page);
            page.doc.settle();
            assert.equal(page.doc.activeElement, page.el('example-select'), `${id}: 열린 뒤에도`);
        }
    }
});

test('모든 알고리즘·예제를 자동 재생으로 끝까지 볼 수 있다(2배속, 단계마다 화면이 상태와 맞는다)', async (t) => {
    const catalog = JSON.parse(readFileSync(new URL('../../frontend/js/data/catalog.json', import.meta.url), 'utf8'));
    const page = await withClock(t);
    setSpeed(page, 2);
    let played = 0;
    for (const algorithm of catalog.algorithms) {
        choosePicker(page, 'algo-select', algorithm.id);
        await settled(page);
        for (const example of algorithm.examples) {
            if (page.el('example-select').value !== example.id) { choosePicker(page, 'example-select', example.id); await settled(page); }
            const bundle = JSON.parse(readFileSync(new URL(`../../frontend/js/data/${example.path}`, import.meta.url), 'utf8'));
            click(page, 'btn-play');
            for (let step = 1; step < bundle.steps.length; step += 1) {
                tick(t, 500);
                assert.equal(stepOf(page), step, `${example.path} 단계 ${step}`);
                assert.deepEqual(snapshot(page).highlighted, bundle.steps[step].lines.python);
            }
            assert.equal(page.el('btn-play').textContent, '다시 재생', example.path);
            assert.equal(snapshot(page).phase, '실행 끝');
            tick(t, 5000);
            assert.equal(stepOf(page), bundle.steps.length - 1);
            played += 1;
        }
    }
    assert.equal(played, 36);
    assert.deepEqual(page.errors, []);
});

test('HTML: 슬라이더와 속도 선택 상자에 연결된 <label>이 있고, 슬라이더는 정수 단계(step=1)이며 재생 버튼은 단계 버튼과 같은 조작줄 안에 있다', () => {
    const html = readFileSync(new URL('../../frontend/html/visualizer.html', import.meta.url), 'utf8');
    assert.match(html, /<label for="viz-slider"[^>]*>단계 이동<\/label>\s*<input type="range" id="viz-slider" min="0" max="0" step="1" value="0" disabled>/);
    assert.match(html, /<label for="speed-select"[^>]*>속도<\/label>\s*<select id="speed-select" disabled><\/select>/);
    const controls = html.slice(html.indexOf('class="viz-controls"'), html.indexOf('</main>'));
    for (const id of ['btn-reset', 'btn-prev', 'btn-play', 'btn-next', 'viz-slider', 'speed-select', 'viz-progress', 'viz-phase']) assert.ok(controls.includes(`id="${id}"`), `${id}는 조작줄 안에 있어야 한다`);
    // 재생 중 알림 영역을 끄고 켜려면 id가 필요하다
    assert.match(html, /<div class="viz-message" id="viz-live" aria-live="polite" aria-atomic="true">/);
    // 처음에는 모두 막혀 있다(불러온 뒤 켜진다)
    for (const id of ['btn-reset', 'btn-prev', 'btn-play', 'btn-next']) assert.match(html, new RegExp(`<button type="button" id="${id}"[^>]*disabled`), id);
});
