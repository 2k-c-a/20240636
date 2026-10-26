# 인터페이스 계약

기준일: 2026-10-14. 상위 설계: [DESIGN.md](../DESIGN.md). 구현 순서: [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md) 00단계.

이 문서는 **trace(실행 기록) 형식, 인증·공개 설정, HTTP API, 권한·충돌 정책의 최종 계약**이다. DESIGN.md §6, §8과 내용이 다르면 이 문서가 우선하며, 같은 변경에서 DESIGN.md도 맞춘다.

이 문서는 계약을 정의할 뿐이다. 여기에 적힌 파일·API·테스트는 아직 구현되거나 검증되지 않았다. 구현이 끝났다는 근거는 [ACCEPTANCE.md](ACCEPTANCE.md)의 검증 기록이다.

## 0. 확정 요구사항과 정의 위치

| 확정 요구 | 계약상 의미 | 정의 위치 |
|---|---|---|
| 회원가입 포함 | 이메일 가입·확인·로그인·복구는 Supabase Auth, 프로필·게시판은 FastAPI. 진도 저장은 제외 | §7, §8 / ACCEPTANCE AUTH-01~03 |
| 단일 언어 표시 | 화면은 한 번에 한 언어의 코드만 보이고 전환한다. 동시 비교는 범위 밖. bundle은 언어별 코드·줄 매핑을 모두 담고 전환 시 stepIndex를 유지한다 | §2, §3 / ACCEPTANCE VIS-02 |
| 한국어 설명 | 사용자에게 보이는 모든 문자열(step `message`, 언어별 `notes`, 오류 `message`, `fields` 값, 화면 문구)은 한국어다. 식별자·operation 이름은 영어를 유지한다 | §3, §8.1 / ACCEPTANCE SITE-02 |
| 준비된 예제 재생 | 사용자 코드·입력을 실행하지 않고 검증한 예제의 실행 기록을 재생한다. 모든 시각화 페이지에 그 안내를 표시한다 | §2, §5 / ACCEPTANCE SITE-02 |
| GitHub 링크·장안대학교 지도 | SNS 링크는 `https://github.com/2k-c-a`만 사용한다. 지도 장소는 장안대학교이며 실패 시 학교 이름과 외부 지도 링크를 보여준다. 개인 위치는 수집하지 않는다 | DESIGN.md §1·§15 / ACCEPTANCE SITE-01 |
| 로컬 실행 | 공개 배포 없이 `http://127.0.0.1:8000`에서 FastAPI가 정적 웹과 API를 같은 origin으로 제공한다. Supabase 설정이 없어도 학습 기능은 동작하고, 회원·게시판만 설정에 따라 제한된다 | §6, §7 / ACCEPTANCE RUN-01 |

## 1. 공통 식별자와 제한값

| 대상 | 허용 값 | 비고 |
|---|---|---|
| 언어 ID | `python`, `cpp`, `java`, `kotlin`, `rust`, `c`, `javascript` | 현재 지원 목록. 목표 순서: Python → C++ → Java → Kotlin → Rust → C → JavaScript; 일곱 언어 모두 구현 |
| 알고리즘 ID | `bfs`, `dfs`, `binary-search`, `bubble-sort`, `union-find`, `dijkstra`, `knapsack`, `topological-sort`, `two-pointers` | 고정 목록. 게시글 `algorithm_id`도 같은 목록 + null |
| 예제 ID | `^[a-z0-9]+(-[a-z0-9]+)*$`, 32자 이하 | 알고리즘 안에서 유일 |
| 노드 ID | `^[A-Za-z0-9]{1,3}$` | 그래프 알고리즘 |
| eventId | `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`, 40자 이하 | §3의 R5 참고 |
| contentVersion | `<algorithmId>-<exampleId>-v<N>` (N은 1 이상 정수) | 코드·매핑·trace 중 하나라도 바뀌면 N을 올린다 |
| UUID | 소문자 하이픈 형식 | 게시글·사용자 ID |
| 시각 | ISO 8601 UTC, `Z` 접미사 | 예: `2026-10-14T05:30:00.123456Z` |
| 문자열 길이 | Unicode 코드 포인트 수 | JS는 `[...s].length`로 센다. `s.length`(UTF-16 단위)를 쓰지 않는다 |

콘텐츠 제한(제안값, 콘텐츠 검증 시 조정 가능): step 2,000개 이하, 그래프 노드 12개·간선 24개 이하, 배열 원소 20개 이하, 정수 -999~999, bundle JSON 200KB 이하, 코드 120줄 이하·줄당 120자 이하.

## 2. 줄 매핑 정책

- 매핑의 단위는 **줄이 아니라 연산(operation)** 이다. 줄과 상태 변화는 1:1이 아니다.
  - 한 연산이 한 언어에서는 한 줄, 다른 언어에서는 여러 줄일 수 있다.
  - 같은 줄이 여러 연산에 나타날 수 있다(예: BFS의 `for` 줄은 `check-neighbor`와 `process`에 모두 쓰인다).
  - 조건 검사처럼 상태를 바꾸지 않는 연산도 step으로 둘 수 있다.
  - `processed`, `sortedFrom` 같은 학습용 보조 상태는 원본 코드에 변수가 없다. 이런 상태가 확정되는 지점(예: 반복문이 끝나는 줄)을 연산에 매핑하고, 화면에서는 코드의 실제 변수와 구분해 표시한다.
- 화면은 **방금 실행한 연산의 줄**과 **그 연산을 실행한 뒤의 상태**를 보여준다. "지금 실행 중"이라고 표시하지 않는다.
- import·함수 선언처럼 학습과 무관한 줄은 어느 연산에도 매핑하지 않을 수 있다. 이 도구는 모든 실제 명령을 따라가는 디버거가 아니다.
- 검증기는 줄 번호가 범위 안인지, 같은 eventId가 같은 줄을 가리키는지까지만 기계적으로 확인한다. **"이 줄이 이 연산에 맞는가"는 사람이 검토**하고 [ACCEPTANCE.md](ACCEPTANCE.md)에 기록한다. 05단계부터는 BFS 예제의 세 언어에 대해 이 검토를 테스트가 대신 보조한다: `language-mapping.test.mjs`는 강조되는 줄의 **소스 문장**을 손으로 적은 표와 비교하고, `language-execution.test.mjs`는 코드를 실제로 실행해 실행된 줄의 순서가 매핑과 같은지 확인한다(Python·JavaScript는 원본 그대로 줄 단위로 따라가고, C는 원본의 gcov 줄 횟수와 탐침을 넣은 사본의 줄 순서로 확인한다. 실행기가 없으면 이유와 함께 건너뛴다).
- 같은 operation이 언어마다 서로 다른 줄 수·줄 번호를 가질 수 있다(예: BFS `check-neighbor`는 Python·JavaScript 2줄, C 3줄). 화면은 "어느 언어가 몇 줄을 실행했는지"나 메모리·시간이 같다고 말하지 않는다.

## 3. TraceBundle

알고리즘 예제 하나를 JSON 파일 하나로 표현한다. 위치는 `frontend/js/data/<algorithmId>/<exampleId>.json`이다.

```text
TraceBundle {
  schemaVersion: 1
  contentVersion: string
  algorithmId: AlgorithmId
  exampleId: string
  input: <알고리즘별 input, §4>
  codes: { [languageId]: { lines: string[], notes: string } }
  steps: TraceStep[]
}

TraceStep {
  index: integer
  eventId: string
  operation: <알고리즘별 operation, §4>
  lines: { [languageId]: integer[] }   // codes의 줄 번호(1부터 시작)
  state: <알고리즘별 state, §4>
  message: string                      // 한국어 설명
}
```

- `codes[language].lines`는 소스를 줄 단위로 나눈 배열이다. 각 문자열에 줄바꿈 문자와 탭을 쓰지 않는다. 들여쓰기는 공백으로 한다.
- `codes[language].notes`는 그 언어 구현의 차이(자료구조, 시간복잡도 등)를 설명하는 한국어 문자열이다. 비어 있을 수 없고 한글을 포함해야 하며 500자 이하.
- 한 bundle의 `codes`에 있는 언어가 곧 그 예제가 지원하는 언어다. 카탈로그의 `languages`와 일치해야 한다.
- 최상위·`codes[언어]`·step·`input`·`state`의 키 집합은 이 문서에 적힌 것과 **정확히** 같아야 한다. 빠진 키도, 더 있는 키도 오류다.
- 실제 파일은 [`frontend/js/data/bfs/diamond.json`](../frontend/js/data/bfs/diamond.json)이며 아래 예시의 앞 7개 step과 일치한다(테스트가 비교한다).

### 규칙

| ID | 규칙 |
|---|---|
| R1 | `steps[i].index === i`. step은 최소 2개(initial + 종료)이며 2,000개 이하 |
| R2 | step 0은 `eventId: "initial"`, `operation: "initial"`이고 모든 언어의 `lines`가 빈 배열이다 |
| R3 | step 1 이후는 `operation`이 `initial`이 아니고, 모든 언어의 `lines`가 비어 있지 않다 |
| R4 | `lines`의 언어 키 집합은 `codes`의 언어 키 집합과 같다. 각 줄 배열은 오름차순·중복 없음·`1..codes[language].lines.length` 범위 |
| R5 | 같은 `eventId`는 어느 step에서나 같은 `operation`과 언어별 같은 `lines`를 가진다. eventId는 "코드의 어느 의미 지점인가"를 뜻하고, 반복 실행되면 같은 값이 반복된다 |
| R6 | `state`는 알고리즘별 키 집합과 정확히 일치한다(누락·추가 키 금지). 매 step은 이전 step과 객체를 공유하지 않는 **완전한 스냅샷**이다. 로더는 bundle을 깊은 freeze 상태로 반환한다 |
| R7 | 각 step의 `state`는 이전 step의 `state`에서 해당 `operation`의 전이 규칙(§4)으로 얻은 값과 같다 |
| R8 | 마지막 step의 operation은 알고리즘별 종료 operation이고, 종료 이후 step은 없다 |
| R9 | `message`는 1~200자 plain text이며 한글을 포함해야 하고 제어 문자를 쓸 수 없다. HTML·Markdown으로 해석하지 않는다 |
| R10 | `input`이 §4의 제한을 만족한다. `state`의 값은 항상 `input`에서 도달 가능한 값이다 |

### 검증기 (`frontend/js/trace-validator.js`)

- `validateBundle(bundle) -> {valid, errors}`. `errors`는 사람이 읽는 한국어 문장이며 `steps[3].lines.python[1]: …`처럼 위치로 시작한다. 오류가 50개를 넘으면 앞의 50개와 "앞의 50개만 표시" 문장만 돌려준다. 어떤 값이 들어와도 예외를 던지지 않고(순환 참조 포함), 입력을 바꾸지 않는다.
- **R1~R6, R8~R10과 `input` 제한은 네 알고리즘 모두에 적용한다.** R6의 "객체를 공유하지 않음"은 같은 배열·객체가 bundle 안의 두 곳 이상에 있는 경우를 오류로 본다(한 곳을 고치면 과거 step이 함께 바뀌기 때문이다).
- **R7(상태·전이 규칙)은 알고리즘마다 규칙 함수가 있어야 검증한다.** 네 알고리즘(`bfs`, `dfs`, `binary-search`, `bubble-sort`)에 모두 있으며, 규칙 함수가 없는 알고리즘의 bundle은 구조가 맞아도 `state: <id>의 상태·전이 규칙 검증기가 아직 없어 이 bundle을 승인할 수 없습니다`로 거부한다(검증하지 않은 콘텐츠를 통과시키지 않기 위해서다. 새 알고리즘을 추가할 때의 안전장치다). **모든 규칙 함수는 전이 규칙과 별개로, 입력에서 알고리즘을 직접 계산한 정답(reference)을 최종 상태와 비교한다**: BFS·DFS는 발견·처리 순서, 이분 탐색은 결과 인덱스, 버블 정렬은 정렬 결과와 교환 횟수(= 입력의 역순 쌍의 수)·비교 횟수(= n(n-1)/2).
- 구조 오류가 있으면 전이 규칙은 검사하지 않는다(오류가 연쇄되는 것을 막기 위해서다). 구조를 고친 뒤 다시 검증하면 전이 오류가 나온다.
- BFS 규칙은 §4.1의 표를 그대로 구현한다. 표에 더해 상태 불변식(`queue`·`processed`·`current`는 발견한 노드, `queue`와 `processed`는 겹치지 않음, `neighbor`는 `current`의 이웃)과, 이웃 검사 뒤의 다음 operation 제약(미발견 이웃 → `discover`, 발견한 이웃 → `check-neighbor` 또는 `process`, `discover` → `enqueue`, `process` → 큐가 남으면 `dequeue`·비면 `finish`)을 검사한다. 전이 규칙은 "어떤 operation이 나타났을 때" 적용되므로, 아무 operation도 하지 않은 trace(`initial → finish` 등)를 막기 위해 **step 1은 반드시 시작 노드의 `discover`**여야 한다(§4.1). 그리고 마지막 방어선으로 입력에서 BFS를 직접 계산해 최종 `discovered`·`processed`와 비교한다. 규칙에 빈틈이 있어도 결과가 BFS와 다른 trace는 통과하지 못한다. 두 검사는 각각 테스트로 고정되어 있다.

