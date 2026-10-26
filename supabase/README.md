# Supabase 데이터베이스 (프로필·게시글)

회원 프로필과 게시판 글의 테이블, 제약, 접근 권한(RLS), 동시 수정 방지 RPC를 SQL migration으로 관리합니다. 저장소만 복제해서는 원래 Supabase 프로젝트의 설정이 복제되지 않으므로, 새 프로젝트에서는 아래 순서대로 이 SQL을 적용합니다. 계약(컬럼·제약·RPC 인자와 결과)은 [docs/CONTRACTS.md](../docs/CONTRACTS.md) §10이 최종본입니다.

## 구성

```text
supabase/
├── migrations/
│   ├── 202610140001_profiles_posts.sql   테이블, CHECK 제약, 인덱스, 그리고 테이블을 바로 잠그는 RLS 활성화·기본 권한 회수
│   ├── 202610140002_rls_triggers.sql     필요한 권한(GRANT), RLS 정책, 불변 컬럼·표시명·version·시각 트리거
│   ├── 202610140003_post_mutations.sql   update_post / delete_post (SECURITY INVOKER, 낙관적 동시성)
│   └── 202610160001_posts_rpc_only.sql   직접 UPDATE·DELETE 거부 트리거(RPC만 version 검사 통과), 두 RPC 재정의
└── tests/
    ├── after_migration_1.sql    migration 1만 적용한 직후: 아무도(비회원·회원) 읽기·쓰기 불가
    ├── after_migration_2.sql    migration 1·2까지 적용한 직후(RPC 없음): 쓰기 규칙이 이미 안전
    ├── rls.sql                  권한·RLS·제약·트리거 (비회원 / 회원 A·B / 프로필 없는 회원 / 관리자를 실제 역할로 전환해 확인)
    ├── post_mutations.sql       RPC 결과 4가지·우선순위·입력 검증·SECURITY INVOKER
    ├── concurrency.mjs          같은 version의 동시 요청 (서로 다른 DB 접속 여러 개)
    └── support/
        ├── local_supabase_shim.sql   로컬 PostgreSQL 전용: Supabase의 역할·auth 스키마를 흉내 낸다
        └── test_helpers.sql          테스트 도구(역할 전환, 단언)
```

migration은 **이 순서대로** 적용합니다. 비어 있는 프로젝트(`public.profiles`, `public.posts`가 없는 곳)를 전제로 하며, 되돌리는(down) migration은 만들지 않았습니다.

**파일 사이에 열린 틈이 없습니다.** 파일은 하나씩 따로 적용될 수 있고(SQL Editor, 파일마다 별도 트랜잭션인 CLI) 새 테이블에 `anon`·`authenticated` 권한을 기본으로 주는 Supabase 프로젝트도 있습니다. 그래서 테이블을 만드는 첫 파일(`…0001`)이 **같은 트랜잭션 안에서** RLS를 켜고 기본 권한을 모두 회수합니다. 첫 파일만 적용한 상태에서는 비회원·회원 모두 읽기·쓰기가 막혀 있고(`service_role`만 접근), `…0002`가 필요한 권한·정책·트리거를 열며, `…0003`이 RPC를 추가하고, migration 4(`202610160001_…`)가 RPC를 거치지 않은 직접 수정·삭제를 거부합니다(RPC를 부를 때만 트랜잭션 안에서 설정값 `app.post_rpc`를 켜는 방식이며 SECURITY DEFINER는 쓰지 않습니다). 함수를 만드는 파일도 같은 파일 안에서 기본 실행 권한을 회수합니다. 이 규칙은 `after_migration_1.sql`·`after_migration_2.sql`(적용 직후 상태)과 `tests/db`의 정적 테스트가 지킵니다.

## 새 프로젝트에 적용하기

### 1. 적용 전 점검 (기존 데이터를 지우지 않기 위해)

Supabase 대시보드의 SQL Editor에서 먼저 아래를 실행해 **첫 조회의 profiles/posts가 모두 null이고, 둘째 조회가 0행인지** 확인합니다. 첫 조회는 null 값이어도 결과 행 하나를 반환합니다.

```sql
select to_regclass('public.profiles') as profiles, to_regclass('public.posts') as posts;
select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and proname in ('update_post', 'delete_post', 'profiles_guard', 'posts_guard_insert', 'posts_guard_update');
```

이미 있는 테이블이나 함수가 보이면 **적용하지 말고** 현재 정의를 이 migration과 비교(diff)해서 충돌을 조정합니다. 이 migration은 기존 테이블을 `drop`하거나 데이터를 지우지 않으며, 이미 있으면 `create table`이 오류로 멈춥니다.

### 2. 적용

