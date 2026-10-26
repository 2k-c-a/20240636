# 실제 Supabase 통합 테스트 (선택 실행)

기본 `pytest`에서는 **건너뜁니다**. 실제 개발 프로젝트(`backend/.env`의 Supabase)에 요청을 보내고 테스트가 만든 글을 지웁니다.

## 준비

- `backend/.env`에 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `APP_ORIGIN`이 있어야 합니다.
- **테스트 전용 계정**(이메일 확인을 마친 계정)의 이메일·비밀번호를 환경 변수로 넘깁니다. 파일에 적지 마세요.
  - `IT_USER_A_EMAIL`, `IT_USER_A_PASSWORD` (필수)
  - `IT_USER_B_EMAIL`, `IT_USER_B_PASSWORD` (선택, 있으면 남의 글 수정·삭제 거부도 확인)
- 계정에 프로필이 없으면 닉네임 `통합시험A`/`통합시험B`로 만듭니다(이미 있으면 그대로 둡니다).
- `IT_EXPECT_RPC_ONLY=1`: migration 4(`202610160001_posts_rpc_only.sql`)를 적용한 뒤에만 켭니다. 직접 PATCH/DELETE가 거부되는지 확인합니다.

## 실행 (PowerShell)

```powershell
cd mobile/web/backend
$env:RUN_SUPABASE_INTEGRATION = "1"
$env:IT_USER_A_EMAIL = "..."; $env:IT_USER_A_PASSWORD = "..."
.\.venv\Scripts\python.exe -m pytest tests/integration -v
```

테스트는 **자기가 만든 글(UUID)만** 지웁니다. 중간에 실패해도 정리 단계가 같은 UUID를 지웁니다. 다른 사람의 글이나 기존 데이터는 건드리지 않습니다.
