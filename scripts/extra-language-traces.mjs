// Java, Kotlin/JVM, Rust 코드와 의미 이벤트별 강조 줄.
export const EXTRA_CODES = {
    "java": {
        "bfs": {
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
        "dfs": {
            "lines": [
                "class Algorithm {",
                "    static void dfs(int[][] graph, int node, boolean[] visited) {",
                "        visited[node] = true;",
                "        for (int nxt : graph[node]) {",
                "            if (!visited[nxt]) {",
                "                dfs(graph, nxt, visited);",
                "            }",
                "        }",
                "    }",
                "}"
            ],
            "notes": "노드 A, B, C, …는 입력 순서의 정수 인덱스 0, 1, 2, …로 나타냅니다. 인접 리스트의 이웃 순서대로 방문합니다. processed와 호출 스택은 학습용 표시입니다. 첫 호출 전 new boolean[graph.length]를 전달합니다. 깊은 재귀는 스택 한계에 주의해야 합니다."
        },
        "binary-search": {
            "lines": [
                "class Algorithm {",
                "    static int binarySearch(int[] values, int target) {",
                "        int left = 0, right = values.length - 1;",
                "        while (left <= right) {",
                "            int mid = left + (right - left) / 2;",
                "            if (values[mid] == target) {",
                "                return mid;",
                "            } else if (values[mid] < target) {",
                "                left = mid + 1;",
                "            } else {",
                "                right = mid - 1;",
                "            }",
                "        }",
                "        return -1;",
                "    }",
                "}"
            ],
            "notes": "오름차순 int 배열에서 양끝을 포함하는 구간을 탐색합니다. 빈 배열이면 right는 -1이고 반복하지 않습니다. 같은 값이 여러 개면 그중 하나의 인덱스, 없으면 -1을 반환합니다."
        },
        "bubble-sort": {
            "lines": [
                "class Algorithm {",
                "    static void bubbleSort(int[] values) {",
                "        int n = values.length;",
                "        for (int i = 0; i < n - 1; i++) {",
                "            for (int j = 0; j < n - 1 - i; j++) {",
                "                if (values[j] > values[j + 1]) {",
                "                    int temp = values[j];",
                "                    values[j] = values[j + 1];",
                "                    values[j + 1] = temp;",
                "                }",
                "            }",
                "        }",
                "    }",
                "}"
            ],
            "notes": "원본 int 배열을 정렬합니다. 임시 변수로 교환하는 세 줄은 한 단계로 표시합니다. 같은 값은 교환하지 않습니다. sortedFrom은 안쪽 반복이 끝날 때 갱신하는 학습용 표시입니다. 조기 종료가 없는 기본형입니다."
        }
    },
    "kotlin": {
        "bfs": {
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
        "dfs": {
            "lines": [
                "fun dfs(graph: Array<IntArray>, node: Int, visited: BooleanArray) {",
                "    visited[node] = true",
                "    for (nxt in graph[node]) {",
                "        if (!visited[nxt]) {",
                "            dfs(graph, nxt, visited)",
                "        }",
                "    }",
                "}"
            ],
            "notes": "노드 A, B, C, …는 입력 순서의 정수 인덱스 0, 1, 2, …로 나타냅니다. 인접 리스트의 이웃 순서대로 방문합니다. processed와 호출 스택은 학습용 표시입니다. 첫 호출 전 BooleanArray(graph.size)를 전달합니다. 배열을 공유하므로 재귀 호출에서 발견 기록을 유지합니다. 깊은 재귀는 스택 한계에 주의해야 합니다."
        },
        "binary-search": {
            "lines": [
                "fun binarySearch(values: IntArray, target: Int): Int {",
                "    var left = 0",
                "    var right = values.size - 1",
                "    while (left <= right) {",
                "        val mid = left + (right - left) / 2",
                "        if (values[mid] == target) {",
                "            return mid",
                "        } else if (values[mid] < target) {",
                "            left = mid + 1",
                "        } else {",
                "            right = mid - 1",
                "        }",
                "    }",
                "    return -1",
                "}"
            ],
            "notes": "오름차순 IntArray에서 양끝을 포함하는 구간을 탐색합니다. Int 나눗셈으로 중간 위치를 계산합니다. 빈 배열도 처리하며 같은 값이 여러 개면 그중 하나의 인덱스, 없으면 -1을 반환합니다."
        },
        "bubble-sort": {
            "lines": [
                "fun bubbleSort(values: IntArray) {",
                "    val n = values.size",
                "    for (i in 0 until (n - 1)) {",
                "        for (j in 0 until (n - 1 - i)) {",
                "            if (values[j] > values[j + 1]) {",
                "                val temp = values[j]",
                "                values[j] = values[j + 1]",
                "                values[j + 1] = temp",
                "            }",
                "        }",
                "    }",
                "}"
            ],
            "notes": "원본 IntArray를 정렬합니다. until은 끝값을 포함하지 않으며 빈 배열과 원소 하나일 때 반복하지 않습니다. 임시 변수를 거치는 세 줄은 한 교환 단계입니다. sortedFrom은 학습용 표시이며 조기 종료가 없는 기본형입니다."
        }
    },
    "rust": {
        "bfs": {
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
        "dfs": {
            "lines": [
                "fn dfs(graph: &[Vec<usize>], node: usize, visited: &mut [bool]) {",
                "    visited[node] = true;",
                "    for &nxt in &graph[node] {",
                "        if !visited[nxt] {",
                "            dfs(graph, nxt, visited);",
                "        }",
                "    }",
                "}"
            ],
            "notes": "노드 A, B, C, …는 입력 순서의 정수 인덱스 0, 1, 2, …로 나타냅니다. 인접 리스트의 이웃 순서대로 방문합니다. processed와 호출 스택은 학습용 표시입니다. 첫 호출 전 vec![false; graph.len()]을 만들고 &mut visited를 전달합니다. 가변 슬라이스로 발견 기록을 공유합니다. 깊은 재귀는 스택 한계에 주의해야 합니다."
        },
        "binary-search": {
            "lines": [
                "fn binary_search(values: &[i32], target: i32) -> isize {",
                "    let mut left: isize = 0;",
                "    let mut right = values.len() as isize - 1;",
                "    while left <= right {",
                "        let mid = left + (right - left) / 2;",
                "        if values[mid as usize] == target {",
                "            return mid;",
                "        } else if values[mid as usize] < target {",
                "            left = mid + 1;",
                "        } else {",
                "            right = mid - 1;",
                "        }",
                "    }",
                "    -1",
                "}"
            ],
            "notes": "오름차순 i32 슬라이스를 읽기 전용으로 빌립니다. 예제는 최대 20개이며 경계는 isize로 계산해 빈 배열의 right=-1을 표현합니다. 반복 안에서만 인덱스를 usize로 변환합니다. 같은 값이 여러 개면 그중 하나의 인덱스, 없으면 -1입니다."
        },
        "bubble-sort": {
            "lines": [
                "fn bubble_sort(values: &mut [i32]) {",
                "    let n = values.len();",
                "    for i in 0..n.saturating_sub(1) {",
                "        for j in 0..(n - 1 - i) {",
                "            if values[j] > values[j + 1] {",
                "                values.swap(j, j + 1);",
                "            }",
                "        }",
                "    }",
                "}"
            ],
            "notes": "가변 슬라이스를 빌려 원본 배열을 정렬합니다. saturating_sub(1)은 빈 배열에서 usize 뺄셈 언더플로를 막습니다. 안쪽 반복은 n>=2일 때만 실행됩니다. swap으로 인접 원소를 교환하며 같은 값은 교환하지 않습니다. sortedFrom은 학습용 표시입니다."
        }
    }
};
export const EXTRA_EVENT_LINES = {
    "java": {
        "bfs": {
            "initial": [],
            "mark-start": [
                4,
                5
            ],
            "enqueue-start": [
                6,
                7
            ],
            "dequeue-node": [
                8,
                9
            ],
            "check-neighbor": [
                10,
                11
            ],
            "mark-neighbor": [
                12
            ],
            "enqueue-neighbor": [
                13
            ],
            "process-node": [
                10
            ],
            "finish": [
                8
            ]
        },
        "dfs": {
            "initial": [],
            "call-start": [
                2
            ],
            "call-neighbor": [
                2,
                6
            ],
            "discover": [
                3
            ],
            "check-neighbor": [
                4,
                5
            ],
            "process": [
                4
            ],
            "return-start": [
                2
            ],
            "return-neighbor": [
                6
            ]
        },
        "binary-search": {
            "initial": [],
            "first-mid": [
                3,
                4,
                5
            ],
            "compute-mid": [
                4,
                5
            ],
            "compare-equal": [
                6
            ],
            "compare-smaller": [
                6,
                8
            ],
            "compare-larger": [
                6,
                8
            ],
            "found": [
                7
            ],
            "set-left": [
                9
            ],
            "set-right": [
                11
            ],
            "first-finish": [
                3,
                4,
                14
            ],
            "finish": [
                4,
                14
            ]
        },
        "bubble-sort": {
            "initial": [],
            "first-compare": [
                3,
                4,
                5,
                6
            ],
            "pass-compare": [
                4,
                5,
                6
            ],
            "compare": [
                5,
                6
            ],
            "swap": [
                7,
                8,
                9
            ],
            "mark-sorted": [
                5
            ],
            "finish": [
                4
            ],
            "finish-empty": [
                3,
                4
            ]
        }
    },
    "kotlin": {
        "bfs": {
            "initial": [],
            "mark-start": [
                3,
                4
            ],
            "enqueue-start": [
                5,
                6
            ],
            "dequeue-node": [
                7,
                8
            ],
            "check-neighbor": [
                9,
                10
            ],
            "mark-neighbor": [
                11
            ],
            "enqueue-neighbor": [
                12
            ],
            "process-node": [
                9
            ],
            "finish": [
                7
            ]
        },
        "dfs": {
            "initial": [],
            "call-start": [
                1
            ],
            "call-neighbor": [
                1,
                5
            ],
            "discover": [
                2
            ],
            "check-neighbor": [
                3,
                4
            ],
            "process": [
                3
            ],
            "return-start": [
                1
            ],
            "return-neighbor": [
                5
            ]
        },
        "binary-search": {
            "initial": [],
            "first-mid": [
                2,
                3,
                4,
                5
            ],
            "compute-mid": [
                4,
                5
            ],
            "compare-equal": [
                6
            ],
            "compare-smaller": [
                6,
                8
            ],
            "compare-larger": [
                6,
                8
            ],
            "found": [
                7
            ],
            "set-left": [
                9
            ],
            "set-right": [
                11
            ],
            "first-finish": [
                2,
                3,
                4,
                14
            ],
            "finish": [
                4,
                14
            ]
        },
        "bubble-sort": {
            "initial": [],
            "first-compare": [
                2,
                3,
                4,
                5
            ],
            "pass-compare": [
                3,
                4,
                5
            ],
            "compare": [
                4,
                5
            ],
            "swap": [
                6,
                7,
                8
            ],
            "mark-sorted": [
                4
            ],
            "finish": [
                3
            ],
            "finish-empty": [
                2,
                3
            ]
        }
    },
    "rust": {
        "bfs": {
            "initial": [],
            "mark-start": [
                3,
                4
            ],
            "enqueue-start": [
                5,
                6
            ],
            "dequeue-node": [
                7
            ],
            "check-neighbor": [
                8,
                9
            ],
            "mark-neighbor": [
                10
            ],
            "enqueue-neighbor": [
                11
            ],
            "process-node": [
                8
            ],
            "finish": [
                7
            ]
        },
        "dfs": {
            "initial": [],
            "call-start": [
                1
            ],
            "call-neighbor": [
                1,
                5
            ],
            "discover": [
                2
            ],
            "check-neighbor": [
                3,
                4
            ],
            "process": [
                3
            ],
            "return-start": [
                1
            ],
            "return-neighbor": [
                5
            ]
        },
        "binary-search": {
            "initial": [],
            "first-mid": [
                2,
                3,
                4,
                5
            ],
            "compute-mid": [
                4,
                5
            ],
            "compare-equal": [
                6
            ],
            "compare-smaller": [
                6,
                8
            ],
            "compare-larger": [
                6,
                8
            ],
            "found": [
                7
            ],
            "set-left": [
                9
            ],
            "set-right": [
                11
            ],
            "first-finish": [
                2,
                3,
                4,
                14
            ],
            "finish": [
                4,
                14
            ]
        },
        "bubble-sort": {
            "initial": [],
            "first-compare": [
                2,
                3,
                4,
                5
            ],
            "pass-compare": [
                3,
                4,
                5
            ],
            "compare": [
                4,
                5
            ],
            "swap": [
                6
            ],
            "mark-sorted": [
                4
            ],
            "finish": [
                3
            ],
            "finish-empty": [
                2,
                3
            ]
        }
    }
};