아래 중 하나를 고릅니다. 다섯 파일은 각각 하나의 트랜잭션으로 실행되어야 하며(중간에 실패하면 그 파일은 아무것도 남기지 않음) 순서를 지켜야 합니다.

- **SQL Editor**: 파일을 순서대로 하나씩 붙여 넣어 실행합니다.
- **psql**: `psql "<접속 문자열>" -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations/<파일>`을 파일마다 실행합니다. 접속 문자열에는 비밀번호가 들어 있으므로 문서·Git·로그에 남기지 않습니다.
- **Supabase CLI**: `supabase db push`. 이 저장소에서는 CLI를 설치하지 않아 이 방법은 확인하지 않았습니다.

### 3. 적용 뒤 확인

SQL Editor에서 두 테이블의 RLS가 켜져 있는지, 정책이 아래 개수인지 봅니다(`profiles` 3개, `posts` 4개).

```sql
select c.relname, c.relrowsecurity from pg_class c where c.oid in ('public.profiles'::regclass, 'public.posts'::regclass);
select tablename, count(*) from pg_policies where schemaname = 'public' group by tablename;
```

> `tests/*.sql`은 **실제 Supabase 프로젝트에서 실행하지 않습니다.** 테스트 사용자를 `auth.users`에 직접 넣기 때문에, 로컬 shim이 없으면 시작 단계에서 스스로 중단합니다. 실제 프로젝트의 권한·RLS는 Supabase Auth로 만든 테스트 계정으로 API와 Data API를 통해 확인합니다(13단계).

## 로컬에서 검증하기

PostgreSQL이 설치된 컴퓨터에서 **설치 없이** 일회용 임시 클러스터로 모든 테스트를 실행합니다.

```powershell
npm run test:db
```

- 이미 설치된 `initdb`·`postgres`·`psql`을 PATH, `PG_BIN` 환경 변수, 일반적인 설치 위치(Windows의 `Program Files\PostgreSQL`, Linux의 `/usr/lib/postgresql`, macOS의 Homebrew·Postgres.app)에서 찾습니다. 찾지 못하면 "실행하지 않음"을 알리고 종료 코드 2로 끝납니다(통과가 아닙니다).
- 임시 폴더에 빈 클러스터를 만들고 `127.0.0.1`의 빈 포트에서 일회용 비밀번호로만 엽니다. 실행 중인 다른 PostgreSQL 서비스나 Supabase 프로젝트에는 접속하지 않으며, `PG*` 환경 변수와 `.env`는 읽지 않습니다. 끝나면 서버를 멈추고 폴더를 지웁니다.
- 빈 데이터베이스에 `local_supabase_shim.sql`과 migration을 적용한 뒤 네 가지를 각각 새 데이터베이스에서 실행합니다: `migration_steps`(migration을 **하나씩** 적용하고 그 직후 상태를 `after_migration_1.sql`·`after_migration_2.sql`로 검사), `rls`, `post_mutations`, `concurrency`.
- `npm test`에도 같은 테스트가 포함되어 있으며 PostgreSQL이 없으면 이유를 표시하고 건너뜁니다.
- 일부만 실행: `node scripts/run-db-tests.mjs --only rls`(쉼표로 여러 개 가능: `--only rls,post_mutations`). **쓸 수 있는 이름은 `migration_steps`, `rls`, `post_mutations`, `concurrency`뿐이며 다른 이름이나 값 없는 `--only`는 오류(종료 코드 1)입니다.** 실행된 검사가 하나도 없으면 통과가 아니라 실패(종료 코드 1)입니다.
- 다른 migration 폴더로 실행: `--migrations <폴더>`, 다른 테스트 폴더로 실행: `--tests <폴더>`(안에 `support/local_supabase_shim.sql`이 있어야 함), 검사마다 출력: `--verbose`.

### 무엇을 확인하고 무엇을 확인하지 않는가

확인하는 것(로컬 PostgreSQL에서):

- 빈 데이터베이스에 migration을 순서대로 적용하면 같은 스키마·RLS·RPC가 만들어진다. 파일을 하나씩 적용한 **중간 상태**(1만 적용, 1·2까지 적용)에서도 비회원이 읽고 쓸 수 없거나(1) 최종과 같은 쓰기 규칙이 적용된다(2).
- 비회원 / 회원 A / 회원 B / 프로필 없는 회원 / 관리자(service_role)를 `SET ROLE`로 **실제 역할로 전환**해서 조회·작성·수정·삭제를 시험한다(테스트를 돌리는 접속은 관리자 권한이라 그대로 실행하면 모든 것이 성공하므로, 전환이 되었는지 매번 확인한다).
- 타인 `author_id`로 삽입, `author_id`·`created_at`·`version`·표시명·시각 변조, 길이·공백·허용 ID 위반, 닉네임 규칙을 거부한다. 권한이 넓은 역할(service_role)도 불변 컬럼은 트리거가 막는다.
- RPC의 결과 `ok / not_found / forbidden / version_conflict`와 우선순위, 필드 누락과 null의 구분, `SECURITY INVOKER`(컬럼 권한·정책을 일부러 빼면 RPC도 실패함).
- 같은 version의 동시 요청(8개 접속 × 여러 번, 잠금을 쥔 채 기다리는 접속)에서 정확히 하나만 성공한다.

