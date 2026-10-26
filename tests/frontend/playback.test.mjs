// 자동 재생 timer(playback.js): 가짜 시계로 간격, 단일 timer, 오래된 callback 무효화, 끝에서 자동 정지를 검증한다.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

import { ACTIONS, createPlayerState, reducePlayer } from '../../frontend/js/player-state.js';
import { createPlayback, defaultScheduler, syncPlayback } from '../../frontend/js/playback.js';
import { makeBfsBundle } from './helpers/bfs-bundle.mjs';
import { createFakeScheduler } from './helpers/fake-scheduler.mjs';
import { makeRng } from './helpers/rng.mjs';

const bundle = makeBfsBundle({ A: [] }, 'A', undefined, ['python', 'javascript', 'c']); // 6단계(0~5), 세 언어
const LAST = bundle.steps.length - 1;

/**
 * 실제 재생 상태 전이(reducePlayer)와 가짜 시계, 재생기를 묶은 테스트용 화면. 화면 쪽 연결(visualizer.js)과 같은 순서로 동작한다.
 * sync: true(기본)이면 advance가 화면처럼 단계를 옮긴 뒤 syncPlayback까지 부른다. 즉 timer callback 안에서 play()가 새 timer를 거는
 * 되돌아 들어오는(re-entrant) 경로다. false이면 단계만 옮긴다.
 */
function harness({ speed = 1, languageId = 'python', sync = true } = {}) {
    const scheduler = createFakeScheduler();
    let state = createPlayerState(bundle, languageId, { speed });
    const advances = [];
    const playback = createPlayback({
        advance: () => {
            advances.push(scheduler.now);
            state = reducePlayer(state, { type: ACTIONS.TICK });
            if (sync) syncPlayback(playback, state);
        },
        getState: () => state,
        scheduler,
    });
    const dispatch = (type, extra = {}) => {
        state = reducePlayer(state, { type, ...extra });
        syncPlayback(playback, state);
        return state;
    };
    return { scheduler, playback, advances, dispatch, get state() { return state; } };
}

test('1배속은 1초마다, 0.5배속은 2초마다, 2배속은 0.5초마다 한 단계씩 나아간다', () => {
    for (const [speed, interval] of [[1, 1000], [0.5, 2000], [2, 500]]) {
        const h = harness({ speed });
        h.dispatch(ACTIONS.PLAY);
        h.scheduler.tick(interval - 1);
        assert.equal(h.state.stepIndex, 0, `${speed}배속: ${interval}ms 전에는 움직이지 않는다`);
        h.scheduler.tick(1);
        assert.equal(h.state.stepIndex, 1, `${speed}배속: ${interval}ms에 한 단계`);
        h.scheduler.tick(interval);
        assert.equal(h.state.stepIndex, 2);
        assert.deepEqual(h.scheduler.delays.slice(0, 2), [interval, interval]);
    }
});

test('끝까지 가면 마지막 단계에서 저절로 멈추고 timer가 남지 않으며, 그 뒤에는 시간이 흘러도 움직이지 않는다', () => {
    const h = harness();
    h.dispatch(ACTIONS.PLAY);
    h.scheduler.tick(1000 * LAST);
    assert.deepEqual([h.state.stepIndex, h.state.playing], [LAST, false]);
    assert.equal(h.scheduler.pending, 0, '마지막 단계에서 timer가 남지 않는다');
    assert.equal(h.playback.active, false);
    assert.equal(h.advances.length, LAST);
    h.scheduler.tick(60000);
    assert.equal(h.state.stepIndex, LAST);
    assert.equal(h.advances.length, LAST);
});

test('재생 중에 PLAY를 다시 눌러도 timer는 하나뿐이고 속도가 빨라지지 않는다', () => {
    const h = harness();
    h.dispatch(ACTIONS.PLAY);
    for (let i = 0; i < 5; i += 1) {
        h.dispatch(ACTIONS.PLAY);
        assert.equal(h.playback.play(), false, '이미 걸려 있으면 false');
        assert.equal(h.scheduler.pending, 1);
    }
    h.scheduler.tick(3000);
    assert.equal(h.state.stepIndex, 3, '3초에 3단계(중복 timer가 없다)');
    assert.equal(h.scheduler.pending, 1);
});

