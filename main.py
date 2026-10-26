from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException
from sqlmodel import Session, select
from database import create_db, get_session
from models import User, UserCreate, UserRead, COURSES
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import OAuth2PasswordRequestForm, OAuth2PasswordBearer
from security import hash_password, verify_password, create_access_token, decode_token

@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db()
    yield

app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

@app.get("/")
def home():
    return FileResponse("static/index.html")

@app.get("/courses")
def list_courses():
    return COURSES

@app.post("/signup", response_model=UserRead)
def signup(data: UserCreate, session: Session = Depends(get_session)):
    if data.course not in COURSES:
        raise HTTPException(status_code=400, detail="과정을 선택해 주세요")
    exists = session.exec(select(User).where(User.email == data.email)).first()
    if exists:
        raise HTTPException(status_code=400, detail="이미 가입된 이메일입니다")

    user = User(
        name=data.name,
        email=data.email,
        password_hash=hash_password(data.password),
        role="student",
        status="pending",
        course=data.course,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user

@app.post("/login")
def login(form: OAuth2PasswordRequestForm = Depends(), session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.email == form.username)).first()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다")
    if user.status != "active":
        raise HTTPException(status_code=403, detail="담당자의 가입 승인을 기다리는 중입니다")
    return {"access_token": create_access_token(user.id), "token_type": "bearer"}

def get_current_user(token: str = Depends(oauth2_scheme), session: Session = Depends(get_session)) -> User:
    user_id = decode_token(token)
    user = session.get(User, user_id) if user_id else None
    if not user or user.status != "active":
        raise HTTPException(status_code=401, detail="로그인이 필요합니다")
    return user

@app.get("/me", response_model=UserRead)
def me(user: User = Depends(get_current_user)):
    return user


def require_manager(user: User = Depends(get_current_user)) -> User:
    """담당자만 통과시키는 검사. 담당자 전용 API에 Depends로 붙여 쓴다."""
    if user.role != "manager":
        raise HTTPException(status_code=403, detail="담당자만 사용할 수 있습니다")
    return user

@app.post("/managers", response_model=UserRead)
def create_manager(
    data: UserCreate,
    session: Session = Depends(get_session),
    _: User = Depends(require_manager),
):
    if len(data.password) < 8:
        raise HTTPException(status_code=400, detail="담당자 비밀번호는 8자 이상이어야 합니다")
    if session.exec(select(User).where(User.email == data.email)).first():
        raise HTTPException(status_code=400, detail="이미 가입된 이메일입니다")

    manager = User(
        name=data.name,
        email=data.email,
        password_hash=hash_password(data.password),
        role="manager",
    )
    session.add(manager)
    session.commit()
    session.refresh(manager)
    return manager


def get_pending_student(user_id: int, session: Session) -> User:
    user = session.get(User, user_id)
    if not user or user.role != "student" or user.status != "pending":
        raise HTTPException(status_code=404, detail="승인 대기 중인 가입 신청이 아닙니다")
    return user

@app.get("/signups", response_model=list[UserRead])
def list_signups(session: Session = Depends(get_session), _: User = Depends(require_manager)):
    return session.exec(select(User).where(User.status == "pending").order_by(User.id)).all()

@app.post("/signups/{user_id}/approve", response_model=UserRead)
def approve_signup(user_id: int, session: Session = Depends(get_session), _: User = Depends(require_manager)):
    user = get_pending_student(user_id, session)
    user.status = "active"
    session.add(user)
    session.commit()
    session.refresh(user)
    return user

@app.delete("/signups/{user_id}")
def reject_signup(user_id: int, session: Session = Depends(get_session), _: User = Depends(require_manager)):
    # 반려하면 기록을 지워서, 정보를 고쳐 다시 가입할 수 있게 한다
    user = get_pending_student(user_id, session)
    session.delete(user)
    session.commit()
    return {"ok": True}
