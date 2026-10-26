-- RLS·권한·제약·트리거 테스트 (psql로 실행: 실행 방법은 supabase/README.md).
-- 비회원(anon) / 회원 A / 회원 B / 프로필 없는 회원 C / 관리자(service_role)를 "실제 역할로 전환해서" 확인한다.
-- 모든 변경은 하나의 트랜잭션 안에서 이루어지고 마지막에 ROLLBACK 한다. 성공한 검사는 'ok - ...'를 출력하고 실패하면 즉시 중단한다.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
\set uid_a 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
\set uid_b 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
\set uid_c 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

begin;
\ir support/test_helpers.sql

-- 준비(관리자): 사용자 A·B(프로필 있음), C(프로필 없음), 닉네임 규칙 시험용 E1~E24(프로필 없음)
insert into auth.users (id, email) values
    (:'uid_a', 'a@example.test'), (:'uid_b', 'b@example.test'), (:'uid_c', 'c@example.test');
insert into auth.users (id, email) select t.eid(n), 'e' || n || '@example.test' from generate_series(1, 24) as n;
insert into public.profiles (id, nickname) values (:'uid_a', '앨리스'), (:'uid_b', 'Bob');
select t.eq((select count(*) from public.profiles)::text, '2', '준비: 프로필 2개');

-- =============================================================================================
-- 1. 구조 점검: RLS·정책·권한·트리거 함수 (관리자 접속으로 카탈로그를 읽는다)
-- =============================================================================================
select t.eq((select relrowsecurity::text from pg_class where oid = 'public.profiles'::regclass), 'true', '구조: profiles RLS 켜짐');
select t.eq((select relrowsecurity::text from pg_class where oid = 'public.posts'::regclass), 'true', '구조: posts RLS 켜짐');
select t.eq((select string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, ','), ' | ' order by policyname)
               from pg_policies where schemaname = 'public' and tablename = 'profiles'),
            'profiles_insert_own:INSERT:authenticated | profiles_select_own:SELECT:authenticated | profiles_update_own:UPDATE:authenticated',
            '구조: profiles 정책은 본인 조회·생성·수정뿐이다(삭제 정책 없음, anon 정책 없음)');
select t.eq((select string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, ','), ' | ' order by policyname)
               from pg_policies where schemaname = 'public' and tablename = 'posts'),
            'posts_delete_own:DELETE:authenticated | posts_insert_own:INSERT:authenticated | posts_select_public:SELECT:anon,authenticated | posts_update_own:UPDATE:authenticated',
            '구조: posts 정책');

-- 인덱스: 목록 정렬(created_at DESC, id DESC)과 작성자·알고리즘 필터
select t.eq((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'posts_created_at_id_idx'),
            'CREATE INDEX posts_created_at_id_idx ON public.posts USING btree (created_at DESC, id DESC)', '구조: 최신순 목록 인덱스');
select t.eq((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'posts_author_created_at_id_idx'),
            'CREATE INDEX posts_author_created_at_id_idx ON public.posts USING btree (author_id, created_at DESC, id DESC)', '구조: 작성자별 목록 인덱스');
select t.eq((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'posts_algorithm_created_at_id_idx'),
            'CREATE INDEX posts_algorithm_created_at_id_idx ON public.posts USING btree (algorithm_id, created_at DESC, id DESC)', '구조: 알고리즘별 목록 인덱스');

-- 트리거 함수: SECURITY INVOKER(호출자 권한으로 실행), search_path 고정
do $$
declare
    f text;
begin
    foreach f in array array['public.profiles_guard()', 'public.posts_guard_insert()', 'public.posts_guard_update()'] loop
        perform t.eq((select prosecdef::text from pg_proc where oid = f::regprocedure), 'false', '구조: ' || f || '는 SECURITY INVOKER');
        perform t.eq((select (proconfig @> array['search_path=""'])::text from pg_proc where oid = f::regprocedure), 'true', '구조: ' || f || '는 search_path를 비워 고정한다');
    end loop;
end;
$$;

-- 표 권한(anon·authenticated). 기본 권한이 모두 주어진 상태에서 migration이 회수했는지 확인한다.
do $$
declare
    r record;
    privs text[] := array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'];
    p text;
    want boolean;
begin
    for r in select * from (values
        ('anon', 'profiles', array[]::text[]),
        ('anon', 'posts', array['select']),
        ('authenticated', 'profiles', array['select']),
        ('authenticated', 'posts', array['select', 'delete'])
    ) as v(role_name, table_name, allowed) loop
        foreach p in array privs loop
            want := p = any (r.allowed);
            perform t.eq(has_table_privilege(r.role_name, 'public.' || r.table_name, p)::text, want::text,
                         format('권한: %s의 %s 테이블 %s = %s', r.role_name, r.table_name, p, want));
        end loop;
    end loop;
end;
$$;

-- 컬럼 권한: 쓸 수 있는 컬럼만 true
do $$
declare
    r record;
begin
    for r in select * from (values
        ('profiles', 'id', 'insert', true), ('profiles', 'nickname', 'insert', true),
        ('profiles', 'created_at', 'insert', false), ('profiles', 'updated_at', 'insert', false),
        ('profiles', 'nickname', 'update', true), ('profiles', 'id', 'update', false),
        ('profiles', 'created_at', 'update', false), ('profiles', 'updated_at', 'update', false),
        ('posts', 'author_id', 'insert', true), ('posts', 'title', 'insert', true), ('posts', 'body', 'insert', true),
        ('posts', 'algorithm_id', 'insert', true),
        ('posts', 'id', 'insert', false), ('posts', 'author_display_name', 'insert', false), ('posts', 'version', 'insert', false),
        ('posts', 'created_at', 'insert', false), ('posts', 'updated_at', 'insert', false),
        ('posts', 'title', 'update', true), ('posts', 'body', 'update', true), ('posts', 'algorithm_id', 'update', true),
        ('posts', 'id', 'update', false), ('posts', 'author_id', 'update', false), ('posts', 'author_display_name', 'update', false),
        ('posts', 'version', 'update', false), ('posts', 'created_at', 'update', false), ('posts', 'updated_at', 'update', false)
    ) as v(table_name, column_name, priv, want) loop
        perform t.eq(has_column_privilege('authenticated', 'public.' || r.table_name, r.column_name, r.priv)::text, r.want::text,
                     format('권한: authenticated의 %s.%s %s = %s', r.table_name, r.column_name, r.priv, r.want));
        perform t.eq(has_column_privilege('anon', 'public.' || r.table_name, r.column_name, r.priv)::text, 'false',
                     format('권한: anon의 %s.%s %s = false', r.table_name, r.column_name, r.priv));
    end loop;
