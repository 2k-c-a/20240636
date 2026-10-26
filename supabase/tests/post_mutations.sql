-- 게시글 수정·삭제 RPC(update_post, delete_post) 테스트 (psql로 실행: 실행 방법은 supabase/README.md).
-- 결과 4가지(ok / not_found / forbidden / version_conflict), 우선순위(없음 → 남의 글 → 오래된 version), 필드 누락과 null의 구분,
-- 입력 검증 오류, 권한(anon 거부), SECURITY INVOKER(호출자 권한·RLS를 그대로 따름)를 실제 역할로 전환해서 확인한다.
-- 같은 version의 동시 요청은 한 트랜잭션 안에서 흉내 낼 수 없으므로 supabase/tests/concurrency.mjs가 별도 접속으로 확인한다.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
\set uid_a 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
\set uid_b 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
\set none_id '00000000-0000-4000-8000-000000000000'

begin;
\ir support/test_helpers.sql

insert into auth.users (id, email) values (:'uid_a', 'a@example.test'), (:'uid_b', 'b@example.test');
insert into public.profiles (id, nickname) values (:'uid_a', '앨리스'), (:'uid_b', 'Bob');
insert into public.posts (author_id, title, body, algorithm_id) values
    (:'uid_a', 'T1', 'B1', 'bfs'), (:'uid_a', 'T2', 'B2', 'dfs'), (:'uid_a', 'T3', 'B3', null),
    (:'uid_a', 'T4', 'B4', 'bubble-sort'), (:'uid_a', 'T5', 'B5', 'binary-search'), (:'uid_b', 'TB', 'BB', 'dfs');
select id as p1 from public.posts where title = 'T1' \gset
select id as p2 from public.posts where title = 'T2' \gset
select id as p3 from public.posts where title = 'T3' \gset
select id as p4 from public.posts where title = 'T4' \gset
select id as p5 from public.posts where title = 'T5' \gset
select id as pb from public.posts where title = 'TB' \gset

-- =============================================================================================
-- 1. 함수 정의와 권한 (카탈로그)
-- =============================================================================================
select t.eq((select prosecdef::text from pg_proc where oid = 'public.update_post(uuid,integer,text,text,text,boolean)'::regprocedure), 'false', '정의: update_post는 SECURITY INVOKER');
select t.eq((select prosecdef::text from pg_proc where oid = 'public.delete_post(uuid,integer)'::regprocedure), 'false', '정의: delete_post는 SECURITY INVOKER');
select t.eq((select (proconfig @> array['search_path=""'])::text from pg_proc where oid = 'public.update_post(uuid,integer,text,text,text,boolean)'::regprocedure), 'true', '정의: update_post는 search_path를 비워 고정한다');
select t.eq((select (proconfig @> array['search_path=""'])::text from pg_proc where oid = 'public.delete_post(uuid,integer)'::regprocedure), 'true', '정의: delete_post는 search_path를 비워 고정한다');
select t.eq(pg_get_function_identity_arguments('public.update_post(uuid,integer,text,text,text,boolean)'::regprocedure),
            'p_id uuid, p_expected_version integer, p_title text, p_body text, p_algorithm_id text, p_set_algorithm_id boolean', '계약: update_post 인자');
select t.eq(pg_get_function_result('public.update_post(uuid,integer,text,text,text,boolean)'::regprocedure),
            'TABLE(result text, id uuid, author_id uuid, author_display_name text, title text, body text, algorithm_id text, version integer, created_at timestamp with time zone, updated_at timestamp with time zone)',
            '계약: update_post 결과 컬럼');
select t.eq(pg_get_function_identity_arguments('public.delete_post(uuid,integer)'::regprocedure), 'p_id uuid, p_expected_version integer', '계약: delete_post 인자');
select t.eq(pg_get_function_result('public.delete_post(uuid,integer)'::regprocedure), 'TABLE(result text)', '계약: delete_post 결과 컬럼');
select t.eq(has_function_privilege('anon', 'public.update_post(uuid,integer,text,text,text,boolean)', 'execute')::text, 'false', '권한: anon은 update_post 실행 불가');
select t.eq(has_function_privilege('anon', 'public.delete_post(uuid,integer)', 'execute')::text, 'false', '권한: anon은 delete_post 실행 불가');
select t.eq(has_function_privilege('authenticated', 'public.update_post(uuid,integer,text,text,text,boolean)', 'execute')::text, 'true', '권한: authenticated는 update_post 실행 가능');
select t.eq(has_function_privilege('authenticated', 'public.delete_post(uuid,integer)', 'execute')::text, 'true', '권한: authenticated는 delete_post 실행 가능');
select t.eq((select count(*) from aclexplode((select proacl from pg_proc where oid = 'public.update_post(uuid,integer,text,text,text,boolean)'::regprocedure)) where grantee = 0)::text, '0', '권한: PUBLIC은 update_post 실행 불가');
select t.eq((select count(*) from aclexplode((select proacl from pg_proc where oid = 'public.delete_post(uuid,integer)'::regprocedure)) where grantee = 0)::text, '0', '권한: PUBLIC은 delete_post 실행 불가');

