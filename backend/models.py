from datetime import date, datetime, time, timezone

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


class ExcuseRequest(SQLModel, table=True):
    """공결·휴가 신청. 상태: pending(승인 대기) → approved(증빙 대기) → submitted(증빙 확인 대기) → confirmed(인정 완료), 또는 rejected."""
    id: int | None = Field(default=None, primary_key=True)
    student_id: int = Field(foreign_key="user.id", index=True)
    course: str
    reason: str  # 사유 (excuse_rule.EXCUSE_RULE 의 키)
    target: str  # 대상 (본인, 자녀 ...)
    start_date: date
    end_date: date
    class_days: int  # 신청 기간 안의 수업일 수
    recognized_days: int  # 규칙상 인정 가능한 일수
    rule_note: str = ""  # 규칙 검사 결과 메시지
    memo: str = ""
    status: str = Field(default="pending", index=True)
    evidence_due: date | None = None  # 승인 때 정해진다: 결석 마지막 날의 다음 수업일
    manager_comment: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    decided_at: datetime | None = None


class Evidence(SQLModel, table=True):
    """증빙서류 파일. 파일은 uploads/ 에 무작위 이름으로 저장한다."""
    id: int | None = Field(default=None, primary_key=True)
    request_id: int = Field(foreign_key="excuserequest.id", index=True)
    doc_name: str  # 어떤 서류인지 (예: 청첩장)
    filename: str  # 학생이 올린 원래 파일 이름 (표시용)
    stored_name: str
    uploaded_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    rejected: bool = False  # 담당자가 반려한 서류


class ExcuseCreate(SQLModel):
    reason: str
    target: str
    start_date: date
    end_date: date
    memo: str = ""


class CommentIn(SQLModel):
    comment: str = ""


class EvidenceRead(SQLModel):
    id: int
    doc_name: str
    filename: str
    uploaded_at: datetime
    rejected: bool


class ExcuseRead(SQLModel):
    id: int
    student_id: int
    student_name: str
    course: str
    reason: str
    target: str
    start_date: date
    end_date: date
    class_days: int
    recognized_days: int
    rule_note: str
    memo: str
    status: str
    evidence_due: date | None
    overdue: bool
    required_docs: list[str]
    submitted_docs: list[str]
    evidence: list[EvidenceRead]
    manager_comment: str
    created_at: datetime


class DailyPlan(SQLModel, table=True):
    """강사가 쓰는 하루 수업 계획의 한 칸 (하루에 여러 칸)."""
    id: int | None = Field(default=None, primary_key=True)
    course: str = Field(index=True)
    day: date = Field(index=True)
    start_time: time
    end_time: time
    title: str  # 주제
    note: str = ""  # 준비물·메모
    instructor_id: int = Field(foreign_key="user.id")


class PlanCreate(SQLModel):
    day: date
    start_time: time
    end_time: time
    title: str
    note: str = ""


class PlanRead(SQLModel):
    id: int
    course: str
    day: date
    start_time: time
    end_time: time
    title: str
    note: str
    instructor_name: str


class AbsenceBrief(SQLModel):
    """강사에게 보여주는 결석 예정 정보. 사유·서류 같은 민감한 내용은 뺀다."""
    student_name: str
    start_date: date
    end_date: date
    class_days: int
    recognized_days: int
    approved: bool  # False 면 아직 승인 대기 중

