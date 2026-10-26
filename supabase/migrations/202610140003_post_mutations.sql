-- 08단계 migration 3/3: 게시글 수정·삭제 RPC (낙관적 동시성 제어).
--
-- 두 함수는 SECURITY INVOKER다. 호출한 사용자의 권한으로 실행되므로 컬럼 권한과 RLS가 그대로 적용된다(SECURITY DEFINER가 아니다).
-- 결과는 항상 result 한 줄이다: ok / not_found / forbidden / version_conflict. API(11단계)가 각각 200·204 / 404 / 403 / 412로 바꾼다.
--
-- 원자성: 소유자·version 확인과 변경을 "하나의 UPDATE/DELETE 문"의 WHERE 조건(id + auth.uid() + 기대 version)으로 처리한다.
-- 같은 version을 가진 요청 둘이 동시에 오면 하나가 행 잠금을 얻어 먼저 바꾸고, 나머지는 잠금이 풀린 뒤 바뀐 version으로 조건을
-- 다시 평가해 0행이 되어 version_conflict가 된다(READ COMMITTED, PostgREST 기본). SELECT로 먼저 확인한 뒤 UPDATE하는 방식이 아니다.
-- 0행일 때만 별도 조회로 원인을 가린다. 우선순위는 not_found → forbidden → version_conflict이다.

create function public.update_post(
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

create function public.delete_post(
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

-- 로그인한 회원만 실행할 수 있다. 비회원(anon)과 PUBLIC에는 주지 않는다.
revoke all on function public.update_post(uuid, integer, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.delete_post(uuid, integer) from public, anon, authenticated;
grant execute on function public.update_post(uuid, integer, text, text, text, boolean) to authenticated;
grant execute on function public.delete_post(uuid, integer) to authenticated;