-- =============================================================================================
-- 2. update_post: 성공
-- =============================================================================================
select t.val('authenticated', :'uid_a', format($q$select result || '|' || version || '|' || title || '|' || body || '|' || coalesce(algorithm_id, '-') from public.update_post(%L, 1, 'T1-new')$q$, :'p1'),
             'ok|2|T1-new|B1|bfs', '수정: 제목만 바꾸면 본문·알고리즘은 그대로이고 version이 2가 된다');
select t.eq((select title || '|' || body || '|' || version from public.posts where id = :'p1'), 'T1-new|B1|2', '수정: DB에도 반영되었다');
select t.val('authenticated', :'uid_a', format($q$select result || '|' || version || '|' || title || '|' || body || '|' || coalesce(algorithm_id, '-') from public.update_post(%L, 2, p_body => 'B1-new')$q$, :'p1'),
             'ok|3|T1-new|B1-new|bfs', '수정: 본문만 바꾼다');
select t.val('authenticated', :'uid_a', format($q$select result || '|' || version || '|' || coalesce(algorithm_id, '-') from public.update_post(%L, 3, p_algorithm_id => 'dfs', p_set_algorithm_id => true)$q$, :'p1'),
             'ok|4|dfs', '수정: 알고리즘만 dfs로 바꾼다(제목·본문 인자 생략)');
select t.eq((select title || '|' || body from public.posts where id = :'p1'), 'T1-new|B1-new', '수정: 알고리즘만 바꿔도 제목·본문은 그대로다');
select t.val('authenticated', :'uid_a', format($q$select result || '|' || version || '|' || coalesce(algorithm_id, '-') from public.update_post(%L, 4, p_algorithm_id => null, p_set_algorithm_id => true)$q$, :'p1'),
             'ok|5|-', '수정: 알고리즘을 명시적 null로 바꾸면 연결이 제거된다');
select t.val('authenticated', :'uid_a', format($q$select result || '|' || version || '|' || title || '|' || body || '|' || coalesce(algorithm_id, '-') from public.update_post(%L, 5, 'T-all', 'B-all', 'bubble-sort', true)$q$, :'p1'),
             'ok|6|T-all|B-all|bubble-sort', '수정: 세 필드를 한꺼번에 바꾼다');
select t.val('authenticated', :'uid_a', format($q$select result || '|' || version from public.update_post(%L, 6, 'T-all')$q$, :'p1'),
             'ok|7', '수정: 값이 같아도 성공하고 version이 올라간다');
select t.val('authenticated', :'uid_a', format($q$select count(*) from public.update_post(%L, 7, p_body => 'B-again')$q$, :'p1'), '1', '결과: 성공해도 항상 한 줄이다');
select t.eq((select author_display_name || '|' || author_id::text from public.posts where id = :'p1'), '앨리스|' || :'uid_a', '수정: 작성자와 표시명은 그대로다');
select t.eq((select (updated_at > created_at)::text from public.posts where id = :'p1'), 'true', '수정: updated_at이 갱신되었다');
select t.val('authenticated', :'uid_a', format($q$select id::text || '|' || author_id::text || '|' || author_display_name || '|' || (created_at is not null) || '|' || (updated_at is not null) from public.update_post(%L, 8, 'T-fields')$q$, :'p1'),
             :'p1' || '|' || :'uid_a' || '|앨리스|true|true', '결과: ok일 때 id·작성자·표시명·시각이 채워진다');

-- =============================================================================================
-- 3. update_post: 실패 결과와 우선순위 (없음 → 남의 글 → 오래된 version)
-- =============================================================================================
select t.val('authenticated', :'uid_a', format($q$select result from public.update_post(%L, 1, 'stale')$q$, :'p1'), 'version_conflict', '충돌: 오래된 version(1)으로 수정하면 version_conflict');
select t.val('authenticated', :'uid_a', format($q$select result from public.update_post(%L, 99, 'future')$q$, :'p1'), 'version_conflict', '충돌: 아직 없는 version(99)도 version_conflict');
select t.val('authenticated', :'uid_a', format($q$select count(*) from public.update_post(%L, 1, 'stale')$q$, :'p1'), '1', '결과: 실패해도 한 줄이다');
select t.val('authenticated', :'uid_a', format($q$select coalesce(id::text, 'null') || coalesce(title, 'null') || coalesce(version::text, 'null') from public.update_post(%L, 1, 'stale')$q$, :'p1'),
             'nullnullnull', '결과: 실패하면 글 내용을 돌려주지 않는다(412에 현재 글을 넣지 않는다)');
