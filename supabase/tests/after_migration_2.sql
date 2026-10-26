-- migration 1·2까지 적용하고 3(RPC)은 아직 적용하지 않은 직후의 상태. 권한·RLS·트리거는 최종 상태와 같고 RPC만 없다.
-- 파일을 따로 적용하는 환경에서 이 상태가 파일 사이에 실제로 존재하므로, 이 상태에서도 쓰기가 안전한지 확인한다.
-- 이 테스트는 러너(scripts/run-db-tests.mjs)가 migration 1·2만 적용한 데이터베이스에서 실행한다.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
\set uid_a 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
\set uid_b 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

begin;
\ir support/test_helpers.sql

insert into auth.users (id, email) values (:'uid_a', 'a@example.test'), (:'uid_b', 'b@example.test');
insert into public.profiles (id, nickname) values (:'uid_a', '앨리스'), (:'uid_b', 'Bob');
insert into public.posts (author_id, title, body) values (:'uid_a', '제목', '본문');
select id as post_a from public.posts \gset

select t.eq((select count(*) from pg_proc where proname in ('update_post', 'delete_post') and pronamespace = 'public'::regnamespace)::text, '0', '상태 확인: RPC는 아직 없다');
select t.eq((select count(*) from pg_policies where schemaname = 'public')::text, '7', 'migration 1·2: 정책 7개가 있다');
select t.eq((select count(*) from pg_trigger where tgrelid in ('public.profiles'::regclass, 'public.posts'::regclass) and not tgisinternal)::text, '3', 'migration 1·2: 트리거 3개가 있다');

-- 비회원
select t.run('anon', null, 'select * from public.profiles', '42501', 'migration 1·2: anon은 프로필을 읽을 수 없다');
select t.run('anon', null, format('insert into public.profiles (id, nickname) values (%L, %L)', gen_random_uuid(), '비회원삽입'), '42501', 'migration 1·2: anon은 프로필을 만들 수 없다');
select t.run('anon', null, format($q$insert into public.posts (author_id, title, body, version) values (%L, '제목', '본문', 999)$q$, :'uid_a'), '42501', 'migration 1·2: anon은 글을 넣을 수 없다');
select t.run('anon', null, format($q$update public.posts set title = '해킹' where id = %L$q$, :'post_a'), '42501', 'migration 1·2: anon은 글을 수정할 수 없다');
select t.run('anon', null, 'delete from public.posts', '42501', 'migration 1·2: anon은 글을 지울 수 없다');
select t.count('anon', null, 'select 1 from public.posts', 1, 'migration 1·2: anon은 글을 읽을 수 있다');
-- 회원
select t.run('authenticated', :'uid_b', format($q$insert into public.posts (author_id, title, body, version) values (%L, '제목', '본문', 999)$q$, :'uid_b'), '42501', 'migration 1·2: 회원도 version을 지정할 수 없다');
select t.run('authenticated', :'uid_b', format($q$insert into public.posts (author_id, title, body) values (%L, '제목', '본문')$q$, :'uid_a'), 'P0001', 'migration 1·2: 회원은 남의 author_id로 글을 쓸 수 없다');
select t.rows('authenticated', :'uid_b', format($q$update public.posts set title = '해킹' where id = %L$q$, :'post_a'), 0, 'migration 1·2: 회원은 남의 글을 수정할 수 없다(0행)');
select t.run('authenticated', :'uid_b', 'delete from public.profiles', '42501', 'migration 1·2: 회원은 프로필을 삭제할 수 없다');
select t.run('authenticated', :'uid_b', format($q$insert into public.posts (author_id, title, body) values (%L, '내 글', '본문')$q$, :'uid_b'), 'ok', 'migration 1·2: 회원은 자기 글을 쓸 수 있다');
select t.eq((select version || ':' || author_display_name from public.posts where title = '내 글'), '1:Bob', 'migration 1·2: 트리거가 version과 표시명을 정했다');
-- 트리거 함수는 사용자 역할이 직접 실행할 수 없다
select t.eq(has_function_privilege('anon', 'public.posts_guard_insert()', 'execute')::text, 'false', 'migration 1·2: anon은 트리거 함수를 실행할 수 없다');
select t.eq(has_function_privilege('authenticated', 'public.posts_guard_update()', 'execute')::text, 'false', 'migration 1·2: authenticated는 트리거 함수를 실행할 수 없다');

rollback;
\echo 'after_migration_2.sql: 모든 검사 통과'
