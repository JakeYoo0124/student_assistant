"""강사의 일일 수업 계획 API. 강사가 자기 과정의 계획을 쓰고, 학생·담당자는 읽는다."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from auth import can_view_course, check_course, get_current_user, require_instructor
from database import get_session
from models import DailyPlan, PlanCreate, PlanRead, User
from schedule import get_term, holidays_of, is_class_day

router = APIRouter(prefix="/plans", tags=["plans"])

MAX_RANGE_DAYS = 62  # 한 번에 조회할 수 있는 기간 (달력 한 달 + 여유)


def to_read(session: Session, plan: DailyPlan) -> PlanRead:
    teacher = session.get(User, plan.instructor_id)
    return PlanRead(
        id=plan.id, course=plan.course, day=plan.day,
        start_time=plan.start_time, end_time=plan.end_time,
        title=plan.title, note=plan.note,
        instructor_name=teacher.name if teacher else "(삭제된 사용자)",
    )


def validate_plan(session: Session, course: str | None, data: PlanCreate, exclude_id: int | None = None) -> PlanCreate:
    """저장 전 검사. 문제가 없으면 공백을 정리한 데이터를 돌려준다."""
    if not course:
        raise HTTPException(status_code=400, detail="담당 과정이 지정되지 않은 강사 계정입니다")
    title = data.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="주제를 입력해 주세요")
    if len(title) > 100 or len(data.note) > 500:
        raise HTTPException(status_code=400, detail="주제는 100자, 메모는 500자까지 쓸 수 있습니다")
    if data.end_time <= data.start_time:
        raise HTTPException(status_code=400, detail="종료 시각은 시작 시각보다 늦어야 합니다")

    term = get_term(session, course)
    if term is None:
        raise HTTPException(status_code=400, detail="아직 수업 기간이 등록되지 않았습니다. 담당자에게 문의해 주세요")
    holiday_days = {h.day for h in holidays_of(session, course)}
    if not is_class_day(term, holiday_days, data.day):
        raise HTTPException(status_code=400, detail="수업이 없는 날(주말·휴강일·수업 기간 밖)에는 계획을 쓸 수 없습니다")

    # 같은 날 다른 칸과 시간이 겹치는지: 서로의 시작이 상대의 끝보다 앞이면 겹친다
    others = session.exec(select(DailyPlan).where(DailyPlan.course == course, DailyPlan.day == data.day)).all()
    for other in others:
        if other.id != exclude_id and other.start_time < data.end_time and other.end_time > data.start_time:
            raise HTTPException(
                status_code=400,
                detail=f"{other.start_time:%H:%M}~{other.end_time:%H:%M} '{other.title}' 시간대와 겹칩니다",
            )
    return PlanCreate(day=data.day, start_time=data.start_time, end_time=data.end_time, title=title, note=data.note.strip())


def own_course_plan(session: Session, plan_id: int, instructor: User) -> DailyPlan:
    plan = session.get(DailyPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="없는 계획입니다")
    if plan.course != instructor.course:
        raise HTTPException(status_code=403, detail="다른 과정의 계획은 고칠 수 없습니다")
    return plan


# ── 읽기: 담당자(모든 과정), 강사·학생(자기 과정) ─────────────
@router.get("/{course}", response_model=list[PlanRead])
def list_plans(course: str, start: date, end: date, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    check_course(course)
    can_view_course(user, course)
    if end < start or (end - start).days > MAX_RANGE_DAYS:
        raise HTTPException(status_code=400, detail=f"조회 기간은 {MAX_RANGE_DAYS}일 이내여야 합니다")
    rows = session.exec(
        select(DailyPlan)
        .where(DailyPlan.course == course, DailyPlan.day >= start, DailyPlan.day <= end)
        .order_by(DailyPlan.day, DailyPlan.start_time)
    ).all()
    return [to_read(session, p) for p in rows]


# ── 쓰기: 강사만, 자기 과정만 ───────────────────────────────
@router.post("", response_model=PlanRead)
def create_plan(data: PlanCreate, session: Session = Depends(get_session), instructor: User = Depends(require_instructor)):
    clean = validate_plan(session, instructor.course, data)
    plan = DailyPlan(course=instructor.course, instructor_id=instructor.id, **clean.model_dump())
    session.add(plan)
    session.commit()
    session.refresh(plan)
    return to_read(session, plan)


@router.put("/{plan_id}", response_model=PlanRead)
def update_plan(plan_id: int, data: PlanCreate, session: Session = Depends(get_session), instructor: User = Depends(require_instructor)):
    plan = own_course_plan(session, plan_id, instructor)
    clean = validate_plan(session, plan.course, data, exclude_id=plan.id)
    plan.day, plan.start_time, plan.end_time = clean.day, clean.start_time, clean.end_time
    plan.title, plan.note = clean.title, clean.note
    session.add(plan)
    session.commit()
    session.refresh(plan)
    return to_read(session, plan)


@router.delete("/{plan_id}")
def delete_plan(plan_id: int, session: Session = Depends(get_session), instructor: User = Depends(require_instructor)):
    plan = own_course_plan(session, plan_id, instructor)
    session.delete(plan)
    session.commit()
    return {"ok": True}