select t.eq((select title || '|' || version from public.posts where id = :'p1'), 'T-fields|9', '충돌: 거부된 요청은 글을 바꾸지 않았다');
-- 같은 version으로 연달아 두 번: 첫 번째만 성공
select t.val('authenticated', :'uid_a', format($q$select result from public.update_post(%L, 1, 'first')$q$, :'p2'), 'ok', '같은 version 두 번 중 첫 번째는 성공');
select t.val('authenticated', :'uid_a', format($q$select result from public.update_post(%L, 1, 'second')$q$, :'p2'), 'version_conflict', '같은 version 두 번 중 두 번째는 version_conflict');
select t.eq((select title || '|' || version from public.posts where id = :'p2'), 'first|2', '같은 version 두 번: 첫 번째 내용이 남았다');

select t.val('authenticated', :'uid_b', format($q$select result from public.update_post(%L, 9, 'hack')$q$, :'p1'), 'forbidden', '남의 글: 맞는 version이어도 forbidden');
select t.val('authenticated', :'uid_b', format($q$select result from public.update_post(%L, 1, 'hack')$q$, :'p1'), 'forbidden', '남의 글: version이 틀려도 forbidden(소유권이 version보다 먼저다)');
select t.val('authenticated', :'uid_b', format($q$select coalesce(id::text, 'null') || coalesce(title, 'null') from public.update_post(%L, 9, 'hack')$q$, :'p1'), 'nullnull', '남의 글: 글 내용을 돌려주지 않는다');
select t.eq((select title || '|' || version from public.posts where id = :'p1'), 'T-fields|9', '남의 글: 바뀌지 않았다');
select t.val('authenticated', :'uid_a', format($q$select result from public.update_post(%L, 1, 'hack')$q$, :'pb'), 'forbidden', '남의 글: A가 B의 글도 forbidden');
select t.val('authenticated', :'uid_a', format($q$select result from public.update_post(%L, 1, 'x')$q$, :'none_id'), 'not_found', '없는 글: not_found');
select t.val('authenticated', :'uid_b', format($q$select result from public.update_post(%L, 99, 'x')$q$, :'none_id'), 'not_found', '없는 글: version이 틀려도 not_found');
select t.val('authenticated', null, format($q$select result from public.update_post(%L, 9, 'x')$q$, :'p1'), 'forbidden', '로그인 정보가 없는 요청(uid 없음): 있는 글은 forbidden');
select t.val('authenticated', null, format($q$select result from public.update_post(%L, 1, 'x')$q$, :'none_id'), 'not_found', '로그인 정보가 없는 요청(uid 없음): 없는 글은 not_found');

-- =============================================================================================
-- 4. update_post: 입력 오류(글은 바뀌지 않는다)
-- =============================================================================================
select t.run('authenticated', :'uid_a', format($q$select * from public.update_post(%L, 9, ' 앞공백')$q$, :'p1'), '23514:posts_title_trimmed', '검증: 앞 공백 제목 거부');
select t.run('authenticated', :'uid_a', format($q$select * from public.update_post(%L, 9, %L)$q$, :'p1', ''), '23514:posts_title_length', '검증: 빈 제목 거부');
select t.run('authenticated', :'uid_a', format($q$select * from public.update_post(%L, 9, p_body => '   ')$q$, :'p1'), '23514:posts_body_not_blank', '검증: 공백만 본문 거부');
select t.run('authenticated', :'uid_a', format($q$select * from public.update_post(%L, 9, p_body => %L)$q$, :'p1', repeat('가', 10001)), '23514:posts_body_length', '검증: 10001자 본문 거부');
select t.run('authenticated', :'uid_a', format($q$select * from public.update_post(%L, 9, p_algorithm_id => 'merge', p_set_algorithm_id => true)$q$, :'p1'), '23514:posts_algorithm_id_allowed', '검증: 허용 목록 밖 알고리즘 거부');
select t.run('authenticated', :'uid_a', format($q$select * from public.update_post(%L, 9, p_algorithm_id => 'dfs')$q$, :'p1'), '22023:invalid_argument', '검증: set 플래그 없이 알고리즘만 주면 거부(조용히 무시하지 않는다)');
select t.run('authenticated', :'uid_a', format($q$select * from public.update_post(%L, 9, 'T-with-algorithm', p_algorithm_id => 'dfs')$q$, :'p1'), '22023:invalid_argument',
             '검증: 제목과 함께 알고리즘만 주고 플래그가 없으면 조용히 무시하지 않고 거부(오류에 p_set_algorithm_id를 안내)');