end;
$$;

-- 트리거 함수는 사용자 역할이 직접 실행할 수 없다(PUBLIC 포함).
do $$
declare
    f text;
begin
    foreach f in array array['public.profiles_guard()', 'public.posts_guard_insert()', 'public.posts_guard_update()'] loop
        perform t.eq(has_function_privilege('anon', f, 'execute')::text, 'false', '권한: anon은 ' || f || ' 실행 불가');
        perform t.eq(has_function_privilege('authenticated', f, 'execute')::text, 'false', '권한: authenticated는 ' || f || ' 실행 불가');
        perform t.eq((select count(*) from aclexplode((select proacl from pg_proc where oid = f::regprocedure)) where grantee = 0)::text,
                     '0', '권한: PUBLIC은 ' || f || ' 실행 불가');
    end loop;
end;
$$;

-- =============================================================================================
-- 2. 비회원(anon)
-- =============================================================================================
select t.run('anon', null, 'select * from public.profiles', '42501', 'anon: 프로필 조회 거부');
select t.run('anon', null, format('insert into public.profiles (id, nickname) values (%L, %L)', t.eid(1), 'anon-nick'), '42501', 'anon: 프로필 생성 거부');
select t.run('anon', null, format('update public.profiles set nickname = %L', 'x-nick'), '42501', 'anon: 프로필 수정 거부');
select t.run('anon', null, 'delete from public.profiles', '42501', 'anon: 프로필 삭제 거부');
select t.run('anon', null, format('insert into public.posts (author_id, title, body) values (%L, %L, %L)', :'uid_a', '제목', '본문'), '42501', 'anon: 글 작성 거부');
select t.run('anon', null, format('update public.posts set title = %L', 'x'), '42501', 'anon: 글 수정 거부');
select t.run('anon', null, 'delete from public.posts', '42501', 'anon: 글 삭제 거부');

-- =============================================================================================
-- 3. profiles (회원 A·B·C)
-- =============================================================================================
select t.count('authenticated', :'uid_a', 'select 1 from public.profiles', 1, 'A: 프로필 조회는 본인 것 하나뿐이다(B의 프로필이 있어도)');
select t.count('authenticated', :'uid_a', format('select 1 from public.profiles where id = %L', :'uid_b'), 0, 'A: B의 프로필은 id로 지정해도 보이지 않는다');
select t.count('authenticated', :'uid_b', 'select 1 from public.profiles', 1, 'B: 본인 프로필 하나뿐이다');
select t.count('authenticated', :'uid_c', 'select 1 from public.profiles', 0, 'C: 프로필이 없으면 하나도 보이지 않는다');
select t.count('postgres', null, 'select 1 from public.profiles', 2, '대조: 관리자 접속은 프로필 2개가 모두 보인다(사용자 권한 테스트와 구분)');

-- insert-if-absent: 이미 있으면 닉네임을 덮어쓰지 않는다
select t.rows('authenticated', :'uid_a', format('insert into public.profiles (id, nickname) values (%L, %L) on conflict (id) do nothing', :'uid_a', '덮어쓰기시도'), 0,
              'A: 이미 있는 프로필에 insert ... on conflict do nothing은 0행이다');
select t.eq((select nickname from public.profiles where id = :'uid_a'), '앨리스', 'A: 닉네임이 덮어써지지 않았다');
select t.run('authenticated', :'uid_a', format('insert into public.profiles (id, nickname) values (%L, %L)', :'uid_a', '다시만들기'), '23505', 'A: 이미 있는 프로필을 그냥 insert하면 중복 오류다');

-- 남의 id로 만들기, 다른 컬럼 지정하기
select t.run('authenticated', :'uid_c', format('insert into public.profiles (id, nickname) values (%L, %L)', :'uid_b', '남의프로필'), '42501', 'C: 남의 id로 프로필을 만들 수 없다(RLS)');
select t.run('authenticated', :'uid_c', format('insert into public.profiles (id, nickname, created_at) values (%L, %L, %L)', :'uid_c', '시각조작', '2000-01-01'), '42501', 'C: created_at을 지정할 수 없다(컬럼 권한)');
select t.run('authenticated', :'uid_c', format('insert into public.profiles (id, nickname, updated_at) values (%L, %L, %L)', :'uid_c', '시각조작', '2000-01-01'), '42501', 'C: updated_at을 지정할 수 없다(컬럼 권한)');
select t.run('authenticated', :'uid_c', format('insert into public.profiles (id, nickname) values (%L, %L)', :'uid_c', '씨엘'), 'ok', 'C: 프로필 만들기 성공(2자)');
select t.eq((select (created_at = updated_at)::text from public.profiles where id = :'uid_c'), 'true', 'C: 만든 시각과 수정 시각은 같다');
select t.eq((select (created_at > now() - interval '1 minute' and created_at <= clock_timestamp())::text from public.profiles where id = :'uid_c'), 'true', 'C: 만든 시각은 DB가 정했다');

