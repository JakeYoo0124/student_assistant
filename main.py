from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException
from sqlmodel import Session, select
from database import create_db, get_session
from models import User, UserCreate, UserRead
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

@app.post("/signup", response_model=UserRead)
def signup(data: UserCreate, session: Session = Depends(get_session)):
    exists = session.exec(select(User).where(User.email == data.email)).first()
    if exists:
        raise HTTPException(status_code=400, detail="이미 가입된 이메일입니다")

    user = User(
        name=data.name,
        email=data.email,
        password_hash=hash_password(data.password),
        role="student",
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
    return {"access_token": create_access_token(user.id), "token_type": "bearer"}

def get_current_user(token: str = Depends(oauth2_scheme), session: Session = Depends(get_session)) -> User:
    user_id = decode_token(token)
    user = session.get(User, user_id) if user_id else None
    if not user:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다")
    return user

@app.get("/me", response_model=UserRead)
def me(user: User = Depends(get_current_user)):
    return user
