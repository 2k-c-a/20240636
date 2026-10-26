// 요소를 숨기거나 비활성으로 만들기 전에 키보드 포커스를 안전한 곳으로 옮기는 도구. DOM 조작만 한다.
//
// 포커스를 가진 요소(또는 그 안의 요소)를 숨기면 브라우저는 포커스를 body로 떨어뜨린다. 키보드 사용자는 그 뒤로
// 어디에 있는지 알 수 없고 처음부터 Tab으로 다시 찾아가야 한다. 그래서 숨기기 전에 보이는 요소로 먼저 옮긴다.
// (비활성 요소에는 focus()가 실패하므로 옮길 곳은 활성인 요소여야 한다. 순서가 중요하다: 옮긴 뒤에 숨긴다.)

/** 후보 중 지금 쓸 수 있는(비활성도 숨김도 아닌) 첫 요소. 없으면 null. */
export function firstUsable(...candidates) {
    return candidates.find((element) => element !== null && element !== undefined && !element.disabled && !element.hidden) ?? null;
}

/**
 * regions 안(요소 자신 포함)에 포커스가 있으면 fallback으로 옮긴다.
 * @param {Document} doc
 * @param {Element[]} regions  곧 숨기거나 비활성으로 만들 요소들
 * @param {Element|null} fallback  옮겨 갈 곳(보이고 활성이어야 한다). null이면 아무것도 하지 않는다.
 * @returns {boolean} 포커스를 옮겼으면 true
 */
export function moveFocusOutOf(doc, regions, fallback) {
    const active = doc.activeElement;
    if (fallback === null || active === null || active === doc.body) return false;
    if (!regions.some((region) => region === active || region.contains(active))) return false;
    fallback.focus();
    return true;
}