-- 닉네임 규칙(사용자 E1~E24가 각자 자기 프로필을 만든다)
select t.run('authenticated', t.eid(1), format('insert into public.profiles (id, nickname) values (%L, %L)', t.eid(1), '가'), '23514:profiles_nickname_length', '닉네임: 1자는 거부');
select t.run('authenticated', t.eid(2), format('insert into public.profiles (id, nickname) values (%L, %L)', t.eid(2), repeat('가', 21)), '23514:profiles_nickname_length', '닉네임: 21자는 거부');
select t.run('authenticated', t.eid(3), format('insert into public.profiles (id, nickname) values (%L, %L)', t.eid(3), ' ab'), '23514:profiles_nickname_trimmed', '닉네임: 앞 공백 거부');
select t.run('authenticated', t.eid(4), format('insert into public.profiles (id, nickname) values (%L, %L)', t.eid(4), 'ab '), '23514:profiles_nickname_trimmed', '닉네임: 뒤 공백 거부');
select t.run('authenticated', t.eid(5), format('insert into public.profiles (id, nickname) values (%L, %L)', t.eid(5), E'ab\u3000'), '23514:profiles_nickname_trimmed', '닉네임: 뒤 전각 공백(U+3000) 거부');
select t.run('authenticated', t.eid(6), format('insert into public.profiles (id, nickname) values (%L, %L)', t.eid(6), E'a\nb'), '23514:profiles_nickname_no_control', '닉네임: 줄바꿈(제어 문자) 거부');
select t.run('authenticated', t.eid(7), format('insert into public.profiles (id, nickname) values (%L, %L)', t.eid(7), E'a\tb'), '23514:profiles_nickname_no_control', '닉네임: 탭(제어 문자) 거부');
select t.run('authenticated', t.eid(8), format('insert into public.profiles (id, nickname) values (%L, %L)', t.eid(8), 'a' || chr(127) || 'b'), '23514:profiles_nickname_no_control', '닉네임: DEL(U+007F) 거부');
select t.run('authenticated', t.eid(9), format('insert into public.profiles (id, nickname) values (%L, %L)', t.eid(9), '  '), '23514:profiles_nickname_trimmed', '닉네임: 공백만 거부');
select t.run('authenticated', t.eid(10), format('insert into public.profiles (id, nickname) values (%L, %L)', t.eid(10), ''), '23514:profiles_nickname_length', '닉네임: 빈 문자열 거부');
select t.run('authenticated', t.eid(11), format('insert into public.profiles (id, nickname) values (%L, %L)', t.eid(11), null), '23502', '닉네임: null 거부');
select t.run('authenticated', t.eid(12), format('insert into public.profiles (id, nickname) values (%L, %L)', t.eid(12), 'ab'), 'ok', '닉네임: 2자 허용');
select t.run('authenticated', t.eid(13), format('insert into public.profiles (id, nickname) values (%L, %L)', t.eid(13), repeat('가', 20)), 'ok', '닉네임: 한글 20자 허용');
select t.run('authenticated', t.eid(14), format('insert into public.profiles (id, nickname) values (%L, %L)', t.eid(14), repeat(E'\U0001F600', 20)), 'ok', '닉네임: 이모지 20개(글자 수 20) 허용');
select t.run('authenticated', t.eid(15), format('insert into public.profiles (id, nickname) values (%L, %L)', t.eid(15), repeat(E'\U0001F600', 21)), '23514:profiles_nickname_length', '닉네임: 이모지 21개 거부');
select t.run('authenticated', t.eid(16), format('insert into public.profiles (id, nickname) values (%L, %L)', t.eid(16), 'a b'), 'ok', '닉네임: 가운데 공백 허용');
select t.run('authenticated', t.eid(17), format('insert into public.profiles (id, nickname) values (%L, %L)', t.eid(17), '앨리스'), 'ok', '닉네임: 다른 사람과 같은 닉네임 허용(중복 허용)');
select t.run('authenticated', t.eid(18), format('insert into public.profiles (id, nickname) values (%L, %L)', t.eid(18), E'a\u00a0b'), 'ok', '닉네임: 가운데 NBSP 허용');
select t.run('authenticated', t.eid(19), format('insert into public.profiles (id, nickname) values (%L, %L)', t.eid(19), E'\u00a0ab'), '23514:profiles_nickname_trimmed', '닉네임: 앞 NBSP 거부');
select t.run('authenticated', t.eid(20), format('insert into public.profiles (id, nickname) values (%L, %L)', t.eid(20), E'ab\u0085'), '23514:profiles_nickname_trimmed', '닉네임: 뒤 NEL(U+0085) 거부');

-- 수정: 닉네임만, 본인 것만
select t.rows('authenticated', :'uid_a', format('update public.profiles set nickname = %L where id = %L', '앨리스2', :'uid_a'), 1, 'A: 본인 닉네임 수정 1행');
select t.eq((select nickname from public.profiles where id = :'uid_a'), '앨리스2', 'A: 닉네임이 바뀌었다');
select t.eq((select (updated_at > created_at)::text from public.profiles where id = :'uid_a'), 'true', 'A: 수정하면 updated_at이 created_at보다 늦다');
select t.rows('authenticated', :'uid_a', format('update public.profiles set nickname = %L where id = %L', '해킹', :'uid_b'), 0, 'A: B의 프로필 수정은 0행(RLS)');
select t.eq((select nickname from public.profiles where id = :'uid_b'), 'Bob', 'B의 닉네임은 그대로다');
select t.run('authenticated', :'uid_a', format('update public.profiles set nickname = %L', 'x'), '23514:profiles_nickname_length', 'A: 1자 닉네임으로 수정 거부');
select t.run('authenticated', :'uid_a', format('update public.profiles set id = %L', :'uid_b'), '42501', 'A: 프로필 id 변경 거부(컬럼 권한)');
select t.run('authenticated', :'uid_a', format('update public.profiles set created_at = %L', '2000-01-01'), '42501', 'A: created_at 변경 거부(컬럼 권한)');
select t.run('authenticated', :'uid_a', format('update public.profiles set updated_at = %L', '2000-01-01'), '42501', 'A: updated_at 변경 거부(컬럼 권한)');
select t.run('authenticated', :'uid_a', 'delete from public.profiles', '42501', 'A: 프로필 삭제 거부(삭제 권한 없음)');
select t.run('authenticated', :'uid_a', format('update public.profiles set nickname = %L where id = %L', '앨리스', :'uid_a'), 'ok', 'A: 닉네임을 다시 되돌린다');

