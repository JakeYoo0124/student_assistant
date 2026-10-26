"""로그인한 사용자 확인. 여러 파일에서 같이 쓰려고 main.py 에서 분리했다."""
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from sqlmodel import Session

from database import get_session
from models import User
from security import decode_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")


def get_current_user(token: str = Depends(oauth2_scheme), session: Session = Depends(get_session)) -> User:
    user_id = decode_token(token)
    user = session.get(User, user_id) if user_id else None
    if not user or user.status != "active":
        raise HTTPException(status_code=401, detail="로그인이 필요합니다")
    return user


def require_manager(user: User = Depends(get_current_user)) -> User:
    """담당자만 통과시키는 검사. 담당자 전용 API에 Depends로 붙여 쓴다."""
    if user.role != "manager":
        raise HTTPException(status_code=403, detail="담당자만 사용할 수 있습니다")
    return user


def require_student(user: User = Depends(get_current_user)) -> User:
    if user.role != "student":
        raise HTTPException(status_code=403, detail="학생만 사용할 수 있습니다")
    return user
