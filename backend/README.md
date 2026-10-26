# Python 백엔드

`../frontend`는 프런트엔드이며 기존 html, css, js, img, audio 폴더를 유지합니다.
백엔드는 FastAPI로 작성하고 Uvicorn으로 실행합니다.

로컬 실행과 Vercel 배포를 지원합니다. 배포 설정은 [Vercel 배포 안내](../docs/VERCEL.md)를 참고하세요. Supabase 연결은 인터넷이 필요하며 환경변수와 DB 설정을 준비해야 합니다. `.env`와 `.venv`는 업로드하지 않습니다.

## 사이트 이용자 가입 방식

사이트 이용자는 회원가입 화면에서 자신의 이메일 주소·비밀번호·닉네임을 입력합니다. Supabase 서비스 계정은 필요하지 않습니다. 아래 Supabase 프로젝트·환경 변수·이메일 발송 설정은 개발자/운영자용입니다. 이메일 확인을 사용하는 경우 Supabase Auth의 Email 공급자와 발송 설정을 준비하고 실제 수신·확인 링크까지 검증해야 합니다.

## 준비

- Python 3.12 (3.12.10에서 설치·실행·테스트를 확인했습니다.)
- Supabase 설정은 **학습 화면(시각화)에는 필요 없습니다.** 정적 웹과 `/api/health`는 Supabase 없이 실행됩니다. 회원 인증 API(`/api/me`)를 쓰려면 아래 "설정"을 해야 합니다.

## 실행 (PowerShell)

프로젝트 루트에서 다음 명령을 실행합니다.

```powershell
cd mobile/web/backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

이미 `.venv`가 있으면 생성 명령을 생략하세요. 가상환경 활성화 없이 해당 Python을 직접 사용하므로 PowerShell 실행 정책 변경이 필요 없습니다.

- 웹페이지: http://127.0.0.1:8000/ (`/web/html/index.html`로 이동합니다.)
- API 문서: http://127.0.0.1:8000/docs
- 서버 상태: http://127.0.0.1:8000/api/health

`requirements.txt`는 직접 의존성만 버전을 고정합니다. 이들이 끌어오는 간접 의존성은 설치 시점의 pip가 결정합니다.

## 설정

`.env.example`을 `backend/.env`로 복사해 값을 채웁니다(환경 변수가 있으면 `.env`보다 우선합니다. 값을 바꾼 뒤에는 서버를 다시 시작하세요).

| 이름 | 공개 여부 | 설명 |
|---|---|---|
| `SUPABASE_URL` | 공개 | 프로젝트 URL. `GET /api/config`로 브라우저에 전달됩니다. |
| `SUPABASE_PUBLISHABLE_KEY` | 공개 | Publishable key(`sb_publishable_…`). 서버 전용 키를 넣으면 형식이 달라 **인증이 꺼집니다**(잘못 넣은 키가 `/api/config`로 나가지 않게 하기 위해서입니다. 값은 로그에 남기지 않고 변수 이름만 알립니다). |
| `APP_ORIGIN` | 공개 | 이 앱을 여는 주소(경로 없이, 예: `http://127.0.0.1:8000`). `127.0.0.1`과 `localhost`는 다른 주소이니 한쪽만 쓰세요. |
| `SUPABASE_SECRET_KEY` | **비공개** | 서버 전용 Secret key(`sb_secret_…`). RLS를 우회하는 관리용이며 **일반 사용자 요청에는 쓰지 않습니다**(지금의 API는 사용하지 않습니다). 필요 없으면 비워 두세요. |
| `APP_ENV_FILE` | - | 다른 환경 파일의 경로. 빈 값이면 `.env`를 읽지 않습니다(테스트가 이렇게 합니다). |

세 공개 값이 모두 올바르게 있어야 `auth_enabled`가 true입니다. 하나라도 없거나 형식이 틀리면 인증 API는 `503 auth_not_configured`를 돌려주고 학습 화면은 그대로 동작합니다.

## API (인증·프로필)