-- 관리자(service_role)는 RLS를 우회하지만 트리거는 그대로 지킨다
select t.count('service_role', null, 'select 1 from public.profiles', 9, '관리자(service_role): RLS를 우회해 모든 프로필(A·B·C와 E 6명)이 보인다');
select t.run('service_role', null, format('update public.profiles set id = %L where id = %L', t.eid(21), :'uid_c'), '23514', '관리자: 프로필 id 변경도 트리거가 거부한다');
select t.run('service_role', null, format('update public.profiles set created_at = %L where id = %L', '2000-01-01', :'uid_c'), '23514', '관리자: 프로필 created_at 변경도 트리거가 거부한다');

-- =============================================================================================
-- 3b. 공백 정의(29자) 표 시험. 공백은 Python str.strip()이 지우는 문자와 같은 집합이다(docs/CONTRACTS.md §10.1).
--     닉네임·제목은 앞뒤에 오면 거부, 본문은 그 문자만 있으면 거부, 가운데·본문 앞뒤에서는 허용한다.
--     이 구간의 변경은 SAVEPOINT로 되돌려 이후 검사에 영향을 주지 않는다.
-- =============================================================================================
savepoint whitespace_table;
insert into auth.users (id, email) select t.eid(n), 'w' || n || '@example.test' from generate_series(100, 160) as n;
select set_config('t.uid_a', :'uid_a', true);
do $$
declare
    codes integer[] := array[9, 10, 11, 12, 13, 28, 29, 30, 31, 32, 133, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288];
    cp integer;
    ch text;
    next_user integer := 100;
    uid_a uuid := current_setting('t.uid_a')::uuid;
    nick_reject text;
    who text;
begin
    perform t.eq(array_length(codes, 1)::text, '29', '공백 표: Python isspace 문자는 29개');
    foreach cp in array codes loop
        ch := chr(cp);
        who := '공백 U+' || upper(lpad(to_hex(cp), 4, '0'));
        -- 제어 문자(U+0000~U+001F)는 닉네임에서 no_control 제약이 먼저(이름 순) 걸린다.
        nick_reject := case when cp <= 31 then '23514:profiles_nickname_no_control' else '23514:profiles_nickname_trimmed' end;
        perform t.run('authenticated', t.eid(100), format('insert into public.profiles (id, nickname) values (%L, %L)', t.eid(100), ch || 'ab'), nick_reject, who || ': 닉네임 앞에 오면 거부');
        perform t.run('authenticated', t.eid(100), format('insert into public.profiles (id, nickname) values (%L, %L)', t.eid(100), 'ab' || ch), nick_reject, who || ': 닉네임 뒤에 오면 거부');
        perform t.run('authenticated', uid_a, format($f$insert into public.posts (author_id, title, body) values (%L, %L, '본문')$f$, uid_a, ch || '제목'), '23514:posts_title_trimmed', who || ': 제목 앞에 오면 거부');
        perform t.run('authenticated', uid_a, format($f$insert into public.posts (author_id, title, body) values (%L, %L, '본문')$f$, uid_a, '제목' || ch), '23514:posts_title_trimmed', who || ': 제목 뒤에 오면 거부');
        perform t.run('authenticated', uid_a, format($f$insert into public.posts (author_id, title, body) values (%L, '제목', %L)$f$, uid_a, ch), '23514:posts_body_not_blank', who || ': 본문이 그 문자 하나뿐이면 거부');
        perform t.run('authenticated', uid_a, format($f$insert into public.posts (author_id, title, body) values (%L, '제목', %L)$f$, uid_a, ch || ch || ch), '23514:posts_body_not_blank', who || ': 본문이 그 문자만 여럿이면 거부');
        perform t.run('authenticated', uid_a, format($f$insert into public.posts (author_id, title, body) values (%L, '제목', %L)$f$, uid_a, ch || '본문' || ch), 'ok', who || ': 본문 앞뒤에 있어도 글자가 있으면 허용');
        perform t.run('authenticated', uid_a, format($f$insert into public.posts (author_id, title, body) values (%L, %L, '본문')$f$, uid_a, '가' || ch || '나'), 'ok', who || ': 제목 가운데는 허용');
        if cp > 31 then
            next_user := next_user + 1;
            perform t.run('authenticated', t.eid(next_user), format('insert into public.profiles (id, nickname) values (%L, %L)', t.eid(next_user), 'a' || ch || 'b'), 'ok', who || ': 닉네임 가운데는 허용');
        end if;
    end loop;
    -- 공백이 아닌 보이지 않는 문자(U+200B, 폭 없는 공백)는 공백 정의에 없으므로 허용한다(Python isspace도 False).
    perform t.run('authenticated', t.eid(160), format('insert into public.profiles (id, nickname) values (%L, %L)', t.eid(160), chr(8203) || 'ab'), 'ok', '공백 정의 밖: U+200B는 닉네임 앞에 와도 허용');
end;
$$;
rollback to savepoint whitespace_table;

