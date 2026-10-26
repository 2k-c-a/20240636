"""가짜 Supabase(Auth `/auth/v1/user`와 PostgREST `/rest/v1/profiles`). 받은 요청을 모두 기록하고 RLS처럼 토큰 사용자 본인의 행만 보여 준다.

`httpx.MockTransport`로 연결하면(tests/test_supabase_requests.py) 네트워크 없이, 실제 소켓 서버로 띄우면(tests/test_live_server.py) 실제 uvicorn 서버와 함께 쓸 수 있다.
"""

import json
import threading

import httpx

from conftest import TEST_PUBLISHABLE_KEY, TOKEN_A, TOKEN_B, USER_A, USER_B

TOKENS = {TOKEN_A: USER_A, TOKEN_B: USER_B}
NOW = "2026-10-14T05:30:00.123456+00:00"


class FakeSupabase:
    """Auth(`/auth/v1/user`)와 PostgREST(`/rest/v1/profiles`)를 흉내 내는 가짜 서버. 받은 요청을 모두 기록한다."""

    def __init__(self):
        self.requests: list[dict] = []
        self.rows: dict[str, dict] = {}
        self.violations: list[str] = []
        self.lock = threading.Lock()
        self.auth_response: httpx.Response | Exception | None = None
        self.rest_response: httpx.Response | Exception | None = None

    # --- 도우미
    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handle))

    @staticmethod
    def _json(status: int, body) -> httpx.Response:
        return httpx.Response(status, json=body)

    def _viewer(self, headers) -> str | None:
        """Authorization의 사용자 토큰이 가리키는 사용자 ID. 공개 키이거나 모르는 토큰이면 None."""
        token = headers.get("authorization", "").removeprefix("Bearer ")
        user = TOKENS.get(token)
        return user.id if user else None

    def handle(self, request: httpx.Request) -> httpx.Response:
        headers = {k.lower(): v for k, v in request.headers.items()}
        record = {
            "method": request.method,
            "path": request.url.path,
            "query": dict(request.url.params),
            "headers": headers,
            "body": json.loads(request.content) if request.content else None,
            "thread": threading.get_ident(),
        }
        with self.lock:
            self.requests.append(record)
        if headers.get("apikey") != TEST_PUBLISHABLE_KEY:
            with self.lock:
                self.violations.append(f"apikey가 Publishable key가 아님: {request.url.path}")
        if request.url.path == "/auth/v1/user":
            return self._auth(headers)
        if request.url.path == "/rest/v1/profiles":
            return self._rest(request, headers, record)
        return self._json(404, {"message": "no route"})

    def _auth(self, headers) -> httpx.Response:
        if isinstance(self.auth_response, Exception):
            raise self.auth_response
        if self.auth_response is not None:
            return self.auth_response
        user = TOKENS.get(headers.get("authorization", "").removeprefix("Bearer "))
        if user is None:
            return self._json(401, {"code": "bad_jwt", "error_code": "bad_jwt", "msg": "invalid JWT: unable to parse or verify signature"})
        return self._json(200, {"id": user.id, "aud": "authenticated", "role": "authenticated", "email": user.email, "app_metadata": {}, "user_metadata": {}, "created_at": NOW})

    def _rest(self, request: httpx.Request, headers, record) -> httpx.Response:
        if isinstance(self.rest_response, Exception):
            raise self.rest_response
        if self.rest_response is not None:
            return self.rest_response
        viewer = self._viewer(headers)
        if viewer is None:
            return self._json(401, {"code": "PGRST301", "details": None, "hint": None, "message": "JWT expired"})
        target = record["query"].get("id", "").removeprefix("eq.")
        if request.method == "GET":
            self._check_same_user(viewer, target, record)
            row = self.rows.get(viewer)  # RLS: 본인 행만 보인다
            return self._json(200, [row] if row and target == viewer else [])
        if request.method == "POST":
            body = record["body"]
            new_id = body["id"]
            self._check_same_user(viewer, new_id, record)
            if new_id != viewer:
                return self._json(403, {"code": "42501", "message": "new row violates row-level security policy for table \"profiles\""})
            with self.lock:
                if new_id in self.rows:
                    return self._json(201, [])  # ON CONFLICT DO NOTHING: 0행
                self.rows[new_id] = {"id": new_id, "nickname": body["nickname"], "created_at": NOW, "updated_at": NOW}
                return self._json(201, [self.rows[new_id]])
        if request.method == "PATCH":
            self._check_same_user(viewer, target, record)
            with self.lock:
                row = self.rows.get(viewer) if target == viewer else None
                if row is None:
                    return self._json(200, [])
                row["nickname"] = record["body"]["nickname"]
                row["updated_at"] = "2026-10-14T06:00:00.000000+00:00"
                return self._json(200, [row])
        return self._json(405, {"message": "method"})

    def _check_same_user(self, viewer: str, target: str, record) -> None:
        """우리 코드는 항상 토큰의 사용자와 같은 id를 다룬다. 다르면 라이브러리가 헤더를 섞었다는 뜻이다."""
        if viewer != target:
            with self.lock:
                self.violations.append(f"토큰 사용자 {viewer}가 {target}의 행을 다룸: {record['method']}")