select t.run('authenticated', :'uid_a', format($q$select * from public.update_post(%L, 9)$q$, :'p1'), '22023:no_fields_to_update', '검증: 바꿀 필드가 없으면 거부');
select t.run('authenticated', :'uid_a', format($q$select * from public.update_post(%L, null, 'x')$q$, :'p1'), '22004', '검증: expected version이 null이면 거부');
select t.run('authenticated', :'uid_a', 'select * from public.update_post(null, 1, ''x'')', '22004', '검증: id가 null이면 거부');
select t.eq((select title || '|' || version from public.posts where id = :'p1'), 'T-fields|9', '검증 오류: 글이 바뀌지 않았고 version도 오르지 않았다');
select t.run('authenticated', :'uid_a', format($q$select * from public.update_post(%L, 9, p_algorithm_id => null, p_set_algorithm_id => false)$q$, :'p1'), '22023', '검증: null과 플래그 false의 조합도 바꿀 필드가 없으므로 거부');

-- =============================================================================================
-- 5. delete_post
-- =============================================================================================
select t.val('authenticated', :'uid_a', format($q$select result from public.delete_post(%L, 1)$q$, :'p3'), 'ok', '삭제: 맞는 version이면 ok');
select t.count('postgres', null, format('select 1 from public.posts where id = %L', :'p3'), 0, '삭제: 글이 사라졌다');
select t.val('authenticated', :'uid_a', format($q$select result from public.delete_post(%L, 1)$q$, :'p3'), 'not_found', '삭제: 이미 삭제된 글은 not_found');
select t.val('authenticated', :'uid_a', format($q$select result from public.update_post(%L, 1, 'x')$q$, :'p3'), 'not_found', '수정: 삭제된 글은 not_found');
select t.val('authenticated', :'uid_a', format($q$select result from public.delete_post(%L, 99)$q$, :'p4'), 'version_conflict', '삭제: version이 다르면 version_conflict');
select t.count('postgres', null, format('select 1 from public.posts where id = %L', :'p4'), 1, '삭제: version_conflict이면 글이 남는다');
select t.val('authenticated', :'uid_b', format($q$select result from public.delete_post(%L, 1)$q$, :'p4'), 'forbidden', '삭제: 남의 글은 forbidden');
select t.val('authenticated', :'uid_b', format($q$select result from public.delete_post(%L, 99)$q$, :'p4'), 'forbidden', '삭제: 남의 글은 version이 틀려도 forbidden');
select t.count('postgres', null, format('select 1 from public.posts where id = %L', :'p4'), 1, '삭제: forbidden이면 글이 남는다');
select t.val('authenticated', :'uid_a', format($q$select result from public.delete_post(%L, 1)$q$, :'none_id'), 'not_found', '삭제: 없는 글은 not_found');
select t.val('authenticated', null, format($q$select result from public.delete_post(%L, 1)$q$, :'p4'), 'forbidden', '삭제: 로그인 정보가 없는 요청은 forbidden');
select t.val('authenticated', :'uid_a', format($q$select count(*) from public.delete_post(%L, 99)$q$, :'p4'), '1', '삭제 결과: 항상 한 줄이다');
select t.run('authenticated', :'uid_a', 'select * from public.delete_post(null, 1)', '22004', '삭제 검증: id가 null이면 거부');
select t.run('authenticated', :'uid_a', format('select * from public.delete_post(%L, null)', :'p4'), '22004', '삭제 검증: expected version이 null이면 거부');
-- 읽은 뒤 다른 곳에서 수정된 글을 오래된 version으로 삭제하려 하면 거부
select t.val('authenticated', :'uid_a', format($q$select result from public.update_post(%L, 1, 'T4-new')$q$, :'p4'), 'ok', '준비: p4를 version 2로 수정');
select t.val('authenticated', :'uid_a', format($q$select result from public.delete_post(%L, 1)$q$, :'p4'), 'version_conflict', '삭제: 수정된 뒤 오래된 version(1)으로 지우면 version_conflict');
select t.val('authenticated', :'uid_a', format($q$select result from public.delete_post(%L, 2)$q$, :'p4'), 'ok', '삭제: 현재 version(2)으로는 ok');