| 경로 | 인증 | 설명 |
|---|---|---|
| `GET /api/config` | 없음 | `{supabase_url, supabase_publishable_key, app_origin, auth_enabled}`. Secret key는 어떤 경우에도 나가지 않고, 응답은 캐시하지 않습니다. 미설정이면 값은 모두 null이고 `auth_enabled:false`입니다. |
| `GET /api/me` | 필수 | `{id, email, nickname}`. 프로필이 없어도 200이며 `nickname`이 null입니다. |
| `POST /api/me/profile` | 필수 | `{nickname}`. 프로필이 없을 때만 만들고(201), 이미 있으면 기존 프로필을 그대로 돌려줍니다(200, 닉네임을 덮어쓰지 않음). |
| `PATCH /api/me/profile` | 필수 | `{nickname}`. 본인 프로필의 닉네임만 바꿉니다. 프로필이 없으면 404 `profile_not_found`. |

- 인증: `Authorization: Bearer <액세스 토큰>`. 서버는 토큰을 decode만 하지 않고 Supabase Auth의 `get_user`로 확인합니다. 헤더 없음 401 `unauthenticated`, 만료·위조·형식 오류 401 `invalid_token`, 확인 서비스 장애 503 `service_unavailable`(판정할 수 없으면 허용하지 않습니다).
- 사용자 ID는 **검증된 토큰에서만** 얻습니다. 요청 본문에 `id`·`author_id` 같은 정의되지 않은 필드가 있으면 422입니다.
- 일반 사용자 요청은 **Publishable key + 그 사용자의 토큰**으로 DB를 부르므로 RLS가 그 사용자 권한으로 판단합니다. Secret key나 전역 로그인 세션을 쓰지 않으며, 요청마다 클라이언트를 따로 만듭니다.
- 모든 응답에 서버가 만든 `X-Request-ID`가 있고, 오류 본문은 `{error: {code, message, request_id, fields?}}`입니다. 토큰·키·내부 예외 내용은 응답과 로그에 넣지 않습니다.
- 닉네임 규칙: 앞뒤 공백을 지운 뒤 2~20자, 제어 문자 불가, 중복 허용(DB의 CHECK가 같은 규칙을 강제합니다).

## API (게시판)

| 경로 | 인증 | 설명 |
|---|---|---|
| `GET /api/posts` | 없음 | `?limit=`(1~50, 기본 20) `&cursor=` `&algorithm=`. 최신순 `{items, next_cursor}`, 본문 제외. |
| `GET /api/posts/{id}` | 없음 | 글 상세 + `ETag`. |
| `POST /api/posts` | 필수 | `{title, body, algorithm_id?}` → 201 + `Location` + `ETag`. 프로필이 없으면 403 `profile_required`. |
| `PATCH /api/posts/{id}` | 필수 | `If-Match` 필수. `{title?, body?, algorithm_id?}`(누락=변경 없음, `algorithm_id:null`=연결 제거). |
| `DELETE /api/posts/{id}` | 필수 | `If-Match` 필수 → 204. |

- 오류 코드: 400 `invalid_cursor`, 403 `forbidden`·`profile_required`, 404 `not_found`, 412 `precondition_failed`, 422 `validation_error`, 428 `precondition_required`, 503 `service_unavailable`. 자세한 규칙과 검사 순서는 [CONTRACTS.md](../docs/CONTRACTS.md) §8.
- 수정·삭제는 DB의 `update_post`·`delete_post` RPC 하나로 처리해 같은 version의 동시 요청 중 하나만 성공합니다. 작성·수정·삭제는 응답을 받지 못해도 서버가 다시 보내지 않습니다.
- 읽기는 Publishable key로, 쓰기는 그 사용자의 토큰으로 Supabase를 부릅니다(RLS가 판단). Secret key를 쓰지 않습니다.
- 직접 PostgREST 쓰기 차단(`posts_00_require_rpc`)은 migration 4를 적용한 프로젝트에서만 동작합니다.

## 회원 화면과 Supabase Auth 설정 (10단계)

가입·로그인·복구는 브라우저의 Supabase SDK(`frontend/js/vendor/supabase.js`, 고정 버전)가 직접 처리하고, 이 서버는 `GET /api/config`로 공개 설정을 알려 주고 토큰을 검증하기만 합니다. 화면은 `signup.html`·`login.html`·`reset-password.html`·`auth-callback.html`·`profile.html`입니다.