-- =============================================================================================
-- 4. posts 작성
-- =============================================================================================
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body, algorithm_id) values (%L, 'A의 첫 글', E'본문\n둘째 줄', 'bfs')$q$, :'uid_a'), 'ok', 'A: 글 작성 성공');
select id as post_a1 from public.posts where title = 'A의 첫 글' \gset
select t.eq((select version::text from public.posts where id = :'post_a1'), '1', '작성: version은 1이다');
select t.eq((select author_display_name from public.posts where id = :'post_a1'), '앨리스', '작성: 표시명은 프로필의 닉네임에서 복사된다');
select t.eq((select (created_at = updated_at)::text from public.posts where id = :'post_a1'), 'true', '작성: created_at과 updated_at이 같다');
select t.eq((select (author_id::text) from public.posts where id = :'post_a1'), :'uid_a', '작성: author_id는 A다');

-- 다른 사람 명의·프로필 없음
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body) values (%L, '가짜', '본문')$q$, :'uid_b'), 'P0001', 'A: B의 id로 글을 쓸 수 없다(A에게는 B의 프로필이 보이지 않아 프로필 없음으로 거부)');
select t.run('authenticated', :'uid_c', format($q$insert into public.posts (author_id, title, body) values (%L, '제목', '본문')$q$, :'uid_c'), 'ok', 'C: 프로필을 만든 뒤라 글 작성 성공');
select t.run('authenticated', t.eid(22), format($q$insert into public.posts (author_id, title, body) values (%L, '제목', '본문')$q$, t.eid(22)), 'P0001', '프로필 없는 회원 E22: 글 작성 거부(profile_required)');
select t.val('authenticated', t.eid(22), format($q$select 1 from public.posts where author_id = %L$q$, t.eid(22)), null, 'E22: 거부된 글이 저장되지 않았다');

-- 사용자가 정할 수 없는 컬럼
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body, version) values (%L, '제목', '본문', 99)$q$, :'uid_a'), '42501', 'A: version 지정 거부');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body, author_display_name) values (%L, '제목', '본문', '위조')$q$, :'uid_a'), '42501', 'A: author_display_name 지정 거부');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body, created_at) values (%L, '제목', '본문', '2000-01-01')$q$, :'uid_a'), '42501', 'A: created_at 지정 거부');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body, updated_at) values (%L, '제목', '본문', '2000-01-01')$q$, :'uid_a'), '42501', 'A: updated_at 지정 거부');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (id, author_id, title, body) values (%L, %L, '제목', '본문')$q$, gen_random_uuid(), :'uid_a'), '42501', 'A: id 지정 거부');

-- 제목·본문·알고리즘 ID 규칙
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body) values (%L, %L, '본문')$q$, :'uid_a', ''), '23514:posts_title_length', '제목: 빈 문자열 거부');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body) values (%L, %L, '본문')$q$, :'uid_a', '  '), '23514:posts_title_trimmed', '제목: 공백만 거부');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body) values (%L, %L, '본문')$q$, :'uid_a', ' 제목'), '23514:posts_title_trimmed', '제목: 앞 공백 거부');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body) values (%L, %L, '본문')$q$, :'uid_a', E'제목\n'), '23514:posts_title_trimmed', '제목: 뒤 줄바꿈 거부');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body) values (%L, %L, '본문')$q$, :'uid_a', E'제목\u3000'), '23514:posts_title_trimmed', '제목: 뒤 전각 공백 거부');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body) values (%L, %L, '본문')$q$, :'uid_a', repeat('가', 101)), '23514:posts_title_length', '제목: 101자 거부');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body) values (%L, %L, '본문')$q$, :'uid_a', repeat('가', 100)), 'ok', '제목: 100자 허용');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body) values (%L, %L, '본문')$q$, :'uid_a', E'가운데\n줄바꿈'), 'ok', '제목: 가운데 줄바꿈은 허용');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body) values (%L, null, '본문')$q$, :'uid_a'), '23502', '제목: null 거부');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body) values (%L, '제목', %L)$q$, :'uid_a', ''), '23514:posts_body_length', '본문: 빈 문자열 거부');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body) values (%L, '제목', %L)$q$, :'uid_a', '   '), '23514:posts_body_not_blank', '본문: 공백만 거부');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body) values (%L, '제목', %L)$q$, :'uid_a', E'\n\n'), '23514:posts_body_not_blank', '본문: 줄바꿈만 거부');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body) values (%L, '제목', %L)$q$, :'uid_a', E'\u3000'), '23514:posts_body_not_blank', '본문: 전각 공백만 거부');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body) values (%L, '제목', %L)$q$, :'uid_a', repeat('가', 10001)), '23514:posts_body_length', '본문: 10001자 거부');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body) values (%L, '제목', %L)$q$, :'uid_a', repeat('가', 10000)), 'ok', '본문: 10000자 허용');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body) values (%L, '줄바꿈 보존', %L)$q$, :'uid_a', E'\n앞뒤 줄바꿈\n'), 'ok', '본문: 앞뒤 줄바꿈이 있어도 허용');
select t.eq((select body from public.posts where title = '줄바꿈 보존'), E'\n앞뒤 줄바꿈\n', '본문: 줄바꿈이 그대로 보존된다');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body, algorithm_id) values (%L, '알고리즘', '본문', 'quick-sort')$q$, :'uid_a'), '23514:posts_algorithm_id_allowed', '알고리즘 ID: 허용 목록에 없으면 거부');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body, algorithm_id) values (%L, '알고리즘', '본문', 'BFS')$q$, :'uid_a'), '23514:posts_algorithm_id_allowed', '알고리즘 ID: 대소문자가 다르면 거부');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body, algorithm_id) values (%L, '알고리즘', '본문', '')$q$, :'uid_a'), '23514:posts_algorithm_id_allowed', '알고리즘 ID: 빈 문자열 거부');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body, algorithm_id) values (%L, '알고리즘 dfs', '본문', 'dfs')$q$, :'uid_a'), 'ok', '알고리즘 ID: dfs 허용');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body, algorithm_id) values (%L, '알고리즘 binary', '본문', 'binary-search')$q$, :'uid_a'), 'ok', '알고리즘 ID: binary-search 허용');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body, algorithm_id) values (%L, '알고리즘 bubble', '본문', 'bubble-sort')$q$, :'uid_a'), 'ok', '알고리즘 ID: bubble-sort 허용');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body, algorithm_id) values (%L, '알고리즘 없음', '본문', null)$q$, :'uid_a'), 'ok', '알고리즘 ID: null 허용');

