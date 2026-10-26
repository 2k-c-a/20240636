// 생성기/학습 연산 정의를 가져오지 않는 독립 정답 계산.
export function learningAnswer(id, input) {
    if (id === 'union-find') {
        const groups = Array.from({ length: input.n }, (_, i) => new Set([i]));
        return input.operations.map(([kind, a, b]) => {
            if (kind) return groups[a].has(b) ? 1 : 0;
            const joined = new Set([...groups[a], ...groups[b]]);
            for (const x of joined) groups[x] = joined;
            return -1;
        });
    }
    if (id === 'dijkstra') {
        const d = Array.from({ length: input.n }, (_, i) => Array.from({ length: input.n }, (_, j) => i === j ? 0 : Infinity));
        for (const [a, b, w] of input.edges) d[a][b] = Math.min(d[a][b], w);
        for (let k = 0; k < input.n; k++) for (let i = 0; i < input.n; i++) for (let j = 0; j < input.n; j++) d[i][j] = Math.min(d[i][j], d[i][k] + d[k][j]);
        return d[input.start].map(x => Number.isFinite(x) ? x : 1000000);
    }
    if (id === 'knapsack') {
        let best = 0;
        for (let mask = 0; mask < 2 ** input.weights.length; mask++) {
            let weight = 0, value = 0;
            for (let i = 0; i < input.weights.length; i++) if (mask & (1 << i)) { weight += input.weights[i]; value += input.values[i]; }
            if (weight <= input.capacity) best = Math.max(best, value);
        }
        return [best];
    }
    if (id === 'two-pointers') {
        let count = 0;
        for (let left = 0; left < input.values.length; left++) { let sum = 0; for (let right = left; right < input.values.length; right++) { sum += input.values[right]; if (sum === input.target) count++; } }
        return [count];
    }
    // 위상 정렬 정답은 여러 개일 수 있다. FIFO·작은 시작 노드 우선 정책의 결과를 별도로 계산한다.
    const remaining = new Set(Array.from({ length: input.n }, (_, i) => i)), ready = [], order = [];
    const enqueueReady = (candidates = [...remaining]) => { for (const v of candidates) if (!ready.includes(v) && input.edges.every(([a,b]) => b !== v || !remaining.has(a))) ready.push(v); };
    enqueueReady();
    while (ready.length) { const u = ready.shift(); remaining.delete(u); order.push(u); enqueueReady(input.edges.filter(([a]) => a === u).map(([,b]) => b)); }
    return [...order, ...Array(input.n - order.length).fill(-1)];
}
