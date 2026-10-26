"""검증을 마친 사용자. 토큰을 Supabase Auth에 확인한 결과이며, 권한 판단에는 이 값만 쓴다."""

from dataclasses import dataclass


@dataclass(frozen=True)
class VerifiedUser:
    id: str
    """사용자 UUID(소문자 문자열)."""
    email: str | None
    """본인 이메일. 이메일이 없는 계정이면 None."""
