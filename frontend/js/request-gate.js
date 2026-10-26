// "가장 나중에 시작한 요청만 화면에 반영한다"는 규칙을 지키는 작은 장치.
// 새 요청을 시작하면 이전 요청을 중단(abort)하고, 중단 신호를 무시하고 늦게 도착한 이전 응답도 isCurrent()로 걸러 낸다.
// 예제를 빠르게 바꿀 때 먼저 요청한 예제가 나중에 도착해 새 화면을 덮어쓰는 일을 막는다.

export function createRequestGate() {
    let latest = 0;
    let controller = null;
    return {
        /** 새 요청을 시작한다. 이전 요청은 중단되고 isCurrent()가 거짓이 된다. */
        begin() {
            if (controller !== null) controller.abort();
            controller = new AbortController();
            latest += 1;
            const id = latest;
            return { signal: controller.signal, isCurrent: () => id === latest };
        },
    };
}
