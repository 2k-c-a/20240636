// 알고리즘별 화면 렌더러 목록. 재생기(visualizer.js)는 알고리즘을 직접 알지 않고 이 목록에서 algorithmId로 찾아 쓴다.
// 새 알고리즘은 renderer 함수 두 개(상태, 범례)와 문구를 여기에 등록하면 되며 재생기·재생 상태 코드는 바꾸지 않는다.
import { renderBinarySearch, renderBinarySearchLegend, renderBubbleSort, renderBubbleSortLegend } from './array.js';
import { renderDfsGraph, renderDfsLegend, renderGraph, renderLegend } from './graph.js';
import { renderGrid, renderGridLegend, renderLearning, renderLearningLegend } from './learning.js';
import { EXTENDED_IDS } from '../learning-programs.js';

/**
 * @typedef {Object} AlgorithmRenderer
 * @property {(root: Element, input: object, state: object, context: {operation: string}) => void} render  현재 상태를 그린다
 * @property {(root: Element) => void} renderLegend  범례를 그린다
 * @property {string} heading     상태 영역의 제목
 * @property {string} legendTitle 범례 접이식 제목
 */

/** @type {Readonly<Record<string, AlgorithmRenderer>>} */
export const RENDERERS = Object.freeze({
    ...Object.fromEntries(EXTENDED_IDS.map(id => [id, Object.freeze({ render: (root, input, state, context) => renderLearning(root, id, input, state, context), renderLegend: renderLearningLegend, heading: '자료구조와 상태', legendTitle: '범례: 표와 노드 표시 보는 법' })])),
    bfs: Object.freeze({ render: (root, input, state, context) => input.grid ? renderGrid(root, input, state) : renderGraph(root, input, state, context), renderLegend: (root, input) => input?.grid ? renderGridLegend(root) : renderLegend(root), heading: '그래프와 상태', legendTitle: '범례: 노드 모양과 표시 보는 법' }),
    dfs: Object.freeze({ render: renderDfsGraph, renderLegend: renderDfsLegend, heading: '그래프와 호출 스택', legendTitle: '범례: 노드 모양과 표시 보는 법' }),
    'binary-search': Object.freeze({ render: renderBinarySearch, renderLegend: renderBinarySearchLegend, heading: '배열과 상태', legendTitle: '범례: 칸 모양과 표시 보는 법' }),
    'bubble-sort': Object.freeze({ render: renderBubbleSort, renderLegend: renderBubbleSortLegend, heading: '배열과 상태', legendTitle: '범례: 칸 모양과 표시 보는 법' }),
});

/** algorithmId의 renderer. 등록되지 않은 알고리즘이면 예외(화면을 그리지 못한다). */
export function getRenderer(algorithmId) {
    if (!Object.hasOwn(RENDERERS, algorithmId)) throw new Error(`${algorithmId}의 화면이 아직 없습니다.`);
    return RENDERERS[algorithmId];
}
