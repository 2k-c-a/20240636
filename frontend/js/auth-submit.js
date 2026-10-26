// 회원 양식 제출의 중복 실행·비밀번호 잔존·키보드 포커스를 관리한다.
export function createAuthSubmitHandler({ form, message, showMessage, handler, readData = () => new FormData(form) }) {
    let pending = false;
    return async (event) => {
        event.preventDefault();
        if (pending) return;
        pending = true;
        const controls = [...form.querySelectorAll('input, button')];
        const disabled = controls.map((control) => control.disabled);
        const active = form.ownerDocument.activeElement;
        const progress = '처리 중입니다. 잠시 기다려 주세요.';
        try {
            // 비활성화 전에 값을 읽고, 네트워크 요청을 기다리는 동안 입력란에는 비밀번호를 남기지 않는다.
            const data = readData();
            for (const input of form.querySelectorAll('input[type="password"]')) input.value = '';
            showMessage(message, progress, 'ok');
            if (form.contains(active)) {
                message.setAttribute('tabindex', '-1');
                message.focus();
            }
            for (const control of controls) control.disabled = true;
            form.setAttribute('aria-busy', 'true');
            await handler(data);
        } catch (error) {
            showMessage(message, error);
        } finally {
            for (const input of form.querySelectorAll('input[type="password"]')) input.value = '';
            controls.forEach((control, index) => { control.disabled = disabled[index]; });
            form.setAttribute('aria-busy', 'false');
            // 대기 중 사용자가 다른 곳으로 이동했다면 포커스를 가져오지 않는다.
            if (form.ownerDocument.activeElement === message && form.contains(active) && !form.hidden) active.focus();
            if (message.textContent === progress) showMessage(message, '');
            pending = false;
        }
    };
}
