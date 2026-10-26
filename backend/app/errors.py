"""공통 오류 형식 `{error: {code, message, request_id, fields?}}`과 요청 ID.

- 모든 응답에 서버가 만든 `X-Request-ID`를 붙이고, 오류 본문의 `request_id`와 같은 값을 쓴다(클라이언트가 보낸 값은 쓰지 않는다).
- 내부 예외·SQL·키·토큰은 응답과 로그에 넣지 않는다. 처리하지 못한 예외는 `internal_error`로만 알리고 request_id와 예외 종류만 기록한다.
- 이 형식은 `/api/` 아래 경로에만 적용한다. 정적 파일(`/web`)의 404 등은 기존 응답을 그대로 둔다.
"""

import logging
import uuid
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send
from .security import security_headers

logger = logging.getLogger("app.errors")

REQUEST_ID_HEADER = "X-Request-ID"


class ApiError(Exception):
    """API가 클라이언트에 돌려줄 오류. `fields`는 입력 검증 오류에만 쓴다(필드 이름 → 한국어 메시지 하나)."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        *,
        fields: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
    ):
        super().__init__(f"{code}: {message}")
        self.status_code = status_code
        self.code = code
        self.message = message
        self.fields = fields
        self.headers = headers or {}


def validation_error(fields: dict[str, str] | None = None, message: str = "입력값을 확인해 주세요.") -> ApiError:
    return ApiError(422, "validation_error", message, fields=fields or None)


def unauthenticated() -> ApiError:
    return ApiError(401, "unauthenticated", "로그인이 필요합니다.", headers={"WWW-Authenticate": "Bearer"})


def invalid_token() -> ApiError:
    return ApiError(401, "invalid_token", "로그인 정보가 올바르지 않거나 만료되었습니다. 다시 로그인해 주세요.", headers={"WWW-Authenticate": 'Bearer error="invalid_token"'})


def service_unavailable() -> ApiError:
    return ApiError(503, "service_unavailable", "서비스에 일시적으로 연결할 수 없습니다. 잠시 뒤에 다시 시도해 주세요.")


def auth_not_configured() -> ApiError:
    return ApiError(503, "auth_not_configured", "인증 설정이 되어 있지 않습니다. 서버 설정(backend/.env)을 확인해 주세요.")


def internal_error() -> ApiError:
    return ApiError(500, "internal_error", "서버에서 문제가 생겼습니다. 잠시 뒤에 다시 시도해 주세요.")


def invalid_cursor() -> ApiError:
    return ApiError(400, "invalid_cursor", "목록 위치 정보(cursor)가 올바르지 않습니다. 처음부터 다시 불러와 주세요.")


def forbidden() -> ApiError:
    return ApiError(403, "forbidden", "본인이 쓴 글만 수정하거나 삭제할 수 있습니다.")


def profile_required() -> ApiError:
    return ApiError(403, "profile_required", "글을 쓰려면 먼저 프로필(닉네임)을 만들어 주세요.")


def post_not_found() -> ApiError:
    return ApiError(404, "not_found", "글이 없거나 이미 삭제되었습니다.")


def precondition_failed() -> ApiError:
    return ApiError(412, "precondition_failed", "다른 곳에서 글이 먼저 바뀌었습니다. 글을 다시 불러온 뒤 내용을 확인하고 다시 저장해 주세요.")


def precondition_required() -> ApiError:
    return ApiError(428, "precondition_required", "수정·삭제에는 If-Match 헤더(글의 ETag)가 필요합니다.")


def request_id_of(request: Request) -> str:
    """미들웨어가 정한 요청 ID. 미들웨어를 거치지 않은 경우를 위해 없으면 새로 만든다."""
    request_id = getattr(request.state, "request_id", None)
    if request_id is None:
        request_id = request.state.request_id = uuid.uuid4().hex
    return request_id


def error_response(request: Request, status_code: int, code: str, message: str, *, fields: dict[str, str] | None = None, headers: dict[str, str] | None = None) -> JSONResponse:
    request_id = request_id_of(request)
    body: dict[str, Any] = {"code": code, "message": message, "request_id": request_id}
    if fields:
        body["fields"] = fields
    response = JSONResponse({"error": body}, status_code=status_code, headers=headers or {})
    response.headers[REQUEST_ID_HEADER] = request_id
    response.headers.setdefault("Cache-Control", "no-store")
    response.headers.update(security_headers())
    return response


class RequestIdMiddleware:
    """요청마다 ID를 만들어 `scope["state"]`에 두고 모든 응답에 `X-Request-ID`를 붙인다."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request_id = uuid.uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id

        async def send_with_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() != REQUEST_ID_HEADER.lower().encode()]
                headers.append((REQUEST_ID_HEADER.encode("latin-1"), request_id.encode("latin-1")))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_id)


def _is_api_path(request: Request) -> bool:
    return request.url.path.startswith("/api/") or request.url.path == "/api"


_STATUS_CODES = {404: ("not_found", "요청한 주소를 찾을 수 없습니다."), 405: ("method_not_allowed", "허용되지 않는 요청 방식입니다.")}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, exc: ApiError):
        if exc.status_code >= 500:
            logger.warning("%s %s -> %s %s (request_id=%s)", request.method, request.url.path, exc.status_code, exc.code, request_id_of(request))
        return error_response(request, exc.status_code, exc.code, exc.message, fields=exc.fields, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def handle_validation(request: Request, exc: RequestValidationError):
        fields = {}
        for item in exc.errors():
            location = [str(part) for part in item.get("loc", ()) if part not in ("body", "query", "path", "header")]
            fields.setdefault(".".join(location) or "요청", "값을 확인해 주세요.")
        return error_response(request, 422, "validation_error", "입력값을 확인해 주세요.", fields=fields)

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(request: Request, exc: StarletteHTTPException):
        if not _is_api_path(request):
            from fastapi.exception_handlers import http_exception_handler

            return await http_exception_handler(request, exc)  # 정적 파일 등은 기존 응답을 유지한다
        code, message = _STATUS_CODES.get(exc.status_code, ("http_error", "요청을 처리하지 못했습니다."))
        return error_response(request, exc.status_code, code, message, headers=dict(exc.headers or {}))

    @app.exception_handler(Exception)
    async def handle_unexpected(request: Request, exc: Exception):
        # 메시지와 요청 내용은 기록하지 않는다(키·토큰·개인정보가 들어갈 수 있다). 종류와 request_id만 남긴다.
        logger.error("처리하지 못한 오류 %s %s: %s (request_id=%s)", request.method, request.url.path, type(exc).__name__, request_id_of(request))
        error = internal_error()
        return error_response(request, error.status_code, error.code, error.message)
