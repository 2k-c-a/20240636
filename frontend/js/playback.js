// 자동 재생의 timer를 관리한다. DOM을 모르고, 시간은 주입받은 scheduler로만 다룬다(그래서 테스트에서 가짜 시계로 검증한다).
//
// 이 모듈은 "timer 하나를 걸었다 풀었다 하는 일"만 한다. 재생 중인지·몇 배속인지·몇 단계인지는 재생 상태(player-state.js)가
// 갖고 있고, 이 모듈은 getState()로 읽기만 한다. 단계를 옮기는 일도 advance()(= TICK 전이)를 부를 뿐이다.
//
// 지키는 규칙
//   - timer는 항상 하나 이하다. 이미 재생 중일 때 play()를 다시 불러도 timer가 늘지 않는다.
//   - 재생을 시작·멈추거나 속도를 바꿀 때마다 세대(generation)를 올린다. clearTimeout으로 취소하지 못하고 이미 대기열에 들어간
//     callback이 나중에 실행되어도, 세대가 다르면 아무것도 하지 않는다(오래된 callback이 화면을 되돌리지 못한다).
//   - 마지막 단계에 닿거나 재생 상태가 false가 되면 스스로 멈춘다.
//   - destroy() 뒤에는 어떤 호출도 아무 일도 하지 않는다.
import { DEFAULT_SPEED, SPEEDS, intervalFor } from './player-state.js';

/** 실제 시계. 호출할 때 globalThis의 함수를 찾으므로 테스트가 시계를 가짜로 바꿔 끼울 수 있다. */
export const defaultScheduler = Object.freeze({
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: (handle) => globalThis.clearTimeout(handle),
});

/**
 * @param {{
 *   advance: () => void,
 *   getState: () => ({playing: boolean, speed?: number, stepIndex: number, lastStepIndex: number}|null),
 *   scheduler?: {setTimeout: (callback: () => void, delay: number) => any, clearTimeout: (handle: any) => void},
 * }} options
 *   advance: 한 단계 나아간다(보통 TICK 전이). getState: 지금 재생 상태(없으면 null). scheduler: 시계(생략하면 실제 시계)
 * @returns {{play: () => boolean, pause: () => void, setSpeed: (speed: number) => boolean, destroy: () => void, readonly active: boolean, readonly speed: number}}
 */
export function createPlayback({ advance, getState, scheduler = defaultScheduler }) {
    let timer = null; // 지금 걸려 있는 timer. 없으면 null
    let generation = 0;
    let destroyed = false;
    const initial = getState();
    let speed = initial !== null && SPEEDS.includes(initial.speed) ? initial.speed : DEFAULT_SPEED;

    /** 지금 상태에서 재생을 이어 갈 수 있는지: 재생 중이고 아직 마지막 단계가 아니다. */
    const canContinue = () => {
        const state = getState();
        return state !== null && state.playing === true && state.stepIndex < state.lastStepIndex;
    };

    function clear() {
        generation += 1; // 이미 대기열에 들어간 이전 callback을 무효로 만든다
        if (timer !== null) {
            scheduler.clearTimeout(timer);
            timer = null;
        }
    }

    function arm() {
        const mine = generation;
        timer = scheduler.setTimeout(() => {
            if (destroyed || mine !== generation) return; // 오래된 callback
            timer = null;
            if (!canContinue()) {
                generation += 1;
                return;
            }
            try {
                advance();
            } catch (error) {
                clear(); // advance 안에서 이미 새 timer를 걸었을 수도 있으므로 세대만 올리지 않고 timer까지 푼다
                throw error;
            }
            if (destroyed || mine !== generation) return; // advance 안에서 멈췄거나 바뀌었다
            if (canContinue()) arm();
            else generation += 1; // 마지막 단계에 닿았거나 재생이 멈췄다
        }, intervalFor(speed));
    }

    return {
        /** 재생 타이머를 건다. 이미 걸려 있거나, 재생 중이 아니거나 마지막 단계이면 아무것도 하지 않고 false를 돌려준다. */
        play() {
            if (destroyed || timer !== null || !canContinue()) return false;
            clear();
            arm();
            return true;
        },
        /** 타이머를 푼다. 걸려 있지 않아도 안전하다. */
        pause() {
            if (!destroyed) clear();
        },
        /** 속도를 바꾼다. 재생 중이면 새 간격으로 타이머를 다시 건다(항상 하나). 목록에 없는 속도는 무시하고 false를 돌려준다. */
        setSpeed(next) {
            if (destroyed || !SPEEDS.includes(next)) return false;
            const changed = next !== speed;
            speed = next;
            if (changed && timer !== null) {
                clear();
                if (canContinue()) arm();
            }
            return true;
        },
        /** 타이머를 풀고 이후의 모든 호출을 무시한다(페이지를 떠날 때). */
        destroy() {
            if (destroyed) return;
            clear();
            destroyed = true;
        },
        get active() {
            return timer !== null;
        },
        get speed() {
            return speed;
        },
    };
}

/**
 * 재생 상태에 맞게 timer를 맞춘다: 속도를 알려 주고, 재생 중이면 걸고 아니면 푼다. 상태가 바뀔 때마다(그리고 처음에) 부른다.
 * 상태가 없으면(예제를 불러오는 중) 푼다.
 * @param {ReturnType<typeof createPlayback>} playback
 * @param {{playing: boolean, speed: number}|null} state
 */
export function syncPlayback(playback, state) {
    if (state === null) {
        playback.pause();
        return;
    }
    playback.setSpeed(state.speed);
    if (state.playing) playback.play();
    else playback.pause();
}