확인하지 않은 것:

- **실제 Supabase 프로젝트에 적용**한 결과, 기존 데이터베이스와의 diff.
- Supabase의 PostgREST(Data API)·Auth(GoTrue)·JWT 서명 검증 경로. 로컬 shim은 `auth.uid()`가 JWT claim의 `sub`를 읽는 규칙과 기본 권한만 흉내 낸다.
- Supabase가 쓰는 PostgreSQL 버전(15·17 등)과의 차이. 이 저장소는 PostgreSQL 18.3(Windows)에서만 실행했다.
- `READ COMMITTED` 이외의 격리 수준(PostgREST 기본은 `READ COMMITTED`). `REPEATABLE READ` 이상에서는 동시 수정이 `version_conflict` 대신 직렬화 오류(40001)로 끝날 수 있다.
- 로케일: 로컬 클러스터는 `C` 로케일이다. 공백 정의는 문자 코드로 직접 적었으므로 로케일에 영향을 받지 않도록 했지만 다른 로케일에서 실행해 보지는 않았다.

## RPC 결과를 HTTP 상태로 바꾸기 (11단계)

| `result` | 의미 | HTTP |
|---|---|---|
| `ok` | 수정·삭제 성공 | 200(수정, 새 ETag) · 204(삭제) |
| `not_found` | 글이 없거나 이미 삭제됨 | 404 |
| `forbidden` | 본인 글이 아님 | 403 |
| `version_conflict` | 기대한 version과 현재 version이 다름 | 412 |

우선순위는 `not_found` → `forbidden` → `version_conflict`입니다. 입력 오류는 결과 값이 아니라 SQLSTATE 예외로 오며(`23514` 제약 위반, `22023`·`22004` 잘못된 인자), 정상 경로에서는 API가 먼저 검증하므로 도달하지 않아야 합니다. 자세한 인자와 규칙은 CONTRACTS §10을 보세요.


## 현재 프로젝트 적용 상태 (2026-10-16)

**`202610160001_posts_rpc_only.sql`(migration 4)은 아직 이 프로젝트에 적용하지 않았다.** 적용하기 전에는 작성자가 Data API로 PATCH/DELETE를 직접 보내 version 검사를 우회할 수 있다. SQL Editor에서 이 파일만 한 번 실행하면 되며(앞의 세 migration은 다시 실행하지 않는다), 적용 뒤 `posts`에 `posts_00_require_rpc` 트리거가 보이고 RPC가 계속 `ok`를 돌려주는지 확인한다.

`webproject` (`wchcazqtlvczctugnkst`)에 세 migration의 정의를 SQL Editor에서 순서대로 하나의 트랜잭션으로 적용했다. `profiles` RLS/정책 3개, `posts` RLS/정책 4개, 두 RPC의 SECURITY INVOKER를 카탈로그 조회로 확인했다. CLI migration 이력은 등록하지 않았으므로 같은 SQL을 다시 push/실행하지 않는다. 실제 사용자 A/B의 Auth·Data API 통합 검증은 남아 있다. 상세 결과와 환경 제한은 [ACCEPTANCE.md](../docs/ACCEPTANCE.md)의 Supabase 실제 프로젝트 설정 기록을 참고한다.


실제 적용 전에는 기존 객체를 비교하며, 기존 개발 프로젝트의 적용 기록이 새로 clone한 사람의 프로젝트에도 적용됐다는 의미는 아닙니다. API URL·Publishable key·Auth 이메일 설정은 개발자 본인이 별도로 준비합니다. 서버 소스 공유는 DB 복제가 아닙니다.


## 학습 알고리즘 확장 (migration 5)

`202610250001_learning_algorithms.sql`은 게시글 algorithm_id 허용 목록에 union-find·dijkstra·knapsack·topological-sort·two-pointers를 추가합니다. 기존 1~4 적용 프로젝트에는 **이 새 파일만** 전체를 한 트랜잭션으로 실행합니다. 새 빈 프로젝트에는 파일명 순서로 5개를 적용합니다. 데이터·테이블을 삭제하거나 예전 파일을 다시 실행하지 않습니다. 이번 개발에서는 실제 Supabase에 적용하지 않았습니다. 학습 trace는 DB 적용 없이 사용 가능합니다.
