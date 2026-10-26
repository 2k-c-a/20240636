# 알고리즘 실행 시각화 웹사이트 (가칭)

알고리즘 코드를 한 단계씩 따라가며, 그 단계가 자료구조의 상태를 어떻게 바꾸는지 한국어 설명과 함께 보여주는 학습용 웹사이트입니다. 모바일 웹 수업 실습 프로젝트입니다.

현재 소스 상태와 검증 한계를 정리한 실행 안내입니다(2026-10-25). 설계는 [DESIGN.md](DESIGN.md), 단계별 계획은 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), 인터페이스 계약과 검증 기준은 [docs/CONTRACTS.md](docs/CONTRACTS.md)와 [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)에 있습니다.

## 화면·게시판 개편 (2026-10-26)

- 메뉴에 마우스를 올리면 하위 메뉴가 열립니다. 키보드·터치로도 열고 Escape로 닫을 수 있습니다.
- 로그인·회원가입은 오른쪽 위 계정 영역에 있으며, 로그인 후 닉네임·내 정보·로그아웃으로 바뀝니다.
- 홈·소개·회원 화면·게시판의 타이포그래피와 간격을 정리하고 모바일 화면을 지원합니다.
- 갤러리·실습 문의·기획서 페이지, 배경음악, 마우스 실습 효과는 제거했습니다.
- 게시판의 **게시글 작성** 버튼 → `write.html`에서 작성 → 저장한 글 상세로 이동합니다.
- 댓글은 누구나 읽고, 프로필을 만든 회원이 작성하고 본인 댓글을 삭제합니다. 댓글은 최신순 페이지네이션이며 최대 2,000자입니다.
- 기존 DB에는 `supabase/migrations/202610260001_comments.sql`만 추가 실행합니다. 기존 테이블을 초기화하지 마세요.

## 현재 상태

Vercel에서 프런트엔드와 FastAPI를 함께 배포하는 설정·환경변수·검증 순서는 [Vercel 배포 안내](docs/VERCEL.md)를 참고하세요.

| 항목 | 상태 |
|---|---|
| 로컬 서버(정적 웹, `/api/health`) | 동작, 자동 테스트 있음 |
| 실행 기록(trace) 형식·검증기·로더, 9개 알고리즘(BFS·격자 응용, DFS, 이분 탐색, 버블 정렬, 유니온 파인드, 다익스트라, 배낭 DP, 위상 정렬, 투 포인터) × 예제 36개 × Python·C++·Java·Kotlin·Rust·C·JavaScript 코드 | 있음, 자동 테스트 있음 (`npm run validate:traces`) |
| 시각화 화면: 알고리즘·예제·언어 선택, 한 단계씩(다음·이전·처음으로) 보기, 자동 재생(0.5·1·2배속, 마지막 단계에서 멈춤), 단계 슬라이더. 언어를 바꿔도 단계·상태 유지, 알고리즘·예제를 바꾸면 처음부터 | 있음 (`/web/html/visualizer.html`), 자동 테스트와 브라우저 확인 |
| DB: 프로필·게시글 테이블, 제약, RLS, 동시 수정 방지 RPC (`supabase/migrations`) | SQL과 테스트 있음 (`npm run test:db`, 로컬 PostgreSQL 임시 클러스터에서 확인). **실제 프로젝트 적용 및 RLS·정책 개수·RPC 실행 방식 확인(2026-10-16). 실제 계정 권한 통합 검증은 남음** |
| 공개 설정·사용자 인증·프로필 API (`/api/config`, `/api/me`, `/api/me/profile`) | 있음, 자동 테스트 있음(인증·DB 경계는 가짜 Supabase). **실제 Supabase 프로젝트로 하는 통합 검증은 아직 하지 않음** |
| 이메일·비밀번호 회원가입·로그인·복구 화면, 게시판 화면·API | 구현 있음. 2026-10-17 사용자 이메일 플로우 확인 기록 있음. 현재 CSP·프로필·A/B 통합 검증은 남음 |
| 하위 메뉴·오른쪽 위 계정 정보·GitHub SNS 링크·장안대학교 지도 | 있음, 자동 테스트 있음 |

## 추가 학습 유형과 복잡도

