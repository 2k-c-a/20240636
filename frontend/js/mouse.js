const box = document.getElementById('box');

// 마우스를 올릴 수 있는 기기에서만 동작한다. 터치 기기는 탭할 때 mouseover만 오고 mouseout이 오지 않아 바뀐 모습이 남기 때문이다.
const canHover = typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover)').matches;

if (box && box.dataset.hoverImage && canHover) {
    const originalText = box.textContent;
    const originalBackgroundImage = box.style.backgroundImage;

    box.addEventListener('mouseover', function () {
        box.textContent = '';
        box.style.backgroundImage = 'url("' + box.dataset.hoverImage + '")';
    });

    box.addEventListener('mouseout', function () {
        box.textContent = originalText;
        box.style.backgroundImage = originalBackgroundImage;
    });
}

// 버튼, 버튼 모양 링크, 메뉴 링크의 마우스 올림 효과는 style.css의 `@media (hover: hover)` 규칙이 처리한다.
// 인라인 스타일로 바꾸면 터치 기기와 비활성(disabled) 버튼에 효과가 남는다.
