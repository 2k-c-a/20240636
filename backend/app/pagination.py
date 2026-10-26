"""목록 cursor: 마지막 글의 `created_at`·`id`와 필터를 담은 JSON의 base64url (불투명 문자열, 300자 이하).

cursor는 비밀이나 권한 수단이 아니다. 클라이언트가 만든 값일 수 있으므로 길이·형식·타입을 모두 검사하고, 만들어진 필터와 요청의 필터가 다르면 거부한다.
검사를 통과한 값만 PostgREST 필터 문자열에 들어가므로(정규화된 시각과 UUID뿐) 필터 문법을 주입할 수 없다.
"""

import base64
import binascii
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

MAX_CURSOR_LENGTH = 300


class InvalidCursor(ValueError):
    """cursor의 형식·길이·타입이 잘못되었거나 필터가 다르다."""


@dataclass(frozen=True)
class CursorPosition:
    """이 위치(`created_at`, `id`)보다 뒤(더 오래된 글)부터 읽는다."""

    created_at: datetime
    id: str

    @property
    def created_at_text(self) -> str:
        return self.created_at.isoformat()


def encode_cursor(created_at: datetime, post_id: str, algorithm: str | None) -> str:
    payload = {"c": _normalize(created_at).isoformat(), "i": str(UUID(str(post_id))), "a": algorithm}
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("ascii")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_cursor(cursor: str, algorithm: str | None) -> CursorPosition:
    """cursor를 위치로 바꾼다. 잘못되었으면 `InvalidCursor`. `algorithm`은 이번 요청의 필터다."""
    if not isinstance(cursor, str) or not cursor or len(cursor) > MAX_CURSOR_LENGTH:
        raise InvalidCursor("길이")
    try:
        raw = base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True)
        data = json.loads(raw.decode("utf-8"))
    except (binascii.Error, ValueError):  # UnicodeDecodeError와 JSON 오류도 ValueError
        raise InvalidCursor("형식") from None
    if not isinstance(data, dict) or set(data) != {"c", "i", "a"}:
        raise InvalidCursor("구조")
    created, post_id, cursor_algorithm = data["c"], data["i"], data["a"]
    if not isinstance(created, str) or not isinstance(post_id, str) or not (cursor_algorithm is None or isinstance(cursor_algorithm, str)):
        raise InvalidCursor("타입")
    try:
        position = CursorPosition(_normalize(datetime.fromisoformat(created)), str(UUID(post_id)))
    except (ValueError, OverflowError):
        raise InvalidCursor("값") from None
    if cursor_algorithm != algorithm:
        raise InvalidCursor("필터")
    return position


def _normalize(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("시간대가 없는 시각")
    return value.astimezone(timezone.utc)
