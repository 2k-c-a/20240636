// 동시 수정·삭제 테스트: 같은 version을 가진 요청 둘 중 하나만 성공하는지 "서로 다른 DB 접속"으로 확인한다.
//
// 이 파일은 scripts/run-db-tests.mjs가 만든 임시 로컬 클러스터에서만 실행한다(데이터를 COMMIT 하므로 실제 Supabase 프로젝트에는 절대 쓰지 않는다).
// 한 트랜잭션 안에서는 동시성을 흉내 낼 수 없으므로 psql 접속을 여러 개 동시에 열고 pg_sleep으로 행 잠금을 쥔 채 기다리게 해서
//   - 잠금을 쥔 요청이 먼저 바꾸면, 기다리던 요청은 잠금이 풀린 뒤 바뀐 version으로 조건을 다시 평가해 version_conflict가 되는지
//   - 8개 접속이 동시에 같은 version으로 수정해도 정확히 하나만 ok이고 version이 한 번만 오르는지
// 를 본다. 반환값은 통과한 검사 수이고, 실패하면 예외를 던진다.
import assert from 'node:assert/strict';

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * @param {{ session: (sql: string) => Promise<{code: number, stdout: string, stderr: string, ms: number}> }} ctx
 *   session: 새 접속 하나로 SQL을 실행한다(관리자 접속).
 */
