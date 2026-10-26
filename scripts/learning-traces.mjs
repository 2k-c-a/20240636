import { LANGUAGE_IDS } from '../frontend/js/trace-contract.js';
import { compileLearning, executeLearning, learningProgram } from '../frontend/js/learning-programs.js';
import { gridInput } from '../frontend/js/grid-bfs.js';

export const LEARNING_TITLES = Object.freeze({ 'union-find': '유니온 파인드', dijkstra: '다익스트라 (배열 기반)', knapsack: '0/1 배낭 DP', 'topological-sort': '위상 정렬 (Kahn)', 'two-pointers': '투 포인터 (연속 구간 합)' });
const example = (algorithmId, id, title, input) => ({ algorithmId, id, title, input, version: 1 });
export const LEARNING_EXAMPLES = Object.freeze([
    example('union-find', 'basic', '집합 합치기와 같은 집합 조회', { n: 6, operations: [[0,0,1],[0,2,3],[0,0,2],[0,4,5],[1,0,3],[1,0,5],[0,3,5],[1,1,4]] }),
    example('union-find', 'compression', '균형 트리에서 경로 반감', { n: 8, operations: [[0,0,1],[0,2,3],[0,4,5],[0,6,7],[0,0,2],[0,4,6],[0,0,4],[1,7,1]] }),
    example('union-find', 'single', '원소 하나와 자기 자신 조회', { n: 1, operations: [[1,0,0],[0,0,0],[1,0,0]] }),
    example('dijkstra', 'basic', '간선 수보다 가중치 합이 중요한 경로', { n: 5, start: 0, edges: [[0,1,8],[0,2,2],[2,1,1],[1,3,2],[2,3,9],[3,4,1]] }),
    example('dijkstra', 'unreachable', '0 가중치와 도달 불가 노드', { n: 4, start: 0, edges: [[0,1,0],[2,3,3]] }),
    example('dijkstra', 'single', '노드 하나', { n: 1, start: 0, edges: [] }),
    example('knapsack', 'basic', '한 물건을 한 번만 고르는 배낭', { weights: [2,3,4], values: [4,5,7], capacity: 5 }),
    example('knapsack', 'ties', '같은 무게·가치와 최댓값 동률', { weights: [2,2,4], values: [3,3,6], capacity: 4 }),
    example('knapsack', 'too-heavy', '어떤 물건도 담을 수 없는 용량', { weights: [4,5], values: [8,10], capacity: 3 }),
    example('knapsack', 'empty', '물건 없음·용량 0', { weights: [], values: [], capacity: 0 }),
    example('topological-sort', 'basic', '선행 작업을 만족하는 처리 순서', { n: 5, edges: [[0,2],[1,2],[2,3],[2,4]] }),
    example('topological-sort', 'cycle', '방향 사이클로 전체 순서를 만들 수 없음', { n: 4, edges: [[0,1],[1,2],[2,1]] }),
    example('topological-sort', 'independent', '간선 없는 독립 작업', { n: 3, edges: [] }),
    example('two-pointers', 'basic', '목표 합 5인 양의 정수 연속 구간', { values: [1,2,3,2,1,1,4], target: 5 }),
    example('two-pointers', 'not-found', '합을 만들 수 없는 경우', { values: [2,4,6], target: 3 }),
    example('two-pointers', 'empty', '빈 배열', { values: [], target: 1 }),
    example('two-pointers', 'single', '원소 하나가 목표 합', { values: [5], target: 5 }),
]);
export const GRID_EXAMPLES = Object.freeze([
    example('bfs', 'grid-maze', '응용: 벽이 있는 격자 미로와 최단 거리', gridInput({ rows: 3, cols: 4, walls: [[0,2],[1,0],[2,2]], start: [0,0], goal: [2,3] })),
    example('bfs', 'grid-open', '응용: 여러 최단 경로가 있는 격자', gridInput({ rows: 2, cols: 3, walls: [], start: [0,0], goal: [1,2] })),
    example('bfs', 'grid-unreachable', '응용: 벽으로 막힌 도착점', gridInput({ rows: 3, cols: 3, walls: [[0,1],[1,1],[2,1]], start: [0,0], goal: [2,2] })),
]);

export function buildLearningBundle(example) {
    const program = learningProgram(example.algorithmId, example.input);
    const compiled = Object.fromEntries(LANGUAGE_IDS.map(language => [language, compileLearning(program, language)]));
    return {
        schemaVersion: 1, contentVersion: `${example.algorithmId}-${example.id}-v${example.version}`,
        algorithmId: example.algorithmId, exampleId: example.id, input: structuredClone(example.input),
        codes: Object.fromEntries(LANGUAGE_IDS.map(language => [language, { lines: compiled[language].lines, notes: compiled[language].notes }])),
        steps: executeLearning(program).map((step, index) => ({ index, ...step, lines: Object.fromEntries(LANGUAGE_IDS.map(language => [language, [...compiled[language].mapping[step.eventId]]])) })),
    };
}
