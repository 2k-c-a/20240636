# Vercel 배포

배포용 저장소: https://github.com/2k-c-a/20240636

FastAPI 앱 하나에서 `/web/…` 웹페이지와 `/api/…` API를 함께 제공합니다.
DB와 이메일 인증은 기존 Supabase 프로젝트를 사용합니다.

## 저장소 구성

이 배포용 저장소의 Vercel Root Directory는 `.`(저장소 최상위)입니다.
`mobile/web` 폴더의 내용만 새 저장소 최상위에 업로드했다면 Root Directory는 `.`입니다.
어느 경우든 frontend와 backend는 같은 루트 아래에 있어야 합니다.
`.env`, `.venv`, `.vercel`은 GitHub에 업로드하지 않습니다.

배포 루트의 `requirements.txt`가 백엔드 의존성을 참조하고,
`pyproject.toml`이 `backend.app.main:app`을 실행 대상으로 지정합니다.
Python 버전은 `.python-version`으로 3.12를 지정합니다.
정적 파일도 FastAPI를 거치므로 페이지별 CSP와 공통 보안 헤더를 유지합니다.

## Vercel 설정

1. Add New → Project에서 `2k-c-a/20240636` 저장소를 가져옵니다.
2. 위 구조에 맞춰 Root Directory를 설정합니다.
3. Framework Preset은 FastAPI로 선택합니다. Build Command와 Output Directory는 별도 덮어쓰기를 하지 않습니다.
4. Environment Variables에 아래 값을 Production 환경으로 등록합니다.

| 변수 | 값 |
|---|---|
| SUPABASE_URL | Supabase 프로젝트의 HTTPS API URL |
| SUPABASE_PUBLISHABLE_KEY | 해당 프로젝트의 Publishable key |
| APP_ORIGIN | 실제 운영 도메인, 예: https://example.vercel.app (경로 없이) |

현재 일반 사용자 API는 SUPABASE_SECRET_KEY를 사용하지 않으므로 등록하지 않습니다.
최초 배포 후 운영 도메인이 확정되면 APP_ORIGIN을 맞추고 다시 배포합니다.
환경변수 변경은 새 배포에 반영됩니다.
Preview 주소는 Production 주소와 다르므로 인증을 검증하려면 별도 주소 설정이 필요합니다.

## Supabase 설정

Authentication → URL Configuration에서 Site URL을 APP_ORIGIN과 같게 설정하고,
Redirect URLs에 `https://실제운영도메인/web/html/auth-callback.html`을 추가합니다.
기존 로컬 개발용 콜백 주소가 필요하면 유지합니다.
DB는 초기화하지 말고, 아직 적용되지 않은 migration만 확인해 적용합니다.
DB 적용 절차는 `../supabase/README.md`를 참고합니다.

## 배포 후 확인

- `/`: `/web/html/index.html`로 이동하고 CSS·JS·이미지가 로드됨
- `/api/health`: `{"status":"ok"}` (DB 연결까지 검사하지는 않음)
- `/api/config`: `auth_enabled: true`, 운영 APP_ORIGIN 확인
- `/web/html/visualizer.html`: 예제 선택과 재생
- 회원가입 → 확인 메일 → 로그인 → 프로필 생성 → 게시글 작성·수정·삭제
- `/web/html/map.html`: 지도 표시
- `/.env`, `/backend/.env`, `/web/.env`: 404
- HTML 응답에 Content-Security-Policy 헤더가 있으며 Supabase 연결이 차단되지 않음

로컬 테스트 통과와 실제 Vercel 배포 성공은 별도로 확인해야 합니다.

참고: https://vercel.com/docs/frameworks/backend/fastapi