- BFS 응용 3개: 격자 미로·여러 최단 경로·도달 불가. 별도 알고리즘 대신 BFS의 예제로 제공하며 거리·경로는 발견 상태에서 유도한 학습 표시입니다.
- 유니온 파인드 3개: 랭크 합치기·경로 반감·같은 집합 조회.
- 다익스트라 3개: 가중치 경로·0 가중치·도달 불가. 현재 코드는 배열/인접 행렬 기반 O(V²)이며 음수 가중치를 거부합니다. 힙 구현과 구분합니다.
- 0/1 배낭 DP 4개: 선택/미선택·동률·너무 무거움·물건 없음. O(NW) 표와 이전 행 참조를 보여 줍니다.
- 위상 정렬 3개: 선행 작업·방향 사이클·독립 작업. Kahn 큐와 평탄화 인접 리스트로 O(V+E)입니다.
- 투 포인터 4개: 양의 정수의 연속 구간 합·없음·빈 배열·단일 원소. 0/음수는 지원하지 않으며 두 포인터가 앞으로만 움직여 O(n)입니다.

기존 알고리즘에도 시간·공간복잡도, 기호, 이유, 구현 전제를 표시합니다. 조기 종료 없는 버블 정렬은 최선도 O(n²), 정렬된 배열의 이분 탐색은 최악 O(log n), BFS/DFS는 인접 리스트 순회 O(V+E)입니다. 복잡도는 재생 속도·UI 렌더링·trace 저장 비용과 구분합니다.

새 예제에도 7개 언어가 제공됩니다. 새 프로그램의 Python·JavaScript·C·C++·Java는 실제 결과/단계 검사를 수행했고, 현재 환경의 Kotlin·Rust 실행기는 없어 새 코드의 실제 컴파일 검증은 미실행입니다. 해당 실행기가 있는 환경에서는 테스트가 자동 실행됩니다.

**게시판에서 새 알고리즘 태그를 사용하려면** 기존 migration 1~4가 있는 DB에 `202610250001_learning_algorithms.sql`만 추가 적용해야 합니다. 기존 테이블·글을 초기화하지 마세요. 학습 화면은 Supabase 없이 바로 사용할 수 있습니다.

## 게시판 사용

`/web/html/board.html`에서 비회원도 목록·필터·더 보기를 이용할 수 있습니다. 사이트 이메일 계정으로 로그인하고 프로필을 만든 뒤 글을 작성합니다. 글 상세에서는 작성자만 수정·삭제 버튼을 볼 수 있고, 실제 권한은 API와 DB에서도 검사합니다.

로그인이 만료되면 같은 페이지의 로그인 양식으로 돌아올 수 있어 작성 중인 초안이 유지됩니다. 충돌 시 최신 글과 비교한 뒤 저장하며, 서버 응답이 없으면 목록에서 처리 여부를 확인합니다. 페이지를 새로고침하거나 닫으면 메모리 초안이 사라질 수 있으므로 먼저 복사해 두세요. 실제 A/B 계정의 전체 화면 검증은 아직 남아 있습니다.

## 이메일 회원가입

사이트 이용자는 **본인의 이메일 주소·비밀번호·닉네임**으로 가입합니다. Supabase 서비스에 별도로 가입할 필요가 없습니다. 가입 후 받은 확인 메일의 링크를 열고, 사이트 가입에 사용한 이메일과 비밀번호로 로그인합니다.

인증 저장소와 확인 메일 처리는 서버 운영자가 설정한 Supabase Auth를 사용합니다. Supabase 프로젝트·키·이메일 발송 설정은 개발자/운영자만 준비합니다. 이메일 전송을 실제로 확인하기 전에는 가입 전체가 검증되었다고 간주하지 않습니다.

## 폴더

```text
20240636/
├── frontend/   html, css, js, img, audio (브라우저에 공개되는 파일)
├── backend/    FastAPI + Uvicorn 서버, 테스트 (README 참고)
├── docs/       계약과 검증 기준
├── supabase/   DB migration(SQL)과 테스트, 적용 방법 (supabase/README.md)
├── scripts/    예제 데이터 생성(generate-traces)·검증(validate-traces)
├── package.json   프런트엔드 테스트 실행 설정 (빌드 도구 없음)
├── DESIGN.md, IMPLEMENTATION_PLAN.md
```

