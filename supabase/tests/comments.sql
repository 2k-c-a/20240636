-- 실제 Supabase에서는 실행하지 않습니다. 로컬 테스트 전용 역할을 사용하고 모두 롤백합니다.
\set ON_ERROR_STOP on
begin;
\ir support/test_helpers.sql
insert into auth.users(id,email) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a@example.test'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','b@example.test'),
('cccccccc-cccc-4ccc-8ccc-cccccccccccc','c@example.test');
insert into public.profiles(id,nickname) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','앨리스'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','보브');
insert into public.posts(id,author_id,title,body) values
('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','질문','설명');
select t.run('anon', null, $$insert into public.comments(post_id,author_id,body) values ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','익명')$$,'42501','비회원 댓글 작성 거부');
select t.run('authenticated','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $$insert into public.comments(post_id,author_id,body) values ('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','위조')$$,'42501','다른 작성자 위조 거부');
select t.run('authenticated','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $$insert into public.comments(post_id,author_id,body) values ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','첫 댓글')$$,'ok','본인 댓글 작성');
select t.eq((select author_display_name from public.comments),'앨리스','표시명은 프로필에서 복사');
select t.rows('anon',null,'select * from public.comments',1,'비회원 공개 읽기');
select t.run('authenticated','cccccccc-cccc-4ccc-8ccc-cccccccccccc', $$insert into public.comments(post_id,author_id,body) values ('11111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc','미완성 프로필')$$,'P0001','프로필 없는 회원 거부');
select t.run('authenticated','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $$insert into public.comments(post_id,author_id,body) values ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',' ')$$,'23514','공백 댓글 거부');
select t.run('authenticated','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $$insert into public.comments(post_id,author_id,body) values ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('가',2001))$$,'23514','너무 긴 댓글 거부');
select t.run('authenticated','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $$update public.comments set body='수정'$$,'42501','임의 수정 권한 없음');
select t.rows('authenticated','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','delete from public.comments',0,'다른 회원 댓글 삭제 불가');
select t.rows('authenticated','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','delete from public.comments',1,'본인 댓글 삭제 가능');
select t.run('authenticated','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $$insert into public.comments(post_id,author_id,body) values ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','글과 함께 삭제될 댓글')$$,'ok','연쇄 삭제 준비');
select t.run('authenticated','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $$select * from public.delete_post('11111111-1111-4111-8111-111111111111',1)$$,'ok','RPC로 게시글 삭제');
select t.eq((select count(*) from public.comments)::text,'0','게시글 삭제 시 댓글 연쇄 삭제');
rollback;
