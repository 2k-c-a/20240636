#!/usr/bin/env node
// DB 테스트 실행기: 이 컴퓨터의 PostgreSQL 바이너리로 "일회용 임시 클러스터"를 띄우고, 빈 데이터베이스에
// Supabase 흉내(shim) → supabase/migrations 를 순서대로 적용한 뒤 supabase/tests 의 테스트를 실행하고, 끝나면 모두 지운다.
//
// 안전 규칙
//   - 이미 실행 중인 PostgreSQL 서비스나 Supabase 프로젝트에는 접속하지 않는다. 임시 클러스터는 127.0.0.1의 빈 포트에서 일회용 비밀번호로만 열린다.
//   - 환경 변수 PG*(PGHOST, PGDATABASE 등)와 .env는 읽지 않는다. 실제 프로젝트의 접속 정보로 실수로 실행될 길이 없다.
//   - 설치하지 않는다. 이미 설치된 PostgreSQL(initdb, postgres, psql)이 필요하다. 없으면 "실행하지 않음"을 알리고 종료 코드 2로 끝난다(통과가 아니다).
//
// 사용법: node scripts/run-db-tests.mjs [--only <이름>[,<이름>...]] [--migrations <폴더>] [--tests <폴더>] [--keep] [--verbose(검사마다 'ok - ...' 출력)]
//   이름: migration_steps(migration을 하나씩 적용한 직후 상태), rls, post_mutations, concurrency. 다른 이름은 오류이고 종료 코드 1이다.
//   PG_BIN=<PostgreSQL bin 폴더>로 위치를 지정할 수 있다.
//   종료 코드: 0 통과, 1 실패(잘못된 인자, 검사 실패, 실행된 검사가 0개인 경우 포함), 2 실행하지 않음(PostgreSQL을 찾지 못함).
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name);

/** 쓸 수 있는 테스트 이름. 실행 순서이기도 하다. */
export const SUITES = ['migration_steps', 'rls', 'post_mutations', 'concurrency'];

/** 명령줄을 잘못 쓴 경우. 스택 대신 메시지만 보여 주고 종료 코드 1로 끝난다. */
export class UsageError extends Error {}

