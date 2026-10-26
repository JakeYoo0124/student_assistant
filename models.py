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