test('일시정지하면 timer가 풀리고, 취소했는데도 늦게 실행된 이전 callback은 아무 일도 하지 않는다', () => {
    const h = harness();
    h.dispatch(ACTIONS.PLAY);
    h.scheduler.tick(1000);
    assert.equal(h.state.stepIndex, 1);
    const stale = h.scheduler.handle;
    h.dispatch(ACTIONS.PAUSE);
    assert.equal(h.scheduler.pending, 0);
    assert.equal(h.playback.active, false);
    h.scheduler.fireStale(stale); // 이미 대기열에 들어가 있던 callback이 이제야 실행된다
    assert.equal(h.state.stepIndex, 1, '움직이지 않는다');
    assert.equal(h.advances.length, 1);
    assert.equal(h.scheduler.pending, 0, '새 timer를 걸지도 않는다');
});

test('멈췄다가 다시 재생하면 새 간격으로 시작하고, 그 사이의 오래된 callback은 새 재생을 건드리지 않는다', () => {
    const h = harness();
    h.dispatch(ACTIONS.PLAY);
    h.scheduler.tick(600);
    const first = h.scheduler.handle;
    h.dispatch(ACTIONS.PAUSE);
    h.scheduler.tick(5000);
    h.dispatch(ACTIONS.PLAY);
    const second = h.scheduler.handle;
    assert.notEqual(first, second);
    h.scheduler.fireStale(first);
    assert.equal(h.state.stepIndex, 0, '오래된 callback이 새 재생에서 단계를 옮기지 못한다');
    assert.equal(h.scheduler.pending, 1, '새 timer는 그대로 하나다');
    h.scheduler.tick(999);
    assert.equal(h.state.stepIndex, 0, '남은 시간이 이어지지 않고 새로 1초를 센다');
    h.scheduler.tick(1);
    assert.equal(h.state.stepIndex, 1);
});

test('재생 중 속도를 바꾸면 timer 하나를 새 간격으로 다시 걸고, 이전 timer의 callback은 무효다', () => {
    const h = harness();
    h.dispatch(ACTIONS.PLAY);
    h.scheduler.tick(400);
    const old = h.scheduler.handle;
    h.dispatch(ACTIONS.SET_SPEED, { speed: 2 });
    assert.equal(h.scheduler.pending, 1);
    assert.equal(h.playback.speed, 2);
    assert.equal(h.scheduler.delays.at(-1), 500);
    h.scheduler.fireStale(old);
    assert.equal(h.state.stepIndex, 0, '이전 간격의 callback은 무시');
    h.scheduler.tick(500);
    assert.equal(h.state.stepIndex, 1);
    h.scheduler.tick(500);
    assert.equal(h.state.stepIndex, 2, '이후에는 0.5초마다');

    h.dispatch(ACTIONS.SET_SPEED, { speed: 0.5 });
    assert.equal(h.scheduler.pending, 1);
    h.scheduler.tick(1999);
    assert.equal(h.state.stepIndex, 2);
    h.scheduler.tick(1);
    assert.equal(h.state.stepIndex, 3);
});

