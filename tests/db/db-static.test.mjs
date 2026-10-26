// PostgreSQL 없이도 확인할 수 있는 DB 파일의 정적 검사: 파일 구성, 비밀 문자열 없음, 안전장치, 읽기 어려운 문자 금지.
// 실제 동작(RLS·제약·RPC·동시성)은 db.test.mjs가 PostgreSQL이 있을 때 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { findPgBin } from '../../scripts/run-db-tests.mjs';

const root = new URL('../../', import.meta.url);
const read = (relative) => readFileSync(new URL(relative, root), 'utf8');
const migrationNames = readdirSync(new URL('supabase/migrations/', root)).sort();
const migrations = Object.fromEntries(migrationNames.map((name) => [name, read(`supabase/migrations/${name}`)]));
const allMigrationsText = Object.values(migrations).join('\n');
/** SQL 주석(--로 시작하는 줄과 줄 끝 주석)을 지운 코드. */
const stripComments = (sql) => sql.split('\n').map((line) => line.replace(/--.*$/, '')).join('\n');

const sqlFiles = [
    ...migrationNames.map((name) => `supabase/migrations/${name}`),
    'supabase/tests/rls.sql', 'supabase/tests/post_mutations.sql',
    'supabase/tests/support/local_supabase_shim.sql', 'supabase/tests/support/test_helpers.sql',
];
const sourceFiles = [...sqlFiles, 'supabase/tests/concurrency.mjs', 'scripts/run-db-tests.mjs', 'supabase/README.md'];

test('migration은 정해진 여섯 파일이고 12자리 버전 순서로 정렬된다', () => {
    assert.deepEqual(migrationNames, ['202610140001_profiles_posts.sql', '202610140002_rls_triggers.sql', '202610140003_post_mutations.sql', '202610160001_posts_rpc_only.sql', '202610250001_learning_algorithms.sql', '202610260001_comments.sql']);
    for (const name of migrationNames) assert.match(name, /^\d{12}_[a-z_]+\.sql$/);
    for (const [name, sql] of Object.entries(migrations)) assert.ok(sql.trim().length > (name === '202610250001_learning_algorithms.sql' ? 100 : 500), `${name}이 비어 있다`);
});

test('필수 테스트 파일이 있고 README가 실행 방법을 안내한다', () => {
    for (const file of ['supabase/tests/rls.sql', 'supabase/tests/post_mutations.sql', 'supabase/tests/concurrency.mjs', 'supabase/README.md', 'scripts/run-db-tests.mjs']) {
        assert.ok(existsSync(new URL(file, root)), `${file}이 없다`);
    }
    const readme = read('supabase/README.md');
    for (const phrase of ['npm run test:db', '적용 전 점검', '확인하지 않은 것', 'local_supabase_shim.sql']) assert.ok(readme.includes(phrase), `README에 "${phrase}"가 없다`);
});

test('비밀로 보이는 문자열(JWT, Secret key, 비밀번호가 든 접속 문자열)이 DB 파일에 없다', () => {
    const patterns = [
        [/eyJ[A-Za-z0-9_-]{20,}/, 'JWT'],
        [/sb_secret_[A-Za-z0-9_-]+/, 'Supabase Secret key'],
        [/sbp_[A-Za-z0-9]{20,}/, 'Supabase 개인 액세스 토큰'],
        [/postgres(?:ql)?:\/\/[^\s/:@]+:[^\s@]+@/i, '비밀번호가 든 접속 문자열'],
    ];
    for (const file of sourceFiles) {
        const text = read(file);
        for (const [pattern, label] of patterns) assert.doesNotMatch(text, pattern, `${file}에 ${label}처럼 보이는 문자열이 있다`);
    }
});

test('공백 계열 문자는 소스에 실제 문자로 넣지 않고 \\uXXXX 이스케이프로만 적는다(보이지 않는 문자가 섞이지 않게)', () => {
    // 눈에 보이지 않는 공백 계열 문자의 코드: U+00A0, U+1680, U+2000~U+200B, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF.
    // 이 테스트 파일 자체에도 그 문자를 직접 적지 않으려고 코드 값으로 만든다.
    const codes = [0xa0, 0x1680, ...Array.from({ length: 12 }, (_, i) => 0x2000 + i), 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff];
    const invisible = codes.map((code) => String.fromCodePoint(code));
    for (const file of sourceFiles) {
        const text = read(file);
        const found = invisible.find((ch) => text.includes(ch));
        assert.equal(found, undefined, `${file}에 눈에 보이지 않는 공백 계열 문자(U+${found === undefined ? '' : found.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})가 있다`);
    }
    // 규칙 자체는 남아 있어야 한다: 앞뒤 공백 제약이 문자 코드로 적혀 있다.
    assert.ok(migrations['202610140001_profiles_posts.sql'].includes(String.fromCharCode(92) + 'u3000'), '전각 공백 이스케이프가 제약에 있어야 한다');
});

