"""`GET /api/config`: 브라우저가 Supabase에 직접 로그인할 때 필요한 공개 설정."""

from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..config import AppConfig
from ..dependencies import get_config

router = APIRouter(tags=["설정"])


@router.get("/api/config", summary="공개 설정")
def read_config(config: Annotated[AppConfig, Depends(get_config)]) -> JSONResponse:
    """URL·Publishable key·앱 주소만 돌려준다. 세 값이 모두 있어야 `auth_enabled`가 true이고, 하나라도 없으면 값은 모두 null이다.

    Secret key를 포함한 다른 설정은 어떤 경우에도 넣지 않는다. 응답은 캐시하지 않는다.
    """
    return JSONResponse(config.public(), headers={"Cache-Control": "no-store"})
