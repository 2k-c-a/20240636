// 요청 장치(request-gate.js): 가장 나중에 시작한 요청만 최신이고, 새 요청은 이전 요청을 중단한다.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createRequestGate } from '../../frontend/js/request-gate.js';
import { selectionAfterChange } from '../../frontend/js/player-state.js';
import { loadFixture } from './helpers/load-fixture.mjs';

test('첫 요청은 최신이고 중단되지 않은 상태다', () => {
    const gate = createRequestGate();
    const first = gate.begin();
    assert.equal(first.isCurrent(), true);
    assert.equal(first.signal.aborted, false);
});

test('새 요청을 시작하면 이전 요청은 중단되고 최신이 아니게 되며, 새 요청은 영향을 받지 않는다', () => {
    const gate = createRequestGate();
    const first = gate.begin();
    const second = gate.begin();
    assert.equal(first.signal.aborted, true, '이전 요청의 신호가 울린다');
    assert.equal(first.isCurrent(), false);
    assert.equal(second.signal.aborted, false);
    assert.equal(second.isCurrent(), true);
    assert.notEqual(first.signal, second.signal, '요청마다 별도의 신호다');

    const third = gate.begin();
    assert.deepEqual([first.isCurrent(), second.isCurrent(), third.isCurrent()], [false, false, true]);
    assert.deepEqual([first.signal.aborted, second.signal.aborted, third.signal.aborted], [true, true, false]);
});

test('여러 번 빠르게 시작해도 마지막 요청만 최신이고, 나중에 isCurrent를 물어도 같다', async () => {
    const gate = createRequestGate();
    const requests = Array.from({ length: 50 }, () => gate.begin());
    await Promise.resolve();
    assert.deepEqual(requests.map((request) => request.isCurrent()).filter(Boolean).length, 1);
    assert.equal(requests.at(-1).isCurrent(), true);
    assert.ok(requests.slice(0, -1).every((request) => request.signal.aborted && !request.isCurrent()));
});

test('게이트마다 독립이다(한 게이트의 요청이 다른 게이트의 요청을 중단하지 않는다)', () => {
    const a = createRequestGate();
    const b = createRequestGate();
    const fromA = a.begin();
    b.begin();
    b.begin();
    assert.equal(fromA.isCurrent(), true);
    assert.equal(fromA.signal.aborted, false);
});

// ---------- 선택 전환(selectionAfterChange) ----------

const current = (algorithmId, exampleId, languageId) => Object.freeze({ algorithmId, exampleId, languageId, notices: Object.freeze([]) });
const plain = (selection) => ({ algorithmId: selection.algorithmId, exampleId: selection.exampleId, languageId: selection.languageId });

test('selectionAfterChange: 알고리즘을 바꾸면 현재 예제 ID가 새 알고리즘에 있어도 첫 예제를 고르고, 언어는 유지한다', async () => {
    const { catalog } = await loadFixture();
    // bfs/cycle → dfs: dfs에도 "cycle" 예제가 있지만 알고리즘을 바꾸면 그 알고리즘의 첫 예제(basic)로 간다.
    const next = selectionAfterChange(catalog, current('bfs', 'cycle', 'javascript'), { algorithmId: 'dfs' });
    assert.deepEqual(plain(next), { algorithmId: 'dfs', exampleId: 'basic', languageId: 'javascript' });
    assert.deepEqual([...next.notices], []);
    assert.ok(Object.isFrozen(next));
    assert.deepEqual(plain(selectionAfterChange(catalog, current('bfs', 'disconnected', 'c'), { algorithmId: 'binary-search' })), { algorithmId: 'binary-search', exampleId: 'basic', languageId: 'c' });
    assert.deepEqual(plain(selectionAfterChange(catalog, current('bubble-sort', 'sorted', 'python'), { algorithmId: 'bfs' })), { algorithmId: 'bfs', exampleId: 'diamond', languageId: 'python' });
});

test('selectionAfterChange: 예제만 바꾸면 알고리즘과 언어는 그대로이고 그 예제를 고른다', async () => {
    const { catalog } = await loadFixture();
    const next = selectionAfterChange(catalog, current('dfs', 'basic', 'c'), { exampleId: 'disconnected' });
    assert.deepEqual(plain(next), { algorithmId: 'dfs', exampleId: 'disconnected', languageId: 'c' });
    // 알고리즘과 예제를 함께 바꾸는 경우: 그 알고리즘의 그 예제
    assert.deepEqual(plain(selectionAfterChange(catalog, current('dfs', 'basic', 'c'), { algorithmId: 'bubble-sort', exampleId: 'negative-duplicates' })), { algorithmId: 'bubble-sort', exampleId: 'negative-duplicates', languageId: 'c' });
});

test('selectionAfterChange: 새 예제에 현재 언어가 없으면 Python, Python도 없으면 첫 언어로 바꾼다', async () => {
    const { catalog } = await loadFixture();
    const limited = structuredClone(catalog);
    const bubble = limited.algorithms.find((item) => item.id === 'bubble-sort');
    bubble.examples[0].languages = ['python', 'javascript'];
    bubble.examples[1].languages = ['javascript'];
    assert.equal(selectionAfterChange(limited, current('bfs', 'diamond', 'c'), { algorithmId: 'bubble-sort' }).languageId, 'python', 'C가 없으니 Python');
    assert.equal(selectionAfterChange(limited, current('bfs', 'diamond', 'javascript'), { algorithmId: 'bubble-sort' }).languageId, 'javascript', '있으면 유지');
    assert.equal(selectionAfterChange(limited, current('bubble-sort', 'basic', 'c'), { exampleId: bubble.examples[1].id }).languageId, 'javascript', 'Python도 없으면 첫 언어');
});

test('selectionAfterChange: 같은 선택이거나 목록에 없는 값이면 현재 선택 객체를 그대로 돌려준다', async () => {
    const { catalog } = await loadFixture();
    const now = current('dfs', 'cycle', 'javascript');
    for (const change of [{}, { algorithmId: 'dfs' }, { exampleId: 'cycle' }, { algorithmId: 'dfs', exampleId: 'cycle' }, { algorithmId: 'quick-sort' }, { algorithmId: '__proto__' },
        { algorithmId: 'constructor' }, { exampleId: 'nope' }, { exampleId: '' }, { exampleId: '__proto__' }, { algorithmId: undefined }, { algorithmId: null }, { algorithmId: 7 }, { exampleId: 7 }, { exampleId: ['basic'] }]) {
        assert.equal(selectionAfterChange(catalog, now, change), now, JSON.stringify(change));
    }
    // 다른 알고리즘의 예제 ID만 주면(현재 알고리즘에 없는 예제) 거부한다
    assert.equal(selectionAfterChange(catalog, now, { exampleId: 'diamond' }), now);
});
