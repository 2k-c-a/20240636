-- migration 1(테이블·제약·인덱스)만 적용한 직후의 상태: 아무도(비회원·회원 모두) 읽기·쓰기를 할 수 없어야 한다.
-- migration 파일은 하나씩 따로 적용될 수 있다(SQL Editor에서 한 파일씩, 파일마다 별도 트랜잭션인 CLI 등). 그러면 파일 사이에 이 상태가 실제로 존재한다.
-- Supabase는 public의 새 테이블에 anon·authenticated 권한을 기본으로 주므로, 테이블을 만드는 첫 파일이 같은 트랜잭션 안에서 바로 잠가야 한다.
-- 이 테스트는 러너(scripts/run-db-tests.mjs)가 migration 1만 적용한 데이터베이스에서 실행한다.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
\set uid_a 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
\set uid_b 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

begin;
\ir support/test_helpers.sql

-- 준비(관리자): 사용자와 프로필·글을 직접 넣는다. 트리거가 아직 없으므로 표시명은 직접 적는다.
insert into auth.users (id, email) values (:'uid_a', 'a@example.test'), (:'uid_b', 'b@example.test');
insert into public.profiles (id, nickname) values (:'uid_a', '앨리스');
insert into public.posts (author_id, author_display_name, title, body) values (:'uid_a', '앨리스', '제목', '본문');
select id as post_a from public.posts \gset
select t.eq((select count(*) from pg_proc where proname in ('update_post', 'delete_post', 'profiles_guard', 'posts_guard_insert', 'posts_guard_update') and pronamespace = 'public'::regnamespace)::text,
            '0', '상태 확인: migration 1만 적용되어 함수와 트리거가 아직 없다');

-- 구조: RLS 켜짐, 표 권한 없음
select t.eq((select relrowsecurity::text from pg_class where oid = 'public.profiles'::regclass), 'true', 'migration 1: profiles RLS 켜짐');
select t.eq((select relrowsecurity::text from pg_class where oid = 'public.posts'::regclass), 'true', 'migration 1: posts RLS 켜짐');
do $$
declare
    r record;
    privs text[] := array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'];
    colprivs text[] := array['select', 'insert', 'update', 'references'];
    p text;
begin
    for r in select role_name, table_name from (values ('anon'), ('authenticated')) as roles(role_name), (values ('profiles'), ('posts')) as tables(table_name) loop
        foreach p in array privs loop
            perform t.eq(has_table_privilege(r.role_name, 'public.' || r.table_name, p)::text, 'false', format('migration 1: %s의 %s 테이블 %s 권한 없음', r.role_name, r.table_name, p));
        end loop;
        foreach p in array colprivs loop
            perform t.eq(has_any_column_privilege(r.role_name, 'public.' || r.table_name, p)::text, 'false', format('migration 1: %s의 %s 컬럼 %s 권한 없음', r.role_name, r.table_name, p));
        end loop;
    end loop;
    foreach p in array array['profiles', 'posts'] loop
        perform t.eq((select count(*) from aclexplode((select relacl from pg_class where oid = ('public.' || p)::regclass)) where grantee = 0)::text, '0', 'migration 1: PUBLIC에는 ' || p || ' 권한이 없다');
    end loop;
end;
$$;

-- 동작: 비회원이 프로필과 version=999인 글을 넣을 수 없다(독립 검토에서 재현된 시나리오)
select t.run('anon', null, format('insert into public.profiles (id, nickname) values (%L, %L)', :'uid_b', '비회원삽입'), '42501', 'migration 1: anon은 프로필을 만들 수 없다');
select t.run('anon', null, format($q$insert into public.posts (author_id, author_display_name, title, body, version) values (%L, '위조', '제목', '본문', 999)$q$, :'uid_a'), '42501', 'migration 1: anon은 version=999인 글을 넣을 수 없다');
select t.run('anon', null, 'select * from public.profiles', '42501', 'migration 1: anon은 프로필을 읽을 수 없다');
select t.run('anon', null, 'select * from public.posts', '42501', 'migration 1: anon은 글을 읽을 수 없다(읽기 권한은 migration 2에서 준다)');
select t.run('anon', null, format($q$update public.posts set title = '해킹' where id = %L$q$, :'post_a'), '42501', 'migration 1: anon은 글을 수정할 수 없다');
select t.run('anon', null, 'delete from public.posts', '42501', 'migration 1: anon은 글을 지울 수 없다');
-- 로그인한 회원도 마찬가지다
select t.run('authenticated', :'uid_b', format('insert into public.profiles (id, nickname) values (%L, %L)', :'uid_b', '회원삽입'), '42501', 'migration 1: 회원도 프로필을 만들 수 없다');
select t.run('authenticated', :'uid_a', format($q$insert into public.posts (author_id, author_display_name, title, body, version) values (%L, '위조', '제목', '본문', 999)$q$, :'uid_a'), '42501', 'migration 1: 회원도 글을 넣을 수 없다');
select t.run('authenticated', :'uid_a', 'select * from public.profiles', '42501', 'migration 1: 회원도 프로필을 읽을 수 없다');
select t.run('authenticated', :'uid_a', format($q$update public.posts set title = '해킹' where id = %L$q$, :'post_a'), '42501', 'migration 1: 회원도 글을 수정할 수 없다');
select t.run('authenticated', :'uid_a', 'delete from public.posts', '42501', 'migration 1: 회원도 글을 지울 수 없다');
select t.eq((select count(*) from public.posts)::text, '1', 'migration 1: 거부된 요청으로 글이 바뀌지 않았다');
-- 관리자(Secret key)는 RLS를 우회하는 역할이라 접근할 수 있다(기본 권한 유지)
select t.count('service_role', null, 'select 1 from public.posts', 1, 'migration 1: service_role은 접근할 수 있다(RLS 우회 역할)');

rollback;
\echo 'after_migration_1.sql: 모든 검사 통과'