## 준비물

- Python 3.12
- PostgreSQL (DB 테스트용, 선택. `initdb`·`postgres`·`psql`이 필요하며 PostgreSQL 18.3(Windows)에서만 실행해 봤습니다. 없으면 DB 테스트는 건너뛰어집니다. 설치하지 않고 이미 설치된 것만 씁니다.)
- Node.js 20 이상 (프런트엔드 테스트용. v24.20.0, npm 11.19.0에서 확인했고 20·22는 확인하지 않았습니다. Node 22 미만에서는 JavaScript 코드의 줄 실행 검증이 "실행하지 않음"으로 건너뛰어집니다.)
- 선택: Java 소스 실행 검증에는 Java 11 이상, Kotlin/JVM 원본 실행 검증에는 `kotlinc`와 Java, Rust 원본 실행 검증에는 `rustc`가 필요합니다. C++ 코드 실행 검증에는 C++17을 지원하는 `g++`가, C 코드 실행 검증에는 `gcc`와 `gcov`가, Python 코드 실행 검증에는 `python`(3.8 이상)이 PATH에 필요합니다. 없으면 해당 테스트는 이유를 표시하고 건너뜁니다(통과한 것으로 세지 않습니다).
- Supabase 프로젝트는 회원·게시판 단계부터 필요합니다. 학습 화면만 실행할 때는 필요 없습니다. 실제 프로젝트 설정·검증 기록은 docs/ACCEPTANCE.md의 날짜별 기록을 참고하세요.

## 처음 받는 사람의 로컬 실행 (PowerShell)

Python 3.12와 Node.js를 먼저 준비합니다. 학습 화면만 실행할 때는 Supabase 계정·설정 파일·Node 패키지 설치가 필요하지 않습니다.

```powershell
git clone https://github.com/2k-c-a/20240636.git
cd 20240636/backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

브라우저에서 `http://127.0.0.1:8000/`을 엽니다. 시각화는 `/web/html/visualizer.html`, 게시판은 `/web/html/board.html`, 상태 확인은 `/api/health`입니다. HTML을 파일 탐색기에서 직접 여는 방식(file://)은 사용하지 않습니다. 개발 중 자동 재시작이 필요할 때만 `--reload`를 추가합니다. 가상환경 활성화 없이 위 명령을 실행할 수 있습니다.

### 회원·게시판까지 연결하기 (개발자/운영자)

1. 본인 Supabase 개발 프로젝트를 준비합니다. 사이트 이용자가 만드는 이메일 계정과 개발자의 Supabase 서비스 계정은 별개입니다.
2. [DB 적용 안내](supabase/README.md)의 사전 점검 SQL로 기존 객체를 확인합니다. 새 빈 프로젝트에 migration 6개를 파일명 순서대로 적용합니다. 기존 프로젝트에 SQL을 재실행하거나 테이블을 지워 초기화하지 마세요.
3. backend 폴더에서 아래 명령으로 **.env가 없을 때만** 예제 파일을 복사하고, 로컬 편집기로 값을 입력합니다.

```powershell
if (-not (Test-Path -LiteralPath .env)) { Copy-Item -LiteralPath .env.example -Destination .env }
```

- `SUPABASE_URL`: 프로젝트 API URL(`https://<project-ref>.supabase.co`). Session pooler·PostgreSQL 접속 문자열을 넣지 않습니다.
- `SUPABASE_PUBLISHABLE_KEY`: 브라우저에 공개 가능한 Publishable key. Secret key를 넣지 않습니다.
- `APP_ORIGIN`: `http://127.0.0.1:8000`.
- `SUPABASE_SECRET_KEY`: 일반 회원·게시판 API에는 필요하지 않으므로 비워 둡니다.

4. Supabase Auth의 이메일/비밀번호 가입과 이메일 확인·발송을 설정합니다. Site URL은 위 APP_ORIGIN, 허용 Redirect URL은 `http://127.0.0.1:8000/web/html/auth-callback.html`입니다. 이메일 발송 제한과 SMTP 조건은 [백엔드 안내](backend/README.md)를 따릅니다.
5. 서버를 재시작하고 실제 테스트 이메일로 가입→같은 브라우저에서 확인→로그인→프로필→게시판을 확인합니다. GitHub 소스만 복제해도 DB·메일·키가 자동 생성되는 것은 아닙니다.

