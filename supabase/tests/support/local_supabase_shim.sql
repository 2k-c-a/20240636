-- 로컬 테스트 전용. 실제 Supabase 프로젝트에서는 절대 실행하지 않는다.
--
-- 빈 로컬 PostgreSQL에서 migration과 테스트를 돌리기 위해 Supabase가 미리 만들어 두는 것 중 우리 SQL이 쓰는 최소한만 흉내 낸다:
--   - 역할 anon, authenticated, service_role (service_role은 RLS를 우회한다)
--   - auth.users(id만 의미 있음)와 auth.uid() (JWT claim의 sub를 읽는다)
--   - public 스키마의 새 테이블·함수에 세 역할 권한을 기본으로 주는 "기본 권한"(Supabase의 실제 기본 동작).
--     이게 있어야 migration의 REVOKE가 실제로 필요한지(빠뜨리면 테스트가 실패하는지) 확인할 수 있다.
-- 진짜 GoTrue(Auth) 서버의 동작(JWT 서명 검증, 이메일 확인 등)은 흉내 내지 않는다.

-- 실제 Supabase로 보이면(auth 스키마가 이미 있거나 supabase_admin 역할이 있으면) 아무것도 바꾸지 않고 중단한다.
do $$
begin
    if exists (select 1 from pg_namespace where nspname = 'auth')
       or exists (select 1 from pg_roles where rolname = 'supabase_admin') then
        raise exception '이 파일은 Supabase의 auth 스키마가 없는 빈 로컬 PostgreSQL에서만 실행합니다. 실제 Supabase 프로젝트로 보입니다. 중단합니다.';
    end if;
end;
$$;

-- 역할은 클러스터 전체에 하나뿐이므로 같은 클러스터에 데이터베이스를 여러 개 만들어 쓸 때를 위해 없을 때만 만든다.
do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin noinherit bypassrls;
    end if;
end;
$$;

create schema auth;
comment on schema auth is 'LOCAL_TEST_SHIM';

create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    created_at timestamptz not null default now()
);

-- Supabase의 auth.uid()와 같은 규칙: request.jwt.claim.sub 또는 request.jwt.claims(JSON)의 sub. 없으면 null.
create function auth.uid()
returns uuid
language sql
stable
as $$
    select coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
