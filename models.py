from datetime import date

from sqlmodel import SQLModel, Field

COURSES = ["AI에이전트과정", "아키텍처과정", "보안과정"]


class User(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    email: str = Field(unique=True)
    password_hash: str
    role: str
    status: str = Field(default="active")  # pending(승인 대기) / active
    course: str | None = None  # 학생의 과정 (담당자는 없음)


class UserCreate(SQLModel):
    name: str
    email: str
    password: str
    course: str | None = None  # 학생 가입 때만 필수


class UserRead(SQLModel):
    id: int
    name: str
    email: str
    role: str
    course: str | None = None


class CourseTerm(SQLModel, table=True):
    """과정별 수업 기간. 이 기간의 평일에서 휴강일을 뺀 날이 수업일이다."""
    course: str = Field(primary_key=True)
    start_date: date
    end_date: date


class Holiday(SQLModel, table=True):
    """휴강일. course 가 None 이면 모든 과정에 적용된다(공휴일 등)."""
    id: int | None = Field(default=None, primary_key=True)
    course: str | None = None
    day: date
    reason: str


class TermIn(SQLModel):
    start_date: date
    end_date: date


class HolidayCreate(SQLModel):
    course: str | None = None
    day: date
    reason: str


class HolidayRead(SQLModel):
    id: int | None = None  # 공휴일(자동)은 id 가 없다
    course: str | None = None
    day: date
    reason: str
    public: bool = False  # True 면 공휴일(자동), 삭제 불가


class ScheduleRead(SQLModel):
    course: str
    start_date: date | None = None
    end_date: date | None = None
    holidays: list[HolidayRead] = []