### 예시 (BFS, Python·C++·Java·Kotlin·Rust·C·JavaScript 등록, 앞 7개 step만 발췌)

실제 bundle은 종료 step까지 있어야 한다. 줄 번호는 아래 `codes`의 줄에 맞춘 것이며, 같은 operation(`eventId`)은 언어마다 다른 줄 번호를 가리킬 수 있다(§3의 R5는 같은 언어 안에서의 일관성을 요구한다). 실제 파일은 `frontend/js/data/bfs/diamond.json`이고 테스트가 이 발췌와 앞 7개 step이 같은지 확인한다.

```json
{
  "schemaVersion": 1,
  "contentVersion": "bfs-diamond-v4",
  "algorithmId": "bfs",
  "exampleId": "diamond",
  "input": {
    "directed": true,
    "graph": {
      "A": [
        "B",
        "C"
      ],
      "B": [
        "D"
      ],
      "C": [
        "D"
      ],
      "D": []
    },
    "start": "A",
    "layout": {
      "A": {
        "x": 50,
        "y": 10
      },
      "B": {
        "x": 20,
        "y": 50
      },
      "C": {
        "x": 80,
        "y": 50
      },
      "D": {
        "x": 50,
        "y": 90
      }
    }
  },
  "codes": {
    "python": {
      "lines": [
        "from collections import deque",
        "def bfs(graph, start):",
        "    visited = {start}",
        "    queue = deque([start])",
        "    while queue:",
        "        node = queue.popleft()",
        "        for nxt in graph[node]:",
        "            if nxt not in visited:",
        "                visited.add(nxt)",
        "                queue.append(nxt)"
      ],
      "notes": "visited는 코드의 집합이며 trace의 discovered와 대응합니다. queue는 collections.deque이고 popleft()는 맨 앞 원소를 O(1)에 꺼냅니다. processed는 학습용 보조 상태라서 코드에 변수가 없습니다. 노드의 이웃을 모두 검사해 for 반복이 끝나는 지점(7번 줄)에서 처리 완료로 표시합니다."
    },
    "cpp": {
      "lines": [
        "#include <vector>",
        "#include <queue>",
        "void bfs(const std::vector<std::vector<int>>& graph, int start) {",
        "    std::vector<bool> visited(graph.size(), false);",
        "    visited[start] = true;",
        "    std::queue<int> queue;",
        "    queue.push(start);",
        "    while (!queue.empty()) {",
        "        int node = queue.front();",
        "        queue.pop();",
        "        for (int nxt : graph[node]) {",
        "            if (!visited[nxt]) {",
        "                visited[nxt] = true;",
        "                queue.push(nxt);",
        "            }",
        "        }",
        "    }",
        "}"
      ],
      "notes": "노드 A, B, C, …는 0, 1, 2, …로 나타냅니다. graph는 인접 리스트이며 visited는 발견 여부입니다. std::queue의 front()는 맨 앞 값을 읽고 pop()은 제거합니다. 두 연산은 같은 dequeue 단계로 표시합니다. 큐 삽입·제거는 기본 deque에서 O(1)입니다. processed는 학습용 표시이며 이웃 반복(11번 줄)이 끝나면 처리 완료입니다."
    },
    "java": {
      "lines": [
        "import java.util.ArrayDeque;",
        "class Algorithm {",
        "    static void bfs(int[][] graph, int start) {",
        "        boolean[] visited = new boolean[graph.length];",
        "        visited[start] = true;",
        "        ArrayDeque<Integer> queue = new ArrayDeque<>();",
        "        queue.addLast(start);",
        "        while (!queue.isEmpty()) {",
        "            int node = queue.removeFirst();",
        "            for (int nxt : graph[node]) {",
        "                if (!visited[nxt]) {",
        "                    visited[nxt] = true;",
        "                    queue.addLast(nxt);",
        "                }",
        "            }",
        "        }",
        "    }",
        "}"
      ],
      "notes": "노드 A, B, C, …는 입력 순서의 정수 인덱스 0, 1, 2, …로 나타냅니다. 인접 리스트의 이웃 순서대로 방문합니다. processed와 호출 스택은 학습용 표시입니다. ArrayDeque로 큐의 양끝 연산을 수행합니다."
    },
    "kotlin": {
      "lines": [
        "import java.util.ArrayDeque",
        "fun bfs(graph: Array<IntArray>, start: Int) {",
        "    val visited = BooleanArray(graph.size)",
        "    visited[start] = true",
        "    val queue = ArrayDeque<Int>()",
        "    queue.addLast(start)",
        "    while (queue.isNotEmpty()) {",
        "        val node = queue.removeFirst()",
        "        for (nxt in graph[node]) {",
        "            if (!visited[nxt]) {",
        "                visited[nxt] = true",
        "                queue.addLast(nxt)",
        "            }",
        "        }",
        "    }",
        "}"
      ],
      "notes": "노드 A, B, C, …는 입력 순서의 정수 인덱스 0, 1, 2, …로 나타냅니다. 인접 리스트의 이웃 순서대로 방문합니다. processed와 호출 스택은 학습용 표시입니다. Kotlin/JVM 예제이며 java.util.ArrayDeque를 사용합니다."
    },
    "rust": {
      "lines": [
        "use std::collections::VecDeque;",
        "fn bfs(graph: &[Vec<usize>], start: usize) {",
        "    let mut visited = vec![false; graph.len()];",
        "    visited[start] = true;",
        "    let mut queue = VecDeque::new();",
        "    queue.push_back(start);",
        "    while let Some(node) = queue.pop_front() {",
        "        for &nxt in &graph[node] {",
        "            if !visited[nxt] {",
        "                visited[nxt] = true;",
        "                queue.push_back(nxt);",
        "            }",
        "        }",
        "    }",
        "}"
      ],
      "notes": "노드 A, B, C, …는 입력 순서의 정수 인덱스 0, 1, 2, …로 나타냅니다. 인접 리스트의 이웃 순서대로 방문합니다. processed와 호출 스택은 학습용 표시입니다. VecDeque의 pop_front는 Option을 반환합니다. Some(node)이면 반복하고 None이면 종료합니다."
    },
    "c": {
      "lines": [
        "#define N 4",
        "void bfs(int adj[N][N], int deg[N], int start, int queue[N]) {",
        "    int visited[N] = {0};",
        "    visited[start] = 1;",
        "    int head = 0, tail = 0;",
        "    queue[tail++] = start;",
        "    while (head < tail) {",
        "        int node = queue[head++];",
        "        for (int i = 0; i < deg[node]; i++) {",
        "            int nxt = adj[node][i];",
        "            if (!visited[nxt]) {",
        "                visited[nxt] = 1;",
        "                queue[tail++] = nxt;",
        "            }",
        "        }",
        "    }",
        "}"
      ],
      "notes": "노드 A, B, C, D는 0, 1, 2, 3으로 나타내며 adj[node][i]는 node의 i번째 이웃, deg[node]는 이웃의 수입니다. visited[x]가 1이면 발견한 노드(trace의 discovered)입니다. 큐는 배열 하나와 head·tail 두 인덱스이며, 꺼내면 head만 늘어나 꺼낸 원소도 배열에 남으므로 화면의 큐는 queue[head]부터 queue[tail - 1]까지입니다(발견한 순서는 queue 배열에 남습니다). processed는 학습용 보조 상태라서 코드에 변수가 없으며, for 반복이 끝나는 지점(9번 줄)에서 처리 완료로 표시합니다."
    },
    "javascript": {
      "lines": [
        "function bfs(graph, start) {",
        "    const visited = new Set([start]);",
        "    const queue = [start];",
        "    let head = 0;",
        "    while (head < queue.length) {",
        "        const node = queue[head++];",
        "        for (const nxt of graph[node]) {",
        "            if (!visited.has(nxt)) {",
        "                visited.add(nxt);",
        "                queue.push(nxt);",
        "            }",
        "        }",
        "    }",
        "}"
      ],
      "notes": "visited는 Set이며 trace의 discovered와 대응합니다. queue는 배열이고 shift()를 쓰지 않습니다. 대신 head 인덱스가 맨 앞 원소를 가리키며 queue[head++]로 읽고 head만 늘리므로 꺼낼 때 원소를 옮기지 않습니다. 꺼낸 원소도 배열에 남으므로 화면의 큐는 queue 전체가 아니라 head부터 끝까지입니다. processed는 학습용 보조 상태라서 코드에 변수가 없으며, for…of 반복이 끝나는 지점(7번 줄)에서 처리 완료로 표시합니다."
    }
  },
  "steps": [
    {
      "index": 0,
      "eventId": "initial",
      "operation": "initial",
      "lines": {
        "python": [],
        "cpp": [],
        "java": [],
        "kotlin": [],
        "rust": [],
        "c": [],
        "javascript": []
      },
      "state": {
        "discovered": [],
        "processed": [],
        "queue": [],
        "current": null,
        "neighbor": null
      },
      "message": "실행 전 상태입니다."
    },
    {
      "index": 1,
      "eventId": "mark-start",
      "operation": "discover",
      "lines": {
        "python": [
          3
        ],
        "cpp": [
          4,
          5
        ],
        "java": [
          4,
          5
        ],
        "kotlin": [
          3,
          4
        ],
        "rust": [
          3,
          4
        ],
        "c": [
          3,
          4
        ],
        "javascript": [
          2
        ]
      },
      "state": {
        "discovered": [
          "A"
        ],
        "processed": [],
        "queue": [],
        "current": null,
        "neighbor": null
      },
      "message": "시작 노드 A를 발견한 노드로 기록합니다."
    },
    {
      "index": 2,
      "eventId": "enqueue-start",
      "operation": "enqueue",
      "lines": {
        "python": [
          4
        ],
        "cpp": [
          6,
          7
        ],
        "java": [
          6,
          7
        ],
        "kotlin": [
          5,
          6
        ],
        "rust": [
          5,
          6
        ],
        "c": [
          5,
          6
        ],
        "javascript": [
          3,
          4
        ]
      },
      "state": {
        "discovered": [
          "A"
        ],
        "processed": [],
        "queue": [
          "A"
        ],
        "current": null,
        "neighbor": null
      },
      "message": "발견한 A를 큐에 넣습니다."
    },
    {
      "index": 3,
      "eventId": "dequeue-node",
      "operation": "dequeue",
      "lines": {
        "python": [
          5,
          6
        ],
        "cpp": [
          8,
          9,
          10
        ],
        "java": [
          8,
          9
        ],
        "kotlin": [
          7,
          8
        ],
        "rust": [
          7
        ],
        "c": [
          7,
          8
        ],
        "javascript": [
          5,
          6
        ]
      },
      "state": {
        "discovered": [
          "A"
        ],
        "processed": [],
        "queue": [],
        "current": "A",
        "neighbor": null
      },
      "message": "큐 앞에서 A를 꺼내 현재 노드로 삼습니다."
    },
    {
      "index": 4,
      "eventId": "check-neighbor",
      "operation": "check-neighbor",
      "lines": {
        "python": [
          7,
          8
        ],
        "cpp": [
          11,
          12
        ],
        "java": [
          10,
          11
        ],
        "kotlin": [
          9,
          10
        ],
        "rust": [
          8,
          9
        ],
        "c": [
          9,
          10,
          11
        ],
        "javascript": [
          7,
          8
        ]
      },
      "state": {
        "discovered": [
          "A"
        ],
        "processed": [],
        "queue": [],
        "current": "A",
        "neighbor": "B"
      },
      "message": "A의 첫 이웃 B를 검사합니다. 아직 발견하지 않은 노드입니다."
    },
    {
      "index": 5,
      "eventId": "mark-neighbor",
      "operation": "discover",
      "lines": {
        "python": [
          9
        ],
        "cpp": [
          13
        ],
        "java": [
          12
        ],
        "kotlin": [
          11
        ],
        "rust": [
          10
        ],
        "c": [
          12
        ],
        "javascript": [
          9
        ]
      },
      "state": {
        "discovered": [
          "A",
          "B"
        ],
        "processed": [],
        "queue": [],
        "current": "A",
        "neighbor": "B"
      },
      "message": "B를 발견한 노드로 기록합니다."
    },
    {
      "index": 6,
      "eventId": "enqueue-neighbor",
      "operation": "enqueue",
      "lines": {
        "python": [
          10
        ],
        "cpp": [
          14
        ],
        "java": [
          13
        ],
        "kotlin": [
          12
        ],
        "rust": [
          11
        ],
        "c": [
          13
        ],
        "javascript": [
          10
        ]
      },
      "state": {
        "discovered": [
          "A",
          "B"
        ],
        "processed": [],
        "queue": [
          "B"
        ],
        "current": "A",
        "neighbor": "B"
      },
      "message": "발견한 B를 큐 뒤에 넣습니다."
    }
  ]
}
```

## 4. 알고리즘별 input · state · operation

표기: "불변"이라고 적지 않은 필드는 전이 규칙에 적힌 대로만 바뀌고, 적히지 않은 필드는 이전 값을 유지한다.

### 4.1 BFS (`bfs`)

**input**

```text
{ directed: true, graph: { [node]: node[] }, start: node, layout: { [node]: {x: number, y: number} } }
```

