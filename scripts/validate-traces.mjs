// catalog에 등록된 모든 예제를 검증한다.
// 사용법: node scripts/validate-traces.mjs [data 폴더]   (기본: frontend/js/data)
// 오류가 하나라도 있으면 종료 코드 1로 끝난다.

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIMITS } from '../frontend/js/trace-contract.js';
import { validateBundle, validateCatalog } from '../frontend/js/trace-validator.js';

const DEFAULT_DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../frontend/js/data');

async function readJson(file, label, errors) {
    let text;
    try {
        text = await readFile(file, 'utf8');
    } catch (error) {
        errors.push(`${label}: 파일을 읽을 수 없습니다 (${error.code ?? error.message})`);
        return undefined;
    }
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > LIMITS.maxBundleBytes) {
        errors.push(`${label}: 파일이 ${LIMITS.maxBundleBytes}바이트를 넘습니다 (${bytes}바이트)`);
        return undefined;
    }
    try {
        return JSON.parse(text);
    } catch (error) {
        errors.push(`${label}: JSON 형식이 올바르지 않습니다 (${error.message})`);
        return undefined;
    }
}

/**
 * data 폴더의 catalog와 모든 예제를 검증한다.
 * @param {string} [dataDir]
 * @returns {Promise<{errors: string[], checked: {path: string, contentVersion: string, steps: number, languages: string[]}[]}>}
 */
export async function validateDataDir(dataDir = DEFAULT_DATA_DIR) {
    const errors = [];
    const checked = [];

    const catalog = await readJson(join(dataDir, 'catalog.json'), 'catalog.json', errors);
    if (catalog === undefined) return { errors, checked };

    const catalogResult = validateCatalog(catalog);
    if (!catalogResult.valid) {
        errors.push(...catalogResult.errors.map((message) => `catalog.json: ${message}`));
        return { errors, checked };
    }

    const examples = catalog.algorithms.flatMap((algorithm) => algorithm.examples.map((example) => ({ algorithm, example })));
    if (examples.length === 0) {
        errors.push('catalog.json: 등록된 예제가 없습니다. 아무것도 검증하지 않은 채 통과시키지 않습니다');
        return { errors, checked };
    }

    for (const { algorithm, example } of examples) {
        const found = errors.length;
        const bundle = await readJson(join(dataDir, example.path), example.path, errors);
        if (bundle === undefined) continue;

        const result = validateBundle(bundle);
        errors.push(...result.errors.map((message) => `${example.path}: ${message}`));
        if (!result.valid) continue;

        if (bundle.algorithmId !== algorithm.id) errors.push(`${example.path}: algorithmId가 catalog와 다릅니다 (catalog ${algorithm.id}, bundle ${bundle.algorithmId})`);
        if (bundle.exampleId !== example.id) errors.push(`${example.path}: exampleId가 catalog와 다릅니다 (catalog ${example.id}, bundle ${bundle.exampleId})`);
        const bundleLanguages = Object.keys(bundle.codes).sort();
        const catalogLanguages = [...example.languages].sort();
        if (bundleLanguages.join(',') !== catalogLanguages.join(',')) {
            errors.push(`${example.path}: 언어가 catalog와 다릅니다 (catalog ${catalogLanguages.join(',')}, bundle ${bundleLanguages.join(',')})`);
        }
        if (errors.length === found) {
            checked.push({ path: example.path, contentVersion: bundle.contentVersion, steps: bundle.steps.length, languages: bundleLanguages });
        }
    }

    // 등록하지 않은 bundle 파일은 화면에 나오지 않으므로 빠뜨린 등록으로 본다.
    const registered = new Set(examples.map(({ example }) => example.path));
    let entries = [];
    try {
        entries = await readdir(dataDir, { recursive: true });
    } catch (error) {
        errors.push(`data 폴더를 읽을 수 없습니다 (${error.code ?? error.message})`);
    }
    for (const entry of entries) {
        const path = entry.split('\\').join('/');
        if (path.endsWith('.json') && path !== 'catalog.json' && !registered.has(path)) {
            errors.push(`${path}: catalog.json에 등록되지 않은 bundle 파일입니다`);
        }
    }

    return { errors, checked };
}

async function main() {
    const dataDir = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_DATA_DIR;
    console.log(`검증 대상: ${dataDir}`);
    const { errors, checked } = await validateDataDir(dataDir);

    for (const item of checked) {
        console.log(`✔ ${item.path} - ${item.contentVersion}, ${item.steps} steps, 언어: ${item.languages.join(', ')}`);
    }
    for (const message of errors) console.log(`✖ ${message}`);

    console.log(`결과: 통과 ${checked.length}개, 오류 ${errors.length}개`);
    if (errors.length > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await main();
}