test('줄바꿈은 LF이고 테스트 SQL은 COMMIT 하지 않으며 ROLLBACK으로 끝난다(데이터를 남기지 않는다)', () => {
    for (const file of sourceFiles) assert.ok(!read(file).includes('\r'), `${file}에 CR이 있다`);
    for (const file of ['supabase/tests/rls.sql', 'supabase/tests/post_mutations.sql']) {
        const code = stripComments(read(file));
        assert.doesNotMatch(code, /^\s*commit\s*;/im, `${file}에 commit이 있다`);
        assert.match(code, /^\s*begin\s*;/im, `${file}이 트랜잭션을 시작하지 않는다`);
        assert.match(code.trimEnd().split('\n').filter((l) => !l.startsWith('\\')).pop(), /^rollback;$/, `${file}이 rollback으로 끝나지 않는다`);
    }
});

test('안전장치: shim은 실제 Supabase(auth 스키마·supabase_admin)로 보이면 중단하고, 테스트는 shim이 없으면 시작하지 않는다', () => {
    const shim = read('supabase/tests/support/local_supabase_shim.sql');
    assert.match(shim, /nspname = 'auth'/);
    assert.match(shim, /rolname = 'supabase_admin'/);
    assert.match(shim, /raise exception/);
    assert.match(shim, /comment on schema auth is 'LOCAL_TEST_SHIM'/);
    const helpers = read('supabase/tests/support/test_helpers.sql');
    assert.match(helpers, /LOCAL_TEST_SHIM/);
    assert.match(helpers, /raise exception/);
    // 두 테스트 파일은 도구를 불러와야 시작한다
    for (const file of ['supabase/tests/rls.sql', 'supabase/tests/post_mutations.sql']) assert.match(read(file), /\\ir support\/test_helpers\.sql/);
});

test('실행기는 .env와 PG* 환경 변수를 읽지 않고 설치하지 않으며 자기 임시 클러스터에만 접속한다', () => {
    const runner = read('scripts/run-db-tests.mjs');
    assert.doesNotMatch(runner, /loadEnvFile|dotenv|readFileSync\([^)]*\.env/);
    assert.match(runner, /\/\^PG\/i\.test\(key\)/, 'PG* 환경 변수를 지우는 코드가 있어야 한다');
    assert.match(runner, /listen_addresses=127\.0\.0\.1/);
    assert.match(runner, /scram-sha-256/);
    assert.doesNotMatch(runner, /apt(-get)? install|brew install|winget|choco |npm install|pip install/);
});

test('migration의 보안 규칙: RLS 활성화, 기본 권한 회수, SECURITY DEFINER 없음, 모든 함수에 search_path 고정', () => {
    const code = stripComments(allMigrationsText);
    assert.match(code, /alter table public\.profiles enable row level security/i);
    assert.match(code, /alter table public\.posts enable row level security/i);
    assert.match(code, /revoke all on table public\.profiles from public, anon, authenticated/i);
    assert.match(code, /revoke all on table public\.posts from public, anon, authenticated/i);
    assert.doesNotMatch(code, /security\s+definer/i, 'SECURITY DEFINER를 쓰지 않는다');
    assert.doesNotMatch(code, /grant\s+(all|delete|truncate)[^;]*to[^;]*\banon\b/i, 'anon에게 쓰기 권한을 주지 않는다');
    assert.doesNotMatch(code, /\bdrop\s+(table|schema|policy|function|trigger|index|column)\b|\btruncate\b/i, 'migration은 기존 객체나 데이터를 지우지 않는다');
    // DELETE는 사용자가 요청한 글 하나를 지우는 delete_post 안에만 있다(소유자·version 조건이 붙은 문장).
    const deletes = code.match(/\bdelete\s+from\b[^;]*;/gi) ?? [];
    // migration 4가 delete_post를 다시 정의하므로 두 곳(migration 3, 4)에만 있어야 한다.
    assert.equal(deletes.length, 2, 'DELETE 문은 delete_post 정의(migration 3, 4) 안의 두 곳뿐이어야 한다');
    for (const statement of deletes) assert.match(statement, /p\.author_id = v_uid[\s\S]*p\.version = p_expected_version/, 'DELETE에 소유자와 version 조건이 있어야 한다');
    const functions = code.split(/create\s+(?:or\s+replace\s+)?function\s+/i).slice(1);
    assert.ok(functions.length >= 8, '함수가 8개(트리거 4 + RPC 2 + 재정의 2) 이상이어야 한다');
    for (const body of functions) assert.match(body.slice(0, 700), /set\s+search_path\s*=\s*''/i, `search_path가 고정되지 않은 함수: ${body.slice(0, 60)}`);
});