export async function runConcurrencyTests({ session }) {
    let checks = 0;
    const pass = (label) => { checks += 1; console.error(`ok - ${label}`); };

    const admin = async (sql) => {
        const result = await session(sql);
        assert.equal(result.code, 0, `관리자 SQL 실패: ${result.stderr}`);
        return result.stdout;
    };
    /** 회원 uid로 로그인한 상태의 한 트랜잭션. body 안의 'RESULT:...' 줄이 결과다. */
    const asUser = (uid, body) => `
        begin;
        set local role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true);
        select set_config('request.jwt.claim.sub', '${uid}', true);
        ${body}
        commit;`;
    const results = (run) => run.stdout.split(/\r?\n/).filter((line) => line.startsWith('RESULT:')).map((line) => line.slice(7));
    const update = (postId, version, title) => `select 'RESULT:' || result from public.update_post('${postId}', ${version}, '${title}');`;
    const remove = (postId, version) => `select 'RESULT:' || result from public.delete_post('${postId}', ${version});`;
    const expectOk = (run, label) => assert.equal(run.code, 0, `${label}: psql 실패 ${run.stderr}`);
    /** 잠금을 쥔 접속이 정말 pg_sleep(seconds) 중일 때까지 기다린다(시간을 추측하지 않는다). 그때 이미 그 접속의 UPDATE/DELETE는 끝나 있다. */
    const untilSleeping = async (seconds) => {
        for (let i = 0; i < 400; i += 1) {
            const n = Number((await admin(`select count(*) from pg_stat_activity where pid <> pg_backend_pid() and state = 'active' and query like '%pg_sleep(${seconds})%';`)).trim());
            if (n > 0) return;
            await sleep(25);
        }
        throw new Error(`pg_sleep(${seconds})을 실행 중인 접속이 나타나지 않았다`);
    };

    // 준비(COMMIT): 사용자 A·B와 글
    await admin(`
        insert into auth.users (id, email) values ('${USER_A}', 'a@example.test'), ('${USER_B}', 'b@example.test');
        insert into public.profiles (id, nickname) values ('${USER_A}', '앨리스'), ('${USER_B}', 'Bob');
        insert into public.posts (author_id, title, body)
            select '${USER_A}', 'race-' || n, '본문' from generate_series(1, 20) as n;`);
    const idsByTitle = {};
    for (const line of (await admin(`select title || ' ' || id from public.posts where title like 'race-%';`)).split(/\r?\n/).filter(Boolean)) {
        const [title, id] = line.trim().split(' ');
        idsByTitle[title] = id;
    }
    assert.equal(Object.keys(idsByTitle).length, 20);
    const postState = async (id) => (await admin(`select version || '|' || title from public.posts where id = '${id}';`)).trim();
    const postCount = async (id) => Number((await admin(`select count(*) from public.posts where id = '${id}';`)).trim());

    // ---------------------------------------------------------------------------------------
    // 1. 행 잠금을 쥔 수정 하나와, 같은 version으로 그 잠금을 기다리는 수정 셋
    // ---------------------------------------------------------------------------------------
    {
        const id = idsByTitle['race-1'];
        const holder = session(asUser(USER_A, `${update(id, 1, 'holder')}\nselect pg_sleep(1.5);`));
        await untilSleeping('1.5'); // 잠금을 쥔 채 자고 있는 동안 도착하게 한다
        const waiters = [1, 2, 3].map((n) => session(asUser(USER_A, update(id, 1, `waiter-${n}`))));
        const [h, ...w] = await Promise.all([holder, ...waiters]);
        expectOk(h, '잠금 보유자');
        w.forEach((run, i) => expectOk(run, `기다린 요청 ${i + 1}`));
        assert.deepEqual(results(h), ['ok'], '먼저 잠금을 얻은 요청은 ok');
        pass('같은 version 4개 중 잠금을 먼저 얻은 요청만 ok');
        for (const run of w) assert.deepEqual(results(run), ['version_conflict'], '기다린 요청은 version_conflict');
        pass('같은 version으로 기다린 3개 요청은 모두 version_conflict(잠금이 풀린 뒤 바뀐 version으로 다시 평가)');
        for (const run of w) assert.ok(run.ms >= 700, `기다린 요청이 잠금을 기다리지 않고 끝났다(${run.ms}ms)`);
        pass('기다린 요청은 실제로 잠금이 풀릴 때까지 대기했다(700ms 이상)');
        assert.equal(await postState(id), '2|holder');
        pass('최종 상태: version 2, 먼저 성공한 요청의 제목');
    }

    // ---------------------------------------------------------------------------------------
    // 2. 같은 version으로 8개 접속이 동시에 수정 (여러 번 반복)
    // ---------------------------------------------------------------------------------------
    {
        let rounds = 0;
        for (let round = 2; round <= 7; round += 1) {
            const id = idsByTitle[`race-${round}`];
            const runs = await Promise.all(Array.from({ length: 8 }, (_, n) => session(asUser(USER_A, update(id, 1, `racer-${n}`)))));
            runs.forEach((run, i) => expectOk(run, `경쟁 ${round}-${i}`));
            const outcomes = runs.flatMap(results);
            assert.equal(outcomes.length, 8, '모든 요청이 결과를 한 줄씩 돌려준다');
            assert.equal(outcomes.filter((x) => x === 'ok').length, 1, `정확히 하나만 ok여야 한다: ${outcomes.join(',')}`);
            assert.equal(outcomes.filter((x) => x === 'version_conflict').length, 7, `나머지는 version_conflict여야 한다: ${outcomes.join(',')}`);
            const winner = runs.findIndex((run) => results(run)[0] === 'ok');
            assert.equal(await postState(id), `2|racer-${winner}`, '최종 version은 2이고 제목은 성공한 요청의 것이다');
            rounds += 1;
        }
        pass(`동시에 8개 접속이 같은 version으로 수정: ${rounds}번 반복 모두 정확히 하나만 ok, version은 한 번만 올랐다`);
    }

    // ---------------------------------------------------------------------------------------
    // 3. 수정과 삭제가 같은 version으로 겹칠 때
    // ---------------------------------------------------------------------------------------
    {
        const id = idsByTitle['race-8'];
        const holder = session(asUser(USER_A, `${remove(id, 1)}\nselect pg_sleep(1.21);`));
        await untilSleeping('1.21');
        const waiter = session(asUser(USER_A, update(id, 1, 'late-update')));
        const [h, w] = await Promise.all([holder, waiter]);
        expectOk(h, '삭제');
        expectOk(w, '기다린 수정');
        assert.deepEqual(results(h), ['ok']);
        assert.deepEqual(results(w), ['not_found'], '삭제가 끝난 뒤 수정은 not_found');
        assert.equal(await postCount(id), 0);
        pass('삭제가 잠금을 쥔 동안 같은 version으로 수정을 기다리면, 삭제가 끝난 뒤 not_found');
    }
    {
        const id = idsByTitle['race-9'];
        const holder = session(asUser(USER_A, `${update(id, 1, 'first-update')}\nselect pg_sleep(1.22);`));
        await untilSleeping('1.22');
        const waiter = session(asUser(USER_A, remove(id, 1)));
        const [h, w] = await Promise.all([holder, waiter]);
        expectOk(h, '수정');
        expectOk(w, '기다린 삭제');
        assert.deepEqual(results(h), ['ok']);
        assert.deepEqual(results(w), ['version_conflict'], '수정이 끝난 뒤 오래된 version의 삭제는 version_conflict');
        assert.equal(await postState(id), '2|first-update');
        pass('수정이 잠금을 쥔 동안 같은 version으로 삭제를 기다리면, 수정이 끝난 뒤 version_conflict이고 글은 남는다');
    }

    // ---------------------------------------------------------------------------------------
    // 4. 남의 요청과 삭제 경쟁
    // ---------------------------------------------------------------------------------------
    {
        const id = idsByTitle['race-10'];
        const holder = session(asUser(USER_A, `${update(id, 1, 'owner-update')}\nselect pg_sleep(1.23);`));
        await untilSleeping('1.23');
        const other = session(asUser(USER_B, `${update(id, 1, 'intruder')}\n${remove(id, 1)}`));
        const [h, o] = await Promise.all([holder, other]);
        expectOk(h, '소유자 수정');
        expectOk(o, '남의 요청');
        assert.deepEqual(results(h), ['ok']);
        assert.deepEqual(results(o), ['forbidden', 'forbidden'], 'B의 수정·삭제는 version이 맞아도 forbidden');
        assert.equal(await postState(id), '2|owner-update');
        pass('소유자가 수정하는 동안 B가 같은 version으로 수정·삭제를 시도해도 forbidden이고 글은 소유자가 바꾼 대로다');
    }
    {
        // 10개 접속이 같은 글을 동시에 삭제: 정확히 하나만 ok, 나머지는 not_found
        const id = idsByTitle['race-11'];
        const runs = await Promise.all(Array.from({ length: 10 }, () => session(asUser(USER_A, remove(id, 1)))));
        runs.forEach((run, i) => expectOk(run, `동시 삭제 ${i}`));
        const outcomes = runs.flatMap(results);
        assert.equal(outcomes.filter((x) => x === 'ok').length, 1, `삭제 ok는 정확히 하나: ${outcomes.join(',')}`);
        assert.equal(outcomes.filter((x) => x === 'not_found').length, 9, `나머지는 not_found: ${outcomes.join(',')}`);
        assert.equal(await postCount(id), 0);
        pass('같은 글을 10개 접속이 동시에 삭제: 정확히 하나만 ok, 나머지는 not_found');
    }

    return checks;
}
