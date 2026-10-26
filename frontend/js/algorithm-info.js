const entries = {
    bfs: { time: 'O(V + E)', space: '보조 공간 O(V)', symbols: 'V: 노드 수, E: 방향 간선 수', reason: '시작점에서 닿는 각 노드를 한 번 발견하고 그 노드의 이웃을 한 번씩 검사합니다. 집합 조회는 평균 O(1)을 가정합니다.', caveat: '입력 그래프 저장은 보통 O(V + E)입니다. C 예제는 이웃 저장 배열을 N×N으로 잡아 입력 저장 공간은 O(V²)입니다.' },
    dfs: { time: 'O(V + E)', space: '방문 기록·재귀 스택 O(V)', symbols: 'V: 노드 수, E: 방향 간선 수', reason: '발견한 노드의 함수에 한 번 들어가고 이웃을 한 번씩 검사합니다. 집합 조회는 평균 O(1)을 가정합니다.', caveat: '최악에는 재귀 깊이가 V가 됩니다. C 예제의 고정 입력 배열은 O(V²), 다른 인접 리스트 입력은 O(V + E) 공간입니다.' },
    'binary-search': { time: '최선 O(1), 최악 O(log n)', space: '반복문 방식 보조 공간 O(1)', symbols: 'n: 배열 원소 수', reason: '비교할 때마다 탐색 구간이 대략 절반으로 줄어듭니다.', caveat: '이미 정렬된 배열이 전제입니다. 이 코드에는 정렬 비용이 포함되지 않습니다. 중복 값은 일치하는 인덱스 하나를 반환합니다.' },
    'bubble-sort': { time: '최선·평균·최악 모두 O(n²)', space: '보조 공간 O(1)', symbols: 'n: 배열 원소 수', reason: '현재 코드는 조기 종료가 없어 정렬된 입력도 n(n−1)/2번 비교합니다.', caveat: '교환이 없으면 종료하는 다른 구현은 최선 O(n)이지만 화면의 구현에는 해당하지 않습니다.' },
    'union-find': { time: '초기화 O(n + m), m회 연산 O(m α(n)) (분할 상환)', space: '부모·랭크 O(n), 입력·조회 결과 보관 O(m)', symbols: 'n: 원소 수, m: 합치기·조회 횟수, α: 역 아커만 함수', reason: '랭크 기준 합치기와 경로 반감을 함께 사용해 반복 조회의 경로를 짧게 만듭니다.', caveat: 'α(n)은 매우 느리게 증가합니다. 매 연산이 반드시 O(1)이라는 뜻은 아니며, 여러 연산 전체의 분할 상환 경계입니다.' },
    dijkstra: { time: '현재 배열 기반 구현 O(V²)', space: '인접 행렬 O(V²), 거리·확정·이전 노드 O(V)', symbols: 'V: 노드 수, E: 간선 수', reason: '매 회 미확정 최소 거리를 V개에서 찾고, 선택한 노드의 행 V칸을 검사합니다.', caveat: '음수 가중치는 허용하지 않습니다. 힙·인접 리스트 구현의 O((V + E) log V)와 구분하세요. 작은 예제에서는 최소 선택 원리를 먼저 보여 줍니다.' },
    knapsack: { time: 'O(NW)', space: '현재 2차원 DP 표 O(NW)', symbols: 'N: 물건 수, W: 배낭 용량', reason: '각 물건과 각 용량의 조합을 계산하고, 선택·미선택 결과를 비교합니다. 0행·0열을 포함한 실제 표 크기는 (N+1)×(W+1)입니다.', caveat: 'W의 비트 수가 아니라 값에 비례하는 의사 다항 시간입니다. 한 물건은 최대 한 번 사용합니다. 1차원 최적화는 이 예제에 포함하지 않습니다.' },
    'topological-sort': { time: 'O(V + E)', space: '인접 리스트·큐·진입 차수·결과 O(V + E)', symbols: 'V: 노드 수, E: 선행 관계 수', reason: '각 노드는 큐에서 한 번 나오고 각 방향 간선은 한 번 처리됩니다.', caveat: '방향 사이클이 있으면 전체 순서를 만들 수 없습니다. starts[u]~starts[u+1]은 평탄화한 이웃 배열 edges에서 u의 이웃 범위입니다.' },
    'two-pointers': { time: 'O(n)', space: '배열 입력 제외 보조 공간 O(1)', symbols: 'n: 배열 원소 수', reason: '겹친 while문이어도 left와 right는 각각 최대 n번만 앞으로 움직입니다.', caveat: '양의 정수 배열의 연속 구간 합을 세는 예제입니다. 0·음수를 섞으면 이 이동 규칙으로 모든 구간을 셀 수 없어 입력에서 거부합니다.' },
};
export const ALGORITHM_INFO = Object.freeze(Object.fromEntries(Object.entries(entries).map(([id, value]) => [id, Object.freeze(value)])));
export function algorithmInfo(bundle) {
    if (bundle.input.grid) return { time: 'O(RC)', space: '방문·큐 등 보조 공간 O(RC)', symbols: 'R: 행 수, C: 열 수', reason: '이동 가능한 칸은 RC개 이하이고, 각 칸의 네 방향만 검사합니다.', caveat: '격자를 인접 리스트로 변환한 BFS 응용입니다. 시작 거리는 0이며 이동 횟수를 셉니다. C의 고정 크기 입력 배열은 별도로 O((RC)²) 공간을 잡습니다. 거리·경로는 발견 상태에서 유도한 학습 표시입니다.' };
    return ALGORITHM_INFO[bundle.algorithmId];
}
export function renderAlgorithmInfo(root, bundle) {
    const info = algorithmInfo(bundle), doc = root.ownerDocument;
    root.replaceChildren();
    const heading = doc.createElement('h4'); heading.textContent = '시간복잡도와 구현 전제'; root.append(heading);
    const cost = doc.createElement('p'); cost.textContent = `시간: ${info.time} · 공간: ${info.space}`; root.append(cost);
    const details = doc.createElement('details'), summary = doc.createElement('summary');
    summary.textContent = '왜 이 복잡도인가? · 기호와 구현 전제'; details.append(summary);
    for (const text of [info.symbols, info.reason, info.caveat, '알고리즘 자체의 비용입니다. 화면 렌더링·언어 전환·실행 기록 저장 비용이나 재생 속도를 뜻하지 않습니다.']) {
        const p = doc.createElement('p'); p.textContent = text; details.append(p);
    }
    root.append(details);
}