- `graph`의 키 집합이 노드 집합이다. 모든 이웃은 키에 있어야 하고, 한 이웃 배열에 같은 노드가 두 번 나오지 않는다. 자기 간선은 허용한다. `start`는 키에 있다.
- 이웃 처리 순서는 이웃 배열의 순서다. 모든 언어 구현이 같은 순서를 쓴다.
- `layout`은 모든 노드의 위치를 가진다. 좌표는 0~100이며 SVG viewBox `0 0 100 100`에 맞춘다. 렌더러가 위치를 계산하지 않는다.

**state**: `{discovered: node[], processed: node[], queue: node[], current: node|null, neighbor: node|null}`

- `discovered`는 발견한 순서이며 코드의 `visited`에 해당한다. `processed`는 이웃 처리가 끝난 순서이며 학습용 보조 상태다. `queue`는 앞→뒤 순서다.

| operation | 의미 | 전이 |
|---|---|---|
| `initial` | step 0 | 배열은 모두 `[]`, `current`·`neighbor`는 null |
| `discover` | 노드 하나를 발견으로 기록 | `discovered` 끝에 1개 추가(중복 불가). 시작 노드는 `start`이고 `neighbor`는 null. 이웃이면 직전 `neighbor`와 같은 노드 |
| `enqueue` | 큐에 넣음 | `queue` 끝에 `discovered`의 마지막 노드를 추가. 직전 step은 `discover`다 |
| `dequeue` | 큐 앞에서 꺼냄 | `queue` 앞 원소를 제거하고 `current`로 둔다. `neighbor`는 null. 전제: `queue`가 비어 있지 않고 `current`가 null |
| `check-neighbor` | 이웃 하나를 검사(상태 변화 없음) | `neighbor`를 검사 대상 이웃으로 설정. 한 `current`에 대해 `graph[current]`의 이웃을 배열 순서대로 정확히 한 번씩 검사한다 |
| `process` | 현재 노드의 이웃 처리 완료 | `processed` 끝에 `current` 추가, `current`·`neighbor`는 null. 전제: 모든 이웃을 검사했다 |
| `finish` | 종료(마지막 step) | 상태는 직전과 같고 `queue`는 비어 있으며 `current`는 null |

- **step 1은 항상 시작 노드(`start`)의 `discover`이고, 그 다음 step은 `enqueue`다.** 시작 노드를 발견하지 않는 trace(`initial` 바로 다음에 `finish` 등)는 구조가 맞아도 거부한다.
- 검사한 이웃이 이미 발견된 노드면 다음 step은 `discover`가 아니라 다음 `check-neighbor` 또는 `process`다. 결과는 `message`로 설명한다.
- `while queue` 조건 검사는 별도 step을 두지 않는다. 참이면 `dequeue`의 줄에, 거짓이면 `finish`의 줄에 그 줄을 포함한다.

### 4.2 DFS (`dfs`, 재귀형)

**input**: BFS와 같다.

**state**: `{frames: {node, nextNeighborIndex}[], discovered: node[], processed: node[], current: node|null}`

- `frames`는 호출 스택이며 바닥→꼭대기 순서다. `nextNeighborIndex`는 그 frame이 **다음에 검사할 이웃의 위치**(0부터)다. `current`는 꼭대기 frame의 `node`이고, frame이 없으면 null이다.
- 검사 중인 이웃은 별도 필드 없이 `check-neighbor` step에서 `graph[top.node][top.nextNeighborIndex - 1]`로 얻는다.

| operation | 의미 | 전이 |
|---|---|---|
| `initial` | step 0 | `frames`·`discovered`·`processed`는 `[]`, `current`는 null |
| `call` | 함수 호출 | `frames` 끝에 `{node, nextNeighborIndex: 0}` 추가, `current = node`. 최초 호출은 `start`, 이후는 직전에 검사한 미발견 이웃 |
| `discover` | 현재 노드를 발견으로 기록 | `discovered` 끝에 `current` 추가. 직전 step은 `call`이다 |
| `check-neighbor` | 이웃 검사 | 꼭대기 frame의 `nextNeighborIndex`를 1 증가. 전제: 아직 검사할 이웃이 남아 있다 |
| `process` | 현재 노드의 이웃 처리 완료 | `processed` 끝에 `current` 추가. 전제: `nextNeighborIndex`가 이웃 수와 같다 |
| `return` | 호출 복귀 | `frames`의 꼭대기를 제거하고 `current`를 새 꼭대기의 `node`(없으면 null)로 둔다. 직전 step은 `process`다 |

- 마지막 step은 루트 frame의 `return`이다(`frames`가 비고 `current`가 null). DFS에는 `finish`가 없다.
- 검사한 이웃이 미발견이면 다음 step은 `call`, 이미 발견이면 다음 `check-neighbor` 또는 `process`다.

- **호출 스택의 모양**: 한 노드는 스택에 두 번 있을 수 없다(이미 발견한 노드는 다시 호출하지 않는다). 처리를 마친 노드가 스택에 남는 순간은 `process`와 `return` 사이의 꼭대기뿐이다. `call`로 쌓은 노드는 바로 다음 `discover`에서 발견으로 기록된다(그 사이에만 꼭대기 frame이 아직 `discovered`에 없을 수 있다).
- **`return`의 줄 표시**: 함수가 끝나 돌아오는 순간은 그 자체로 실행되는 줄이 없다. 처음 호출의 `return`은 함수 머리 줄, 이웃 호출의 `return`은 호출한 줄(`dfs(...)`)을 보여 준다. 실행 검증은 이 둘(함수 머리 줄, `return` 단계)을 줄 순서·횟수 비교에서 뺀다.

### 4.3 이분 탐색 (`binary-search`)

**input**: `{values: integer[], target: integer}`

- `values`는 비내림차순(오름차순, 중복 허용)이고 길이 0~20이다. `target`은 정수다.

**state**: `{values: integer[], target: integer, left: integer, right: integer, mid: integer|null, result: integer|null}`

- `values`와 `target`은 `input`과 같고 바뀌지 않는다. `left`·`right`는 양끝을 포함하는 구간이다. `result`는 종료 전에 null이다.

| operation | 의미 | 전이 |
|---|---|---|
| `initial` | step 0 | `left = 0`, `right = values.length - 1`, `mid`·`result`는 null |
| `compute-mid` | 중간 위치 계산 | `mid = floor((left + right) / 2)`. 전제: `left <= right`. 반복 조건 줄을 함께 표시한다 |
| `compare` | `values[mid]`와 `target` 비교(상태 변화 없음) | 전제: `mid`가 null이 아니다. 결과는 `message`로 설명한다 |
| `set-left` | `values[mid] < target`: 오른쪽 구간으로 | `left = mid + 1` |
| `set-right` | `values[mid] > target`: 왼쪽 구간으로 | `right = mid - 1` |
| `found` | 일치(마지막 step) | `result = mid`, `mid = null` |
| `finish` | 구간이 비어 종료(마지막 step) | 전제: `left > right`. `result = -1`, `mid = null` |

- 중복 값이 있으면 `result`는 일치하는 인덱스 중 하나다. "첫 번째 위치"라고 표현하지 않는다. (같은 값이 여럿일 때 이 알고리즘이 처음 만나는 인덱스를 돌려주며, 검증기는 그 인덱스와 정확히 같은지 확인한다.)
- 한 라운드(`compute-mid` → `compare` → `set-left`|`set-right`) 뒤에 구간이 남으면 다시 `compute-mid`, 비면 `finish`다. 첫 연산은 구간이 있으면 `compute-mid`, 빈 배열이면 `finish`다. `compare`는 결과(같음·작음·큼)에 따라 다음 연산이 `found`·`set-left`·`set-right`로 정해진다.
- `-1`은 결과 값일 뿐이며 배열 인덱스로 강조하지 않는다. 빈 배열은 `left = 0`, `right = -1`로 시작해 바로 `finish`한다.

### 4.4 버블 정렬 (`bubble-sort`)

**input**: `{values: integer[]}` (길이 0~20, 음수·중복 허용)

**알고리즘**: 조기 종료가 없는 기본형이다. 바깥 반복 `n-1`회, 안쪽 반복은 `n-1-i`회이고 `values[j] > values[j+1]`일 때만 교환한다(같은 값은 교환하지 않는다).

**state**: `{values: integer[], compareIndices: [integer, integer]|null, swapped: boolean, sortedFrom: integer}`

- `sortedFrom`은 뒤쪽에서 위치가 확정된 구간의 시작 인덱스다(`values.length`이면 확정된 원소 없음). 학습용 보조 상태다.

| operation | 의미 | 전이 |
|---|---|---|
| `initial` | step 0 | `values`는 input, `compareIndices`는 null, `swapped`는 false, `sortedFrom = values.length` |
| `compare` | 인접한 두 원소 비교 | `compareIndices = [j, j+1]`, `swapped = false`. 전제: `j + 1 < sortedFrom` |
| `swap` | 두 원소 교환 | `values[j]`와 `values[j+1]`을 교환, `swapped = true`. 전제: 직전 step은 `compare`이고 `values[j] > values[j+1]` |
| `mark-sorted` | 한 번의 패스가 끝남 | `sortedFrom`을 1 감소, `compareIndices = null`, `swapped = false` |
| `finish` | 종료(마지막 step) | `sortedFrom = 0`, `compareIndices = null`, `swapped = false`. `values`는 비내림차순 |

- 모든 step에서 `values`는 input의 순열이다(원소의 다중집합 보존). 길이 0 또는 1인 입력은 `compare` 없이 `initial → finish`이다.
- 한 패스는 `compare`(→ `swap`)를 `j = 0`부터 `sortedFrom - 2`까지 한 칸씩 이어 가고, 끝나면 `mark-sorted`다. 패스가 `n - 1`번 끝나면(`sortedFrom = 1`) `finish`이다. 확정된 구간(`index >= sortedFrom`)은 다시 비교하지 않는다.

### 4.5 eventId와 줄 매핑 (언어별)

같은 `eventId`는 한 언어 안에서 항상 같은 줄을 가리킨다(R5). 아래는 등록된 예제가 쓰는 전부이며 `language-mapping.test.mjs`가 손으로 적은 표와 소스 문장을 비교한다. 같은 `operation`이 여러 `eventId`를 가질 수 있다(처음 실행할 때는 초기화 줄이 함께 실행되기 때문이다).

| 알고리즘 | eventId | operation | Python | JavaScript | C |
|---|---|---|---|---|---|
| DFS | `call-start` / `return-start` | call / return | 1 | 1 | 2 |
| DFS | `call-neighbor` | call | 1, 5 | 1, 5 | 2, 7 |
| DFS | `return-neighbor` | return | 5 | 5 | 7 |
| DFS | `discover` | discover | 2 | 2 | 3 |
| DFS | `check-neighbor` | check-neighbor | 3, 4 | 3, 4 | 4, 5, 6 |
| DFS | `process` | process | 3 | 3 | 4 |
| 이분 탐색 | `first-mid` / `compute-mid` | compute-mid | 2, 3, 4 / 3, 4 | 2, 3, 4 / 3, 4 | 2, 3, 4 / 3, 4 |
| 이분 탐색 | `compare-equal` | compare | 5 | 5 | 5 |
| 이분 탐색 | `compare-smaller` / `compare-larger` | compare | 5, 7 | 5, 7 | 5, 7 |
| 이분 탐색 | `found` | found | 6 | 6 | 6 |
| 이분 탐색 | `set-left` / `set-right` | set-left / set-right | 8 / 10 | 8 / 10 | 8 / 10 |
| 이분 탐색 | `first-finish` / `finish` | finish | 2, 3, 11 / 3, 11 | 2, 3, 13 / 3, 13 | 2, 3, 13 / 3, 13 |
| 버블 정렬 | `first-compare` | compare | 2, 3, 4, 5 | 2, 3, 4, 5 | 2, 3, 4 |
| 버블 정렬 | `pass-compare` | compare | 3, 4, 5 | 3, 4, 5 | 2, 3, 4 |
| 버블 정렬 | `compare` | compare | 4, 5 | 4, 5 | 3, 4 |
| 버블 정렬 | `swap` | swap | 6 | 6 | 5, 6, 7 |
| 버블 정렬 | `mark-sorted` | mark-sorted | 4 | 4 | 3 |
| 버블 정렬 | `finish` / `finish-empty` | finish | 3 / 2, 3 | 3 / 2, 3 | 2 / 2 |

- 이분 탐색의 `else:`·`} else {` 줄(`set-right` 앞)은 실행 중에 따로 멈추는 줄이 아니라서 강조하지 않는다.
- 이분 탐색 `compare-*`가 5번만 또는 5·7번을 강조하는 이유: 같은지 먼저 검사하고(5), 같지 않을 때만 작은지 검사(7)하기 때문이다. 작음과 큼은 두 번째 검사의 결과로 갈린다.
- 그래프 알고리즘의 C 코드 첫 줄은 `#define N <노드 수>`이며 예제마다 노드 수에 맞는다(그 밖의 줄은 모든 예제가 같다).

## 5. 카탈로그

`frontend/js/data/catalog.json`은 존재하고 검증을 통과한 bundle만 등록한다.

```text
{ schemaVersion: 1,
  algorithms: [ { id: AlgorithmId, title: string,
                  examples: [ { id: string, title: string,
                                path: "<algorithmId>/<exampleId>.json",
                                languages: LanguageId[] } ] } ] }
```

