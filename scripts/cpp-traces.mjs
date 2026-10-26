// C++17 예제 코드와 의미 이벤트별 줄 매핑. 노드는 입력 순서의 정수 인덱스로 표현한다.
export const CPP_CODES = {
    "bfs": {
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
    "dfs": {
        "lines": [
            "#include <vector>",
            "void dfs(const std::vector<std::vector<int>>& graph, int node, std::vector<bool>& visited) {",
            "    visited[node] = true;",
            "    for (int nxt : graph[node]) {",
            "        if (!visited[nxt]) {",
            "            dfs(graph, nxt, visited);",
            "        }",
            "    }",
            "}"
        ],
        "notes": "노드 A, B, C, …는 0, 1, 2, …로 나타냅니다. graph는 인접 리스트이며 visited는 참조로 공유하므로 재귀 호출의 발견 기록이 유지됩니다. 처음 호출 전 graph.size()만큼 false로 초기화한 visited를 만듭니다. frames와 processed는 학습용 표시입니다. 이웃 반복(4번 줄)이 끝나면 처리 완료이며 함수가 끝나면 호출 스택에서 빠집니다. 깊은 재귀는 스택 한계에 주의해야 합니다."
    },
    "binary-search": {
        "lines": [
            "#include <vector>",
            "int binary_search(const std::vector<int>& values, int target) {",
            "    int left = 0, right = static_cast<int>(values.size()) - 1;",
            "    while (left <= right) {",
            "        int mid = left + (right - left) / 2;",
            "        if (values[mid] == target) {",
            "            return mid;",
            "        } else if (values[mid] < target) {",
            "            left = mid + 1;",
            "        } else {",
            "            right = mid - 1;",
            "        }",
            "    }",
            "    return -1;",
            "}"
        ],
        "notes": "values는 오름차순 vector를 const 참조로 받습니다. 길이를 int로 변환한 뒤 1을 빼므로 빈 배열의 right는 -1입니다(예제는 최대 20개). 양끝을 포함하는 구간에서 mid를 left + (right - left) / 2로 계산합니다. 정수 나눗셈이며 같은 값이 여러 개면 그중 하나의 인덱스를 반환합니다. 없으면 -1입니다."
    },
    "bubble-sort": {
        "lines": [
            "#include <vector>",
            "#include <utility>",
            "void bubble_sort(std::vector<int>& values) {",
            "    int n = static_cast<int>(values.size());",
            "    for (int i = 0; i < n - 1; i++) {",
            "        for (int j = 0; j < n - 1 - i; j++) {",
            "            if (values[j] > values[j + 1]) {",
            "                std::swap(values[j], values[j + 1]);",
            "            }",
            "        }",
            "    }",
            "}"
        ],
        "notes": "vector를 참조로 받아 원본 배열을 정렬합니다. std::swap으로 인접한 두 값을 교환하며 앞의 값이 더 클 때만 교환하므로 같은 값의 순서는 유지됩니다. 길이는 int로 변환해 빈 배열에서도 반복 조건을 안전하게 처리합니다(예제는 최대 20개). sortedFrom은 학습용 표시이며 안쪽 반복(6번 줄)이 끝날 때 확정됩니다. 조기 종료가 없는 기본형입니다."
    }
};

export const CPP_EVENT_LINES = {
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
            9,
            10
        ],
        "check-neighbor": [
            11,
            12
        ],
        "mark-neighbor": [
            13
        ],
        "enqueue-neighbor": [
            14
        ],
        "process-node": [
            11
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
            4,
            5,
            6,
            7
        ],
        "pass-compare": [
            5,
            6,
            7
        ],
        "compare": [
            6,
            7
        ],
        "swap": [
            8
        ],
        "mark-sorted": [
            6
        ],
        "finish": [
            5
        ],
        "finish-empty": [
            4,
            5
        ]
    }
};