-- B의 글(이후 소유권 시험용)
select t.run('authenticated', :'uid_b', format($q$insert into public.posts (author_id, title, body, algorithm_id) values (%L, 'B의 글', 'B 본문', 'dfs')$q$, :'uid_b'), 'ok', 'B: 글 작성 성공');
select id as post_b1 from public.posts where title = 'B의 글' \gset

-- 닉네임을 바꿔도 이미 쓴 글의 표시명은 바뀌지 않고, 이후 글에는 새 닉네임이 쓰인다
select t.rows('authenticated', :'uid_a', format('update public.profiles set nickname = %L where id = %L', '앨리스새이름', :'uid_a'), 1, 'A: 닉네임을 새 이름으로 변경');
select t.eq((select author_display_name from public.posts where id = :'post_a1'), '앨리스', '닉네임 변경: 기존 글의 표시명은 작성 당시 그대로다');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body) values (%L, '새 닉네임 글', '본문')$q$, :'uid_a'), 'ok', 'A: 새 글 작성');
select t.eq((select author_display_name from public.posts where title = '새 닉네임 글'), '앨리스새이름', '닉네임 변경: 새 글에는 새 닉네임이 복사된다');
select t.rows('authenticated', :'uid_a', format('update public.profiles set nickname = %L where id = %L', '앨리스', :'uid_a'), 1, 'A: 닉네임을 원래대로');

-- =============================================================================================
-- 5. posts 조회
-- =============================================================================================
select t.count('anon', null, 'select 1 from public.posts', (select count(*) from public.posts)::integer, 'anon: 모든 글이 보인다');
select t.count('authenticated', :'uid_a', format('select 1 from public.posts where id = %L', :'post_b1'), 1, 'A: B의 글도 읽을 수 있다');
select t.val('anon', null, format('select title || version from public.posts where id = %L', :'post_a1'), 'A의 첫 글1', 'anon: 글 내용을 읽을 수 있다');

-- =============================================================================================
-- 6. posts 수정·삭제 (직접 Data API와 같은 경로: UPDATE/DELETE 문)
-- =============================================================================================
-- 6-0. RPC 전용 게이트(migration 4): RPC를 거치지 않은 직접 UPDATE·DELETE는 본인 글이어도 거부되고, RLS를 우회하는 관리 역할은 막지 않는다.
select t.run('authenticated', :'uid_a', format($q$update public.posts set title = title where id = %L$q$, :'post_a1'), '42501:rpc_required', '게이트: 본인 글도 직접 UPDATE는 거부(version 검사 우회 차단)');
select t.run('authenticated', :'uid_a', format('delete from public.posts where id = %L', :'post_a1'), '42501:rpc_required', '게이트: 본인 글도 직접 DELETE는 거부');
select t.rows('authenticated', :'uid_b', format($q$update public.posts set title = title where id = %L$q$, :'post_a1'), 0, '게이트 대조: 남의 글은 RLS가 행을 숨겨 0행이다(게이트 이전 단계에서 이미 막힌다)');
select t.run('authenticated', :'uid_a', format($q$select set_config('app.post_rpc', 'off', true); update public.posts set title = title where id = %L$q$, :'post_a1'), '42501:rpc_required', '게이트: 설정값이 on이 아니면 거부');
select t.eq((select version::text from public.posts where id = :'post_a1'), '1', '게이트: 거부된 시도는 version을 올리지 않았다');
select t.count('postgres', null, format('select 1 from public.posts where id = %L', :'post_a1'), 1, '게이트: 거부된 DELETE로 글이 지워지지 않았다');
savepoint gate_admin;
select t.run('service_role', null, format($q$update public.posts set title = '관리자 직접 수정' where id = %L$q$, :'post_a1'), 'ok', '게이트: RLS를 우회하는 관리 역할은 RPC 없이도 수정할 수 있다');
rollback to savepoint gate_admin;

-- 아래 6·6b 시험은 "게이트 안쪽의" RLS·컬럼 권한·트리거·CHECK를 직접 UPDATE/DELETE 문으로 확인한다. 게이트를 연 것으로 취급하려고
-- 트랜잭션 안에서만 설정값을 켠다(RPC가 하는 일과 같다). 6c에서 다시 끈다.
select set_config('app.post_rpc', 'on', true);

select t.rows('authenticated', :'uid_a', format($q$update public.posts set title = '수정한 제목' where id = %L$q$, :'post_a1'), 1, 'A: 본인 글 수정 1행');
select t.eq((select version::text from public.posts where id = :'post_a1'), '2', '수정: version이 1 올랐다');
select t.eq((select (updated_at > created_at)::text from public.posts where id = :'post_a1'), 'true', '수정: updated_at이 created_at보다 늦다');
select t.eq((select author_display_name from public.posts where id = :'post_a1'), '앨리스', '수정: 표시명은 그대로다');
select t.rows('authenticated', :'uid_a', format($q$update public.posts set title = '수정한 제목' where id = %L$q$, :'post_a1'), 1, 'A: 같은 값으로 다시 수정해도 1행');
select t.eq((select version::text from public.posts where id = :'post_a1'), '3', '수정: 값이 같아도 version이 올랐다');
select t.rows('authenticated', :'uid_a', format($q$update public.posts set algorithm_id = null where id = %L$q$, :'post_a1'), 1, 'A: 알고리즘 연결 제거(null)');
select t.rows('authenticated', :'uid_a', format($q$update public.posts set title = '해킹' where id = %L$q$, :'post_b1'), 0, 'A: B의 글 수정은 0행(RLS)');
select t.eq((select title || version from public.posts where id = :'post_b1'), 'B의 글1', 'B의 글은 그대로다');
select t.rows('authenticated', :'uid_a', format('delete from public.posts where id = %L', :'post_b1'), 0, 'A: B의 글 삭제는 0행(RLS)');
select t.rows('authenticated', :'uid_b', format($q$update public.posts set title = '해킹' where id = %L$q$, :'post_a1'), 0, 'B: A의 글 수정은 0행(RLS)');