- 로더는 catalog에 있는 `path`만 읽는다. 사용자 입력·URL 파라미터로 받은 문자열을 파일 경로로 쓰지 않는다. URL의 `algorithm`, `language`, `example`은 catalog에 존재하는 값만 허용하고, 아니면 기본값과 안내로 처리한다.
- `path`는 `data/` 아래 상대 경로이며 `..`, 절대 경로, 스킴을 허용하지 않는다. 정확히 `<algorithmId>/<exampleId>.json`이어야 하고 `^[a-z0-9-]+/[a-z0-9-]+\.json$`에 맞아야 한다(백슬래시·쿼리·해시·대문자 확장자도 오류).
- **등록된 예제(알고리즘 4개, 예제 16개, 모두 Python·C++·Java·Kotlin·Rust·C·JavaScript)**: BFS `diamond`·`cycle`·`disconnected`, DFS `basic`·`cycle`·`disconnected`, 이분 탐색 `basic`·`empty`·`single`·`not-found`·`duplicates`, 버블 정렬 `basic`·`empty`·`single`·`sorted`·`negative-duplicates`. 목록의 첫 예제가 그 알고리즘의 기본 예제이고, 알고리즘 순서는 BFS, DFS, 이분 탐색, 버블 정렬이다.
- **예제 데이터는 `scripts/trace-builders.mjs`가 만든다.** 코드·설명·줄 매핑·단계 생성·예제 목록이 그 파일에 있고 `node scripts/generate-traces.mjs`가 `frontend/js/data`를 다시 쓴다. `generated-data.test.mjs`가 데이터 파일이 빌더 출력과 글자까지 같은지 확인하므로, 코드나 매핑을 고치면 빌더의 해당 예제 `version`을 올리고 스크립트를 다시 실행해야 한다.
- 알고리즘 ID는 catalog 안에서, 예제 ID는 알고리즘 안에서 유일하다. 각 알고리즘에는 예제가 하나 이상 있고, 각 예제의 `languages`는 비어 있지 않고 중복이 없다. 객체의 키 집합은 위 정의와 정확히 같아야 한다.

### 로더 (`frontend/js/trace-loader.js`)

- `loadCatalog({signal, fetch, baseUrl}) -> Promise<Catalog>`, `loadBundle(algorithmId, exampleId, {signal, fetch, baseUrl, catalog}) -> Promise<TraceBundle>`. `fetch`와 `baseUrl`은 테스트를 위해 바꿀 수 있고 기본값은 `globalThis.fetch`와 `/web/js/data/`이다. `catalog`를 넘기면 다시 읽지 않는다. **넘긴 catalog도 반드시 §5의 검증을 거친다.** 호출자의 객체를 쓰지 않고 복사해서(`structuredClone`) 복사본을 검증하고 얼려서 쓰므로, 검증 뒤 요청 도중 호출자가 원본을 바꿔도 영향이 없다. 복사할 수 없거나 검증에 실패하면 파일을 요청하지 않고 `invalid-catalog`로 거부한다. `catalog`를 **생략(`undefined`)** 한 경우에만 직접 읽으며 `null`은 잘못된 값이다.
- `algorithmId`·`exampleId`는 catalog에서 항목을 찾는 데만 쓰고 경로로 쓰지 않는다. 찾지 못하면(경로처럼 보이는 문자열, `__proto__`, 숫자 등 포함) 파일을 요청하지 않고 `unknown-example`로 거부한다.
- 결과 bundle과 catalog는 **깊게 얼린(freeze) 상태**다. 얼린 배열을 바꾸려 하면 strict mode에서 `TypeError`가 난다.
- 실패는 `TraceLoadError`(`code`, 한국어 `message`, 개발자용 `details[]`)로 던진다.

  | code | 상황 |
  |---|---|
  | `network` | 요청 실패, 본문을 읽는 중 연결이 끊어짐 |
  | `not-found` / `http` | HTTP 404 / 그 밖의 HTTP 오류 |
  | `too-large` | 200KB 초과 |
  | `invalid-json` | JSON이 아님 |
  | `invalid-catalog` | catalog가 §5의 구조를 지키지 않음 |
  | `invalid-bundle` | `validateBundle` 실패. `details`에 검증 오류 목록 |
  | `unknown-example` | catalog에 없는 알고리즘·예제 |
  | `mismatch` | catalog와 bundle의 `algorithmId`·`exampleId`·언어 집합이 다름 |

- **중단(AbortSignal)은 `TraceLoadError`로 감싸지 않고 `AbortError`를 그대로 던진다.** 호출한 쪽은 `error.name === 'AbortError'`이면 오래된 요청으로 보고 버린다. 요청 전, 요청 중, 본문을 읽는 중 어느 시점에 중단해도 같다.

### 콘텐츠 검증 스크립트

- `npm run validate:traces`(= `node scripts/validate-traces.mjs [data 폴더]`)는 catalog와 등록된 모든 예제를 같은 검증기로 검사하고, 오류가 있으면 종료 코드 1로 끝난다.
- 추가로 다음을 오류로 본다: 등록된 파일이 없거나 JSON이 깨짐, catalog와 bundle의 ID·언어 불일치, **catalog에 등록되지 않은 `.json` bundle 파일**, **등록된 예제가 하나도 없는 catalog**(아무것도 검증하지 않은 통과를 막는다).

## 6. 공개 설정 `GET /api/config`

| 필드 | 타입 | 설명 |
|---|---|---|
| `supabase_url` | string \| null | Supabase 프로젝트 URL |
| `supabase_publishable_key` | string \| null | Publishable key |
| `app_origin` | string \| null | 예: `http://127.0.0.1:8000` |
| `auth_enabled` | boolean | 세 값이 모두 설정되었을 때만 true |

- 세 값이 모두 설정되면 `auth_enabled: true`이고, 하나라도 없으면 `auth_enabled: false`와 세 값 모두 null이다. 일부만 노출하지 않는다.
- 이 응답에는 Secret key, 서버 내부 경로, 그 밖의 설정을 넣지 않는다. 응답은 `Cache-Control: no-store`.
- 설정이 없어도 정적 웹, `/api/health`, 학습 기능은 정상 동작한다. 서버를 시작하는 경로는 Supabase 패키지를 불러오지 않는다. 인증이 필요한 API만 `503 auth_not_configured`를 돌려준다.
- **값을 읽는 방법**: 환경 변수가 `backend/.env`보다 우선한다(`.env`는 읽기만 하고 환경 변수를 바꾸지 않는다). 설정은 처음 쓸 때 한 번 읽으므로 값을 바꾸면 서버를 다시 시작한다. `APP_ENV_FILE`로 다른 파일을 지정하거나 빈 값으로 `.env` 읽기를 끈다.
- **형식 검사**(잘못된 값은 없는 것으로 보고 `auth_enabled:false`, 로그에는 변수 이름만 남기고 값은 남기지 않는다): `SUPABASE_URL`은 http(s) 주소(사용자 정보·쿼리 없음), `APP_ORIGIN`은 경로 없는 http(s) origin, `SUPABASE_PUBLISHABLE_KEY`는 `sb_publishable_…` 또는 role이 anon인 옛 JWT여야 한다. 서버 전용 키(`sb_secret_…`, role이 service_role인 JWT 등)를 이 자리에 잘못 넣어도 `/api/config`로 나가지 않는다.
- 일반 사용자 요청은 Publishable key와 그 사용자의 토큰으로만 Supabase를 부른다. Secret key(`SUPABASE_SECRET_KEY`)는 관리용 클라이언트 전용이며 라우터는 사용하지 않는다.

## 7. 인증·프로필 정책

- 사이트 회원은 이메일 주소·비밀번호·닉네임으로 가입한다. Supabase 서비스 계정이나 대시보드 로그인은 요구하지 않는다. 프로젝트 설정은 개발자/운영자의 책임이다.
- 가입·확인·로그인·세션 갱신·로그아웃·복구는 브라우저의 Supabase Auth SDK가 처리한다. FastAPI는 Bearer 토큰을 검증하기만 한다.
- 토큰 검증은 Supabase `get_user(jwt)`로 한다. decode만 하고 신뢰하지 않는다. 토큰이 없으면 `unauthenticated`(401), 만료·위조·검증 거부는 `invalid_token`(401), 검증 서비스가 응답하지 않아 판정할 수 없으면 `service_unavailable`(503)이다. 판정 불가를 허용으로 처리하지 않는다.
- 인증 설정(URL·Publishable key)이 없으면 인증이 필요한 API는 `auth_not_configured`(503)를 반환한다.
- 요청 처리에서 사용자 ID는 검증된 토큰에서만 얻는다. API 요청 본문에 정의되지 않은 `author_id`, `id`, 권한 필드가 있으면 422로 거부한다. Auth metadata의 해당 값은 권한 판단에 사용하지 않는다.
- **프로필 생성은 insert-if-absent다.** `POST /api/me/profile`은 프로필이 없을 때만 만들고(201), 이미 있으면 현재 프로필을 그대로 반환한다(200). 이때 요청의 닉네임으로 기존 닉네임을 덮어쓰지 않는다. 닉네임 변경은 `PATCH /api/me/profile`만 한다.
- **프로필이 없어도 `GET /api/me`는 200**이며 `nickname`이 null이다. 프로필이 없으면 글 작성(`POST /api/posts`)만 `profile_required`(403)로 막는다. 사용자는 프로필을 만든 뒤 글을 쓸 수 있다.
- 가입 폼의 닉네임은 Auth `user_metadata.nickname`으로 전달할 수 있다. 이 값은 신뢰할 수 없는 입력이다. 최초 인증 후 같은 규칙으로 검증해 프로필 생성에만 쓰고, 값이 없거나 규칙에 맞지 않으면 사용자에게 프로필 입력을 요구한다. 권한 판단에는 쓰지 않는다.
- 닉네임 규칙: 앞뒤 공백 제거 후 2~20자, 제어 문자(U+0000~U+001F, U+007F) 불가, 중복 허용. DB의 CHECK가 같은 규칙을 강제한다.
- 비밀번호는 가입·변경 폼에서 8자 이상을 요구하고 Supabase Auth의 최소 길이도 8자 이상으로 설정한다(10단계 적용·검증 대상). 클라이언트 검사만으로 강제했다고 간주하지 않는다. 로그인에서는 기존 비밀번호를 길이 규칙으로 차단하지 않고 Auth가 판정한다. 최대 길이와 추가 규칙은 Supabase Auth 설정을 따르며, Supabase가 거부하면 그 이유를 한국어 안내로 바꿔 보여준다.
- 가입·복구 요청의 안내 문구는 계정 존재 여부를 드러내지 않는다.
- 로그인 후 복귀 경로는 정규식 `^/web/html/[a-z0-9-]+\.html(\?[A-Za-z0-9=&_-]*)?$`에 맞는 같은 사이트 경로만 허용하고, 맞지 않으면 홈으로 보낸다. 복귀 경로는 로그인·가입 화면의 `?next=` 쿼리로 받고, 가입처럼 메일 링크를 거치는 경우에는 요청 때 `localStorage`(`algo-viz-next`, 경로만)에 두었다가 콜백에서 한 번 꺼낸다. 어느 쪽이든 꺼낼 때 위 정규식으로 다시 검사하고, 로그인·가입·재설정·콜백 화면은 복귀 대상에서 뺀다(10단계, `frontend/js/auth-forms.js`의 `safeReturnPath`).
- Auth 콜백은 `{APP_ORIGIN}/web/html/auth-callback.html` 하나로 통일한다. 이 주소를 Supabase의 Site URL·Redirect URL에 등록한다. `127.0.0.1`과 `localhost`는 다른 origin이므로 한쪽만 쓴다.

## 8. HTTP API

### 8.1 공통

- 같은 origin의 `/api/...`. 요청·응답 본문은 UTF-8 JSON(`application/json`).
- 인증이 필요한 요청은 `Authorization: Bearer <access_token>`을 보낸다. 토큰은 쿠키·쿼리·로그에 두지 않는다.
- 모든 응답(정적 파일 포함)에 `X-Request-ID`(서버가 생성)를 넣고, 오류 본문의 `request_id`와 같은 값을 쓴다. 클라이언트가 보낸 값은 쓰지 않는다. 공통 오류 형식은 `/api/` 아래 경로에 적용한다(없는 API 경로 404 `not_found`, 허용하지 않는 메서드 405 `method_not_allowed` 포함). 정적 파일(`/web`)의 404 등은 기존 응답을 그대로 둔다.
- 요청 본문의 정의되지 않은 필드는 422다.
- 오류 본문은 항상 다음 형식이다. `fields`는 입력 검증 오류에만 있고, 필드 이름 → 한국어 메시지(문자열 하나)다.

```json
{"error": {"code": "validation_error", "message": "입력값을 확인해 주세요.", "request_id": "3f6a1c0e9b7d4e2a8c5d1f0a6b9e7c42", "fields": {"title": "제목은 1~100자여야 합니다."}}}
```

- 내부 예외, SQL, 키, 토큰은 응답과 로그에 넣지 않는다.

### 8.2 오류 코드

