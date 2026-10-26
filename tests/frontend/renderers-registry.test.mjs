// 알고리즘별 renderer 목록(renderers/index.js)과 "공통 재생기는 알고리즘을 모른다"는 구조를 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALGORITHM_IDS, OPERATION_LABELS } from '../../frontend/js/trace-contract.js';
import { ACTIONS, createPlayerState, reducePlayer, selectView } from '../../frontend/js/player-state.js';
import { RENDERERS, getRenderer } from '../../frontend/js/renderers/index.js';
import { renderCode } from '../../frontend/js/renderers/code.js';
import { EXAMPLES } from '../../scripts/trace-builders.mjs';
import { byClass, makeRoot } from './helpers/fake-dom.mjs';
import { loadFixture } from './helpers/load-fixture.mjs';

const FRONTEND = fileURLToPath(new URL('../../frontend/js/', import.meta.url));
const source = (relative) => readFileSync(join(FRONTEND, relative), 'utf8');

test('renderer 목록: 계약의 모든 알고리즘에 상태·범례 renderer와 한국어 제목이 있고, 바꿀 수 없다', () => {
    assert.deepEqual(Object.keys(RENDERERS).sort(), [...ALGORITHM_IDS].sort());
    assert.ok(Object.isFrozen(RENDERERS));
    for (const [id, renderer] of Object.entries(RENDERERS)) {
        assert.ok(Object.isFrozen(renderer), id);
        assert.equal(typeof renderer.render, 'function', id);
        assert.equal(typeof renderer.renderLegend, 'function', id);
        assert.match(renderer.heading, /[가-힣]/, id);
        assert.match(renderer.legendTitle, /^범례: /, id);
        assert.equal(getRenderer(id), renderer);
    }
});

test('getRenderer: 등록되지 않은 알고리즘(경로·프로토타입 이름 포함)은 예외로 거부한다', () => {
    for (const id of ['quick-sort', '', '__proto__', 'constructor', 'toString', 'hasOwnProperty', undefined, null, 7, '../bfs']) {
        assert.throws(() => getRenderer(id), /화면이 아직 없습니다/, String(id));
    }
});

test('모든 예제의 모든 단계를 renderer 목록으로 그릴 수 있다(범례 포함, 세 언어의 코드 영역도 함께)', async () => {
    let drawn = 0;
    for (const example of EXAMPLES) {
        const { bundle } = await loadFixture(example.algorithmId, example.id);
        const renderer = getRenderer(bundle.algorithmId);
        renderer.renderLegend(makeRoot());
        for (const language of ['python', 'javascript', 'c']) {
            let state = createPlayerState(bundle, language);
            for (;;) {
                const view = selectView(bundle, state);
                const stateRoot = makeRoot(); // 가짜 DOM은 innerHTML을 쓰면 예외를 던진다
                renderer.render(stateRoot, bundle.input, view.step.state, { operation: view.step.operation });
                assert.ok(stateRoot.childNodes.length > 0, `${example.algorithmId}/${example.id} step ${view.step.index}`);
                assert.ok(Object.hasOwn(OPERATION_LABELS[bundle.algorithmId], view.step.operation));
                const codeRoot = makeRoot();
                renderCode(codeRoot, view.codeLines, view.activeLines, { label: '코드' });
                assert.deepEqual(byClass(codeRoot, 'hl').map((line) => Number(line.getAttribute('data-line'))), view.activeLines);
                drawn += 1;
                const next = reducePlayer(state, { type: ACTIONS.NEXT });
                if (next === state) break;
                state = next;
            }
        }
    }
    assert.ok(drawn > 600, `${drawn}개 화면을 그렸다`);
});

test('공통 재생기·재생 상태·조작·선택 도구의 소스에는 알고리즘 ID가 없다(새 알고리즘은 콘텐츠와 renderer만 추가한다)', () => {
    const names = /\b(bfs|dfs|binary-search|bubble-sort|BFS|DFS)\b/;
    for (const file of ['visualizer.js', 'controls.js', 'focus-guard.js', 'playback.js', 'language-select.js', 'select-options.js', 'request-gate.js', 'renderers/code.js']) {
        const lines = source(file).split('\n').filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*'));
        const hits = lines.filter((line) => names.test(line));
        assert.deepEqual(hits, [], `${file}에 알고리즘 이름이 나옵니다`);
    }
    // player-state.js에서 알고리즘 ID가 나오는 곳은 "기본 알고리즘" 한 줄뿐이다.
    const hits = source('player-state.js').split('\n').filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*') && names.test(line));
    assert.equal(hits.length, 1, hits.join('\n'));
    assert.match(hits[0], /item\.id === 'bfs'/);
});
