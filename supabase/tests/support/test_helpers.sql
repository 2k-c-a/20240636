-- 테스트 공통 도구. rls.sql과 post_mutations.sql이 트랜잭션 안에서 \ir로 불러 쓰며, 트랜잭션을 롤백하면 함께 사라진다.
--
-- 모든 검사는 "실제 역할로 전환한 뒤" 실행한다(SET ROLE). 테스트를 돌리는 접속은 관리자(테이블 소유자) 권한이라 그대로 실행하면 모든 것이 성공하므로,
-- 전환이 실제로 되었는지(current_user)를 매번 확인하고 문장이 끝나면 되돌린다. 성공·실패는 NOTICE 'ok - ...'와 예외 'FAIL - ...'로 알린다.
-- 이 도구는 SECURITY INVOKER라 전환한 역할의 권한으로 문장이 실행된다.

do $$
begin
    if coalesce(obj_description(to_regnamespace('auth'), 'pg_namespace'), '') <> 'LOCAL_TEST_SHIM' then
        raise exception '이 테스트는 supabase/tests/support/local_supabase_shim.sql을 적용한 로컬 PostgreSQL에서만 실행합니다. 실제 Supabase의 auth.users를 만들거나 지우지 않기 위해 중단합니다.';
    end if;
end;
$$;

create schema t;
grant usage on schema t to anon, authenticated, service_role;

-- 값 비교. NULL끼리는 같다.
create function t.eq(actual text, expected text, label text)
returns void
language plpgsql
as $$
begin
    if actual is not distinct from expected then
        raise notice 'ok - %', label;
    else
        raise exception 'FAIL - %: 기대 [%], 실제 [%]', label, expected, actual;
    end if;
end;
$$;

-- 역할 전환: role을 바꾸고 JWT claim(sub)을 설정한다. uid가 null이면 로그인하지 않은 상태다.
create function t.enter(r text, uid uuid)
returns void
language plpgsql
as $$
begin
    perform set_config('request.jwt.claims', case when uid is null then '' else json_build_object('sub', uid, 'role', r)::text end, true);
    perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
    perform set_config('role', r, true);
    if current_user::text <> r then
        raise exception 'FAIL - 역할 전환이 되지 않았다: 기대 %, 실제 %', r, current_user;
    end if;
end;
$$;

-- 문장을 role로 실행하고 결과가 expected인지 본다. expected는 'ok'(성공), 기대하는 SQLSTATE(예: 42501), 또는
-- 'SQLSTATE:이름'(예: 23514:posts_title_length)이다. 이름을 붙이면 오류 메시지에 그 제약 이름이 들어 있어야 한다
-- (같은 값이 여러 제약에 걸릴 때 "엉뚱한 제약이 대신 막아 주는 것"을 구분하려는 것이다. CHECK는 이름 순으로 평가된다).
create function t.run(r text, uid uuid, stmt text, expected text, label text)
returns void
language plpgsql
as $$
declare
    got text := 'ok';
    msg text := '';
    want_state text := split_part(expected, ':', 1);
    want_name text := nullif(substr(expected, length(split_part(expected, ':', 1)) + 2), '');
begin
    perform t.enter(r, uid);
    begin
        execute stmt;
    exception when others then
        got := sqlstate;
        msg := sqlerrm;
    end;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    if got = want_state and (want_name is null or position(want_name in msg) > 0) then
        raise notice 'ok - %', label;
    else
        raise exception 'FAIL - %: 기대 %, 실제 % (%)', label, expected, got, msg;
    end if;
end;
$$;

-- DML을 role로 실행하고 영향받은 행 수가 expected_rows인지 본다(RLS가 행을 숨기면 0이 된다). 오류가 나면 실패다.
create function t.rows(r text, uid uuid, stmt text, expected_rows integer, label text)
returns void
language plpgsql
as $$
declare
    n bigint := -1;
    failure text := null;
begin
    perform t.enter(r, uid);
    begin
        execute stmt;
        get diagnostics n = row_count;
    exception when others then
        failure := sqlstate || ' ' || sqlerrm;
    end;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    if failure is not null then
        raise exception 'FAIL - %: 오류가 났다 (%)', label, failure;
    end if;
    perform t.eq(n::text, expected_rows::text, label);
end;
$$;

-- 한 값을 돌려주는 SELECT를 role로 실행하고 text로 비교한다.
create function t.val(r text, uid uuid, query text, expected text, label text)
returns void
language plpgsql
as $$
declare
    got text;
    failure text := null;
begin
    perform t.enter(r, uid);
    begin
        execute query into got;
    exception when others then
        failure := sqlstate || ' ' || sqlerrm;
    end;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    if failure is not null then
        raise exception 'FAIL - %: 오류가 났다 (%)', label, failure;
    end if;
    perform t.eq(got, expected, label);
end;
$$;

-- 행 수를 role로 센다(RLS가 보이는 행만 센다).
create function t.count(r text, uid uuid, query text, expected_count integer, label text)
returns void
language plpgsql
as $$
begin
    perform t.val(r, uid, 'select count(*) from (' || query || ') as q', expected_count::text, label);
end;
$$;

-- 닉네임 규칙 시험용 사용자 id: t.eid(1) ...
create function t.eid(n integer)
returns uuid
language sql
immutable
as $$ select ('e0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