| HTTP | `code` | 상황 |
|---|---|---|
| 400 | `invalid_cursor` | cursor의 형식·길이·타입이 잘못됨, 또는 cursor가 만들어진 필터와 요청의 `algorithm`이 다름 |
| 401 | `unauthenticated` | Authorization 헤더 없음 |
| 401 | `invalid_token` | 만료·위조·검증 거부된 토큰 |
| 403 | `forbidden` | 본인 글이 아님 |
| 403 | `profile_required` | 프로필이 없어 글을 쓸 수 없음 |
| 404 | `not_found` | 글이 없거나 이미 삭제됨 |
| 404 | `profile_not_found` | 수정할 프로필이 없음 |
| 412 | `precondition_failed` | `If-Match`의 version이 현재 version과 다름 |
| 422 | `validation_error` | 타입·길이·UUID·허용 ID·limit 범위 위반, 알 수 없는 필드, 형식이 잘못된 `If-Match`, 수정 필드가 없는 PATCH |
| 428 | `precondition_required` | 수정·삭제에 `If-Match`가 없음 |
| 429 | `rate_limited` | 요청 제한. `Retry-After` 헤더 포함 |
| 500 | `internal_error` | 예상하지 못한 서버 오류 |
| 503 | `service_unavailable` | Supabase 장애 또는 토큰 유효 여부를 판정할 수 없음 |
| 503 | `auth_not_configured` | 인증 설정이 없음 |

### 8.3 엔드포인트

| 메서드·경로 | 인증 | 요청 | 성공 응답 |
|---|---|---|---|
| `GET /` | 없음 | | 307 → `/web/html/index.html` |
| `GET /api/health` | 없음 | | 200 `{"status": "ok"}` (프로세스 생존만 확인) |
| `GET /api/config` | 없음 | | 200 §6 |
| `GET /api/me` | 필수 | | 200 `{id, email, nickname}`. 본인 이메일만. 프로필이 없으면 `nickname: null` |
| `POST /api/me/profile` | 필수 | `{nickname}` | 201 Profile(새로 생성) / 200 Profile(이미 있음, 변경 없음) |
| `PATCH /api/me/profile` | 필수 | `{nickname}` | 200 Profile. 프로필이 없으면 404 `profile_not_found` |
| `GET /api/posts` | 없음 | 쿼리 `limit`(1~50, 기본 20), `cursor`, `algorithm` | 200 `{items: PostSummary[], next_cursor: string \| null}` |
| `GET /api/posts/{id}` | 없음 | | 200 PostDetail + `ETag` |
| `POST /api/posts` | 필수 | `{title, body, algorithm_id?}` | 201 PostDetail + `Location: /api/posts/{id}` + `ETag` |
| `PATCH /api/posts/{id}` | 필수 | `If-Match` + 수정 필드 | 200 PostDetail + 새 `ETag` |
| `DELETE /api/posts/{id}` | 필수 | `If-Match` | 204 (본문 없음) |

- 읽기 API(`GET /api/posts`, `GET /api/posts/{id}`)는 인증이 필요 없다. `Authorization` 헤더가 와도 무시한다.
- `/api/me`와 `/api/me/profile` 응답은 `Cache-Control: no-store`다. 인증 헤더가 없는 요청과 설정이 없는 서버의 처리 순서는 인증 설정 없음(503 `auth_not_configured`) → 헤더 없음(401 `unauthenticated`) → 형식·검증 실패(401 `invalid_token`) → 판정 불가(503 `service_unavailable`)이다. 헤더 형식은 `Bearer <토큰>`(스킴은 대소문자 무시, 토큰은 공백·제어 문자·비 ASCII 없이 4096자 이하)이다.
- `Profile` = `{id, nickname, created_at, updated_at}`
- `PostSummary` = `{id, title, author_display_name, algorithm_id, created_at, version}` (본문·이메일 없음)
- `PostDetail` = `PostSummary` + `{author_id, body, updated_at}`. `author_id`는 화면이 소유자 버튼을 보일지 정하는 데 쓰며, 서버·DB의 권한 검사를 대체하지 않는다. posts의 SELECT가 공개이므로 이 값은 이미 직접 Data API로 조회할 수 있다.
- 글 입력 규칙: `title`은 앞뒤 공백을 제거한 뒤 1~100자, `body`는 1~10,000자이며 공백만으로 이루어질 수 없다(줄바꿈은 보존). `algorithm_id`는 §1의 알고리즘 ID 또는 null이다. 작성 시 `author_id`·`author_display_name`·`version`·시각을 받지 않는다.
- 목록 정렬은 `(created_at DESC, id DESC)`다. `cursor`는 클라이언트가 해석하지 않는 불투명 문자열(마지막 `created_at`, `id`, 필터를 담은 JSON의 base64url, 300자 이하)이다. `next_cursor`가 null이면 마지막 페이지다. 필터를 바꿀 때는 cursor를 버리고 처음부터 요청한다.
- `GET /api/posts?algorithm=`에서 허용 목록에 없는 값은 422, cursor와 필터가 맞지 않으면 400이다.

```json
{
  "id": "0b4e7a5e-3f0d-4c53-9b8e-6f1c2a9d7e11",
  "author_id": "5d2f3c1a-8e47-4a6b-b0d3-2f9a7c6e1b84",
  "author_display_name": "알고리즘학생",
  "title": "BFS에서 큐가 비는 시점이 궁금합니다",
  "body": "처리 완료와 발견의 차이를 다시 설명해 주세요.",
  "algorithm_id": "bfs",
  "version": 1,
  "created_at": "2026-10-14T05:30:00.123456Z",
  "updated_at": "2026-10-14T05:30:00.123456Z"
}
```

(위는 형식 예시이며 실제 데이터가 아니다.)

### 8.4 수정·삭제와 버전 충돌

- `version`은 1에서 시작한다. 성공한 수정(값이 같아도)마다 DB가 1씩 올린다.
- `ETag`는 따옴표를 포함해 `"post-<uuid>-v<version>"` 형식의 강한 ETag다. 예: `"post-0b4e7a5e-3f0d-4c53-9b8e-6f1c2a9d7e11-v1"`. `GET /api/posts/{id}`, 작성 응답, 수정 응답에 포함한다.
- `If-Match`는 위 형식의 값 **하나**만 허용한다. `*`, 여러 값, 약한 ETag(`W/`), 형식이 다른 값은 422다. 형식이 맞으면 서버가 현재 version과 비교한다.
- 형식은 맞지만 ETag의 UUID가 경로의 글 ID와 다르면 조건 불일치인 412다. 경로 글의 존재·소유권을 먼저 검사하므로 없는 글은 404, 타인 글은 403이 우선한다. version 숫자만 비교해서 다른 글의 ETag를 허용하지 않는다.
- `PATCH` 본문은 `{title?, body?, algorithm_id?}`이며 **필드의 누락과 null을 구분한다.**

| 필드 | 누락 | `null` | 값 |
|---|---|---|---|
| `title`, `body` | 변경 없음 | 422 | 검증 후 변경 |
| `algorithm_id` | 변경 없음 | 필터 연결 제거(null로 저장) | 허용 목록 검증 후 변경 |

- 세 필드가 모두 누락된 PATCH(빈 객체 포함)는 422다.
- 수정·삭제는 DB의 SECURITY INVOKER RPC에서 `id`, `auth.uid()`, `expected_version`을 조건으로 한 번에 처리한다. RPC를 거치지 않은 직접 PATCH/DELETE는 DB 트리거가 `42501 rpc_required`로 거부하므로 version 검사를 우회할 수 없다(§10.3). 결과 `ok` / `not_found` / `forbidden` / `version_conflict`를 각각 200·204 / 404 / 403 / 412로 바꾼다. 같은 version을 가진 동시 요청 두 개 중 하나만 성공한다.
- 충돌(412)에서 서버가 덮어쓰지 않는다. 클라이언트는 글을 다시 조회하고, 작성 중인 내용은 버리지 않은 채 사용자에게 비교·재편집을 안내한다. 412·403 응답에 현재 글 내용을 넣지 않는다.
- 이미 삭제된 글에 대한 수정·삭제는 404다.

### 8.5 검사 순서

한 요청에서 여러 오류가 겹치면 아래 순서의 첫 오류를 반환한다.

| 요청 | 순서 |
|---|---|
| `POST /api/posts` | 인증(401/503) → 입력 검증(422) → 프로필 확인(403 `profile_required`) → 저장 |
| `PATCH`·`DELETE /api/posts/{id}` | 경로 UUID 형식(422) → 인증(401/503) → `If-Match` 없음(428) → `If-Match` 형식·본문 검증(422) → RPC(404 → 403 → 412 → 성공) |
| `POST`·`PATCH /api/me/profile` | 인증 → 입력 검증(422) → 처리 |

### 8.5.1 11단계 구현 보완

- **cursor** = `{"c": 마지막 created_at(UTC ISO, 마이크로초), "i": 마지막 id, "a": 알고리즘 필터 또는 null}`을 JSON으로 직렬화한 base64url(패딩 없음, 300자 이하). 키가 정확히 셋이어야 하고 타입·시각(시간대 포함)·UUID를 검사하며, `a`가 요청의 `algorithm`과 다르면 400 `invalid_cursor`다. 검사를 통과한 정규화 값만 PostgREST 필터(`created_at.lt.… , and(created_at.eq.…, id.lt.…)`)에 들어간다. 저장소에는 `limit+1`건을 요청해 다음 페이지 유무를 정한다.
- **`If-Match`의 글 ID가 경로와 다르면** RPC에 어떤 version과도 맞을 수 없는 값(0)을 보내 존재(404)와 소유권(403)을 먼저 가린 뒤 412로 응답한다.
- **본문 문자 검사**: `title`·`body`에 NUL(`\u0000`)이 있으면 422다(PostgreSQL 텍스트에 저장할 수 없다).
- **경로 UUID**는 소문자 하이픈 형식만 받고(`str(UUID(x)) == x`), 인증보다 먼저 검사한다(수정·삭제).
- DB 오류 번역: `P0001 profile_required` → 403 `profile_required`. HTTP 상태(세 자리)와 SQLSTATE(다섯 자리)를 구분한다. 숫자만으로 된 SQLSTATE(`22023`, `23505` 등)를 5xx로 오해하지 않고 500 `internal_error`로 처리하며, `40001`·`40P01`(직렬화 실패·교착)은 503이다.
- 응답은 모두 `Cache-Control: no-store`다.

### 8.6 재시도 정책

- 읽기(GET)는 제한된 횟수로 다시 시도할 수 있다.
- 작성·수정·삭제는 응답을 받지 못했을 때(네트워크 끊김, 503, 시간 초과) 자동으로 다시 보내지 않는다. 사용자에게 상태를 확인하도록 안내한다.
- 인증 실패(401) 뒤 토큰을 갱신해 한 번만 다시 보내는 것은 서버가 요청을 처리하지 않았음이 확실한 경우에만 허용한다.

## 9. 재생기와 시각화 화면 (04~07단계)

### 재생 상태 (`frontend/js/player-state.js`, DOM·fetch 없음)

- 상태: `{algorithmId, exampleId, contentVersion, languageId, languages, stepIndex, lastStepIndex, playing, speed}`. 얼린 불변 객체이며 `createPlayerState(bundle, languageId, {speed})`가 step 0에서 **재생하지 않는 상태**로 만든다. `languages`는 그 bundle이 코드를 가진 언어(고를 수 있는 언어)이며 `codes`의 순서를 따르는 얼린 배열이다. 그 bundle에 없는 언어로 시작하면 `RangeError`다.
- `reducePlayer(state, action)`는 새 상태를 돌려주고 인자를 바꾸지 않는다. 바뀐 것이 없으면(처음에서 이전, 마지막에서 다음) **같은 객체**를 돌려준다.

  | action | 동작 |
  |---|---|
  | `NEXT` / `PREVIOUS` | `stepIndex`를 ±1 하되 `0..lastStepIndex`에 고정. **자동 재생을 멈춘다** |
  | `RESET` | step 0. 자동 재생을 멈춘다 |
  | `SEEK {index}` | 정수만 받아 범위 안으로 고정하고 자동 재생을 멈춘다. 정수가 아니면(NaN, 소수, 문자열, 생략) 무시하며 **재생도 멈추지 않는다** |
  | `SWITCH_LANGUAGE {languageId}` | `languageId`만 바꾸고 자동 재생을 멈춘다. `stepIndex`·알고리즘·예제는 그대로다. `languages`에 없는 값(`__proto__`, 대소문자가 다른 값, 문자열이 아닌 값, 생략 포함)이거나 지금과 같은 언어면 무시하고 같은 객체를 돌려준다 |
  | `PLAY` | 재생을 시작한다. 마지막 단계에서 누르면 step 0부터 다시 시작한다. 이미 재생 중이면 같은 객체 |
  | `PAUSE` | 재생을 멈춘다(탭 숨김·페이지 떠남에도 쓴다). 이미 멈춰 있으면 같은 객체 |
  | `SET_SPEED {speed}` | `SPEEDS`(0.5·1·2) 중 하나로 바꾼다. `stepIndex`·재생 여부는 그대로. 목록에 없거나 지금과 같은 값이면 무시 |
  | `TICK` | 자동 재생이 한 단계 나아간다. **재생 중이 아니면 무시**(멈춘 뒤 늦게 도착한 callback이 단계를 옮기지 못한다). 마지막 단계에 닿으면 `playing`이 저절로 `false`가 된다 |
  | 그 밖 | 프로그램의 실수이므로 `TypeError` |

