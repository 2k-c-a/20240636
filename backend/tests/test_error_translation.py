"""Supabase 예외 → 공통 오류 번역(`translate_exception`)의 구분 규칙."""

import httpx
import pytest
from postgrest.exceptions import APIError
from supabase_auth.errors import (
    AuthApiError,
    AuthInvalidJwtError,
    AuthRetryableError,
    AuthSessionMissingError,
    AuthUnknownError,
)

from app.services.supabase import translate_exception


def check_violation(constraint: str) -> APIError:
    return APIError({"message": f'new row for relation "t" violates check constraint "{constraint}"', "code": "23514", "details": "", "hint": ""})


@pytest.mark.parametrize(
    ("constraint", "field"),
    [
        ("profiles_nickname_length", "nickname"),
        ("posts_title_length", "title"),
        ("posts_title_trimmed", "title"),
        ("posts_body_length", "body"),
        ("posts_body_not_blank", "body"),
        ("posts_algorithm_id_allowed", "algorithm_id"),
    ],
)
def test_check_violations_name_the_field_by_constraint(constraint, field):
    error = translate_exception(check_violation(constraint), context="test")
    assert (error.status_code, error.code) == (422, "validation_error")
    assert list(error.fields) == [field]


def test_a_trigger_immutable_column_error_is_not_reported_as_a_field_error():
    trigger = APIError({"message": "immutable_column", "code": "23514", "details": "posts의 id는 바꿀 수 없습니다.", "hint": ""})
    error = translate_exception(trigger, context="test")
    assert (error.status_code, error.code) == (403, "forbidden")
    assert error.fields is None


def test_an_unknown_check_violation_is_a_server_error_not_a_nickname_error():
    error = translate_exception(check_violation("something_else"), context="test")
    assert error.status_code == 500 and error.fields is None


@pytest.mark.parametrize("auth_error", [AuthInvalidJwtError("bad"), AuthSessionMissingError(), AuthApiError("expired", 401, None)])
def test_token_problems_are_401(auth_error):
    assert translate_exception(auth_error, context="test").status_code == 401


@pytest.mark.parametrize(
    "outage",
    [AuthRetryableError("down", 502), AuthUnknownError("?", Exception("x")), AuthApiError("boom", 500, None), httpx.ConnectError("no route")],
)
def test_service_problems_stay_503(outage):
    assert translate_exception(outage, context="test").status_code == 503
