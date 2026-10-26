// 마우스 올림 효과: 인라인 스타일이 아니라 CSS의 `@media (hover: hover)` 규칙이 맡는지, #box가 잘못된 요청을 만들지 않는지 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const FRONTEND = join(resolve(dirname(fileURLToPath(import.meta.url)), '../..'), 'frontend');
const mouseSource = readFileSync(join(FRONTEND, 'js/mouse.js'), 'utf8');
const stylesheet = readFileSync(join(FRONTEND, 'css/style.css'), 'utf8');

/** 가짜 #box와 window로 mouse.js를 실행하고, 등록된 이벤트 처리기와 box를 돌려준다. */
function runMouseScript({ hover, hoverImage }) {
    const handlers = {};
    const box = {
        textContent: '여기에 마우스를 올려 보세요!',
        style: { backgroundImage: '' },
        dataset: hoverImage === undefined ? {} : { hoverImage },
        addEventListener: (type, handler) => { handlers[type] = handler; },
    };
    const document = { getElementById: (id) => (id === 'box' ? box : null), querySelectorAll: () => [] };
    const window = { matchMedia: (query) => ({ matches: hover && query === '(hover: hover)' }) };
    vm.runInNewContext(mouseSource, { document, window });
    return { box, handlers };
}

test('버튼 올림 효과는 인라인 스타일이 아니라 hover: hover 조건의 CSS이며 비활성 버튼에는 적용하지 않는다', () => {
    assert.doesNotMatch(mouseSource, /querySelectorAll|button\.style/, 'mouse.js가 버튼에 인라인 스타일을 넣지 않는다');
    const media = /@media \(hover: hover\)\s*\{([\s\S]*?)\n\}/.exec(stylesheet);
    assert.ok(media, 'style.css에 @media (hover: hover) 규칙이 있어야 한다');
    assert.match(media[1], /button:not\(:disabled\):hover/);
    assert.match(media[1], /linear-gradient\(135deg, #24587e, #7048b5\)/);
});

test('#box: 마우스를 올릴 수 있는 기기에서 올리면 이미지로 바뀌고 벗어나면 돌아온다', () => {
    const { box, handlers } = runMouseScript({ hover: true, hoverImage: '../img/a.jpg' });
    handlers.mouseover();
    assert.equal(box.textContent, '');
    assert.equal(box.style.backgroundImage, 'url("../img/a.jpg")');
    handlers.mouseout();
    assert.equal(box.textContent, '여기에 마우스를 올려 보세요!');
    assert.equal(box.style.backgroundImage, '');
});

test('#box: data-hover-image가 없으면 url("undefined")을 요청하지 않도록 아무것도 등록하지 않는다', () => {
    const { handlers } = runMouseScript({ hover: true, hoverImage: undefined });
    assert.deepEqual(Object.keys(handlers), []);
});

test('#box: 마우스를 올릴 수 없는 터치 기기에서는 바뀐 모습이 남지 않도록 등록하지 않는다', () => {
    const { handlers } = runMouseScript({ hover: false, hoverImage: '../img/a.jpg' });
    assert.deepEqual(Object.keys(handlers), []);
});