- **언어 전환은 다시 계산하지 않는다.** 모든 언어의 trace는 같은 step에서 같은 논리 상태를 갖는다(R5). 그래서 전환은 `languageId`만 바꾸고, 화면은 같은 step 객체에서 선택한 언어의 코드·강조 줄(`step.lines[languageId]`)·설명(`codes[languageId].notes`)만 다시 읽는다. 그래프·큐 화면, 연산 이름, 단계 설명은 바뀌지 않는다. 자동 재생 중에 언어를 바꾸면 재생이 멈춘다(07단계).
- **"이전"은 값을 되돌리는 것이 아니라 `stepIndex`만 바꿔 얼린 bundle의 해당 스냅샷을 다시 읽는 것이다.** 이동 중 서버를 부르지 않는다. `getCurrentStep(bundle, state)`는 step 객체를 복사 없이 돌려주며, 다른 bundle에서 만든 상태나 범위 밖 단계는 예외로 거부한다.

### 자동 재생·속도·단계 이동 (07단계, `playback.js`·`controls.js`)

- **속도**: `SPEEDS = [0.5, 1, 2]`(배). 한 단계 사이의 시간은 `intervalFor(speed) = 1000 / speed`밀리초다(0.5배 2초, 1배 1초, 2배 0.5초). 새 예제는 항상 **멈춘 채 step 0**에서 시작하고, 사용자가 고른 속도는 이어받는다(`createPlayerState(bundle, languageId, {speed})`, 목록에 없으면 1배).
- **timer** (`createPlayback({advance, getState, scheduler}) → {play, pause, setSpeed, destroy}`): `scheduler`는 `{setTimeout, clearTimeout}`이며 생략하면 실제 시계(부를 때마다 `globalThis`에서 찾으므로 테스트가 가짜 시계를 끼울 수 있다)다. `advance`는 한 단계 나아가는 함수(화면에서는 `TICK` 전이), `getState`는 지금 재생 상태(없으면 `null`)다. DOM을 모른다.
  1. timer는 **항상 하나 이하**다. 재생 중에 `play()`를 다시 불러도, 속도를 바꿔도 늘지 않는다.
  2. 시작·정지·속도 변경·종료 때마다 **세대(generation)** 를 올린다. `clearTimeout`으로 취소하지 못하고 이미 대기열에 들어간 callback이 나중에 실행되어도 세대가 다르면 아무것도 하지 않는다(오래된 callback이 화면을 되돌리지 못한다).
  3. callback은 실행하는 순간 `getState()`로 재생 중이고 마지막 단계가 아닌지 **다시 확인**한다. 단계를 옮긴 뒤 마지막 단계에 닿았거나 재생이 멈췄으면 timer를 다시 걸지 않는다(마지막 단계에서 저절로 멈춘다).
  4. `advance()`가 예외를 던지면 timer를 걸어 두지 않고(`advance` 안에서 `syncPlayback`이 이미 건 timer까지 푼다) 예외를 다시 던진다. 풀려 있으므로 다시 `play()`할 수 있다. `destroy()` 뒤에는 모든 호출이 아무 일도 하지 않는다.
  5. `syncPlayback(playback, state)`: 상태가 바뀔 때마다(그리고 예제를 열 때) 부른다. 속도를 알려 주고, 재생 중이면 timer를 걸고 아니면 푼다. 상태가 `null`(불러오는 중)이면 푼다.
- **오래된 callback에 대한 겹친 방어선**: ① 재생 상태의 `TICK`은 재생 중이 아니면 무시한다 ② `playback`의 세대 번호와 실행 시점의 재생 확인 ③ 예제를 불러오기 시작하면 `state = null`로 비워 timer·조작이 이전 예제에 아무 일도 못 하게 한다. 한 겹이 빠져도 나머지가 화면을 되돌리지 못하게 막는다.
- **재생이 멈추는 경우**: 일시정지 버튼, 다음·이전·처음으로·슬라이더 이동, 언어 변경, 알고리즘·예제 변경(불러오기 시작), 마지막 단계 도달, 탭 숨김(`visibilitychange`에서 `document.hidden`이면 `PAUSE`; 다시 보여도 **저절로 이어지지 않는다**), 페이지 떠남(`pagehide`에서 멈추고 timer를 푼다. 뒤로 가기 캐시로 돌아올 수 있으면(`persisted`) 재생기를 없애지 않고 멈추기만 한다).
- **속도를 바꿔도 단계는 그대로**다(`SET_SPEED`는 `stepIndex`와 재생 여부를 바꾸지 않는다). 재생 중이면 새 간격으로 timer를 다시 걸어 이어 간다. 멈춘 상태에서 바꾸면 timer를 걸지 않는다.
- **같은 시점**: 코드 강조·설명·상태 그림·진행 표시·슬라이더는 모두 같은 `stepIndex`의 스냅샷에서 읽으므로, 자동 재생·속도 변경·슬라이더 이동 어느 쪽을 거쳐도 서로 다른 단계를 가리키지 않는다.
- **슬라이더** (`#viz-slider`, `<input type="range">`): 0부터 마지막 단계까지, `step="1"`, 시각적으로만 숨긴 `<label>`("단계 이동")이 연결되어 있다. `input`마다 `SEEK`이며 처음 움직이는 순간 재생이 멈춘다. 스크린 리더용 값(`aria-valuetext`)은 "단계 9 / 21"(재생 중이면 ", 자동 재생 중"을 덧붙인다)이다. 새 예제로 바뀔 때 **범위(max)를 먼저, 값을 나중에** 넣는다(더 짧은 예제에서 값이 잘리지 않게). 키보드(화살표·Home·End)로도 움직인다.
- **재생 버튼** (`#btn-play`): 글자로 상태를 알린다("재생" / "일시정지" / 마지막 단계에서 멈춰 있으면 "다시 재생" = 처음부터). 불러오는 동안을 빼고는 비활성이 되지 않으므로 누른 채 포커스를 잃지 않는다. 속도 선택(`#speed-select`)은 `<label>`("속도")이 연결된 `<select>`다.
- **스크린 리더**: 자동 재생 중에는 `#viz-live`의 `aria-live`를 `off`로 끈다(1초마다 단계를 읽으면 아무것도 들을 수 없다). 멈추면 `polite`로 되돌리고 멈춘 이유와 현재 단계를 **한 번** 알린다("일시정지했습니다. 단계 N / M.", "재생이 끝났습니다. 단계 M / M."). 단계 표시줄은 재생 중에 "자동 재생 중 (1배속)"으로 글자로도 알린다.
- **조작줄 배치**: 진행 표시 → 슬라이더·속도 → 버튼(처음으로·이전·재생·다음). 320px 폭에서도 버튼이 잘리거나 줄바꿈되지 않고(`font-size: min(1rem, 4vw)`), 높이가 520px 이하인 가로 화면에서는 한 줄로 모은다. 불러오는 동안은 재생 버튼·슬라이더·속도 선택도 막고, 포커스를 가지고 있으면 숨기거나 막기 전에 선택 상자로 옮긴다(`focus-guard.js`).
- **시계의 한계**: 단계마다 `setTimeout`을 다시 거는 방식이라 한 단계에 약 8~13ms씩 늦어진다(1배에서 한 단계가 약 1.01초). 정확한 시각 동기화가 필요한 기능이 아니므로 보정하지 않는다. 탭이 숨겨지면 멈추므로 브라우저의 timer 지연에 기대지 않는다.

### 주소의 값 (`resolveSelection(catalog, params)`)

- 주소 `?algorithm=&example=&language=`는 **catalog에 있는 값으로만** 해석한다. 파일 경로로 쓰지 않는다. 지정하지 않았거나 빈 값이면 기본값(BFS, 그 알고리즘의 첫 예제, Python)을 안내 없이 쓴다.
- 잘못된 값은 기본값으로 바꾸고 한국어 안내를 돌려준다. 알고리즘이 기본값으로 바뀌면 그 기준의 예제·언어 값은 무시하고 안내를 겹쳐 내지 않는다. 안내에 넣는 값은 제어 문자를 정리하고 24자로 줄이며 항상 `textContent`로 표시한다. 제목의 받침을 알 수 없으므로 조사는 `을(를)`, `은(는)`을 쓴다.

### 화면 표시 규칙

- 모든 시각화 페이지의 **정적 HTML**에 "준비된 예제의 실행 기록을 재생합니다. 입력한 코드를 실제로 실행하는 기능은 아닙니다."가 있다(JavaScript가 실패해도 보인다).
- 화면은 "방금 실행한 연산: <이름>"과 step의 한국어 `message`, 현재 단계(`단계 N / 마지막`, 실행 전·중·끝)를 항상 보여 준다. step 0은 "방금 실행한 연산"이라고 쓰지 않는다. 연산·설명은 `aria-live="polite"` 영역에 있고, 이름 표(`OPERATION_LABELS`, `LANGUAGE_LABELS`)는 `trace-contract.js`에 있으며 모든 operation에 이름이 있는지 테스트가 확인한다.
- 코드: 방금 실행한 줄을 노랑 배경 + 왼쪽 막대 + ▶ 표시로 강조하고 스크린 리더에는 "(방금 실행한 줄)"을 읽어 준다. **긴 줄은 줄바꿈한다**(줄 번호·▶는 첫 줄 옆에만 있고 이어지는 줄은 코드 열에 맞춘다). 좁은 화면에서 강조한 줄의 일부가 잘려 보이지 않게 하기 위해서이며, 코드 영역은 세로로만 스크롤하고 키보드로도 스크롤할 수 있다(`tabindex="0"`). 강조한 줄이 영역 안에서 가려지면 그 영역만 스크롤해 보이게 하고(페이지는 움직이지 않는다), 단계를 옮길 때는 스크롤 위치를 유지하며 언어를 바꿀 때만 맨 위로 되돌린다. 코드 영역은 `pre` 요소를 한 번만 만들어 계속 쓰므로(내용만 바꾼다) 그 영역에 포커스가 있어도 잃지 않는다.
- **알고리즘·예제 선택** (`#algo-select`, `#example-select`): `catalog`의 알고리즘 제목과 그 알고리즘의 예제 제목을 보여 주는 `<select>`이며 각각 `<label>`이 연결되어 있다. 값이 하나뿐이면 비활성이다. 알고리즘을 바꾸면 그 알고리즘의 첫 예제를, 예제만 바꾸면 같은 알고리즘의 그 예제를 **언제나 step 0에서** 연다. 언어는 새 예제가 그 언어의 코드를 가지고 있으면 그대로 두고 없으면 기본 언어(Python)로 바꾼다(`selectionAfterChange`). catalog에 없는 값이나 지금과 같은 값이면 화면을 다시 불러오지 않고 선택 상자만 되돌린다. 선택은 주소에 반영하지 않는다(주소로 시작 화면을 정하는 것은 된다).
- **불러오는 동안과 오래된 응답** (`request-gate.js`): 새 요청을 시작하면 이전 요청을 중단(`AbortController`)하고, 중단 신호를 무시하고 늦게 도착한 이전 응답도 `isCurrent()`로 버린다. 그래서 먼저 고른 예제가 나중에 도착해 새 화면을 덮어쓰지 않는다. 불러오는 동안에는 이전 화면(본문)을 숨기고 조작 버튼을 막으며(이전 예제를 조작하다가 갑자기 바뀌는 일이 없다) 선택 상자는 계속 쓸 수 있다. 실패하면 한국어 사유와 "다시 시도"(같은 선택을 다시 요청)를 보이고, 다른 예제를 고르면 복구된다.
- **숨기기 전에 포커스를 옮긴다** (`focus-guard.js`): 포커스를 가진 요소(또는 그 안의 요소)를 숨기거나 비활성으로 만들면 브라우저는 포커스를 body로 떨어뜨리고 키보드 사용자는 길을 잃는다. 그래서 예제를 불러오기 시작할 때(`show`) 재시도 버튼·오류 상세(요약)·본문·조작 버튼 중 하나가 포커스를 가지고 있으면 **숨기거나 막기 전에** 보이는 첫 선택 상자(예제 → 알고리즘 순, 비활성은 건너뜀)로 옮긴다. 선택 상자를 모두 쓸 수 없는 목록이면 상태 영역(`tabindex="-1"`, 프로그램으로만 포커스를 받는다)에 두고, 예제가 열리면 그 영역을 숨기기 전에 바로 쓸 수 있는 조작 버튼으로 옮긴다. **"다시 시도"를 눌렀다가 다시 실패하면** 그동안 사용자가 포커스를 옮기지 않았을 때만 재시도 버튼으로 돌려놓아 Enter를 다시 누를 수 있게 하고, 사용자가 다른 곳으로 옮겼다면 빼앗지 않는다. 선택 상자로 고른 예제가 실패한 경우에도 재시도 버튼으로 가져가지 않는다.
- **알고리즘별 화면은 `renderers/index.js`의 목록**에서 `algorithmId`로 찾는다(`render`, `renderLegend`, 상태 영역 제목, 범례 제목). 재생기(`visualizer.js`)와 재생 상태(`player-state.js`)는 알고리즘을 모르므로 새 알고리즘은 콘텐츠(bundle)와 renderer만 추가하면 된다. 등록되지 않은 알고리즘이면 "화면이 아직 없습니다" 오류로 열지 않는다.
- **DFS 화면** (`renderers/graph.js`): 노드 상태는 처리 완료 > 현재(스택 꼭대기) > 호출 스택에서 대기("스택 1"이 맨 아래) > 발견 > 미발견이다. 이웃을 검사하는 단계(`check-neighbor`)는 현재 노드 → 검사한 이웃 간선을 주황 굵은 화살표와 "검사 중" 표시로, 호출하는 단계(`call`)는 호출한 노드 → 새 노드 간선을 굵은 화살표로 강조한다. 호출 스택은 꼭대기를 맨 위에 두고 각 칸에 "다음에 볼 이웃(nextNeighborIndex)"을 적는다.
- **배열 화면** (`renderers/array.js`): 칸마다 인덱스·값·표시 글자를 따로 보여 주고(칸이 많으면 여러 줄로 감긴다) 같은 정보를 텍스트 목록으로도 적는다. 이분 탐색은 구간 밖 칸을 점선·흐린 글자로, `left`·`right`·`mid`와 찾은 칸("찾음")을 글자로 표시한다. **결과가 -1이면 어느 칸도 찾음으로 표시하지 않는다.** 버블 정렬은 비교 중인 두 칸("비교"), 방금 교환한 두 칸("교환됨"), 확정된 칸("확정")을 표시한다. 음수는 부호를 그대로 쓰고 스크린 리더용 설명에 "(음수)"를 붙인다. 빈 배열은 칸 대신 안내 문구를 보인다.
- 언어 선택(`language-select.js`): 코드 제목 옆의 `<select id="lang-select">`와 연결된 `<label>언어</label>`다. `state.languages`로 option을 한 번만 만들고 같은 요소를 계속 쓰므로 키보드로 언어를 바꾸는 동안 포커스를 잃지 않는다(`aria`를 따로 붙이지 않고 기본 `select`를 쓴다). 고를 수 있는 언어가 하나뿐이면 비활성이다. 언어를 바꾸면 제목의 언어 이름, 코드 영역의 `aria-label`("JavaScript 코드" 등), 설명(notes), 강조 줄이 바뀌고, 바로 그 한 번만 `aria-live` 영역이 "JavaScript 코드로 바꿨습니다. 단계 9 / 21."을 앞에 붙여 읽는다. 목록에 없는 값이 들어오면 상태를 바꾸지 않고 선택 상자를 현재 언어로 되돌린다.
- BFS 노드는 **색뿐 아니라 모양과 글자로** 구분한다.

  | 상태 | 모양 | 글자 |
  |---|---|---|
  | 미발견 | 점선 원 | 없음 |
  | 발견(큐에 넣기 전) | 실선 원 | 발견 |
  | 큐 대기 | 굵은 실선 원 | 큐 1(맨 앞), 큐 2, … |
  | 현재 | 이중 원 | 현재 |
  | 처리 완료 | 채운 어두운 원 | 완료 |
  | 검사 중인 이웃(위 상태에 겹침) | 점선 바깥 원 | 검사 중 |

  검사 중인 간선(`current → neighbor`)은 굵은 화살표다. 방향 간선은 모두 화살촉이 있고, 반대 방향 간선이 함께 있으면 서로 반대쪽으로 휘며, 자기 간선은 고리로 그린다.
