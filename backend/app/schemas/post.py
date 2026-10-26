"""글 요청·응답 모델, 입력 규칙, ETag.

입력 규칙(CONTRACTS §8.3): 제목은 앞뒤 공백을 제거한 뒤 1~100자, 본문은 1~10,000자이며 공백만으로 이루어질 수 없다(줄바꿈은 보존).
`algorithm_id`는 허용 목록의 ID 또는 null이다. 글자 수는 문자(코드 포인트) 수다. DB의 CHECK가 같은 규칙을 한 번 더 강제한다.
PATCH는 필드의 **누락**(변경 없음)과 **null**을 구분하므로 pydantic 대신 직접 검사한다.
"""

import re
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel

TITLE_MAX = 100
BODY_MAX = 10_000
ALGORITHM_IDS = ("bfs", "dfs", "binary-search", "bubble-sort", "union-find", "dijkstra", "knapsack", "topological-sort", "two-pointers")
MAX_VERSION = 2**31 - 1  # DB의 integer

_FIELD_NAMES = ("title", "body", "algorithm_id")
MESSAGE_UNKNOWN = "허용되지 않는 항목입니다."
MESSAGE_TITLE = f"제목은 1~{TITLE_MAX}자여야 합니다."
MESSAGE_BODY = f"본문은 1~{BODY_MAX:,}자여야 하며 공백만으로 이루어질 수 없습니다."
MESSAGE_ALGORITHM = "알 수 없는 알고리즘입니다."
MESSAGE_TEXT = "문자열이어야 합니다."
MESSAGE_NUL = "쓸 수 없는 문자가 있습니다."
MESSAGE_NULL = "비워 둘 수 없습니다."

_ETAG = re.compile(r'^"post-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-v([1-9][0-9]{0,9})"$')


class PostSummary(BaseModel):
    """목록 항목. 본문과 이메일은 없다."""

    id: UUID
    title: str
    author_display_name: str
    algorithm_id: str | None
    created_at: datetime
    version: int


class PostDetail(PostSummary):
    author_id: UUID
    body: str
    updated_at: datetime


class PostList(BaseModel):
    items: list[PostSummary]
    next_cursor: str | None


class PostValidationFailure(Exception):
    def __init__(self, fields: dict[str, str]):
        super().__init__(", ".join(fields))
        self.fields = fields


def parse_uuid(value: str) -> str | None:
    """소문자 하이픈 형식의 UUID만 받는다. 아니면 None."""
    try:
        parsed = UUID(value)
    except (ValueError, AttributeError, TypeError):
        return None
    return str(parsed) if str(parsed) == value else None


def _clean_title(value: Any, fields: dict[str, str]) -> str | None:
    if not isinstance(value, str):
        fields["title"] = MESSAGE_NULL if value is None else MESSAGE_TEXT
        return None
    title = value.strip()
    if _invalid_text(title):
        fields["title"] = MESSAGE_NUL
    elif not 1 <= len(title) <= TITLE_MAX:
        fields["title"] = MESSAGE_TITLE
    else:
        return title
    return None


def _clean_body(value: Any, fields: dict[str, str]) -> str | None:
    if not isinstance(value, str):
        fields["body"] = MESSAGE_NULL if value is None else MESSAGE_TEXT
        return None
    if _invalid_text(value):
        fields["body"] = MESSAGE_NUL
    elif not 1 <= len(value) <= BODY_MAX or not value.strip():
        fields["body"] = MESSAGE_BODY
    else:
        return value
    return None


def _invalid_text(value: str) -> bool:
    # PostgreSQL UTF-8 text에 저장할 수 없는 NUL·고립 surrogate는 SDK 호출 전에 거부한다.
    return "\x00" in value or any(0xD800 <= ord(ch) <= 0xDFFF for ch in value)


def _clean_algorithm(value: Any, fields: dict[str, str]) -> bool:
    """null 또는 허용 목록의 ID이면 True."""
    if value is None or (isinstance(value, str) and value in ALGORITHM_IDS):
        return True
    fields["algorithm_id"] = MESSAGE_ALGORITHM if isinstance(value, str) else MESSAGE_TEXT
    return False


def _unknown_fields(data: dict[str, Any], fields: dict[str, str]) -> None:
    for name in data:
        if name not in _FIELD_NAMES:
            fields[str(name)] = MESSAGE_UNKNOWN


def parse_create(data: Any) -> dict[str, Any]:
    """`POST /api/posts` 본문 → `{title, body, algorithm_id}`. 잘못되면 `PostValidationFailure`."""
    if not isinstance(data, dict):
        raise PostValidationFailure({"요청": "요청 본문은 JSON 객체여야 합니다."})
    fields: dict[str, str] = {}
    _unknown_fields(data, fields)  # author_id·version 같은 필드는 받지 않는다
    for required in ("title", "body"):
        if required not in data:
            fields.setdefault(required, "필수 항목입니다.")
    title = _clean_title(data["title"], fields) if "title" in data else None
    body = _clean_body(data["body"], fields) if "body" in data else None
    algorithm_id = data.get("algorithm_id")
    _clean_algorithm(algorithm_id, fields)
    if fields:
        raise PostValidationFailure(fields)
    return {"title": title, "body": body, "algorithm_id": algorithm_id}


def parse_patch(data: Any) -> dict[str, Any]:
    """`PATCH /api/posts/{id}` 본문 → 바꿀 필드만 담은 dict(누락된 필드는 키가 없다, `algorithm_id: null`은 `None`으로 있다)."""
    if not isinstance(data, dict):
        raise PostValidationFailure({"요청": "요청 본문은 JSON 객체여야 합니다."})
    fields: dict[str, str] = {}
    _unknown_fields(data, fields)
    changes: dict[str, Any] = {}
    if "title" in data:
        title = _clean_title(data["title"], fields)
        if title is not None:
            changes["title"] = title
    if "body" in data:
        body = _clean_body(data["body"], fields)
        if body is not None:
            changes["body"] = body
    if "algorithm_id" in data and _clean_algorithm(data["algorithm_id"], fields):
        changes["algorithm_id"] = data["algorithm_id"]
    if not fields and not changes:
        fields["요청"] = "수정할 항목(title, body, algorithm_id)이 없습니다."
    if fields:
        raise PostValidationFailure(fields)
    return changes


def format_etag(post_id: UUID | str, version: int) -> str:
    return f'"post-{post_id}-v{version}"'


def parse_etag(value: str) -> tuple[str, int] | None:
    """`If-Match` 값 → (글 ID, version). 형식이 맞는 값 하나만 받고(`*`·여러 값·약한 ETag 불가) 아니면 None."""
    match = _ETAG.fullmatch(value.strip()) if isinstance(value, str) and value == value.strip() else None
    if not match:
        return None
    version = int(match.group(2))
    return (match.group(1), version) if version <= MAX_VERSION else None