Supabase 대시보드 **Authentication → URL Configuration**에서 다음을 맞춥니다(`127.0.0.1`과 `localhost`는 다른 주소이니 하나만 씁니다).

| 항목 | 값 |
|---|---|
| Site URL | `APP_ORIGIN`과 같은 값 (예: `http://127.0.0.1:8000`) |
| Redirect URLs | `http://127.0.0.1:8000/web/html/auth-callback.html` (이 주소 하나) |

- **비밀번호 최소 길이**: Authentication → Sign In / Providers(또는 Password settings)에서 **8자 이상**으로 설정합니다. 화면의 8자 검사는 안내용이며 서버 쪽 강제는 이 설정입니다.
- **이메일 확인**: 켜 두면 가입 후 확인 메일의 링크를 **가입한 같은 브라우저**에서 열어야 합니다(PKCE). 다른 브라우저에서 열면 "같은 브라우저에서 열어 주세요" 안내가 나옵니다.
- **테스트 이메일 조건**: 실제로 받을 수 있는 주소가 필요합니다. 기본 제공 메일 서버는 **시간당 발송 수가 매우 적고**(프로젝트 설정에 따라 다름) 팀 멤버가 아닌 주소로는 보내지 않을 수 있습니다. 제한에 걸리면 화면에 "메일 발송 횟수 제한" 안내가 나옵니다. 반복 시험이 필요하면 Supabase에 SMTP를 연결하세요.
- 복귀 경로는 `/web/html/<이름>.html`(쿼리 선택) 형태의 같은 사이트 경로만 허용하며, 그 밖의 값은 홈으로 보냅니다.

### 회원 화면 수동 확인 순서

기존 2026-10-17 사용자 확인 기록은 유지합니다. 아래 항목은 변경된 화면과 프로필 보완까지 확인하기 위한 절차입니다. 비밀번호나 인증 링크를 검증 기록에 붙이지 마세요.

1. 사이트에서 테스트 이메일·비밀번호·닉네임으로 가입하고 같은 브라우저에서 확인 메일을 엽니다. 확인 대기 안내와 최초 프로필 생성 여부를 확인합니다.
2. 로그인 후 새로고침해 로그인 유지와 메뉴를 확인하고 로그아웃합니다. 다른 사용자 계정으로 로그인했을 때 이메일·닉네임이 섞이지 않아야 합니다.
3. 프로필이 없는 테스트 사용자는 프로필 보완 화면에서 닉네임을 저장할 수 있어야 합니다. 프로필이 이미 있으면 가입 metadata로 닉네임을 덮어쓰지 않아야 합니다.
4. 비밀번호 재설정 메일을 요청하고 같은 브라우저에서 링크를 열어 변경합니다. 완료 안내에 포커스가 있어야 하고 새 비밀번호로 로그인할 수 있어야 합니다.
5. 만료된 링크·다른 브라우저에서 연 링크·서비스 장애에서 한국어 안내를 확인합니다. 인증 코드는 처리 직후 주소창에서 제거되어야 합니다.
6. 키보드로 양식을 제출합니다. 대기 중 중복 제출은 요청을 늘리지 않고 비밀번호 입력란은 비워져야 합니다. 실패 후 다시 시도할 수 있고, 대기 중 이동한 포커스를 완료 시 가져오지 않아야 합니다.

## 게시판 API 확인 (11단계)

목록·상세는 로그인 없이 읽습니다. 작성·수정·삭제에는 사이트 테스트 계정의 access token과 프로필이 필요합니다. Supabase 관리자 Secret key로 시험하지 마세요. 실제 DB 통합 검증은 `tests/integration/README.md`의 명시적 선택 실행 절차를 따릅니다.

| 요청 | 동작 |
|---|---|
| `GET /api/posts?limit=20&algorithm=bfs` | 최신순 요약 목록. 다음 페이지는 응답의 `next_cursor`를 cursor로 전달 |
| `GET /api/posts/{id}` | 상세와 ETag |
| `POST /api/posts` | title·body·선택적 algorithm_id로 작성, 201과 Location·ETag 반환 |
| `PATCH /api/posts/{id}` | If-Match 필수. 누락 필드는 유지, algorithm_id:null은 연결 제거 |
| `DELETE /api/posts/{id}` | If-Match 필수. 성공 시 204 |

