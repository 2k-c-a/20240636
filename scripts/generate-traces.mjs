// frontend/js/data의 catalog.json과 모든 예제 bundle을 scripts/trace-builders.mjs에서 다시 만든다.
//
//   node scripts/generate-traces.mjs            data 폴더를 덮어쓴다
//   node scripts/generate-traces.mjs <폴더>      다른 폴더에 만든다(비교용)
//
// 코드·줄 매핑·설명을 고쳤다면 trace-builders.mjs의 EXAMPLES에서 해당 예제의 version을 올린 뒤 실행하고,
// `npm run validate:traces`와 `npm test`로 확인한다.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXAMPLES, buildBundle, buildCatalog, formatBundle, formatCatalog } from './trace-builders.mjs';
import { GRID_EXAMPLES, LEARNING_EXAMPLES, buildLearningBundle } from './learning-traces.mjs';
const ALL_EXAMPLES = [...EXAMPLES, ...GRID_EXAMPLES, ...LEARNING_EXAMPLES];

const DEFAULT_DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'frontend/js/data');

/**
 * 예전 실행에서 만들어졌지만 이번에는 만들지 않은 bundle(예제 이름을 바꾸거나 지운 경우)을 지운다.
 * 알고리즘 폴더(EXAMPLES에 있는 이름)의 *.json만 대상이라 다른 폴더나 파일은 건드리지 않는다.
 */
function removeStale(outDir, written) {
    const keep = new Set(written);
    for (const algorithmId of new Set(ALL_EXAMPLES.map((example) => example.algorithmId))) {
        const dir = join(outDir, algorithmId);
        if (!existsSync(dir)) continue;
        for (const name of readdirSync(dir)) {
            if (name.endsWith('.json') && !keep.has(`${algorithmId}/${name}`)) rmSync(join(dir, name));
        }
    }
}

export function generate(outDir) {
    const written = [];
    const write = (relative, text) => {
        const path = join(outDir, relative);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text, 'utf8');
        written.push(relative);
    };
    write('catalog.json', formatCatalog(buildCatalog()));
    for (const example of EXAMPLES) write(`${example.algorithmId}/${example.id}.json`, formatBundle(buildBundle(example)));
    for (const example of GRID_EXAMPLES) write(`${example.algorithmId}/${example.id}.json`, formatBundle(buildBundle(example)));
    for (const example of LEARNING_EXAMPLES) write(`${example.algorithmId}/${example.id}.json`, formatBundle(buildLearningBundle(example)));
    removeStale(outDir, written);
    return written;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const outDir = resolve(process.argv[2] ?? DEFAULT_DIR);
    const written = generate(outDir);
    console.log(`${outDir}에 ${written.length}개 파일을 썼습니다.`);
}
