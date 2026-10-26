import os
import jwt

# 개발용 기본값이다. 실제로 배포할 때는 반드시 환경변수 SECRET_KEY 로 긴 무작위 값을 넣어야 한다.
SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-change-me-dev-only-change-me")
ALGORITHM = "HS256"

from pwdlib import PasswordHash

_hasher = PasswordHash.recommended()

def hash_password(password: str) -> str:
    return _hasher.hash(password)

def verify_password(password: str, hashed: str) -> bool:
    return _hasher.verify(password, hashed)

from datetime import datetime, timedelta, timezone

def create_access_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=8)
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def decode_token(token: str) -> int | None:
    """토큰이 유효하면 사용자 id를, 아니면 None을 돌려준다."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None