- 큐는 "앞 → 뒤" 순서의 상자로, 비면 "비어 있음"으로 쓴다. 발견·큐·현재·이웃·처리 완료를 글자로 모두 적은 목록과 그래프의 텍스트 설명(`A → B, C · …`)이 항상 함께 나오며, 그림(SVG)은 같은 정보이므로 보조 기술에는 숨긴다.
- 렌더러는 **현재 상태(snapshot)만 받아 매번 새로 그린다.** 모든 글자는 `textContent`로 넣고 `innerHTML`·`outerHTML`·`insertAdjacentHTML`을 쓰지 않는다(테스트의 가짜 DOM이 쓰는 순간 예외를 던진다). 노드 위치는 입력의 `layout`을 그대로 쓴다.
- 단계 버튼(처음으로·이전·다음)은 `button`이며 불러오기 전과 끝(처음)에서는 비활성이다(`controls.js`). 재생 버튼·슬라이더·속도 선택은 위 "자동 재생·속도·단계 이동" 규칙을 따른다. 포커스가 있는 버튼이 비활성이 되면 키보드 포커스를 활성인 버튼으로 옮겨 포커스를 잃지 않게 한다. **순서가 중요하다: 모든 버튼의 상태를 먼저 갱신한 뒤에 옮긴다**(비활성 버튼에는 `focus()`가 실패한다). 어떤 버튼이 포커스를 가지고 있었는지는 갱신 전에 기억하고, 우선순위는 다음 > 이전 > 처음으로이다. 컨트롤 밖의 요소나 아무 곳에도 포커스가 없는 경우는 건드리지 않는다. 좁은 화면(≤600px)에서 배경음악 컨트롤은 제목과 겹치지 않도록 헤더 아래로 옮긴다(공통 스타일).
- 불러오기에 실패하면 한국어 사유와 "다시 시도"를 보여 주고 잘못된 상태를 그리지 않는다. 안내 문구는 유지한다.

## 10. 데이터베이스: 테이블·제약·RLS·트리거·RPC (08단계)

SQL은 `supabase/migrations/`의 세 파일이며 **이 순서로** 적용한다(`202610140001_profiles_posts.sql` → `202610140002_rls_triggers.sql` → `202610140003_post_mutations.sql`). 적용 방법과 사전 점검은 [supabase/README.md](../supabase/README.md), 검증은 `npm run test:db`이다. 아래는 그 SQL이 실제로 만드는 것이며 DESIGN.md §7·§8과 §7·§8(위)의 정책을 DB에서 강제한다.

### 10.1 테이블과 제약

| 테이블 | 컬럼 | 제약 |
|---|---|---|
| `public.profiles` | `id uuid` PK → `auth.users(id)` ON DELETE CASCADE, `nickname text`, `created_at`, `updated_at` (timestamptz) | 닉네임 **2~20자**(`profiles_nickname_length`), **앞뒤 공백 없음**(`profiles_nickname_trimmed`), **제어 문자 불가** U+0000~U+001F·U+007F(`profiles_nickname_no_control`). 중복 허용 |
| `public.posts` | `id uuid` PK 기본 `gen_random_uuid()`, `author_id` → `profiles(id)` ON DELETE CASCADE, `author_display_name`, `title`, `body`, `algorithm_id` (nullable), `version integer` 기본 1, `created_at`, `updated_at` | 제목 **1~100자**(`posts_title_length`)·**앞뒤 공백 없음**(`posts_title_trimmed`), 본문 **1~10,000자**(`posts_body_length`)·**공백만 불가**(`posts_body_not_blank`), `algorithm_id`는 `bfs`·`dfs`·`binary-search`·`bubble-sort` 또는 null(`posts_algorithm_id_allowed`), `version > 0`(`posts_version_positive`) |

- **공백**은 Python `str.strip()`이 지우는 문자(`str.isspace`)와 같은 집합이다: U+0009~U+000D, U+001C~U+001F, U+0020, U+0085, U+00A0, U+1680, U+2000~U+200A, U+2028, U+2029, U+202F, U+205F, U+3000. 문자 코드로 직접 적었으므로 DB 로케일에 영향을 받지 않는다. 그 밖의 보이지 않는 문자(예: U+200B)는 공백으로 보지 않는다.
- API(11단계)가 앞뒤 공백을 제거한 값을 보내고 DB는 **이미 정리된 값만** 받는다. 제목 가운데의 공백·줄바꿈과 본문의 줄바꿈(맨 앞·뒤 포함)은 보존한다. 닉네임과 제목의 앞뒤 공백, 본문의 공백만 있는 값은 DB가 `23514`로 거부한다.
- 글자 수는 문자(코드 포인트) 수다. 이모지 하나는 1자이며 Python `len`과 같다.
- 인덱스: `posts(created_at DESC, id DESC)`, `posts(author_id, created_at DESC, id DESC)`, `posts(algorithm_id, created_at DESC, id DESC)`. 목록 정렬은 `(created_at DESC, id DESC)`이다.

### 10.2 권한과 RLS

Supabase는 `public`의 새 테이블·함수에 `anon`·`authenticated`·`service_role` 권한을 기본으로 준다. migration은 **모두 회수**하고 필요한 것만 다시 준다. **회수는 테이블을 만드는 첫 파일(`…0001`)이 같은 트랜잭션 안에서 한다**(RLS 활성화 + `REVOKE ALL … FROM PUBLIC, anon, authenticated`). migration 파일은 하나씩 따로 적용될 수 있으므로 둘째 파일로 미루면 첫 파일을 적용한 직후부터 둘째 파일을 적용하기 전까지 비회원이 읽고 쓸 수 있는 틈이 생기기 때문이다. 그래서 첫 파일만 적용된 상태에서는 `service_role`(RLS 우회 역할) 말고는 아무도 두 테이블에 접근하지 못하고, `…0002`가 아래 표의 권한과 정책을 연다. 함수를 만드는 파일(`…0002`의 트리거 함수, `…0003`의 RPC)도 같은 파일 안에서 기본 실행 권한을 회수한다. 이 규칙은 "테이블이나 함수를 만든 파일은 그 파일 안에서 잠근다"로 일반화되며 `tests/db`의 정적 테스트가 검사한다.

| 대상 | anon | authenticated |
|---|---|---|
| `profiles` | 권한 없음 | SELECT, INSERT(`id`, `nickname`만), UPDATE(`nickname`만). **DELETE 없음**, TRUNCATE 등 없음 |
| `posts` | SELECT | SELECT, INSERT(`author_id`, `title`, `body`, `algorithm_id`만), UPDATE(`title`, `body`, `algorithm_id`만), DELETE |

RLS는 두 테이블에서 켜져 있고 정책은 정확히 아래 7개다(`auth.uid()`는 `(select auth.uid())`로 감싼다). DELETE 정책이 없는 `profiles`는 어느 역할도 삭제할 수 없다.

| 정책 | 대상·행위 | 조건 |
|---|---|---|
| `profiles_select_own` | authenticated SELECT | `id = auth.uid()` |
| `profiles_insert_own` | authenticated INSERT | WITH CHECK `id = auth.uid()` |
| `profiles_update_own` | authenticated UPDATE | USING·WITH CHECK `id = auth.uid()` |
| `posts_select_public` | anon·authenticated SELECT | `true` |
| `posts_insert_own` | authenticated INSERT | WITH CHECK `author_id = auth.uid()` |
| `posts_update_own` | authenticated UPDATE | USING·WITH CHECK `author_id = auth.uid()` |
| `posts_delete_own` | authenticated DELETE | USING `author_id = auth.uid()` |

`service_role`(Secret key)은 RLS를 우회하며 일반 사용자 요청에 쓰지 않는다. 그 역할도 아래 트리거의 불변 규칙은 지켜야 한다.

### 10.3 트리거 (모두 SECURITY INVOKER, `search_path` 고정, 사용자 역할이 직접 실행할 수 없음)

`posts`의 UPDATE·DELETE 권한은 두 RPC가 SECURITY INVOKER로 실행되려면 필요하므로 `authenticated`에게 남아 있다. 직접 쓰기를 막는 것은 권한이 아니라 아래 `posts_00_require_rpc`다.

- `profiles_guard` (INSERT·UPDATE): 생성 시 `created_at`·`updated_at`을 DB가 정한다. 수정 시 `id`·`created_at`을 바꾸면 `23514 immutable_column`, `updated_at`은 DB가 갱신한다.
- `posts_guard_insert` (INSERT): `author_display_name`을 **`profiles.nickname`에서 복사**한다. 호출자가 준 값은 무시하고(컬럼 권한으로도 줄 수 없다), 호출자에게 그 프로필이 보이지 않거나 없으면 `P0001 profile_required`로 거부한다(타인 `author_id`를 주면 그 프로필이 보이지 않아 같은 오류다). `version`은 1, `created_at`·`updated_at`은 DB 시각으로 정한다.
- `posts_guard_update` (UPDATE): `id`·`author_id`·`author_display_name`·`created_at`을 바꾸면 `23514 immutable_column`. 성공한 수정마다(값이 같아도) **`version`을 1 올리고 `updated_at`을 갱신**한다. 호출자가 정한 `version`·`updated_at`은 무시한다.
- `posts_00_require_rpc` (UPDATE·DELETE, **migration 4**): RLS를 우회하지 않는 역할(`anon`·`authenticated`)이 `update_post`·`delete_post`를 거치지 않고 `posts`를 직접 고치거나 지우면 `42501 rpc_required`로 거부한다. 두 RPC는 UPDATE·DELETE 직전에 트랜잭션 안에서만 유지되는 설정값 `app.post_rpc = 'on'`을 켠다. RLS를 우회하는 관리 역할(`service_role`, `postgres`)과 계정 삭제의 연쇄 삭제(테이블 소유자 권한)는 막지 않는다. 다른 사람의 글은 RLS가 행을 숨겨 이 트리거에 닿기 전에 0행이 된다. 요청 하나가 트랜잭션 하나이고 사용자가 `set_config`를 직접 부를 수 없다는 가정에 기대므로, 설정값을 바꾸는 함수를 공개 스키마에 노출하지 않는다.
- 닉네임을 바꿔도 이미 쓴 글의 `author_display_name`은 바뀌지 않고, 그 뒤의 글에는 새 닉네임이 복사된다.

### 10.4 프로필 생성은 insert-if-absent

`INSERT INTO public.profiles (id, nickname) VALUES (…) ON CONFLICT (id) DO NOTHING`(PostgREST의 `Prefer: resolution=ignore-duplicates`)을 쓴다. 이미 있으면 **0행이 삽입되고 기존 닉네임은 그대로**다. 같은 `id`를 그냥 INSERT하면 `23505`다. 다른 사용자의 `id`로 만들면 RLS가 거부한다(`42501`). 닉네임 변경은 UPDATE만 한다.