수정·삭제는 DB RPC에서 소유권과 version을 함께 검사합니다. If-Match 누락은 428, 형식 오류는 422, 없는 글은 404, 타인 글은 403, 오래된 version은 412입니다. 412가 나오면 상세를 다시 읽고 변경 내용을 확인해야 합니다. 장애·응답 유실에 쓰기 요청을 자동 재전송하지 마세요.

UI 없이 확인하는 PowerShell 예시입니다. 본인 테스트 계정의 토큰을 `TEST_ACCESS_TOKEN` 환경 변수에 준비한 뒤 사용하며, 값을 문서·로그·Git에 적지 않습니다. 아래 요청은 실제로 테스트 글을 만들고 마지막에 그 글만 지웁니다.

```powershell
$base = 'http://127.0.0.1:8000'
$headers = @{ Authorization = "Bearer $env:TEST_ACCESS_TOKEN" }
$body = @{ title = 'API 확인'; body = '테스트 본문'; algorithm_id = 'bfs' } | ConvertTo-Json
$created = Invoke-WebRequest -Method Post -Uri "$base/api/posts" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $body
$post = $created.Content | ConvertFrom-Json
Invoke-RestMethod -Uri "$base/api/posts?limit=1"
$headers['If-Match'] = [string]$created.Headers['ETag']
$updated = Invoke-WebRequest -Method Patch -Uri "$base/api/posts/$($post.id)" -Headers $headers -ContentType 'application/json' -Body '{"algorithm_id":null}'
$headers['If-Match'] = [string]$updated.Headers['ETag']
Invoke-WebRequest -Method Delete -Uri "$base/api/posts/$($post.id)" -Headers $headers
```

cursor는 필터와 묶입니다. 필터 변경 시 이전 cursor를 버려야 합니다. 해석 불가·UTC 변환 범위 초과 cursor는 400 invalid_cursor, 저장할 수 없는 NUL·고립 유니코드 surrogate는 422 validation_error로 DB 호출 전에 거부합니다. 한글·이모지와 본문 줄바꿈은 허용합니다.

## 테스트

```powershell
cd mobile/web/backend
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest
```

테스트는 실제 `.env`나 Supabase에 접근하지 않습니다(`SUPABASE_*`·`APP_*` 환경변수를 지우고 `APP_ENV_FILE`을 빈 값으로 둡니다). 외부 인터넷에도 접속하지 않습니다.

- `test_static.py`: 정적 파일 제공, 리다이렉트, health, `.env`·백엔드 소스 비공개, 서버 시작 경로가 Supabase 패키지를 불러오지 않음.
- `test_config.py`: 공개 설정과 Secret key 비노출, 설정 읽기·검증.
- `test_auth.py`, `test_profiles.py`, `test_errors.py`: 토큰·검증 서비스 장애·A/B 분리·프로필 규칙·오류 형식(인증과 DB 경계는 가짜로 바꿈).
- `test_supabase_requests.py`: **실제 supabase 라이브러리**가 만드는 HTTP 요청을 가짜 Supabase(`httpx.MockTransport`)로 가로채 경로·본문·키·토큰·동시 요청·오류 번역을 확인.
- `test_posts.py`: 글 API 전체(목록 cursor·동률·필터, 상세·ETag, 작성·수정·삭제, `If-Match`, null/누락, 검사 순서, 소유권, 장애 503, 오류 형식).
- `test_pagination.py`: cursor·ETag 형식 검증(잘못된 값·필터 문법 주입 시도).
- `test_supabase_posts.py`: **실제 supabase 라이브러리**가 보내는 PostgREST 요청(쿼리·RPC 인자·키·토큰)과 오류 번역, 쓰기 재전송 없음.
- `integration/`: 실제 Supabase 개발 프로젝트로 하는 선택 실행 테스트(기본은 건너뜀, [README](tests/integration/README.md)).
- `test_live_server.py`: 실제 Uvicorn 서버와 실제 소켓의 가짜 Supabase 서버로 끝까지 확인.

일부 테스트는 임시 포트에 실제 Uvicorn 프로세스를 띄워 검사하므로 수십 초 걸립니다. **실제 Supabase 프로젝트로 하는 인증·RLS 통합 검증은 이 테스트에 포함되어 있지 않습니다**(개발 프로젝트가 필요합니다).

