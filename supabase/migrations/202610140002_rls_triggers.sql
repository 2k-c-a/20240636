-- 08단계 migration 2/3: 테이블·컬럼 권한(GRANT), RLS 정책, 불변 컬럼·표시명·version·시각 트리거.
--
-- Supabase는 public 스키마의 새 테이블·함수에 anon·authenticated·service_role 권한을 기본으로 부여한다(기본 권한).
-- 테이블의 RLS 활성화와 기본 권한 회수는 테이블을 만드는 202610140001에서 이미 했다(파일 사이에 열린 틈이 없게). 여기서는 필요한 것만 다시 연다.
-- 이 파일에서 새로 만드는 트리거 함수의 기본 실행 권한은 같은 파일 끝에서 회수한다.
-- service_role(Secret key)은 RLS를 우회하는 역할이며 일반 사용자 요청에 쓰지 않는다. 그 경우에도 아래 트리거는 동작한다.

-- ---------------------------------------------------------------------------------------------
-- 권한
-- ---------------------------------------------------------------------------------------------
-- profiles: 로그인한 회원만. 만들 때는 id·nickname만, 고칠 때는 nickname만 줄 수 있다(생성·수정 시각은 트리거가 정한다). 삭제는 주지 않는다.
grant select on table public.profiles to authenticated;
grant insert (id, nickname) on table public.profiles to authenticated;
grant update (nickname) on table public.profiles to authenticated;

-- posts: 읽기는 누구나. 쓰기는 회원만이며 작성자·표시명·version·시각·id는 사용자가 정할 수 없다.
grant select on table public.posts to anon, authenticated;
grant insert (author_id, title, body, algorithm_id) on table public.posts to authenticated;
grant update (title, body, algorithm_id) on table public.posts to authenticated;
grant delete on table public.posts to authenticated;

-- ---------------------------------------------------------------------------------------------
-- RLS 정책. auth.uid()는 (select ...)로 감싸 행마다 다시 계산하지 않게 한다.
-- ---------------------------------------------------------------------------------------------
create policy profiles_select_own on public.profiles
    for select to authenticated
    using (id = (select auth.uid()));

create policy profiles_insert_own on public.profiles
    for insert to authenticated
    with check (id = (select auth.uid()));

create policy profiles_update_own on public.profiles
    for update to authenticated
    using (id = (select auth.uid()))
    with check (id = (select auth.uid()));
-- profiles의 DELETE 정책은 일부러 만들지 않는다(일반 API에서는 삭제 금지).

create policy posts_select_public on public.posts
    for select to anon, authenticated
    using (true);

create policy posts_insert_own on public.posts
    for insert to authenticated
    with check (author_id = (select auth.uid()));

create policy posts_update_own on public.posts
    for update to authenticated
    using (author_id = (select auth.uid()))
    with check (author_id = (select auth.uid()));

create policy posts_delete_own on public.posts
    for delete to authenticated
    using (author_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- 트리거 (모두 SECURITY INVOKER: 호출한 사용자의 권한으로 실행되며 RLS도 그대로 적용된다)
-- ---------------------------------------------------------------------------------------------

-- profiles: 시각은 DB가 정하고 id·created_at은 바꿀 수 없다.
create function public.profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if tg_op = 'INSERT' then
        new.created_at := clock_timestamp();
        new.updated_at := new.created_at;
    else
        if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
            raise exception 'immutable_column' using errcode = '23514', detail = 'profiles.id와 created_at은 바꿀 수 없습니다.';
        end if;
        new.updated_at := clock_timestamp();
    end if;
    return new;
end;
$$;

create trigger profiles_guard
    before insert or update on public.profiles
    for each row execute function public.profiles_guard();

-- posts 작성: 표시명은 호출자가 아니라 profiles의 닉네임에서 복사한다. 프로필이 없으면 거부한다.
-- version·시각은 사용자 입력과 상관없이 DB가 정한다. 호출자는 자기 프로필만 볼 수 있으므로 남의 author_id로 넣으면
-- 프로필을 찾지 못해 여기서 거부된다(RLS의 WITH CHECK도 같은 결과를 막는다).
create function public.posts_guard_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    select p.nickname into new.author_display_name
      from public.profiles as p
     where p.id = new.author_id;
    if not found then
        raise exception 'profile_required' using errcode = 'P0001', detail = '프로필이 없어 글을 쓸 수 없습니다.';
    end if;
    new.version := 1;
    new.created_at := clock_timestamp();
    new.updated_at := new.created_at;
    return new;
end;
$$;

create trigger posts_guard_insert
    before insert on public.posts
    for each row execute function public.posts_guard_insert();

-- posts 수정: id·작성자·작성 당시 표시명·생성 시각은 바꿀 수 없다(권한이 넓은 역할도 마찬가지).
-- 성공한 수정마다(값이 같아도) version을 1 올리고 updated_at을 갱신한다. 호출자가 version을 정해도 무시한다.
create function public.posts_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.id is distinct from old.id
       or new.author_id is distinct from old.author_id
       or new.author_display_name is distinct from old.author_display_name
       or new.created_at is distinct from old.created_at then
        raise exception 'immutable_column' using errcode = '23514', detail = 'posts의 id·author_id·author_display_name·created_at은 바꿀 수 없습니다.';
    end if;
    new.version := old.version + 1;
    new.updated_at := clock_timestamp();
    return new;
end;
$$;

create trigger posts_guard_update
    before update on public.posts
    for each row execute function public.posts_guard_update();

-- 트리거 함수는 직접 호출하는 용도가 아니다. 사용자 역할이 실행(RPC 노출)할 수 없게 한다. 트리거 실행에는 영향이 없다.
revoke all on function public.profiles_guard() from public, anon, authenticated;
revoke all on function public.posts_guard_insert() from public, anon, authenticated;
revoke all on function public.posts_guard_update() from public, anon, authenticated;
