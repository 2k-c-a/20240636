"""프로필 요청·응답 모델과 닉네임 규칙.

닉네임 규칙(CONTRACTS §7): 앞뒤 공백을 지운 뒤 2~20자, 제어 문자(U+0000~U+001F, U+007F) 불가, 중복 허용. DB의 CHECK가 같은 규칙을 강제한다.
"앞뒤 공백"은 Python `str.strip()`이 지우는 문자이며 DB 제약이 쓰는 공백 정의와 같은 집합이다(supabase/migrations/202610140001).
"""

import re
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, StrictStr, ValidationError, field_validator

NICKNAME_MIN = 2
NICKNAME_MAX = 20
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")

MESSAGE_REQUIRED = "닉네임을 입력해 주세요."
MESSAGE_TYPE = "닉네임은 문자열이어야 합니다."
MESSAGE_LENGTH = f"닉네임은 {NICKNAME_MIN}~{NICKNAME_MAX}자여야 합니다."
MESSAGE_CONTROL = "닉네임에 줄바꿈 같은 제어 문자를 쓸 수 없습니다."
MESSAGE_UNKNOWN = "허용되지 않는 항목입니다."


class NicknameBody(BaseModel):
    """`POST`·`PATCH /api/me/profile` 요청 본문. 정의되지 않은 필드(author_id, id 등)는 거부한다."""

    model_config = ConfigDict(extra="forbid")

    nickname: StrictStr

    @field_validator("nickname")
    @classmethod
    def _check_nickname(cls, value: str) -> str:
        value = value.strip()
        if not NICKNAME_MIN <= len(value) <= NICKNAME_MAX:
            raise ValueError(MESSAGE_LENGTH)
        if _CONTROL.search(value):
            raise ValueError(MESSAGE_CONTROL)
        return value


class Profile(BaseModel):
    """프로필 응답. 이메일 등 다른 정보는 넣지 않는다."""

    id: UUID
    nickname: str
    created_at: datetime
    updated_at: datetime


class Me(BaseModel):
    """`GET /api/me` 응답. 프로필이 없으면 nickname은 null이다."""

    id: UUID
    email: str | None
    nickname: str | None


def parse_nickname_body(data: Any) -> NicknameBody:
    """JSON 값을 닉네임 요청으로 바꾼다. 잘못되면 `ValidationFailure`(필드 → 한국어 메시지)를 던진다."""
    try:
        return NicknameBody.model_validate(data)
    except ValidationError as error:
        raise ValidationFailure(_field_messages(error)) from None


class ValidationFailure(Exception):
    def __init__(self, fields: dict[str, str]):
        super().__init__(", ".join(fields))
        self.fields = fields


def _field_messages(error: ValidationError) -> dict[str, str]:
    fields: dict[str, str] = {}
    for item in error.errors():
        name = ".".join(str(part) for part in item["loc"]) or "요청"
        kind = item["type"]
        if kind == "missing":
            message = MESSAGE_REQUIRED
        elif kind == "extra_forbidden":
            message = MESSAGE_UNKNOWN
        elif kind == "model_type":
            message = "요청 본문은 JSON 객체여야 합니다."
        elif kind == "value_error":
            message = str(item["ctx"]["error"])
        else:
            message = MESSAGE_TYPE
        fields.setdefault(name, message)
    return fields