-- =============================================================================================
-- 6. 비회원(anon)과 직접 호출
-- =============================================================================================
select t.run('anon', null, format($q$select * from public.update_post(%L, 1, 'x')$q$, :'p5'), '42501', 'anon: update_post 호출 거부');
select t.run('anon', null, format($q$select * from public.delete_post(%L, 1)$q$, :'p5'), '42501', 'anon: delete_post 호출 거부');
select t.count('postgres', null, format('select 1 from public.posts where id = %L and version = 1', :'p5'), 1, 'anon 거부 후: 글이 그대로다');

-- =============================================================================================
-- 7. SECURITY INVOKER 증명: 호출자의 컬럼 권한·RLS가 RPC 안에서도 그대로 적용된다
-- =============================================================================================
savepoint invoker_checks;

revoke update (title) on table public.posts from authenticated;
select t.run('authenticated', :'uid_a', format($q$select * from public.update_post(%L, 1, 'new-title')$q$, :'p5'), '42501', 'INVOKER: title 컬럼 권한을 빼면 update_post도 거부된다(함수가 소유자 권한으로 실행되지 않는다)');
rollback to savepoint invoker_checks;

drop policy posts_update_own on public.posts;
select t.val('authenticated', :'uid_a', format($q$select result from public.update_post(%L, 1, 'policy-less')$q$, :'p5'), 'version_conflict', 'INVOKER: UPDATE 정책이 없으면 RPC도 행을 바꾸지 못한다(소유자·version이 맞아도 0행)');
select t.eq((select title || '|' || version from public.posts where id = :'p5'), 'T5|1', 'INVOKER: 정책이 없을 때 글이 바뀌지 않았다');
rollback to savepoint invoker_checks;

drop policy posts_delete_own on public.posts;
select t.val('authenticated', :'uid_a', format($q$select result from public.delete_post(%L, 1)$q$, :'p5'), 'version_conflict', 'INVOKER: DELETE 정책이 없으면 RPC도 행을 지우지 못한다');
select t.count('postgres', null, format('select 1 from public.posts where id = %L', :'p5'), 1, 'INVOKER: 정책이 없을 때 글이 남았다');
rollback to savepoint invoker_checks;

-- 방어층 분리: 정책이 "모두 허용"으로 잘못 바뀌어도 RPC 자신의 조건(author_id = auth.uid())이 남의 글을 막는다.
drop policy posts_update_own on public.posts;
create policy posts_update_any on public.posts for update to authenticated using (true) with check (true);
select t.val('authenticated', :'uid_b', format($q$select result from public.update_post(%L, 9, 'hack')$q$, :'p1'), 'forbidden', '방어층: UPDATE 정책이 모두 허용이어도 update_post는 남의 글을 forbidden으로 막는다');
select t.eq((select title || '|' || version from public.posts where id = :'p1'), 'T-fields|9', '방어층: 그때 글은 바뀌지 않았다');
select set_config('app.post_rpc', 'on', true); -- 게이트(migration 4)를 열어 정책 단계의 동작만 본다
select t.rows('authenticated', :'uid_b', format($q$update public.posts set title = 'direct' where id = %L$q$, :'p1'), 1, '방어층 대조: 같은 정책 아래에서 직접 UPDATE 문은 남의 글을 바꿔 버린다(위의 forbidden이 RPC 조건 덕분임을 확인)');
rollback to savepoint invoker_checks;

drop policy posts_delete_own on public.posts;
create policy posts_delete_any on public.posts for delete to authenticated using (true);
select t.val('authenticated', :'uid_b', format($q$select result from public.delete_post(%L, 9)$q$, :'p1'), 'forbidden', '방어층: DELETE 정책이 모두 허용이어도 delete_post는 남의 글을 forbidden으로 막는다');
select t.count('postgres', null, format('select 1 from public.posts where id = %L', :'p1'), 1, '방어층: 그때 글이 남아 있다');
select set_config('app.post_rpc', 'on', true);
select t.rows('authenticated', :'uid_b', format('delete from public.posts where id = %L', :'p1'), 1, '방어층 대조: 같은 정책 아래에서 직접 DELETE 문은 남의 글을 지워 버린다');
rollback to savepoint invoker_checks;

-- 원래대로 돌아왔는지(롤백한 savepoint가 정책·권한을 되살렸는지) 확인
select t.val('authenticated', :'uid_a', format($q$select result from public.update_post(%L, 1, 'back-to-normal')$q$, :'p5'), 'ok', '복구 확인: 정책·권한이 되돌아와 수정이 된다');

rollback;
\echo 'post_mutations.sql: 모든 검사 통과'
