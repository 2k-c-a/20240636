"""오류 응답 모델(문서화용). 실제 응답은 app/errors.py가 같은 모양으로 만든다."""

from pydantic import BaseModel, Field


class ErrorBody(BaseModel):
    code: str = Field(description="기계가 읽는 오류 코드(예: validation_error, invalid_token)")
    message: str = Field(description="사용자에게 보여 줄 한국어 설명")
    request_id: str = Field(description="응답 헤더 X-Request-ID와 같은 값")
    fields: dict[str, str] | None = Field(default=None, description="입력 검증 오류일 때 필드 이름 → 한국어 메시지")


class ErrorResponse(BaseModel):
    error: ErrorBody
