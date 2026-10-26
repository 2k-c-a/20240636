# 브라우저용 Supabase SDK

- 파일: `supabase.js` (`@supabase/supabase-js` UMD 번들, 전역 변수 `supabase`)
- 버전: **2.118.0** (고정)
- 라이선스: MIT, Copyright (c) 2020 Supabase — https://github.com/supabase/supabase-js/blob/master/LICENSE
- 출처: `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js`
- SHA-256: `ee3be8de192b97cb1d73d1e95d6b82bb1f6b658c0f97c4ef757fc331996ed3d3`

## 다시 받는 방법

```
curl -sSf https://cdn.jsdelivr.net/npm/@supabase/supabase-js@<버전>/dist/umd/supabase.js -o frontend/js/vendor/supabase.js
sha256sum frontend/js/vendor/supabase.js
```

버전을 올리면 이 문서의 버전과 SHA-256, `tests/frontend/auth-flow.test.mjs`의 기대값을 함께 바꾸고, 가입·로그인·복구를 실제 Supabase에서 다시 확인한다.
번들 파일은 직접 수정하지 않는다. auth.js가 인증이 필요한 시점에 로컬 번들을 script 요소로 한 번만 불러온다. 일반 페이지에서 SDK를 직접 미리 불러오지 않는다. MIT 전문은 LICENSE.supabase를 참고한다.
