-- 코드 리뷰 반영 migration 4/4: 글 수정·삭제를 update_post / delete_post RPC로만 할 수 있게 한다.
--
-- 문제: authenticated에게 posts의 UPDATE·DELETE 권한이 있고 정책은 작성자만 확인하므로, 작성자가 Data API(PATCH/DELETE)로
-- RPC를 거치지 않고 직접 쓰면 expected_version 검사가 없다. 오래된 화면이 최신 글을 조용히 덮어쓸 수 있다(낙관적 동시성 우회).
--
-- 해결: RPC는 SECURITY INVOKER 그대로 두어(호출자의 컬럼 권한·RLS가 계속 적용된다) 권한을 줄이지 않고, 두 RPC가 UPDATE·DELETE 직전에
-- 트랜잭션 안에서만 유지되는 설정값 app.post_rpc = 'on'을 켠다. 새 BEFORE UPDATE/DELETE 트리거가 RLS를 적용받는 역할(RLS를 우회하지 않는 역할)의
-- 요청에서 이 값이 없으면 42501(rpc_required)로 거부한다. 사용자는 PostgREST로 공개 스키마의 함수만 부를 수 있고 set_config를 직접 부를 수 없으며,
-- 요청 하나는 트랜잭션 하나이므로 RPC를 부른 뒤 같은 트랜잭션에서 직접 쓰기를 이어 붙일 수 없다. 이 가정이 깨지는 노출 함수를 만들면 안 된다.
-- service_role·postgres 같은 RLS 우회 역할(관리 작업)은 막지 않는다.
--
-- 이미 SQL Editor로 적용한 migration 1~3은 고치지 않고 이 파일만 새로 적용한다. 아래 함수 두 개는 같은 이름·인자·반환 형식의 재정의다(CREATE OR REPLACE).

create function public.posts_require_rpc()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if coalesce(current_setting('app.post_rpc', true), '') <> 'on'
       and not exists (
           select 1 from pg_catalog.pg_roles as r
            where r.rolname = current_user and (r.rolsuper or r.rolbypassrls)
       ) then
        raise exception 'rpc_required' using errcode = '42501', detail = '글 수정·삭제는 update_post·delete_post로만 할 수 있습니다.';
    end if;
    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

-- 이름 순서로 posts_00_...이 posts_guard_update보다 먼저 실행되어 거부 사유가 명확하다.
create trigger posts_00_require_rpc
    before update or delete on public.posts
    for each row execute function public.posts_require_rpc();

revoke all on function public.posts_require_rpc() from public, anon, authenticated;

create or replace function public.update_post(
    p_id uuid,
    p_expected_version integer,
    p_title text default null,
    p_body text default null,
    p_algorithm_id text default null,
    p_set_algorithm_id boolean default false
)
returns table (
    result text,
    id uuid,
    author_id uuid,
    author_display_name text,
    title text,
    body text,
    algorithm_id text,
    version integer,
    created_at timestamptz,
    updated_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
    v_uid uuid := auth.uid();
    v_set_algorithm boolean := coalesce(p_set_algorithm_id, false);
    v_row public.posts;
    v_author uuid;
    v_exists boolean;
begin
    -- 필드 규칙(누락과 null의 구분):
    --   p_title, p_body: NULL이면 "변경 없음"이다. 제목·본문을 null로 만드는 요청은 API가 422로 거부하므로 DB에는 오지 않는다.
    --   algorithm_id: p_set_algorithm_id가 true일 때만 바꾼다. 이때 p_algorithm_id가 NULL이면 알고리즘 연결 제거다.
    if p_id is null or p_expected_version is null then
        raise exception 'invalid_argument' using errcode = '22004', detail = 'p_id와 p_expected_version은 null일 수 없습니다.';
    end if;
    if p_algorithm_id is not null and not v_set_algorithm then
        raise exception 'invalid_argument' using errcode = '22023', detail = 'p_algorithm_id를 주려면 p_set_algorithm_id를 true로 해야 합니다.';
    end if;
    if p_title is null and p_body is null and not v_set_algorithm then
        raise exception 'no_fields_to_update' using errcode = '22023', detail = '바꿀 필드가 없습니다.';
    end if;

    perform set_config('app.post_rpc', 'on', true); -- 아래 UPDATE가 이 RPC를 거친다는 표시(트리거 posts_00_require_rpc가 확인)
    update public.posts as p
       set title = coalesce(p_title, p.title),
           body = coalesce(p_body, p.body),
           algorithm_id = case when v_set_algorithm then p_algorithm_id else p.algorithm_id end
     where p.id = p_id
       and p.author_id = v_uid
       and p.version = p_expected_version
    returning p.* into v_row;

    if found then
        return query select 'ok'::text, v_row.id, v_row.author_id, v_row.author_display_name, v_row.title, v_row.body,
                            v_row.algorithm_id, v_row.version, v_row.created_at, v_row.updated_at;
        return;
    end if;

    select p.author_id into v_author from public.posts as p where p.id = p_id;
    v_exists := found;
    return query select case
                            when not v_exists then 'not_found'
                            when v_author is distinct from v_uid then 'forbidden'
                            else 'version_conflict'
                        end,
                        null::uuid, null::uuid, null::text, null::text, null::text, null::text, null::integer, null::timestamptz, null::timestamptz;
end;
$$;

create or replace function public.delete_post(
    p_id uuid,
    p_expected_version integer
)
returns table (result text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_uid uuid := auth.uid();
    v_author uuid;
    v_exists boolean;
begin
    if p_id is null or p_expected_version is null then
        raise exception 'invalid_argument' using errcode = '22004', detail = 'p_id와 p_expected_version은 null일 수 없습니다.';
    end if;

    perform set_config('app.post_rpc', 'on', true); -- 아래 DELETE가 이 RPC를 거친다는 표시(트리거 posts_00_require_rpc가 확인)
    delete from public.posts as p
     where p.id = p_id
       and p.author_id = v_uid
       and p.version = p_expected_version;

    if found then
        return query select 'ok'::text;
        return;
    end if;

    select p.author_id into v_author from public.posts as p where p.id = p_id;
    v_exists := found;
    return query select case
                            when not v_exists then 'not_found'
                            when v_author is distinct from v_uid then 'forbidden'
                            else 'version_conflict'
                        end;
end;
$$;

-- 권한은 migration 3과 같다(CREATE OR REPLACE는 기존 권한을 유지하지만 이 파일만으로도 의도가 보이게 다시 적는다).
revoke all on function public.update_post(uuid, integer, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.delete_post(uuid, integer) from public, anon, authenticated;
grant execute on function public.update_post(uuid, integer, text, text, text, boolean) to authenticated;
grant execute on function public.delete_post(uuid, integer) to authenticated;
