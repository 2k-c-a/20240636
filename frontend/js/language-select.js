// 언어 선택 상자(<select>)를 현재 상태에 맞게 맞춘다. DOM 조작만 하며, 어떤 언어를 고를 수 있는지는 player-state.js가 정한다.
//
// 선택 상자는 처음 한 번만 채우고 이후에는 같은 요소를 그대로 쓴다(select-options.js). 목록이 바뀐 경우(예제가 바뀌는 등)에만 option을 새로 만든다.

import { languageOptions } from './player-state.js';
import { syncSelect } from './select-options.js';

/**
 * @param {Document} doc
 * @param {HTMLSelectElement} select
 * @param {Readonly<import('./player-state.js').PlayerState>} state
 */
export function updateLanguageSelect(doc, select, state) {
    // 고를 수 있는 언어가 하나뿐이면 선택할 것이 없어 비활성이다(syncSelect의 기본 규칙).
    syncSelect(doc, select, languageOptions(state).map(({ id, label }) => ({ value: id, label })), state.languageId);
}
