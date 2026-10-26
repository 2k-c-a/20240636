"""cursor 인코딩·검증과 ETag 형식. 사용자가 만든 값일 수 있으므로 잘못된 입력을 모두 거부하는지 본다."""

import base64
import json
from datetime import datetime, timedelta, timezone

import pytest

from app.pagination import MAX_CURSOR_LENGTH, InvalidCursor, decode_cursor, encode_cursor
from app.schemas.post import format_etag, parse_etag

WHEN = datetime(2026, 10, 14, 5, 30, 0, 123456, tzinfo=timezone.utc)
POST_ID = "0b4e7a5e-3f0d-4c53-9b8e-6f1c2a9d7e11"


def make(payload) -> str:
    raw = json.dumps(payload).encode() if not isinstance(payload, bytes) else payload
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def test_round_trip_keeps_microseconds_and_filter():
    for algorithm in (None, "bfs"):
        position = decode_cursor(encode_cursor(WHEN, POST_ID, algorithm), algorithm)
        assert position.created_at == WHEN
        assert position.id == POST_ID
        assert position.created_at_text == "2026-10-14T05:30:00.123456+00:00"


def test_other_timezone_is_normalized_to_utc():
    seoul = WHEN.astimezone(timezone(timedelta(hours=9)))
    assert decode_cursor(encode_cursor(seoul, POST_ID, None), None).created_at_text == "2026-10-14T05:30:00.123456+00:00"


@pytest.mark.parametrize("created", ["0001-01-01T00:00:00+14:00", "9999-12-31T23:59:59-14:00"])
def test_cursor_whose_utc_conversion_overflows_is_invalid(created):
    with pytest.raises(InvalidCursor):
        decode_cursor(make({"c": created, "i": POST_ID, "a": None}), None)


def test_cursor_is_url_safe_and_short():
    cursor = encode_cursor(WHEN, POST_ID, "binary-search")
    assert len(cursor) <= MAX_CURSOR_LENGTH
    assert all(ch.isalnum() or ch in "-_" for ch in cursor)  # 패딩(=)을 쓰지 않는다


def test_filter_mismatch_is_rejected_both_ways():
    with pytest.raises(InvalidCursor):
        decode_cursor(encode_cursor(WHEN, POST_ID, "bfs"), "dfs")
    with pytest.raises(InvalidCursor):
        decode_cursor(encode_cursor(WHEN, POST_ID, "bfs"), None)
    with pytest.raises(InvalidCursor):
        decode_cursor(encode_cursor(WHEN, POST_ID, None), "bfs")


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "a" * (MAX_CURSOR_LENGTH + 1),
        "!!!not-base64!!!",
        "====",
        make(b"\xff\xfe"),  # UTF-8이 아님
        make(b"not json"),
        make([]),
        make("text"),
        make({}),
        make({"c": "2026-10-14T05:30:00+00:00", "i": POST_ID}),  # a 없음
        make({"c": "2026-10-14T05:30:00+00:00", "i": POST_ID, "a": None, "x": 1}),  # 모르는 키
        make({"c": 5, "i": POST_ID, "a": None}),
        make({"c": "2026-10-14T05:30:00+00:00", "i": 5, "a": None}),
        make({"c": "2026-10-14T05:30:00+00:00", "i": POST_ID, "a": 5}),
        make({"c": "yesterday", "i": POST_ID, "a": None}),
        make({"c": "2026-10-14T05:30:00", "i": POST_ID, "a": None}),  # 시간대 없음
        make({"c": "2026-10-14T05:30:00+00:00", "i": "not-a-uuid", "a": None}),
        make({"c": "2026-10-14T05:30:00+00:00),id.eq.1,(x", "i": POST_ID, "a": None}),  # 필터 문법 주입 시도
        make({"c": "2026-10-14T05:30:00+00:00", "i": POST_ID + ",or=(id.gt.0)", "a": None}),
    ],
)
def test_malformed_cursors_are_rejected(bad):
    with pytest.raises(InvalidCursor):
        decode_cursor(bad, None)


def test_non_string_cursor_is_rejected():
    with pytest.raises(InvalidCursor):
        decode_cursor(None, None)  # type: ignore[arg-type]


def test_accepted_cursor_only_yields_normalized_values():
    """통과한 값은 PostgREST 필터에 들어가므로 정규화된 시각과 하이픈 UUID뿐이어야 한다."""
    odd = make({"c": "2026-10-14T14:30:00.5+09:00", "i": POST_ID.upper().replace("-", ""), "a": None})
    position = decode_cursor(odd, None)
    assert position.created_at_text == "2026-10-14T05:30:00.500000+00:00"
    assert position.id == POST_ID


def test_etag_round_trip_and_strict_format():
    etag = format_etag(POST_ID, 3)
    assert etag == f'"post-{POST_ID}-v3"'
    assert parse_etag(etag) == (POST_ID, 3)
    for bad in [
        "*", "", f"W/{etag}", f"{etag}, {etag}", f"post-{POST_ID}-v3", f'"post-{POST_ID}-v0"', f'"post-{POST_ID}-v03"',
        f'"post-{POST_ID}-v-1"', f'"post-{POST_ID.upper()}-v1"', f'"post-{POST_ID}-v2147483648"', f' {etag}', f'{etag} ', f'"post-{POST_ID}-v1"\n',
        '"v1"', f'"post-{POST_ID}-v٣"', None, 5,
    ]:
        assert parse_etag(bad) is None, repr(bad)
    assert parse_etag(f'"post-{POST_ID}-v2147483647"') == (POST_ID, 2147483647)