test('PostgreSQL 위치 찾기: PG_BIN이 가리키는 폴더에 필요한 실행 파일이 있어야 쓴다', () => {
    const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name);
    const dir = mkdtempSync(join(tmpdir(), 'fakepg-'));
    const saved = process.env.PG_BIN;
    try {
        process.env.PG_BIN = dir;
        assert.notEqual(findPgBin(), dir, '비어 있는 폴더는 선택하지 않는다');
        for (const name of ['initdb', 'postgres', 'psql']) writeFileSync(join(dir, exe(name)), '');
        assert.notEqual(findPgBin(), dir, 'pg_isready가 없으면 선택하지 않는다');
        writeFileSync(join(dir, exe('pg_isready')), '');
        assert.equal(findPgBin(), dir, '필요한 실행 파일이 모두 있으면 PG_BIN을 가장 먼저 쓴다');
    } finally {
        if (saved === undefined) delete process.env.PG_BIN;
        else process.env.PG_BIN = saved;
        rmSync(dir, { recursive: true, force: true });
    }
});

test('원자성: 테이블을 만드는 파일은 같은 파일 안에서 RLS를 켜고 기본 권한을 회수하며, 함수를 만드는 파일은 같은 파일 안에서 실행 권한을 회수한다', () => {
    // migration 파일은 하나씩 따로 적용될 수 있다. 첫 파일만 적용된 상태에서 Supabase의 기본 권한이 열려 있으면 비회원이 읽고 쓸 수 있다.
    for (const [name, sql] of Object.entries(migrations)) {
        const code = stripComments(sql);
        for (const [, table] of code.matchAll(/create\s+table\s+public\.(\w+)/gi)) {
            assert.match(code, new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 'i'), `${name}: ${table} 테이블을 만들면서 같은 파일에서 RLS를 켜지 않는다`);
            assert.match(code, new RegExp(`revoke\\s+all\\s+on\\s+table\\s+public\\.${table}\\s+from\\s+public,\\s*anon,\\s*authenticated`, 'i'), `${name}: ${table}의 기본 권한을 같은 파일에서 회수하지 않는다`);
            // 잠금은 테이블을 만든 뒤에 있어야 한다(순서 자체는 트랜잭션 안이라 중요하지 않지만, 읽는 사람이 한눈에 보도록 같은 파일 안에 둔다)
            assert.ok(code.search(new RegExp(`revoke\\s+all\\s+on\\s+table\\s+public\\.${table}`, 'i')) > code.search(new RegExp(`create\\s+table\\s+public\\.${table}`, 'i')));
        }
        for (const [, fn, args] of code.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(([^)]*)\)/gi)) {
            assert.match(code, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${fn}\\s*\\(`, 'i'), `${name}: 함수 ${fn}의 기본 실행 권한을 같은 파일에서 회수하지 않는다`);
            assert.ok(args !== undefined);
        }
    }
    assert.match(stripComments(migrations['202610140001_profiles_posts.sql']), /create\s+table\s+public\.profiles/i, '첫 migration이 테이블을 만든다');
});

test('실행기 인자 검사: 모르는 테스트 이름·값 없는 --only·모르는 인자는 PostgreSQL을 찾기 전에 종료 코드 1로 실패한다', () => {
    const runnerPath = fileURLToPath(new URL('../../scripts/run-db-tests.mjs', import.meta.url));
    const run = (...args) => spawnSync(process.execPath, [runnerPath, ...args], { encoding: 'utf8', timeout: 30000 });
    const cases = [
        [['--only', 'typo'], /알 수 없는 테스트 이름: typo/],
        [['--only', 'rls,typo'], /알 수 없는 테스트 이름: typo/],
        [['--only'], /--only에는 값이 필요합니다/],
        [['--only', '--keep'], /--only에는 값이 필요합니다/],
        [['--migrations'], /--migrations에는 값이 필요합니다/],
        [['--tests'], /--tests에는 값이 필요합니다/],
        [['--unknown'], /알 수 없는 인자: --unknown/],
    ];
    for (const [args, message] of cases) {
        const result = run(...args);
        assert.equal(result.status, 1, `${args.join(' ')}: 종료 코드 ${result.status}`);
        assert.doesNotMatch(result.stdout, /DB 테스트 전체 통과/, `${args.join(' ')}: 통과로 보이면 안 된다`);
        assert.match(result.stderr, message, `${args.join(' ')}: 이유를 알려야 한다`);
    }
    const typo = run('--only', 'typo');
    assert.match(typo.stderr, /알 수 없는 테스트 이름: typo/);
    for (const name of ['migration_steps', 'rls', 'post_mutations', 'concurrency']) assert.match(typo.stderr, new RegExp(name), `쓸 수 있는 이름에 ${name}이 있어야 한다`);
});