export function parseArgs(argv) {
    const options = { only: null, migrations: join(root, 'supabase', 'migrations'), tests: join(root, 'supabase', 'tests'), keep: false, verbose: false };
    const valueOf = (i, flag) => {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag}에는 값이 필요합니다.${flag === '--only' ? ` 쓸 수 있는 이름: ${SUITES.join(', ')}` : ''}`);
        return value;
    };
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === '--only') {
            const names = valueOf(i, '--only').split(',');
            i += 1;
            const unknown = names.filter((name) => !SUITES.includes(name));
            if (unknown.length > 0) throw new UsageError(`알 수 없는 테스트 이름: ${unknown.join(', ')}. 쓸 수 있는 이름: ${SUITES.join(', ')}`);
            options.only = names;
        } else if (argv[i] === '--migrations') {
            options.migrations = resolve(valueOf(i, '--migrations'));
            i += 1;
        } else if (argv[i] === '--tests') {
            options.tests = resolve(valueOf(i, '--tests'));
            i += 1;
        } else if (argv[i] === '--keep') options.keep = true;
        else if (argv[i] === '--verbose') options.verbose = true;
        else throw new UsageError(`알 수 없는 인자: ${argv[i]}`);
    }
    return options;
}

/** PostgreSQL 바이너리 폴더를 찾는다(initdb·postgres·psql이 모두 있는 곳). 없으면 null. */
export function findPgBin() {
    const dirs = [];
    if (process.env.PG_BIN) dirs.push(process.env.PG_BIN);
    dirs.push(...(process.env.PATH ?? '').split(delimiter).filter(Boolean));
    const versioned = (base, suffix = 'bin') => (existsSync(base) ? readdirSync(base).sort().reverse().map((v) => join(base, v, suffix)) : []);
    if (process.platform === 'win32') {
        for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) dirs.push(...versioned(join(base, 'PostgreSQL')));
    } else {
        dirs.push(...versioned('/usr/lib/postgresql'));
        for (const prefix of ['/opt/homebrew/opt', '/usr/local/opt']) {
            if (existsSync(prefix)) dirs.push(...readdirSync(prefix).filter((n) => n.startsWith('postgresql')).sort().reverse().map((n) => join(prefix, n, 'bin')));
        }
        dirs.push(...versioned('/Applications/Postgres.app/Contents/Versions'));
    }
    return dirs.find((dir) => ['initdb', 'postgres', 'psql', 'pg_isready'].every((n) => existsSync(join(dir, exe(n))))) ?? null;
}

const freePort = () => new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        server.close(() => done(port));
    });
});

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** 환경 변수에서 PG*와 접속 문자열을 모두 지운 깨끗한 환경. */
function cleanEnv(extra) {
    const env = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (!/^PG/i.test(key) && !/DATABASE_URL|SUPABASE/i.test(key)) env[key] = value;
    }
    return { ...env, ...extra };
}

async function startCluster(bin, dir) {
    const data = join(dir, 'data');
    const password = randomBytes(18).toString('hex');
    const pwfile = join(dir, 'pw');
    writeFileSync(pwfile, password, { mode: 0o600 });
    const init = spawnSync(join(bin, exe('initdb')), ['-D', data, '-U', 'postgres', '-E', 'UTF8', '--locale=C', '--auth=scram-sha-256', `--pwfile=${pwfile}`],
        { encoding: 'utf8', env: cleanEnv({}) });
    rmSync(pwfile, { force: true });
    if (init.status !== 0) throw new Error(`initdb 실패:\n${init.stdout}\n${init.stderr}`);

    const port = await freePort();
    const logPath = join(dir, 'postgres.log');
    const logFd = openSync(logPath, 'a');
    // pg_ctl start는 출력이 파이프일 때 돌아오지 않는 일이 있어 postgres를 이 프로세스의 자식으로 직접 띄운다.
    const child = spawn(join(bin, exe('postgres')), ['-D', data, '-p', String(port), '-c', 'listen_addresses=127.0.0.1',
        '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off', '-c', 'max_connections=80'],
    { stdio: ['ignore', logFd, logFd], env: cleanEnv({}), windowsHide: true });
    closeSync(logFd);
    let exited = false;
    child.once('exit', () => { exited = true; });

    for (let i = 0; i < 400; i += 1) {
        if (exited) throw new Error(`postgres가 바로 종료되었습니다:\n${readFileSync(logPath, 'utf8').slice(-1500)}`);
        const ready = spawnSync(join(bin, exe('pg_isready')), ['-h', '127.0.0.1', '-p', String(port)], { env: cleanEnv({}) });
        if (ready.status === 0) break;
        await sleep(100);
        if (i === 399) throw new Error('postgres가 시간 안에 준비되지 않았습니다.');
    }

    const env = cleanEnv({ PGPASSWORD: password, PGCLIENTENCODING: 'UTF8', PGCONNECT_TIMEOUT: '15' });
    const psqlArgs = (db) => ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', db, '-X', '-q', '-v', 'ON_ERROR_STOP=1'];

    return {
        port,
        data,
        psqlSync: (db, args, input) => spawnSync(join(bin, exe('psql')), [...psqlArgs(db), ...args], { encoding: 'utf8', env, input, cwd: root }),
        /** 새 접속 하나로 SQL을 실행한다(표준 입력). */
        session: (db, sql) => new Promise((done) => {
            const started = Date.now();
            const proc = spawn(join(bin, exe('psql')), [...psqlArgs(db), '-At', '-f', '-'], { env, cwd: root, windowsHide: true });
            let stdout = '';
            let stderr = '';
            proc.stdout.setEncoding('utf8').on('data', (c) => { stdout += c; });
            proc.stderr.setEncoding('utf8').on('data', (c) => { stderr += c; });
            proc.on('close', (code) => done({ code, stdout, stderr, ms: Date.now() - started }));
            proc.stdin.end(sql);
        }),
        async stop() {
            spawnSync(join(bin, exe('pg_ctl')), ['stop', '-D', data, '-m', 'fast', '-w', '-t', '20'], { env: cleanEnv({}), stdio: 'ignore' });
            for (let i = 0; i < 100 && !exited; i += 1) await sleep(100);
            if (!exited) child.kill();
            for (let i = 0; i < 100 && !exited; i += 1) await sleep(100);
        },
    };
}

const listSql = (dir) => readdirSync(dir).filter((name) => name.endsWith('.sql')).sort().map((name) => join(dir, name));

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const bin = findPgBin();
    if (bin === null) {
        console.log('실행하지 않음: PostgreSQL(initdb, postgres, psql)을 찾지 못했습니다. 설치되어 있으면 PG_BIN에 bin 폴더를 지정하세요. (통과가 아닙니다)');
        return 2;
    }
    const migrations = listSql(options.migrations);
    if (migrations.length === 0) throw new Error(`migration 파일이 없습니다: ${options.migrations}`);
    const testsDir = options.tests;
    const shim = join(testsDir, 'support', 'local_supabase_shim.sql');
    if (!existsSync(shim)) throw new UsageError(`테스트 폴더에 support/local_supabase_shim.sql이 없습니다: ${testsDir}`);

    const dir = mkdtempSync(join(tmpdir(), 'dbtest-'));
    let cluster = null;
    let dbCount = 0;
    const summary = [];
    const cleanup = async () => {
        if (cluster !== null) await cluster.stop();
        if (!options.keep) rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 300 });
    };
    process.once('SIGINT', () => { cleanup().finally(() => process.exit(130)); });

    try {
        console.log(`PostgreSQL: ${bin}`);
        cluster = await startCluster(bin, dir);

        /** 빈 데이터베이스를 만들고 shim만 적용한다. */
        const createDatabase = (suite) => {
            dbCount += 1;
            const db = `t${dbCount}_${suite}`;
            const r = cluster.psqlSync('postgres', ['-c', `create database ${db} template template0 encoding 'UTF8' locale 'C'`]);
            if (r.status !== 0) throw new Error(`데이터베이스 생성 실패: ${r.stderr}`);
            applyFiles(db, suite, [shim]);
            return db;
        };
        /** 파일마다 하나의 트랜잭션으로 적용한다(Supabase에 파일을 따로 적용할 때와 같다). */
        const applyFiles = (db, suite, files) => {
            for (const file of files) {
                const r = cluster.psqlSync(db, ['--single-transaction', '-f', file]);
                if (r.status !== 0) throw new Error(`${suite}: ${file} 적용 실패:\n${r.stderr}`);
            }
        };
        /** SQL 테스트 파일 하나를 실행하고 통과한 검사 수를 돌려준다. 실패하거나 검사가 하나도 없으면 예외다. */
        const runSqlTest = (db, file) => {
            const r = cluster.psqlSync(db, ['-f', file]);
            const text = `${r.stdout}\n${r.stderr}`;
            const checks = (text.match(/NOTICE:\s+ok - /g) ?? []).length;
            if (options.verbose) console.log(text.split('\n').filter((l) => /ok - |FAIL/.test(l)).join('\n'));
            if (r.status !== 0) throw new Error(`${file}: ${text.split('\n').filter((l) => /FAIL|ERROR/.test(l)).slice(0, 5).join('\n') || text.slice(-1500)}`);
            if (checks === 0) throw new Error(`${file}: 검사가 하나도 실행되지 않았습니다.`);
            return checks;
        };

        const failures = [];
        let totalChecks = 0;
        for (const suite of SUITES) {
            if (options.only !== null && !options.only.includes(suite)) continue;
            try {
                const db = createDatabase(suite);
                let checks;
                if (suite === 'migration_steps') {
                    // migration을 하나씩 적용하고 그때마다 그 직후 상태를 검사한다(파일 사이에 열려 있는 틈이 없는지).
                    if (migrations.length < 2) throw new Error('migration이 2개 이상 있어야 단계별 검사를 할 수 있습니다.');
                    applyFiles(db, suite, [migrations[0]]);
                    checks = runSqlTest(db, join(testsDir, 'after_migration_1.sql'));
                    applyFiles(db, suite, [migrations[1]]);
                    checks += runSqlTest(db, join(testsDir, 'after_migration_2.sql'));
                } else {
                    applyFiles(db, suite, migrations);
                    if (suite === 'concurrency') {
                        const { runConcurrencyTests } = await import(pathToFileURL(join(testsDir, 'concurrency.mjs')).href);
                        checks = await runConcurrencyTests({ session: (sql) => cluster.session(db, sql) });
                    } else {
                        checks = runSqlTest(db, join(testsDir, `${suite}.sql`));
                    }
                }
                if (!(checks > 0)) throw new Error('검사가 하나도 실행되지 않았습니다.');
                totalChecks += checks;
                summary.push(`${suite}: ${checks}개 통과`);
                console.log(`통과 - ${suite}: 검사 ${checks}개`);
            } catch (error) {
                failures.push(suite);
                console.log(`실패 - ${suite}: ${error.message}`);
            }
        }
        if (failures.length === 0 && (summary.length === 0 || totalChecks === 0)) {
            console.log('DB 테스트 실패: 실행된 검사가 없습니다(통과로 보지 않습니다).');
            return 1;
        }
        console.log(failures.length === 0 ? `DB 테스트 전체 통과 (${summary.join(', ')})` : `DB 테스트 실패: ${failures.join(', ')}`);
        return failures.length === 0 ? 0 : 1;
    } finally {
        await cleanup();
        if (options.keep) console.log(`임시 폴더를 남겼습니다: ${dir}`);
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().then((code) => process.exit(code), (error) => {
        console.error(error instanceof UsageError ? error.message : (error.stack ?? error));
        process.exit(1);
    });
}
