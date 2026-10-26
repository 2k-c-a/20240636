-- 기존 글·회원 데이터를 유지하고 댓글만 추가합니다. migration 1~5 적용 후 한 번 실행합니다.
begin;

create table public.comments (
    id uuid primary key default gen_random_uuid(),
    post_id uuid not null references public.posts(id) on delete cascade,
    author_id uuid not null references public.profiles(id) on delete cascade,
    author_display_name text not null,
    body text not null,
    created_at timestamptz not null default clock_timestamp(),
    constraint comments_body_length check (char_length(body) between 1 and 2000),
    constraint comments_body_content check (body ~ '[^\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]')
);
alter table public.comments enable row level security;
revoke all on table public.comments from public, anon, authenticated, service_role;
grant select on table public.comments to anon, authenticated;
grant insert (post_id, author_id, body) on table public.comments to authenticated;
grant delete on table public.comments to authenticated;

create index comments_post_created_idx on public.comments(post_id, created_at desc, id desc);

create policy comments_select_public on public.comments
    for select to anon, authenticated using (true);
create policy comments_insert_own on public.comments
    for insert to authenticated with check (author_id = (select auth.uid()));
create policy comments_delete_own on public.comments
    for delete to authenticated using (author_id = (select auth.uid()));

create function public.comments_guard_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.author_id is distinct from (select auth.uid()) then
        raise exception 'not_authorized' using errcode = '42501';
    end if;
    select p.nickname into new.author_display_name
      from public.profiles as p where p.id = new.author_id;
    if not found then
        raise exception 'profile_required' using errcode = 'P0001';
    end if;
    new.created_at := clock_timestamp();
    return new;
end;
$$;
revoke all on function public.comments_guard_insert() from public, anon, authenticated;

create trigger comments_guard_insert before insert on public.comments
    for each row execute function public.comments_guard_insert();

commit;
