// 테스트용 가짜 시계. 시간은 tick(ms)으로만 흐른다. 이 파일은 테스트가 아니므로 node --test가 직접 실행하지 않는다.
//
// 실제 시계와 같은 점: 취소한 timer는 다시 실행되지 않는다.
// 실제 시계보다 거친 점(일부러): fireStale(handle)로 "취소했는데도 이미 대기열에 들어가 있던 callback"이 나중에 실행되는 상황을 만든다.
export function createFakeScheduler() {
    let now = 0;
    let nextHandle = 1;
    const timers = new Map(); // handle -> {callback, at, delay}
    const log = []; // 걸린 timer의 지연 시간 기록
    const all = new Map(); // handle -> callback (취소한 것도 남긴다)

    return {
        setTimeout(callback, delay) {
            const handle = nextHandle++;
            timers.set(handle, { callback, at: now + delay, delay });
            all.set(handle, callback);
            log.push(delay);
            return handle;
        },
        clearTimeout(handle) {
            timers.delete(handle);
        },
        /** 걸려 있는(취소하지도 실행되지도 않은) timer 수. 규칙은 "항상 1 이하"이다. */
        get pending() {
            return timers.size;
        },
        get now() {
            return now;
        },
        /** 지금까지 걸린 timer의 지연 시간(밀리초) 목록 */
        get delays() {
            return [...log];
        },
        /** 걸려 있는 timer 하나의 핸들(없으면 undefined) */
        get handle() {
            return [...timers.keys()][0];
        },
        /** 시간을 ms만큼 흘린다. 그 사이에 기한이 된 timer를 시간 순서대로 실행한다(실행 중에 걸린 timer도 기한이 되면 실행한다). */
        tick(ms) {
            const end = now + ms;
            for (;;) {
                const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
                if (due === undefined) break;
                const [handle, timer] = due;
                timers.delete(handle);
                now = Math.max(now, timer.at);
                timer.callback();
            }
            now = end;
        },
        /** 취소한 timer의 callback을 억지로 실행한다(취소가 이미 늦은 경우를 흉내 낸다). */
        fireStale(handle) {
            const callback = all.get(handle);
            if (callback === undefined) throw new Error(`알 수 없는 timer ${handle}`);
            callback();
        },
    };
}
