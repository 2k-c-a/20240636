import { createRequestGate } from './request-gate.js';

// 비활성 버튼 외의 제출 이벤트도 막는다. 쓰기 요청은 자동 재전송하지 않는다.
export function exclusiveWrite(handler) {
    let pending = false;
    return async (event) => {
        event.preventDefault();
        if (pending) return;
        pending = true;
        try {
            return await handler(event);
        } finally {
            pending = false;
        }
    };
}

// 계정 변경·로그아웃 뒤 이전 사용자의 프로필 응답/오류가 화면을 바꾸지 않게 한다.
export function createProfileRefresh({ api, onLoading, onLoaded, onError }) {
    const gate = createRequestGate();
    return async (user) => {
        const request = gate.begin();
        onLoading();
        if (!user) {
            onLoaded(null);
            return;
        }
        try {
            const { data } = await api.get('/api/me', { signal: request.signal });
            if (!request.isCurrent()) return;
            if (data.id !== user.id) throw new Error('로그인 정보가 바뀌었습니다. 다시 확인해 주세요.');
            onLoaded(data);
        } catch (error) {
            if (request.isCurrent() && error?.name !== 'AbortError') onError(error);
        }
    };
}
