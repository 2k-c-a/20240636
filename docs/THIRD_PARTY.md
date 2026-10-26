# 외부 코드·자산 출처와 확인 상태

확인일: 2026-10-25. 저장소의 모든 파일에 일괄 라이선스를 부여하는 문서가 아니다. 출처를 추측해서 권리 확인 완료로 표시하지 않는다.

## Supabase 브라우저 SDK

- 파일: frontend/js/vendor/supabase.js, @supabase/supabase-js 2.118.0 UMD 번들.
- 배포 출처: https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js
- 공식 라이선스: https://github.com/supabase/supabase-js/blob/v2.118.0/LICENSE
- MIT, Copyright (c) 2020 Supabase. 공식 버전의 LICENSE를 확인했고 전문을 frontend/js/vendor/LICENSE.supabase에 보존한다.
- SHA-256과 갱신 절차는 frontend/js/vendor/README.md 및 auth-flow 테스트를 따른다. 버전·해시·라이선스를 함께 관리한다. 번들의 하위 패키지 저작권/라이선스 표기가 있는 경우 제거하지 않는다. 전체 전이 의존성 라이선스 감사가 완료됐다는 의미는 아니다.

## 기존 실습 자산

| 파일 | 확인 가능한 근거 | 현재 판정 |
|---|---|---|
| frontend/img/pexels-erwin-bosman-118283-36927967.jpg | 기존 파일명에 Pexels·작가명으로 보이는 문자열과 번호 존재 | 원본 페이지·정확한 작가·다운로드 당시 조건 미확인. 파일명만으로 이용 허락을 확정하지 않음 |
| frontend/img/morskie-oko-tatry_1204-510.avif | 기존 실습 이미지 | 원본 출처·이용 허락 미확인 |
| frontend/audio/bgm.mp3 | 기존 실습 배경음악 | 곡명·작곡/연주자·원본 배포처·재배포 허락 미확인 |
| frontend/img/favicon.svg, favicon-16.png, favicon-32.png, apple-touch-icon.png | 기존 코드 모양 아이콘 자산 | 제작자·생성 기록 미확인. 제3자 권리가 없다고 단정하지 않음 |

기존 자산은 요청에 따라 보존했다. 새로운 공개 소스 배포 전 원본과 라이선스/허락 기록을 확보하거나 허가된 대체 자산으로 교체해야 한다. 전체 저장소에 MIT 등 일괄 라이선스를 임의로 붙이지 않는다. 이미 GitHub에 포함된 자산도 권리 확인 완료를 의미하지 않는다.

## 서비스와 개발 의존성

- Google 지도는 iframe과 외부 링크로 사용한다. 지도 타일을 저장소에 복사하지 않으며 서비스 이용 조건은 별도다. 카카오·네이버 링크도 외부 서비스 링크다.
- Python 직접 의존성은 backend/requirements.txt·requirements-dev.txt에 고정 버전으로 기록한다. 간접 의존성은 pip가 해결하므로 완전한 lockfile 재현과는 다르다.
- Java/Kotlin/Rust/C/C++ 실행 도구·PostgreSQL은 선택 검증 도구다. 실행 파일을 저장소에 번들하지 않는다.


## 추가 알고리즘 설명 참고

알고리즘 원리·복잡도 설명의 참고 자료이며 코드를 복사한 출처가 아니다. 새 예제 데이터·유한 정수 프로그램·7개 언어 출력은 프로젝트에서 작성했다. 백준 문제 본문/입출력을 복제하지 않고 작은 자체 예제를 사용한다.

- Union–Find와 역 아커만 경계: https://www.cs.princeton.edu/~wayne/kleinberg-tardos/pdf/UnionFind.pdf
- Kahn 위상 순서와 선형 경계: https://algs4.cs.princeton.edu/code/edu/princeton/cs/algs4/TopologicalX.java.html
- 0/1 배낭과 의사 다항 시간: https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/7232b0ff982f501556118a8552654762_MIT6_006S20_r19.pdf

표시된 다익스트라는 우선순위 큐 구현이 아닌 배열·인접 행렬 구현이므로 그 코드에 맞는 O(V²)를 명시한다. 기존 미확인 이미지·음악 권리 문제와는 별개다.