test('멈춘 상태에서 속도를 바꾸면 timer를 만들지 않고, 같은 속도·목록에 없는 속도는 무시한다', () => {
    const h = harness();
    h.dispatch(ACTIONS.SET_SPEED, { speed: 2 });
    assert.equal(h.scheduler.pending, 0);
    assert.equal(h.playback.speed, 2);
    h.dispatch(ACTIONS.PLAY);
    assert.equal(h.scheduler.delays.at(-1), 500, '재생을 시작하면 바꿔 둔 속도로 간다');
    const before = h.scheduler.delays.length;
    assert.equal(h.playback.setSpeed(2), true);
    assert.equal(h.scheduler.delays.length, before, '같은 속도로는 timer를 다시 걸지 않는다');
    for (const speed of [3, 0, '1', NaN, null, undefined]) assert.equal(h.playback.setSpeed(speed), false, String(speed));
    assert.equal(h.playback.speed, 2);
    assert.equal(h.scheduler.pending, 1);

    // 상태는 재생 중이라고 하지만 play()를 부른 적이 없다면(timer가 없다) 속도를 바꾼다고 timer가 생기지 않는다. timer는 play()만 건다.
    const scheduler = createFakeScheduler();
    const playback = createPlayback({ advance: () => assert.fail('호출되면 안 된다'), getState: () => ({ playing: true, speed: 1, stepIndex: 0, lastStepIndex: 5 }), scheduler });
    assert.equal(playback.setSpeed(2), true);
    assert.equal(playback.speed, 2);
    assert.equal(scheduler.pending, 0);
    assert.equal(playback.active, false);
});

test('재생 중 직접 한 조작(다음·이전·처음으로·슬라이더 이동·언어 전환)은 timer를 풀고, 이전 callback은 단계를 되돌리지 못한다', () => {
    const manual = [
        [ACTIONS.NEXT, {}, 3], [ACTIONS.PREVIOUS, {}, 1], [ACTIONS.RESET, {}, 0], [ACTIONS.SEEK, { index: 4 }, 4], [ACTIONS.SWITCH_LANGUAGE, { languageId: 'c' }, 2],
    ];
    for (const [type, extra, expected] of manual) {
        const h = harness();
        h.dispatch(ACTIONS.PLAY);
        h.scheduler.tick(2000);
        assert.equal(h.state.stepIndex, 2);
        const stale = h.scheduler.handle;
        h.dispatch(type, extra);
        assert.equal(h.state.stepIndex, expected, type);
        assert.equal(h.state.playing, false, `${type}: 재생이 멈춘다`);
        assert.equal(h.scheduler.pending, 0, `${type}: timer가 풀린다`);
        h.scheduler.fireStale(stale);
        h.scheduler.tick(10000);
        assert.equal(h.state.stepIndex, expected, `${type}: 오래된 callback과 시간이 흘러도 화면이 움직이지 않는다`);
    }
});

test('잘못된 조작(잘못된 SEEK 값, 같은 언어)은 재생을 멈추지 않는다', () => {
    const h = harness();
    h.dispatch(ACTIONS.PLAY);
    h.dispatch(ACTIONS.SEEK, { index: NaN });
    h.dispatch(ACTIONS.SWITCH_LANGUAGE, { languageId: 'python' });
    h.dispatch(ACTIONS.SWITCH_LANGUAGE, { languageId: 'ruby' });
    assert.equal(h.state.playing, true);
    assert.equal(h.scheduler.pending, 1);
    h.scheduler.tick(1000);
    assert.equal(h.state.stepIndex, 1);
});

test('마지막 단계에서 PLAY를 누르면 처음부터 다시 재생하고, 끝까지 가면 다시 멈춘다', () => {
    const h = harness();
    h.dispatch(ACTIONS.PLAY);
    h.scheduler.tick(1000 * LAST);
    assert.equal(h.state.stepIndex, LAST);
    h.dispatch(ACTIONS.PLAY);
    assert.deepEqual([h.state.stepIndex, h.state.playing], [0, true]);
    assert.equal(h.scheduler.pending, 1);
    h.scheduler.tick(1000 * LAST);
    assert.deepEqual([h.state.stepIndex, h.state.playing, h.scheduler.pending], [LAST, false, 0]);
});

test('재생 상태가 밖에서 false가 되면(예: 탭 숨김) 다음 callback이 단계를 옮기지 않고 timer를 다시 걸지 않는다', () => {
    const scheduler = createFakeScheduler();
    let state = { playing: true, speed: 1, stepIndex: 0, lastStepIndex: 5 };
    let advanced = 0;
    const playback = createPlayback({ advance: () => { advanced += 1; state = { ...state, stepIndex: state.stepIndex + 1 }; }, getState: () => state, scheduler });
    assert.equal(playback.play(), true);
    state = { ...state, playing: false }; // timer는 그대로 두고 상태만 멈춘다(pause 호출 누락을 가정)
    scheduler.tick(1000);
    assert.equal(advanced, 0, '재생 중이 아니면 advance를 부르지 않는다');
    assert.equal(scheduler.pending, 0);
    assert.equal(playback.active, false);
});

