// 격자는 별도 알고리즘이 아니라 BFS 인접 리스트의 응용 입력이다.
export function gridInput(grid) {
    if (!grid || Object.keys(grid).sort().join('|') !== 'cols|goal|rows|start|walls' || !Number.isInteger(grid.rows) || grid.rows < 1 || grid.rows > 3 || !Number.isInteger(grid.cols) || grid.cols < 1 || grid.cols > 4 || !Array.isArray(grid.walls)) throw new Error('격자 크기·구조가 잘못되었습니다.');
    const cellOk = cell => Array.isArray(cell) && cell.length === 2 && Number.isInteger(cell[0]) && Number.isInteger(cell[1]) && cell[0] >= 0 && cell[0] < grid.rows && cell[1] >= 0 && cell[1] < grid.cols;
    if (![grid.start, grid.goal, ...grid.walls].every(cellOk)) throw new Error('격자 좌표가 범위를 벗어났습니다.');
    const walls = new Set(grid.walls.map(cell => cell.join(',')));
    if (walls.size !== grid.walls.length || walls.has(grid.start.join(',')) || walls.has(grid.goal.join(','))) throw new Error('벽이 중복되거나 시작·도착점이 벽입니다.');
    const cells = [], graph = {}, layout = {}, byCell = new Map();
    for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) if (!walls.has(`${r},${c}`)) {
        const name = String.fromCharCode(65 + cells.length);
        cells.push({ name, r, c }); byCell.set(`${r},${c}`, name);
        layout[name] = { x: grid.cols === 1 ? 50 : 10 + c * 80 / (grid.cols - 1), y: grid.rows === 1 ? 50 : 10 + r * 80 / (grid.rows - 1) };
    }
    for (const { name, r, c } of cells) graph[name] = [[0, 1], [1, 0], [0, -1], [-1, 0]].map(([dr, dc]) => byCell.get(`${r + dr},${c + dc}`)).filter(Boolean);
    return { directed: true, graph, start: byCell.get(grid.start.join(',')), layout, grid: structuredClone(grid) };
}

export function gridCells(input, state) {
    const { grid, graph, start } = input;
    const distance = { [start]: 0 }, parent = {}, queue = [start];
    for (let head = 0; head < queue.length; head++) for (const v of graph[queue[head]]) if (!(v in distance)) {
        distance[v] = distance[queue[head]] + 1; parent[v] = queue[head]; queue.push(v);
    }
    const walls = new Set(grid.walls.map(cell => cell.join(','))), cells = [];
    let index = 0, goalName = null;
    for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
        if (walls.has(`${r},${c}`)) { cells.push({ r, c, wall: true }); continue; }
        const name = String.fromCharCode(65 + index++), discovered = state.discovered.includes(name);
        const goal = r === grid.goal[0] && c === grid.goal[1];
        if (goal) goalName = name;
        cells.push({ r, c, name, distance: discovered ? distance[name] : null, start: name === start, goal, current: state.current === name, queued: state.queue.includes(name), done: state.processed.includes(name) });
    }
    const path = [];
    if (state.discovered.includes(goalName)) for (let v = goalName; v !== undefined; v = parent[v]) path.unshift(v);
    return { cells, path, goalDistance: state.discovered.includes(goalName) ? distance[goalName] : null };
}
