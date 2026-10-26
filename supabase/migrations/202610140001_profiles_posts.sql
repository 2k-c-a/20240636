-- 08단계 migration 1/3: 프로필·게시글 테이블, CHECK 제약, 인덱스, 그리고 테이블을 바로 잠그는 RLS 활성화·기본 권한 회수.
-- 필요한 권한·정책·트리거는 202610140002, 수정·삭제 RPC는 202610140003에서 만든다. 세 파일은 이 순서로 적용한다.
-- 비어 있는 프로젝트(public.profiles, public.posts가 없는 곳)를 전제로 한다. 이미 있으면 적용하지 말고 supabase/README.md의 사전 점검을 따른다.
--
-- 공백 정의: 아래 CHECK의 문자 클래스 [\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000] 는
-- Python str.strip()이 지우는 문자(str.isspace)와 같은 집합이다. 서버(API)가 앞뒤 공백을 제거한 값을 보내므로 DB는 "이미 정리된 값"만 받는다.
-- 정규식의 \u 이스케이프는 표준 문자열 리터럴에서 정규식 엔진이 해석하므로 로케일(정렬·문자 분류 설정)에 영향을 받지 않는다.

create table public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    nickname text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint profiles_nickname_length
        check (char_length(nickname) between 2 and 20),
    constraint profiles_nickname_trimmed
        check (nickname !~ '^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]'
           and nickname !~ '[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$'),
    constraint profiles_nickname_no_control
        check (nickname !~ '[\u0001-\u001f\u007f]')
);

comment on table public.profiles is '회원 프로필. 본인만 조회·생성·닉네임 수정. 닉네임은 중복을 허용한다.';
comment on column public.profiles.nickname is '앞뒤 공백 없음, 2~20자, 제어 문자(U+0000~U+001F, U+007F) 불가.';

create table public.posts (
    id uuid primary key default gen_random_uuid(),
    author_id uuid not null references public.profiles (id) on delete cascade,
    author_display_name text not null,
    title text not null,
    body text not null,
    algorithm_id text,
    version integer not null default 1,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint posts_title_length
        check (char_length(title) between 1 and 100),
    constraint posts_title_trimmed
        check (title !~ '^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]'
           and title !~ '[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$'),
    constraint posts_body_length
        check (char_length(body) between 1 and 10000),
    constraint posts_body_not_blank
        check (body !~ '^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$'),
    constraint posts_algorithm_id_allowed
        check (algorithm_id is null or algorithm_id in ('bfs', 'dfs', 'binary-search', 'bubble-sort')),
    constraint posts_version_positive
        check (version > 0)
);

comment on table public.posts is '게시글. 누구나 조회, 회원 본인만 작성·수정·삭제. 동시 수정은 version으로 막는다.';
comment on column public.posts.author_display_name is '작성 당시 닉네임. 트리거가 profiles에서 복사하며 이후 닉네임이 바뀌어도 그대로다.';
comment on column public.posts.title is '앞뒤 공백 없음, 1~100자. 줄바꿈 등 가운데의 공백은 허용한다.';
comment on column public.posts.body is '1~10,000자, 공백만으로 이루어질 수 없다. 줄바꿈은 보존한다.';
comment on column public.posts.version is '1에서 시작하고 수정(값이 같아도)할 때마다 DB 트리거가 1 올린다.';

-- 접근 차단: 테이블을 만든 이 파일 안에서(같은 트랜잭션) 바로 잠근다. migration 파일은 하나씩 따로 적용될 수 있다(SQL Editor, 파일마다 별도 트랜잭션인 CLI).
-- Supabase는 public의 새 테이블에 anon·authenticated·service_role 권한을 기본으로 주므로, 여기서 잠그지 않으면 첫 파일을 적용한 직후부터
-- 둘째 파일을 적용하기 전까지 비회원이 읽고 쓸 수 있다(version·시각·표시명까지 직접 정할 수 있다). RLS를 켜고 기본 권한을 모두 회수하면 정책이 없는
-- 동안에는 service_role(RLS 우회 역할)만 접근한다. 필요한 권한과 정책은 202610140002에서 다시 연다.
alter table public.profiles enable row level security;
alter table public.posts enable row level security;
revoke all on table public.profiles from public, anon, authenticated;
revoke all on table public.posts from public, anon, authenticated;

-- 목록 정렬(created_at DESC, id DESC)과 작성자·알고리즘 필터. id는 같은 시각의 글의 순서를 고정한다.
create index posts_created_at_id_idx on public.posts (created_at desc, id desc);
create index posts_author_created_at_id_idx on public.posts (author_id, created_at desc, id desc);
create index posts_algorithm_created_at_id_idx on public.posts (algorithm_id, created_at desc, id desc);
