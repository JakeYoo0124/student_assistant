from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException
from sqlmodel import Session, select
from database import create_db, get_session
from datetime import date
from models import (
    User, UserCreate, UserRead, COURSES,
    CourseTerm, Holiday, TermIn, HolidayCreate, HolidayRead, ScheduleRead,
)
from schedule import get_term, holidays_of, next_class_day, public_holiday_name
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import OAuth2PasswordRequestForm
from security import hash_password, verify_password, create_access_token
from auth import get_current_user, require_manager
from excuse_api import router as excuse_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db()
    yield

app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")
app.include_router(excuse_router)

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

@app.get("/me", response_model=UserRead)
def me(user: User = Depends(get_current_user)):
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


# ── 수업 일정 ───────────────────────────────────────────────
def check_course(course: str):
    if course not in COURSES:
        raise HTTPException(status_code=404, detail="없는 과정입니다")

def can_view_course(user: User, course: str):
    # 담당자는 모든 과정, 학생은 자기 과정만
    if user.role != "manager" and user.course != course:
        raise HTTPException(status_code=403, detail="다른 과정의 일정은 볼 수 없습니다")

@app.get("/schedule/{course}", response_model=ScheduleRead)
def get_schedule(course: str, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    check_course(course)
    can_view_course(user, course)
    term = get_term(session, course)
    return ScheduleRead(
        course=course,
        start_date=term.start_date if term else None,
        end_date=term.end_date if term else None,
        holidays=holidays_of(session, course),
    )

@app.put("/schedule/{course}", response_model=ScheduleRead)
def set_term(course: str, data: TermIn, session: Session = Depends(get_session), _: User = Depends(require_manager)):
    check_course(course)
    if data.end_date < data.start_date:
        raise HTTPException(status_code=400, detail="종료일은 시작일보다 빠를 수 없습니다")
    term = get_term(session, course)
    if term:
        term.start_date, term.end_date = data.start_date, data.end_date
    else:
        term = CourseTerm(course=course, start_date=data.start_date, end_date=data.end_date)
    session.add(term)
    session.commit()
    return ScheduleRead(course=course, start_date=term.start_date, end_date=term.end_date,
                        holidays=holidays_of(session, course))

@app.post("/holidays", response_model=HolidayRead)
def add_holiday(data: HolidayCreate, session: Session = Depends(get_session), _: User = Depends(require_manager)):
    if data.course is not None:
        check_course(data.course)
    reason = data.reason.strip()
    if not reason:
        raise HTTPException(status_code=400, detail="휴강 사유를 입력해 주세요")
    if data.day.weekday() >= 5:
        raise HTTPException(status_code=400, detail="토요일·일요일은 이미 쉬는 날이라 따로 등록하지 않아도 됩니다")
    public_name = public_holiday_name(data.day)
    if public_name:
        raise HTTPException(status_code=400, detail=f"이미 공휴일({public_name})로 자동 등록되어 있습니다")
    dup = session.exec(select(Holiday).where(Holiday.day == data.day, Holiday.course == data.course)).first()
    if dup:
        raise HTTPException(status_code=400, detail="이미 등록된 휴강일입니다")
    holiday = Holiday(course=data.course, day=data.day, reason=reason)
    session.add(holiday)
    session.commit()
    session.refresh(holiday)
    return holiday

@app.delete("/holidays/{holiday_id}")
def delete_holiday(holiday_id: int, session: Session = Depends(get_session), _: User = Depends(require_manager)):
    holiday = session.get(Holiday, holiday_id)
    if not holiday:
        raise HTTPException(status_code=404, detail="없는 휴강일입니다")
    session.delete(holiday)
    session.commit()
    return {"ok": True}

@app.get("/schedule/{course}/next-class-day")
def get_next_class_day(course: str, after: date, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    check_course(course)
    can_view_course(user, course)
    days = {h.day for h in holidays_of(session, course)}
    return {"after": after, "next_class_day": next_class_day(get_term(session, course), days, after)}