자세한 설정·HTTP API 사용·선택 실행 통합 테스트는 [backend/README.md](backend/README.md)를 보세요.

## 테스트

```powershell
# 백엔드 (20240636/backend)
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest

# 프런트엔드 (mobile/web)
npm test
# 실행기가 없어 건너뛴 테스트가 있는지는 요약의 "skipped"와 테스트 이름 옆의 "실행하지 않음"으로 확인합니다.

# 예제 콘텐츠(trace) 검증: catalog에 등록된 모든 예제를 검사한다 (mobile/web)
npm run validate:traces

# DB(migration·RLS·RPC) 테스트: 설치된 PostgreSQL로 일회용 임시 클러스터를 띄워 실행하고 지운다 (mobile/web)
# PostgreSQL이 없으면 "실행하지 않음"을 알리고 종료 코드 2로 끝난다(통과가 아니다). npm test에도 같은 테스트가 있으며 없으면 건너뛴다.
npm run test:db

# 예제 데이터는 scripts/trace-builders.mjs(코드·줄 매핑·설명·단계 생성)에서 만든다. 고친 뒤 다시 만들고(version을 올린다) 검증한다.
node scripts/generate-traces.mjs
```

## 주의

- `backend/.env`에는 비밀 키가 들어갑니다. Git에 올리지 마세요(`.gitignore`로 제외되어 있습니다). 값은 문서나 테스트에 복사하지 않습니다.
- 공개 배포(GitHub Pages, 외부 서버)는 이 프로젝트의 범위가 아닙니다. 소스를 GitHub에 올리고 로컬에서 실행·시연합니다.


## 언어 확장 정책 (2026-10-16)

표시 순서는 **Python → C++ → Java → Kotlin → Rust → C → JavaScript**이며 일곱 언어 모두 9개 알고리즘의 36개 예제에서 선택할 수 있다. 기본 언어는 Python이고 언어 전환 시 현재 단계와 시각화 상태를 유지한다. C++17·Java·Kotlin/JVM·Rust 코드를 제공한다. 각 언어의 한국어 설명과 eventId별 강조 줄을 함께 관리하며 코드 변경 시 contentVersion을 올린다. 실제 실행 검증 여부와 도구 환경의 제한은 docs/ACCEPTANCE.md에 기록한다. 과거 단계별 검증 기록은 당시 이력으로 보존한다.


## 검증 상태와 공유 전 확인

- 자동 검사·Chrome 화면 검증의 결과와 미실행 항목: [TEST_RESULTS.md](docs/TEST_RESULTS.md).
- 시연 순서·실패 시 대응·테스트 글 정리: [DEMO.md](docs/DEMO.md).
- SDK·기존 이미지/오디오 출처와 확인 상태: [THIRD_PARTY.md](docs/THIRD_PARTY.md).
- 실제 Supabase A/B 권한·동시성, 현재 CSP에서 Auth/지도 표시, 실제 탭 숨김, 모바일 실기기·Safari·스크린 리더 검증은 남아 있습니다. 13단계 전체 통과로 표시하지 않습니다.
- 게시판 초안은 메모리에만 있으며 새로고침/닫기 시 사라질 수 있습니다. 학습은 준비된 trace를 재생하며 사용자 코드를 서버에서 실행하지 않습니다. 댓글을 읽고 작성할 수 있으며 본인 댓글은 삭제할 수 있습니다.
- `.env`, `.venv`, 캐시·node_modules·로그는 Git 제외 대상이고 `.env.example`은 빈 예제로 포함합니다. Secret key·access token·DB 비밀번호를 코드·커밋·문서에 넣지 않습니다.
- 보존된 사진·배경음악의 개별 출처/재배포 권한은 미확인입니다. 출처 확인 또는 허가된 대체 자산 준비 전에는 권리 확인 완료로 표시하지 않습니다.
- 기존 이메일 mailto 링크는 사용자 결정에 따라 유지되어 소스에 공개됩니다. GitHub Pages나 외부 서버 배포는 범위가 아닙니다.
- 아래 문서는 업로드 준비이며 자동 commit/push·외부 배포를 수행하지 않습니다.
