// 실제 data 폴더의 예제를 로더로 읽는다(서버 없이 디스크의 파일을 fetch 대신 돌려준다).
// 로더를 거치므로 결과는 검증을 통과했고 깊게 얼려 있다. 화면이 받는 것과 같은 모양이다.
// 이 파일은 테스트가 아니므로 node --test가 직접 실행하지 않는다.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadBundle, loadCatalog } from '../../../frontend/js/trace-loader.js';

export const DATA_DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), 'frontend/js/data');
const BASE = new URL('http://127.0.0.1:8000/web/js/data/');

export function diskFetch(requests = []) {
    return async (url) => {
        requests.push(String(url));
        const name = new URL(url).pathname.replace('/web/js/data/', '');
        return new Response(readFileSync(join(DATA_DIR, name), 'utf8'), { status: 200 });
    };
}

export async function loadFixture(algorithmId = 'bfs', exampleId = 'diamond') {
    const options = { baseUrl: BASE, fetch: diskFetch() };
    const catalog = await loadCatalog(options);
    return { catalog, bundle: await loadBundle(algorithmId, exampleId, { ...options, catalog }) };
}

export const rawFixture = (name = 'bfs/diamond.json') => JSON.parse(readFileSync(join(DATA_DIR, name), 'utf8'));