test('advance가 예외를 던지면 timer를 다시 걸지 않고 예외를 그대로 전한다', () => {
    const scheduler = createFakeScheduler();
    const state = { playing: true, speed: 1, stepIndex: 0, lastStepIndex: 5 };
    const playback = createPlayback({ advance: () => { throw new Error('고장'); }, getState: () => state, scheduler });
    playback.play();
    assert.throws(() => scheduler.tick(1000), /고장/);
    assert.equal(scheduler.pending, 0);
    assert.equal(playback.active, false);
});

test('advance가 새 timer를 건 뒤에 예외를 던져도 그 timer까지 풀리고, 이후 다시 재생할 수 있다', () => {
    // 화면의 advance는 상태를 바꾸고 syncPlayback으로 timer를 거는데, 그 뒤(그리기 등)에서 예외가 날 수 있다.
    const scheduler = createFakeScheduler();
    let state = { playing: true, speed: 1, stepIndex: 0, lastStepIndex: 5 };
    let explode = true;
    const playback = createPlayback({
        advance: () => {
            state = { ...state, stepIndex: state.stepIndex + 1 };
            syncPlayback(playback, state); // callback 안에서 새 timer를 건다
            if (explode) throw new Error('그리기 실패');
        },
        getState: () => state,
        scheduler,
    });
    playback.play();
    const stale = scheduler.handle;
    assert.throws(() => scheduler.tick(1000), /그리기 실패/);
    assert.equal(scheduler.pending, 0, '예외가 난 뒤에는 걸려 있는 timer가 없다');
    assert.equal(playback.active, false);
    // 풀려 있어야 다시 재생할 수 있다(남은 timer가 막고 있지 않다)
    explode = false;
    assert.equal(playback.play(), true);
    assert.equal(scheduler.pending, 1);
    scheduler.fireStale(stale); // 예전 callback은 무효다
    assert.equal(state.stepIndex, 1);
    scheduler.tick(1000);
    assert.equal(state.stepIndex, 2);
});

test('화면처럼 callback 안에서 syncPlayback이 새 timer를 거는 구조에서도 timer는 항상 하나이고 간격이 정확하다', () => {
    for (const speed of [0.5, 1, 2]) {
        const h = harness({ speed, sync: true });
        h.dispatch(ACTIONS.PLAY);
        const interval = 1000 / speed;
        for (let step = 1; step <= LAST; step += 1) {
            assert.equal(h.scheduler.pending, 1, `${speed}배속: 단계 ${step - 1}에서 timer는 정확히 하나`);
            h.scheduler.tick(interval);
            assert.equal(h.state.stepIndex, step);
            assert.ok(h.scheduler.pending <= 1, `${speed}배속: 단계 ${step} 직후 timer가 ${h.scheduler.pending}개`);
        }
        assert.equal(h.scheduler.pending, 0, `${speed}배속: 끝에서 timer가 남지 않는다`);
        assert.equal(h.advances.length, LAST);
        assert.equal(h.scheduler.delays.length, LAST, `${speed}배속: 건 timer는 단계 수만큼이다(중복해서 걸지 않았다)`);
        assert.ok(h.scheduler.delays.every((delay) => delay === interval));
    }
});

test('getState가 null이면(예제를 불러오는 중) 재생하지 않고, syncPlayback은 timer를 푼다', () => {
    const scheduler = createFakeScheduler();
    const playback = createPlayback({ advance: () => assert.fail('호출되면 안 된다'), getState: () => null, scheduler });
    assert.equal(playback.play(), false);
    assert.equal(scheduler.pending, 0);
    const h = harness();
    h.dispatch(ACTIONS.PLAY);
    syncPlayback(h.playback, null);
    assert.equal(h.scheduler.pending, 0);
});

