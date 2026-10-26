// <select>의 option을 맞춘다. 목록이 같으면 같은 option 요소를 그대로 쓴다. 요소를 다시 만들면 키보드로 값을 바꾸는 중에
// 포커스와 열린 목록을 잃을 수 있기 때문이다. DOM 조작만 하며 무엇을 고를 수 있는지는 호출하는 쪽이 정한다.

/**
 * @param {Document} doc
 * @param {HTMLSelectElement} select
 * @param {{value: string, label: string}[]} items  고를 수 있는 값(순서대로)
 * @param {string} current  지금 선택된 값(items에 있어야 한다)
 * @param {{disabled?: boolean}} [options]  disabled: 선택 상자를 비활성으로 둘지. 생략하면 고를 값이 둘 미만일 때 비활성이다.
 */
export function syncSelect(doc, select, items, current, { disabled = items.length < 2 } = {}) {
    const existing = Array.from(select.children, (option) => [option.value, option.textContent]);
    const same = existing.length === items.length && existing.every(([value, label], i) => value === items[i].value && label === items[i].label);
    if (!same) {
        select.replaceChildren(...items.map(({ value, label }) => {
            const option = doc.createElement('option');
            option.value = value;
            option.textContent = label;
            return option;
        }));
    }
    select.value = current;
    select.disabled = disabled;
}
