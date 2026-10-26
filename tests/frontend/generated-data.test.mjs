// 등록된 예제 데이터(frontend/js/data)가 빌더(scripts/trace-builders.mjs)에서 그대로 만들어진 것인지, 계획한 예제가 빠짐없이 있는지 확인한다.
// 데이터를 손으로 고쳤거나 빌더만 고치고 `node scripts/generate-traces.mjs`를 잊으면 이 테스트가 실패한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generate } from '../../scripts/generate-traces.mjs';
import { EXAMPLES, LANGUAGES, buildBundle, buildCatalog, formatBundle, formatCatalog } from '../../scripts/trace-builders.mjs';
import { GRID_EXAMPLES, LEARNING_EXAMPLES } from '../../scripts/learning-traces.mjs';
import { ALGORITHM_IDS } from '../../frontend/js/trace-contract.js';
import { DATA_DIR } from './helpers/load-fixture.mjs';

const read = (relative) => readFileSync(join(DATA_DIR, relative), 'utf8');

/** 계획서(IMPLEMENTATION_PLAN.md 06단계)가 요구하는 경계 예제. */
const REQUIRED = {
    bfs: ['diamond', 'cycle', 'disconnected'],
    dfs: ['basic', 'cycle', 'disconnected'],
    'binary-search': ['basic', 'empty', 'single', 'not-found', 'duplicates'],
    'bubble-sort': ['basic', 'empty', 'single', 'sorted', 'negative-duplicates'],
};

test('catalog.json이 빌더의 목록과 글자까지 같다', () => {
    assert.equal(read('catalog.json'), formatCatalog(buildCatalog()));
});

test('등록된 모든 예제 파일이 빌더가 만든 것과 글자까지 같다(재생성하면 바뀌는 것이 없다)', () => {
    for (const example of EXAMPLES) {
        assert.equal(read(`${example.algorithmId}/${example.id}.json`), formatBundle(buildBundle(example)), `${example.algorithmId}/${example.id}`);
    }
});

test('generate()가 임시 폴더에 만든 파일이 data 폴더와 같다(스크립트가 실제로 같은 결과를 낸다)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'generated-'));
    try {
        const written = generate(dir);
        assert.equal(written.length, EXAMPLES.length + GRID_EXAMPLES.length + LEARNING_EXAMPLES.length + 1);
        for (const relative of written) assert.equal(readFileSync(join(dir, relative), 'utf8'), read(relative), relative);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('계획한 경계 예제가 모두 있고, 모든 예제가 Python·C++·C·JavaScript 코드를 가진다', () => {
    const catalog = JSON.parse(read('catalog.json'));
    assert.deepEqual(catalog.algorithms.map((algorithm) => algorithm.id), [...ALGORITHM_IDS]);
    for (const algorithm of catalog.algorithms) {
        const required = [...(REQUIRED[algorithm.id] ?? []), ...[...GRID_EXAMPLES, ...LEARNING_EXAMPLES].filter(item => item.algorithmId === algorithm.id).map(item => item.id)];
        assert.deepEqual(algorithm.examples.map((example) => example.id).sort(), required.sort(), algorithm.id);
        for (const example of algorithm.examples) {
            assert.deepEqual(example.languages, [...LANGUAGES], `${algorithm.id}/${example.id}`);
            const bundle = JSON.parse(read(example.path));
            assert.deepEqual(Object.keys(bundle.codes), [...LANGUAGES]);
            assert.ok(bundle.steps.every((step) => LANGUAGES.every((language) => Array.isArray(step.lines[language]))), `${example.path}: 모든 step이 지원 언어의 줄을 가진다`);
            assert.ok(bundle.steps.slice(1).every((step) => LANGUAGES.every((language) => step.lines[language].length > 0)), `${example.path}: step 1 이후에는 모든 언어가 줄을 보여 준다`);
        }
    }
});

test('같은 알고리즘의 모든 예제에서 같은 eventId는 같은 줄을 가리키고, 코드는 C의 #define N만 다르다', () => {
    for (const algorithmId of Object.keys(REQUIRED)) {
        const bundles = EXAMPLES.filter((example) => example.algorithmId === algorithmId).map((example) => JSON.parse(read(`${algorithmId}/${example.id}.json`)));
        const lines = new Map();
        for (const bundle of bundles) {
            for (const step of bundle.steps) {
                const key = step.eventId;
                const value = JSON.stringify([step.operation, step.lines]);
                assert.equal(lines.get(key) ?? value, value, `${algorithmId}: eventId ${key}가 예제마다 다른 줄을 가리킨다`);
                lines.set(key, value);
            }
            for (const language of LANGUAGES) {
                const strip = (codes) => (language === 'c' ? codes[language].lines.filter((line) => !line.startsWith('#define N ')) : codes[language].lines);
                assert.deepEqual(strip(bundle.codes), strip(bundles[0].codes), `${algorithmId}/${bundle.exampleId} ${language}`);
                assert.equal(bundle.codes[language].notes, bundles[0].codes[language].notes);
            }
        }
    }
});

test('그래프 알고리즘의 C 코드는 #define N이 노드 수와 같다', () => {
    for (const example of EXAMPLES.filter((item) => item.input.graph !== undefined)) {
        const bundle = JSON.parse(read(`${example.algorithmId}/${example.id}.json`));
        assert.equal(bundle.codes.c.lines[0], `#define N ${Object.keys(example.input.graph).length}`, `${example.algorithmId}/${example.id}`);
    }
});

test('재생성하면 더 이상 등록하지 않은 예전 bundle은 지우고 다른 파일은 남긴다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trace-stale-'));
    try {
        generate(dir);
        writeFileSync(join(dir, 'bfs', 'renamed-away.json'), '{}');
        writeFileSync(join(dir, 'bfs', 'notes.txt'), '남겨야 하는 파일');
        mkdirSync(join(dir, 'other'));
        writeFileSync(join(dir, 'other', 'unrelated.json'), '{}');
        const written = generate(dir);
        assert.ok(!existsSync(join(dir, 'bfs', 'renamed-away.json')), '등록되지 않은 예전 bundle은 지워야 한다');
        assert.ok(existsSync(join(dir, 'bfs', 'notes.txt')), 'json이 아닌 파일은 건드리지 않는다');
        assert.ok(existsSync(join(dir, 'other', 'unrelated.json')), '알고리즘 폴더가 아닌 곳은 건드리지 않는다');
        for (const relative of written) assert.ok(existsSync(join(dir, relative)), `${relative}`);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