test('destroy 뒤에는 timer가 풀리고 어떤 호출도 아무 일도 하지 않으며, 오래된 callback도 무효다', () => {
    const h = harness();
    h.dispatch(ACTIONS.PLAY);
    const stale = h.scheduler.handle;
    h.playback.destroy();
    assert.equal(h.scheduler.pending, 0);
    h.scheduler.fireStale(stale);
    assert.equal(h.state.stepIndex, 0);
    assert.equal(h.playback.play(), false);
    assert.equal(h.playback.setSpeed(2), false);
    h.playback.pause();
    h.playback.destroy(); // 두 번 불러도 안전하다
    h.scheduler.tick(10000);
    assert.equal(h.state.stepIndex, 0);
    assert.equal(h.scheduler.pending, 0);
});

for (const sync of [true, false]) test(`무작위 조작 3000번(advance가 syncPlayback을 ${sync ? '부름' : '부르지 않음'}): timer는 항상 하나 이하이고, 재생 중이면(끝이 아닐 때) 정확히 하나이며, 멈춘 상태에서는 하나도 없다`, () => {
    const rng = makeRng(77);
    const h = harness({ sync });
    const staleHandles = [];
    for (let i = 0; i < 3000; i += 1) {
        const roll = rng();
        if (roll < 0.12) h.dispatch(ACTIONS.PLAY);
        else if (roll < 0.22) h.dispatch(ACTIONS.PAUSE);
        else if (roll < 0.30) h.dispatch(ACTIONS.NEXT);
        else if (roll < 0.36) h.dispatch(ACTIONS.PREVIOUS);
        else if (roll < 0.40) h.dispatch(ACTIONS.RESET);
        else if (roll < 0.46) h.dispatch(ACTIONS.SEEK, { index: Math.floor(rng() * (LAST + 2)) - 1 });
        else if (roll < 0.54) h.dispatch(ACTIONS.SET_SPEED, { speed: [0.5, 1, 2, 3][Math.floor(rng() * 4)] });
        else if (roll < 0.58) h.dispatch(ACTIONS.SWITCH_LANGUAGE, { languageId: ['python', 'javascript', 'c'][Math.floor(rng() * 3)] });
        else if (roll < 0.92) h.scheduler.tick(Math.floor(rng() * 1500));
        else if (staleHandles.length > 0) h.scheduler.fireStale(staleHandles[Math.floor(rng() * staleHandles.length)]); // 취소했거나 이미 실행된 callback이 늦게 실행된다
        if (h.scheduler.handle !== undefined) staleHandles.push(h.scheduler.handle);

        const where = `반복 ${i}`;
        assert.ok(h.scheduler.pending <= 1, `${where}: timer가 ${h.scheduler.pending}개`);
        assert.equal(h.scheduler.pending === 1, h.state.playing, `${where}: timer는 재생 중일 때만 있다`);
        assert.ok(h.state.stepIndex >= 0 && h.state.stepIndex <= LAST);
        assert.ok(!h.state.playing || h.state.stepIndex < LAST, `${where}: 재생 중이면 마지막 단계가 아니다`);
    }
});

test('기본 scheduler는 실제 timer(globalThis.setTimeout)를 호출 시점에 찾아 쓰므로 가짜 시계로 바꿔 끼울 수 있다', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let state = createPlayerState(bundle, 'python');
    const playback = createPlayback({ advance: () => { state = reducePlayer(state, { type: ACTIONS.TICK }); }, getState: () => state });
    state = reducePlayer(state, { type: ACTIONS.PLAY });
    syncPlayback(playback, state);
    t.mock.timers.tick(999);
    assert.equal(state.stepIndex, 0);
    t.mock.timers.tick(1);
    assert.equal(state.stepIndex, 1);
    playback.destroy();
    t.mock.timers.tick(5000);
    assert.equal(state.stepIndex, 1, 'destroy 뒤에는 움직이지 않는다');
    assert.equal(typeof defaultScheduler.setTimeout, 'function');
});
