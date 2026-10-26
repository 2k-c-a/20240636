// 조작 버튼(다음·이전·처음으로)의 비활성 상태와 키보드 포커스, 재생 버튼·단계 슬라이더의 표시를 관리한다.
//
// 처음/마지막 단계에서는 버튼이 비활성이 되는데, 포커스를 가진 버튼이 비활성이 되면 브라우저는 포커스를 body로 넘긴다.
// 그러면 키보드 사용자는 처음부터 Tab으로 다시 찾아와야 한다. 그래서 그런 경우 활성인 다른 버튼으로 포커스를 옮긴다.

import { canGoNext, canGoPrevious } from './player-state.js';

/** 버튼마다 비활성이어야 하는지. 처음으로·이전은 처음 단계에서, 다음은 마지막 단계에서 비활성이다. */
export function controlFlags(state) {
    return { next: !canGoNext(state), prev: !canGoPrevious(state), reset: !canGoPrevious(state) };
}

/**
 * 현재 상태에 맞게 버튼을 갱신하고, 포커스를 잃게 되는 경우 활성인 버튼으로 옮긴다.
 *
 * 순서가 중요하다. 포커스 이동은 **모든 버튼의 상태를 바꾼 뒤에** 해야 한다. 비활성인 버튼에는 focus()가
 * 조용히 실패하므로, 갱신 전에 옮기면 "곧 활성이 될 버튼"에 포커스가 가지 않는다(마지막 단계에서 처음으로를 누른 경우).
 * 어떤 버튼이 포커스를 가지고 있었는지는 갱신 전에 기억해 둔다. 갱신 중에 포커스가 이미 body로 넘어갈 수 있기 때문이다.
 *
 * @param {Document} doc
 * @param {{next: HTMLButtonElement, prev: HTMLButtonElement, reset: HTMLButtonElement}} buttons
 * @param {import('./player-state.js').PlayerState} state
 */
export function updateControls(doc, buttons, state) {
    // 포커스를 옮길 때 우선순위: 다음 > 이전 > 처음으로
    const order = [buttons.next, buttons.prev, buttons.reset];
    const focusedBefore = doc.activeElement;

    const flags = controlFlags(state);
    buttons.next.disabled = flags.next;
    buttons.prev.disabled = flags.prev;
    buttons.reset.disabled = flags.reset;

    if (order.includes(focusedBefore) && focusedBefore.disabled) {
        const target = order.find((button) => !button.disabled);
        if (target) target.focus();
    }
}

/**
 * 재생 버튼의 글자. 재생 중이면 "일시정지", 마지막 단계에서 멈춰 있으면 "다시 재생"(누르면 처음부터), 그 밖에는 "재생"이다.
 * 아이콘이나 색이 아니라 글자로 상태를 알린다. 버튼은 비활성이 되지 않는다(포커스를 잃지 않는다).
 */
export function describePlayButton(state) {
    if (state.playing) return '일시정지';
    return state.stepIndex >= state.lastStepIndex ? '다시 재생' : '재생';
}

export function updatePlayButton(button, state) {
    button.textContent = describePlayButton(state);
    button.disabled = false;
}

/**
 * 단계 슬라이더의 값. 슬라이더는 0부터 마지막 단계까지이며, 스크린 리더가 읽는 값(valueText)은 숫자만이 아니라
 * "단계 9 / 21"과 재생 여부를 함께 알려 준다.
 */
export function describeScrubber(state) {
    return {
        min: 0,
        max: state.lastStepIndex,
        value: state.stepIndex,
        valueText: `단계 ${state.stepIndex} / ${state.lastStepIndex}${state.playing ? ', 자동 재생 중' : ''}`,
    };
}

/** 슬라이더를 현재 상태에 맞춘다. 범위(max)를 먼저 바꾼 뒤 값을 넣는다(새 예제가 더 짧을 때 값이 잘리지 않게). */
export function updateScrubber(slider, state) {
    const { min, max, value, valueText } = describeScrubber(state);
    slider.min = String(min);
    slider.max = String(max);
    slider.value = String(value);
    slider.setAttribute('aria-valuetext', valueText);
    slider.disabled = false;
}