select t.rows('authenticated', :'uid_a', format($q$update public.posts set title = '수정' where id = %L$q$, :'post_a1'), 1, 'A: 제목을 한 번 더 수정');
select t.run('authenticated', :'uid_a', format($q$update public.posts set title = ' 앞공백' where id = %L$q$, :'post_a1'), '23514:posts_title_trimmed', 'A: 수정으로 앞 공백 제목 거부');
select t.run('authenticated', :'uid_a', format($q$update public.posts set body = '   ' where id = %L$q$, :'post_a1'), '23514:posts_body_not_blank', 'A: 수정으로 공백만 본문 거부');
select t.run('authenticated', :'uid_a', format($q$update public.posts set algorithm_id = 'merge' where id = %L$q$, :'post_a1'), '23514:posts_algorithm_id_allowed', 'A: 수정으로 허용 목록 밖 알고리즘 거부');
select t.eq((select version::text from public.posts where id = :'post_a1'), '5', '거부된 수정 3번은 version을 올리지 않았다(성공한 수정 4번 뒤 version 5)');

-- 바꿀 수 없는 컬럼 (본인 글이어도)
select t.run('authenticated', :'uid_a', format('update public.posts set version = 99 where id = %L', :'post_a1'), '42501', 'A: version 직접 변경 거부');
select t.run('authenticated', :'uid_a', format('update public.posts set author_id = %L where id = %L', :'uid_b', :'post_a1'), '42501', 'A: 작성자(author_id) 변경 거부');
select t.run('authenticated', :'uid_a', format($q$update public.posts set author_display_name = '위조' where id = %L$q$, :'post_a1'), '42501', 'A: 표시명 변경 거부');
select t.run('authenticated', :'uid_a', format($q$update public.posts set created_at = '2000-01-01' where id = %L$q$, :'post_a1'), '42501', 'A: created_at 변경 거부');
select t.run('authenticated', :'uid_a', format($q$update public.posts set updated_at = '2000-01-01' where id = %L$q$, :'post_a1'), '42501', 'A: updated_at 변경 거부');
select t.run('authenticated', :'uid_a', format('update public.posts set id = %L where id = %L', gen_random_uuid(), :'post_a1'), '42501', 'A: id 변경 거부');

-- 관리자 권한(컬럼 권한이 넓은 역할)이어도 불변 컬럼은 트리거가 지킨다
select t.run('service_role', null, format('update public.posts set author_id = %L where id = %L', :'uid_b', :'post_a1'), '23514', '관리자: author_id 변경도 트리거가 거부');
select t.run('service_role', null, format($q$update public.posts set author_display_name = '위조' where id = %L$q$, :'post_a1'), '23514', '관리자: 표시명 변경도 트리거가 거부');
select t.run('service_role', null, format($q$update public.posts set created_at = '2000-01-01' where id = %L$q$, :'post_a1'), '23514', '관리자: created_at 변경도 트리거가 거부');
select t.run('service_role', null, format('update public.posts set id = %L where id = %L', gen_random_uuid(), :'post_a1'), '23514', '관리자: id 변경도 트리거가 거부');
select t.run('service_role', null, format($q$update public.posts set version = 99, updated_at = '2000-01-01', title = '관리자 수정' where id = %L$q$, :'post_a1'), 'ok', '관리자: version·updated_at을 지정해도 오류 없이 실행된다');
select t.eq((select version::text from public.posts where id = :'post_a1'), '6', '관리자: 지정한 version(99)은 무시되고 1만 올랐다');
select t.eq((select (updated_at > created_at)::text from public.posts where id = :'post_a1'), 'true', '관리자: 지정한 updated_at(2000년)은 무시되었다');

-- 관리자가 version·시각·표시명을 지정해 넣어도 DB가 정한다
select t.run('service_role', null, format($q$insert into public.posts (author_id, author_display_name, title, body, version, created_at, updated_at) values (%L, '위조', '관리자 글', '본문', 99, '2000-01-01', '2000-01-01')$q$, :'uid_b'), 'ok', '관리자: 값을 지정해 insert');
select t.eq((select version || ':' || author_display_name || ':' || (created_at > now() - interval '1 minute') from public.posts where title = '관리자 글'),
            '1:Bob:true', '관리자 insert: version 1, 표시명은 닉네임, 시각은 DB가 정했다');

-- 삭제
select t.rows('authenticated', :'uid_a', format('delete from public.posts where id = %L', :'post_a1'), 1, 'A: 본인 글 삭제 1행');
select t.count('postgres', null, format('select 1 from public.posts where id = %L', :'post_a1'), 0, '삭제된 글이 없다');
select t.rows('authenticated', :'uid_a', format('delete from public.posts where id = %L', :'post_a1'), 0, 'A: 이미 삭제된 글 삭제는 0행');
select t.rows('authenticated', :'uid_b', format('delete from public.posts where id = %L', :'post_b1'), 1, 'B: 본인 글 삭제 1행');

-- =============================================================================================
-- 6b. 방어층 분리 시험: 컬럼 권한·트리거가 먼저 막아 주는 규칙도 안쪽 방어(RLS의 WITH CHECK, CHECK 제약)가 따로 막는지 본다.
--     바깥 방어를 SAVEPOINT 안에서만 잠시 풀고 되돌린다(이 방어층 하나가 빠져도 나머지가 막는다는 뜻이다).
-- =============================================================================================
select id as post_a2 from public.posts where title = '알고리즘 dfs' \gset