## 구조와 현재 상태

- `app/main.py`: `create_app()`이 FastAPI 앱을 만들고, 모듈 변수 `app`을 Uvicorn이 사용합니다(`app.main:app`). `Settings`로 정적 파일 폴더를 바꿀 수 있고, `config`·`token_verifier`·`profile_store`·`http_client`로 설정과 인증·DB 경계를 바꿀 수 있습니다(테스트용). 설정은 처음 쓸 때 읽습니다.
- 웹페이지는 `frontend`만 `/web` 아래에 공개합니다. `mobile/web` 전체나 `backend`를 공개하면 `.env`와 소스가 노출되므로 그렇게 하지 않습니다.
- `app/config.py`(설정), `app/errors.py`(공통 오류·요청 ID), `app/dependencies.py`(현재 사용자), `app/routers/config.py`·`me.py`(경로), `app/schemas/`(요청·응답 모델), `app/services/`(`supabase.py` 클라이언트·오류 번역, `auth.py` 토큰 검증, `profiles.py` 프로필 DB, `posts.py` 글 DB·RPC), `app/routers/posts.py`·`app/schemas/post.py`·`app/pagination.py`(게시판 API, cursor). 게시판 화면은 board.html·post.html이며 실제 A/B 사용자 화면 통합 검증은 남아 있습니다. 회원 화면(프런트엔드)은 위 "회원 화면과 Supabase Auth 설정"을 보세요.
- `app/services/supabase.py`: Supabase 클라이언트를 만듭니다. `create_anon_client`·`create_user_client`는 Publishable key만 쓰고 요청마다 새로 만들며, `create_admin_client`(Secret key, RLS 우회)는 일반 사용자 요청 경로에서 쓰지 않습니다. Supabase 패키지는 함수 안에서 불러오므로 서버 시작 경로(정적 페이지, `/api/health`)는 Supabase 패키지에 의존하지 않습니다.
- `/api/health`는 프로세스 생존만 확인하며 Supabase 연결 상태는 검사하지 않습니다.

## 보안 헤더와 통합 검증 (13단계)

사이트 페이지에는 로컬 스크립트·스타일, 설정된 Supabase origin의 연결, 지도 페이지의 Google frame만 허용하는 CSP를 적용합니다. 설정된 URL의 origin만 정책에 사용하며 키와 토큰은 헤더에 넣지 않습니다. 공통 응답에는 nosniff·클릭재킹 차단·no-referrer·카메라/마이크/위치 권한 비활성화 헤더를 적용합니다.

개발용 `/docs`·`/redoc`·`/docs/oauth2-redirect`는 FastAPI가 생성하는 inline/CDN 리소스를 사용하므로 사이트 CSP만 제외합니다. 일반 사이트 페이지에는 이 예외가 없습니다. 실제 Supabase Auth와 지도 연동 확인은 아직 남아 있습니다. 검사 결과·재현 방법은 [TEST_RESULTS.md](../docs/TEST_RESULTS.md)를 참고하세요.

## 알려진 제한

- `/docs`, `/openapi.json`도 공개됩니다.
- 매우 긴 URL 경로(수천 자)를 보내면 Windows에서 정적 파일 조회가 500을 반환합니다. 파일 내용이 노출되지는 않습니다.
- 테스트 중 `starlette.testclient`가 httpx 사용이 deprecated라는 경고를 냅니다. 현재 버전 조합에서는 동작하며, 의존성을 올릴 때 확인이 필요합니다.


## 새 학습 알고리즘 게시판 분류

학습 화면의 9개 알고리즘과 맞춰 게시판도 union-find·dijkstra·knapsack·topological-sort·two-pointers를 추가 허용합니다. 기존 Supabase에 migration 1~4가 적용되어 있다면 `supabase/migrations/202610250001_learning_algorithms.sql`만 새로 적용하세요. 이 파일은 기존 데이터·RLS·소유권·RPC 정책을 바꾸지 않고 CHECK 허용 ID를 늘립니다. 이번 개발에서는 실제 프로젝트에 적용하지 않았습니다. 학습 화면은 Supabase 없이 사용할 수 있습니다.
