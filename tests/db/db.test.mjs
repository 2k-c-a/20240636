// DB 동작 테스트: 설치된 PostgreSQL로 일회용 임시 클러스터를 띄워 migration과 supabase/tests의 SQL·동시성 테스트를 실행한다.
// PostgreSQL을 찾지 못하면 이유를 표시하고 건너뛴다(통과로 세지 않는다). 실행기의 안전 규칙은 scripts/run-db-tests.mjs 맨 위를 보라.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findPgBin } from '../../scripts/run-db-tests.mjs';

const runner = fileURLToPath(new URL('../../scripts/run-db-tests.mjs', import.meta.url));
const shim = fileURLToPath(new URL('../../supabase/tests/support/local_supabase_shim.sql', import.meta.url));
const skip = findPgBin() === null ? 'PostgreSQL(initdb, postgres, psql)을 찾지 못해 실행하지 않음 — 통과가 아닙니다' : false;

test('DB: migration 적용 → 단계별 상태·RLS·권한·제약·트리거·RPC·동시성 테스트가 모두 통과한다', { skip, timeout: 300000 }, () => {
    const result = spawnSync(process.execPath, [runner], { encoding: 'utf8', timeout: 280000 });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, output.slice(-3000));
    assert.match(result.stdout, /DB 테스트 전체 통과/);
    // 검사가 하나도 실행되지 않았는데 통과로 보이는 일이 없도록 최소 개수를 확인한다.
    const count = (suite) => Number(new RegExp(`통과 - ${suite}: 검사 (\\d+)개`).exec(result.stdout)?.[1] ?? 0);
    assert.ok(count('migration_steps') >= 60, `migration_steps 검사 수: ${count('migration_steps')}`);
    assert.ok(count('rls') >= 200, `rls 검사 수: ${count('rls')}`);
    assert.ok(count('post_mutations') >= 70, `post_mutations 검사 수: ${count('post_mutations')}`);
    assert.ok(count('concurrency') >= 8, `concurrency 검사 수: ${count('concurrency')}`);
});

test('DB 실행기: 검사가 하나도 없는 테스트는 통과가 아니라 실패(종료 코드 1)이고, 이름을 고른 실행은 그 이름만 실행한다', { skip, timeout: 200000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'emptytests-'));
    try {
        mkdirSync(join(dir, 'support'));
        cpSync(shim, join(dir, 'support', 'local_supabase_shim.sql'));
        writeFileSync(join(dir, 'rls.sql'), 'select 1;\n'); // 검사(ok - ...)가 하나도 없다
        const empty = spawnSync(process.execPath, [runner, '--only', 'rls', '--tests', dir], { encoding: 'utf8', timeout: 150000 });
        assert.equal(empty.status, 1, empty.stdout + empty.stderr);
        assert.match(empty.stdout, /검사가 하나도 실행되지 않았습니다/);
        assert.doesNotMatch(empty.stdout, /DB 테스트 전체 통과/);

        // 이름을 고르면 그 이름만 실행한다(다른 스위트를 몰래 실행하거나 빠뜨리지 않는다)
        const only = spawnSync(process.execPath, [runner, '--only', 'migration_steps'], { encoding: 'utf8', timeout: 150000 });
        assert.equal(only.status, 0, only.stdout + only.stderr);
        assert.match(only.stdout, /통과 - migration_steps: 검사 \d+개/);
        assert.doesNotMatch(only.stdout, /통과 - (rls|post_mutations|concurrency)/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
