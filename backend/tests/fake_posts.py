"""메모리 글 저장소. DB의 규칙(정렬, version, RPC 결과 우선순위 not_found → forbidden → version_conflict)을 흉내 내고 호출 기록을 남긴다."""

import itertools
import threading
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from app.pagination import CursorPosition
from app.schemas.post import PostDetail, PostSummary
from app.services.posts import UpdateOutcome
from conftest import TOKEN_A, TOKEN_B, USER_A, USER_B

START = datetime(2026, 10, 14, 5, 30, tzinfo=timezone.utc)


class FakePostStore:
    def __init__(self):
        self.rows: dict[str, PostDetail] = {}
        self.calls: list[tuple] = []
        self.fail_with: BaseException | None = None
        self.token_users: dict[str, str] = {TOKEN_A: USER_A.id, TOKEN_B: USER_B.id}  # 토큰 → 사용자 ID(auth.uid())
        self.nicknames: dict[str, str] = {}  # 작성자 ID → 표시명(DB 트리거가 프로필에서 복사하는 값)
        self._counter = itertools.count(1)
        self._lock = threading.Lock()

    def _maybe_fail(self):
        if self.fail_with is not None:
            raise self.fail_with

    def add(self, author_id: str, title: str = "제목", body: str = "본문", algorithm_id: str | None = None, *, created_at: datetime | None = None, post_id: str | None = None, display_name: str | None = None) -> PostDetail:
        """테스트 데이터를 직접 넣는다(동률 시각 등 API로 만들 수 없는 경우)."""
        n = next(self._counter)
        when = created_at or START + timedelta(seconds=n)
        post = PostDetail(
            id=post_id or str(UUID(int=n + 0x1000)),
            author_id=author_id,
            author_display_name=display_name or self.nicknames.get(author_id, "작성자"),
            title=title,
            body=body,
            algorithm_id=algorithm_id,
            version=1,
            created_at=when,
            updated_at=when,
        )
        self.rows[str(post.id)] = post
        return post

    # --- PostStore
    def list(self, config, *, limit, algorithm, after: CursorPosition | None):
        self.calls.append(("list", limit, algorithm, after))
        self._maybe_fail()
        rows = sorted(self.rows.values(), key=lambda p: (p.created_at, str(p.id)), reverse=True)
        if algorithm is not None:
            rows = [p for p in rows if p.algorithm_id == algorithm]
        if after is not None:
            rows = [p for p in rows if (p.created_at, str(p.id)) < (after.created_at, after.id)]
        return [PostSummary.model_validate(p.model_dump()) for p in rows[:limit]]

    def get(self, config, post_id):
        self.calls.append(("get", post_id))
        self._maybe_fail()
        return self.rows.get(post_id)

    def create(self, config, token, user_id, title, body, algorithm_id):
        self.calls.append(("create", token, user_id, title, body, algorithm_id))
        self._maybe_fail()
        return self.add(user_id, title, body, algorithm_id)

    def _check(self, user_id_of_token: str | None, post_id: str, expected_version: int):
        post = self.rows.get(post_id)
        if post is None:
            return None, "not_found"
        if str(post.author_id) != user_id_of_token:
            return post, "forbidden"
        if post.version != expected_version:
            return post, "version_conflict"
        return post, "ok"

    def update(self, config, token, post_id, expected_version, changes: dict[str, Any]):
        self.calls.append(("update", token, post_id, expected_version, dict(changes)))
        self._maybe_fail()
        with self._lock:
            post, result = self._check(self.token_users.get(token), post_id, expected_version)
            if result != "ok":
                return UpdateOutcome(result)
            now = post.updated_at + timedelta(seconds=1)
            updated = post.model_copy(update={**changes, "version": post.version + 1, "updated_at": now})
            self.rows[post_id] = updated
            return UpdateOutcome("ok", updated)

    def delete(self, config, token, post_id, expected_version):
        self.calls.append(("delete", token, post_id, expected_version))
        self._maybe_fail()
        with self._lock:
            post, result = self._check(self.token_users.get(token), post_id, expected_version)
            if result == "ok":
                del self.rows[post_id]
            return result