savepoint layer_posts_insert;
alter table public.posts disable trigger posts_guard_insert;
grant insert (author_display_name, version) on table public.posts to authenticated;
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, author_display_name, title, body) values (%L, 'x', '제목', '본문')$q$, :'uid_b'), '42501',
             '방어층: 트리거와 컬럼 권한이 없어도 A는 B의 author_id로 글을 쓸 수 없다(posts 작성 정책의 WITH CHECK)');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, author_display_name, title, body) values (%L, 'x', '제목', '본문')$q$, :'uid_a'), 'ok',
             '방어층 대조: 같은 문장이 자기 author_id로는 성공한다(위의 거부가 정책 때문임을 확인)');
select t.run('service_role', null, format($q$insert into public.posts (author_id, author_display_name, title, body, version) values (%L, 'x', '제목', '본문', 0)$q$, :'uid_a'), '23514:posts_version_positive',
             '방어층: 트리거가 없어도 version 0은 CHECK 제약이 막는다');
rollback to savepoint layer_posts_insert;

savepoint layer_posts_update;
alter table public.posts disable trigger posts_guard_update;
grant update (author_id) on table public.posts to authenticated;
select t.run('authenticated', :'uid_a', format('update public.posts set author_id = %L where id = %L', :'uid_b', :'post_a2'), '42501',
             '방어층: 트리거와 컬럼 권한이 없어도 A는 글의 작성자를 B로 바꿀 수 없다(posts 수정 정책의 WITH CHECK)');
select t.eq((select author_id::text from public.posts where id = :'post_a2'), :'uid_a', '방어층: 거부된 뒤 작성자는 그대로다');
rollback to savepoint layer_posts_update;

savepoint layer_profiles_update;
alter table public.profiles disable trigger profiles_guard;
grant update (id) on table public.profiles to authenticated;
-- WHERE가 컬럼을 참조하는 UPDATE는 새 행도 SELECT 정책(id = auth.uid())으로 검사되어 WITH CHECK가 가려진다. 그래서 WHERE 없이 시험한다
-- (UPDATE 정책의 USING이 본인 행만 남긴다).
select t.run('authenticated', :'uid_c', format('update public.profiles set id = %L', t.eid(22)), '42501',
             '방어층: 트리거와 컬럼 권한이 없어도 C는 프로필의 id를 바꿀 수 없다(profiles 수정 정책의 WITH CHECK)');
select t.run('authenticated', :'uid_c', format('update public.profiles set id = %L where id = %L', t.eid(22), :'uid_c'), '42501',
             '방어층: WHERE가 있는 같은 UPDATE는 SELECT 정책이 새 행을 막는다(다른 층)');
select t.count('postgres', null, format('select 1 from public.profiles where id = %L', :'uid_c'), 1, '방어층: 거부된 뒤 C의 프로필은 그대로다');
rollback to savepoint layer_profiles_update;

-- 되돌린 뒤에는 원래 방어가 모두 살아 있다
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body) values (%L, '제목', '본문')$q$, :'uid_b'), 'P0001', '복구 확인: 트리거가 다시 B의 author_id를 막는다');

-- 6c. 게이트를 다시 닫는다. 이후 직접 쓰기는 다시 거부되고, 계정 삭제의 연쇄 삭제(테이블 소유자 권한)는 게이트에 막히지 않는다.
select set_config('app.post_rpc', '', true);
select t.run('authenticated', :'uid_b', format($q$update public.posts set title = title where author_id = %L$q$, :'uid_b'), '42501:rpc_required', '게이트 복구: 닫으면 직접 UPDATE가 다시 거부된다');

savepoint learning_algorithm_tags;
-- 새 학습 알고리즘 태그도 동일한 사용자 RLS와 CHECK를 거친다.
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body, algorithm_id) values (%L, '학습 확장', '본문', 'union-find')$q$, :'uid_a'), 'ok', '새 알고리즘 태그 union-find 허용');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body, algorithm_id) values (%L, '학습 확장', '본문', 'dijkstra')$q$, :'uid_a'), 'ok', '새 알고리즘 태그 dijkstra 허용');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body, algorithm_id) values (%L, '학습 확장', '본문', 'knapsack')$q$, :'uid_a'), 'ok', '새 알고리즘 태그 knapsack 허용');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body, algorithm_id) values (%L, '학습 확장', '본문', 'topological-sort')$q$, :'uid_a'), 'ok', '새 알고리즘 태그 topological-sort 허용');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, title, body, algorithm_id) values (%L, '학습 확장', '본문', 'two-pointers')$q$, :'uid_a'), 'ok', '새 알고리즘 태그 two-pointers 허용');

rollback to savepoint learning_algorithm_tags;

-- =============================================================================================
-- 7. 계정 삭제(관리자)는 프로필과 글을 함께 지운다
-- =============================================================================================
select t.run('authenticated', :'uid_b', format($q$insert into public.posts (author_id, title, body) values (%L, 'B 글 하나 더', '본문')$q$, :'uid_b'), 'ok', 'B: 글 하나 더 작성');
select t.count('postgres', null, format('select 1 from public.posts where author_id = %L', :'uid_a'), 9, '준비: A의 글 9개(첫 글은 삭제함)');
delete from auth.users where id = :'uid_a';
select t.count('postgres', null, format('select 1 from public.profiles where id = %L', :'uid_a'), 0, '계정 삭제: A의 프로필이 함께 삭제된다');
select t.count('postgres', null, format('select 1 from public.posts where author_id = %L', :'uid_a'), 0, '계정 삭제: A의 글이 함께 삭제된다');
select t.count('postgres', null, format('select 1 from public.posts where author_id = %L', :'uid_b'), 2, '계정 삭제: B의 글은 그대로다');

rollback;
\echo 'rls.sql: 모든 검사 통과'