### 10.5 수정·삭제 RPC (낙관적 동시성)

둘 다 **SECURITY INVOKER**다(호출자의 컬럼 권한과 RLS가 그대로 적용된다). 실행 권한은 `authenticated`만 갖고 `anon`·PUBLIC은 없다. 결과는 **항상 한 줄**이며 첫 컬럼 `result`가 아래 넷 중 하나다.

`update_post(p_id uuid, p_expected_version integer, p_title text DEFAULT NULL, p_body text DEFAULT NULL, p_algorithm_id text DEFAULT NULL, p_set_algorithm_id boolean DEFAULT false)`
→ `TABLE(result text, id uuid, author_id uuid, author_display_name text, title text, body text, algorithm_id text, version integer, created_at timestamptz, updated_at timestamptz)`. `result`가 `ok`일 때만 글의 값이 채워지고 그 밖에는 null이다(412·403 응답에 현재 글을 넣지 않는다).

`delete_post(p_id uuid, p_expected_version integer)` → `TABLE(result text)`.

| `result` | 의미 | API(11단계) |
|---|---|---|
| `ok` | 소유자의 글이고 version이 일치해서 바꿨다 | 200(새 ETag)·204 |
| `not_found` | 글이 없거나 이미 삭제됨 | 404 |
| `forbidden` | 본인 글이 아님(version이 틀려도 이쪽이 우선) | 403 |
| `version_conflict` | 본인 글이지만 기대한 version과 현재 version이 다름 | 412 |

- **필드 누락과 null의 구분**(§8.4와 같다): `p_title`·`p_body`가 NULL이면 **변경 없음**이다(제목·본문을 null로 만드는 요청은 API가 422로 거부하므로 DB에 오지 않는다). `algorithm_id`는 **`p_set_algorithm_id`가 true일 때만** 바꾸며, 이때 `p_algorithm_id`가 NULL이면 알고리즘 연결 제거다. `p_algorithm_id`를 주면서 `p_set_algorithm_id`를 true로 하지 않으면 조용히 무시하지 않고 `22023`으로 거부한다. 바꿀 필드가 하나도 없으면 `22023`, `p_id` 또는 `p_expected_version`이 null이면 `22004`이다.
- **원자성**: 소유자·version 확인과 변경이 `WHERE id = p_id AND author_id = auth.uid() AND version = p_expected_version`인 **하나의 UPDATE/DELETE 문**이다. 같은 version의 요청 둘이 겹치면 하나가 행 잠금을 얻어 먼저 바꾸고, 나머지는 잠금이 풀린 뒤 바뀐 version으로 조건을 다시 평가해 0행이 되어 `version_conflict`(삭제된 뒤라면 `not_found`)가 된다. 0행일 때만 별도 조회로 원인을 가린다. 우선순위는 `not_found` → `forbidden` → `version_conflict`다. `READ COMMITTED`(PostgREST 기본)를 전제로 하며, 더 높은 격리 수준에서는 `40001`로 끝날 수 있다.
- 입력 값 위반(공백만 있는 본문, 허용 목록 밖 알고리즘 등)은 결과 값이 아니라 **SQLSTATE 예외**로 오고(`23514`, 제약 이름이 메시지에 있다) 그 요청은 아무것도 바꾸지 않는다(version도 오르지 않는다). 정상 경로에서는 API가 먼저 검증하므로 도달하지 않아야 한다.
- 성공한 수정은 값이 같아도 version을 올린다. `anon`이 호출하면 `42501`이다.

### 10.6 SQLSTATE 정리(API가 DB 오류를 만났을 때)

| SQLSTATE | 메시지·이름 | 의미 | API 처리 |
|---|---|---|---|
| `P0001` | `profile_required` | 프로필이 없어 글을 쓸 수 없음 | 403 `profile_required` |
| `23514` | 제약 이름(`posts_title_trimmed` 등) 또는 `immutable_column` | 입력 규칙 위반 / 불변 컬럼 변경 시도 | 422 `validation_error`(정상 경로에서는 선검증으로 도달하지 않음) |
| `23505` | | 이미 있는 프로필을 그냥 INSERT | insert-if-absent를 쓰면 발생하지 않음 |
| `42501` | | 권한·RLS 거부 | 403 `forbidden`(소유권) 또는 서버 설정 오류 |
| `22023`·`22004` | | RPC에 잘못된 인자 | 프로그램 오류이므로 500 `internal_error` |

### 10.7 검증 범위

로컬 PostgreSQL 18 임시 클러스터에서 `npm run test:db`로 확인한다. 네 묶음이다: `migration_steps`(migration을 하나씩 적용한 **직후 상태**: `after_migration_1.sql`, `after_migration_2.sql`), `rls`, `post_mutations`, `concurrency`. 이름을 잘못 쓰거나 실행된 검사가 하나도 없으면 실행기는 실패(종료 코드 1)한다. Supabase의 PostgREST·Auth를 거친 경로와 실제 Supabase 프로젝트에 대한 적용·diff는 이 문서의 검증 범위가 아니다(supabase/README.md의 "확인하지 않은 것" 참고).

## 11. 변경 규칙

- trace 계약을 바꾸면 이 문서, DESIGN.md §6, 검증기(`trace-validator.js`), 모든 fixture, 소비 코드(재생기·렌더러)를 같은 작업에서 고친다. 호환되지 않는 변경은 `schemaVersion`을 올린다.
- API·DB 계약을 바꾸면 이 문서, DESIGN.md §7·§8, migration, 스키마·서비스 코드, 프런트엔드, 테스트를 함께 점검한다.
- 03단계는 실제 JSON·타입에 맞춰 §3~§5를, 08단계는 실제 DB 제약과 RPC 인자·결과를(§10에 확정했다), 11단계는 실제 오류·cursor·ETag 동작을 이 문서에 보완한다. DB 제약이나 RPC를 바꾸면 migration, `supabase/tests`, 이 문서의 §10, API 코드를 같은 작업에서 고친다.


### 10단계 회원 양식 동작 보완 (2026-10-25)

- 회원 양식은 값을 읽은 후 비밀번호 입력란을 즉시 비우고, 요청 대기 중 재진입을 막는다. 종료 시 원래 비활성 상태를 복원한다. 응답 유실·실패에 자동 재제출하지 않는다.
- 양식 안에 있던 포커스는 입력을 비활성화하기 전에 진행 상태 영역으로 이동한다. 종료 시에도 그 영역에 포커스가 있고 양식이 표시 중일 때만 원래 입력으로 복원한다. 사용자가 다른 곳으로 이동했거나 성공 패널로 옮긴 포커스는 유지한다.
- PKCE 교환이 오류 없이 끝나더라도 사용자와 access token이 담긴 세션이 없으면 완료로 표시하지 않고 invalid_code로 안내한다. 토큰 자체의 신뢰 판단은 기존 서버 검증 계약을 따른다.


### 11단계 입력 경계 보완 (2026-10-25)

- cursor 시각의 UTC 변환 결과가 지원 범위를 벗어나면 DB 조회 전에 400 invalid_cursor로 거부한다. 내부 날짜 변환 예외를 500으로 노출하지 않는다.
- POST/PATCH의 title·body에 PostgreSQL UTF-8 text로 저장할 수 없는 고립 surrogate가 있으면 기존 NUL 규칙과 같이 422 validation_error로 거부한다. JSON의 올바른 surrogate 쌍은 파싱 후 일반 유니코드 문자이므로 허용한다.


### 12단계 게시판 화면 요청 관리 (2026-10-25)

- 새 글 작성은 대기 중 중복 submit 이벤트도 취소한다. 성공 응답 전에는 초안을 비우지 않으며, 실패한 쓰기를 자동 재전송하지 않는다.
- 계정 변경 시 프로필 조회는 이전 요청을 취소하고 세대가 맞는 응답만 반영한다. 로그아웃 뒤 늦은 응답·이전 요청 오류는 무시한다. 반환된 사용자 ID가 현재 계정과 다르면 작성자 안내에 사용하지 않는다.
- 인라인 재로그인은 회원 양식과 같은 중복 제출·비밀번호 즉시 정리 정책을 사용한다. 재로그인 성공 시 원래 글 양식/상태 안내로 포커스를 이동하며, 작성 중인 글은 별도 저장소나 다른 페이지로 보내지 않는다.
- 제목·본문의 NUL·고립 surrogate는 해당 필드 오류로 표시한다. 정상 이모지와 줄바꿈은 허용한다. 최종 권한과 입력 판정은 API·RLS가 한다.


## 학습 유형 확장 계약 (2026-10-25)

이 절은 초기 4개 알고리즘 계약에 추가되는 범위다. schemaVersion은 1을 유지하고 알고리즘 ID·입력 키·검증 규칙을 확장한다. 기존 16개 bundle 내용은 바꾸지 않았다.

### BFS 격자 응용

BFS input에 선택적 grid={rows,cols,walls,start,goal}을 허용한다. rows 1~3, cols 1~4이며 벽·시작·도착 좌표는 [행,열]이다. 시작·도착이 벽일 수 없다. 이동 가능한 칸을 행 우선 A,B,…로 바꾸고 오른쪽·아래·왼쪽·위 순서로 이웃을 만든다. 양방향 이동은 두 방향 간선으로 표현한다(directed:true). 기존 그래프/좌표/시작 노드와 grid 변환 결과가 정확히 같아야 한다. 기존 BFS 상태·전이 검증을 그대로 적용한다. 시작점 거리는 0이고 발견된 칸에만 거리·최단 경로를 유도해 표시한다. 이 보조 표시는 원본 코드의 추가 변수가 아니다.

### 새 알고리즘 입력

| ID | input | 제한 |
|---|---|---|
| union-find | n, operations | n 1~8, 연산 최대 8개. [0(합치기)/1(조회), a, b] |
| dijkstra | n, edges, start | n 1~6, 방향 간선 최대 12개, 가중치 0~20. 중복 방향 간선 금지 |
| knapsack | weights, values, capacity | 물건 최대 5개, 무게 1~12, 가치 0~30, 용량 0~12 |
| topological-sort | n, edges | n 1~6, 방향 간선 최대 12개. 사이클 입력도 허용하고 실패를 설명 |
| two-pointers | values, target | 원소 최대 12개, 각 값 1~20, 목표 합 1~100 |

### 새 알고리즘 trace와 코드

- state는 {vars:{…}}이며 알고리즘의 정수 변수·작업 배열을 독립 복사한다. 변수 목록·분기·정수 연산·event는 learning-programs.js의 유한한 선언형 프로그램 정의가 결정한다. 사용자 코드를 eval하거나 입력으로 프로그램을 바꾸지 않는다. 입력 제한과 연산/단계 예산을 강제한다.
- initial은 입력·작업공간 초기화 선언을 준비한 상태다. 반복문 조건·인덱스 갱신 등 모든 줄을 하나씩 재생하는 것이 아니라 표시된 학습 event 뒤의 상태를 보인다. finish는 결과 출력 지점을 강조한다.
- 코드에는 현재 예제의 입력 선언이 포함된다. Java는 Main, 나머지는 각 언어의 실행 진입점을 제공한다. 부모/거리/DP/큐 배열은 0 기반이며 DP 표는 i*width+c로 평탄화한다. JavaScript/C/C++/Java/Kotlin/Rust와 Python의 정수 연산 결과가 같도록 입력을 작게 제한한다.
- 다익스트라 state의 1000000은 ∞ 센티널이며 입력 최대 거리보다 충분히 크다. 이는 일반 입력 정수 -999~999 제한의 예외인 내부 표시 값이다.
- 새 검증기는 프로그램의 정규 실행 단계 수·event·전체 상태·설명과 언어별 코드/매핑을 비교해 조기 종료·누락·변조를 거부한다. 생성기와 프로그램 정의를 공유하는 한계가 있으므로 별도 집합 정답·Floyd–Warshall·부분집합 완전탐색·이중 반복 합·독립 위상 계산 및 실제 코드 실행 테스트를 함께 사용한다.
- 언어별 문법 차이와 초기화로 인해 다른 예제의 같은 event가 같은 줄 번호일 필요는 없다. 동일 bundle 안의 같은 event 매핑 일관성은 유지한다. 기존 알고리즘 예제의 기존 매핑 규칙은 보존한다.

### 화면과 복잡도

복잡도는 코드에 맞는 시간·보조/입력 공간, 기호, 전제와 이유를 제공한다. 다익스트라는 힙이 아닌 O(V²), 위상 정렬은 인접 리스트 O(V+E), 배낭은 의사 다항 O(NW), 유니온 파인드는 랭크+경로 반감의 분할 상환 경계, 투 포인터는 양의 정수 연속 합 조건이다. 재생 속도·trace/렌더링 비용을 알고리즘 복잡도와 혼동하지 않는다. 설명 패널은 접을 수 있고 언어·단계 변경으로 사라지지 않는다. 격자는 전용 범례를 사용한다.

게시글 algorithm_id는 9개 ID와 null을 허용하며, 기존 DB에는 추가 migration 202610250001_learning_algorithms.sql을 적용한다. 기존 글과 소유권/RLS/RPC 정책은 변경하지 않는다.
