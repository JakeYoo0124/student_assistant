"""조퇴·외출 간단 신청 API와, 학생 본인 달력에 칠할 결석·조퇴·외출 표시 API."""
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from auth import require_manager, require_student
from database import get_session
from excuse_api import ACTIVE as EXCUSE_ACTIVE
from excuse_rule import CLASS_END
from models import CalendarMark, CommentIn, ExcuseRequest, ShortCreate, ShortRead, ShortRequest, User
from schedule import get_term, holidays_of, is_class_day

router = APIRouter(tags=["short"])

DAY_START = time(9, 0)  # 수업 시작
DAY_END = CLASS_END  # 18:00, excuse_rule.py 와 같은 값
ACTIVE_SHORT = ("pending", "approved")  # 반려를 뺀 나머지
MAX_RANGE_DAYS = 62


def to_read(session: Session, r: ShortRequest) -> ShortRead:
    student = session.get(User, r.student_id)
    return ShortRead(
        id=r.id, student_id=r.student_id, student_name=student.name if student else "(삭제된 사용자)",
        course=r.course, kind=r.kind, day=r.day, start_time=r.start_time, end_time=r.end_time,
        reason=r.reason, status=r.status, manager_comment=r.manager_comment, created_at=r.created_at,
    )


def span(kind: str, start: time, end: time | None) -> tuple[time, time]:
    """겹침 계산용 시간 구간. 조퇴는 나간 시각부터 수업이 끝날 때까지로 본다."""
    return (start, DAY_END) if kind == "조퇴" else (start, end)


def get_short(session: Session, short_id: int) -> ShortRequest:
    r = session.get(ShortRequest, short_id)
    if not r:
        raise HTTPException(status_code=404, detail="없는 신청입니다")
    return r


# ── 학생: 신청 ─────────────────────────────────────────────
@router.post("/short", response_model=ShortRead)
def create_short(data: ShortCreate, session: Session = Depends(get_session), student: User = Depends(require_student)):
    if data.kind not in ("조퇴", "외출"):
        raise HTTPException(status_code=400, detail="조퇴 또는 외출만 신청할 수 있습니다")
    reason = data.reason.strip()
    if not 2 <= len(reason) <= 200:
        raise HTTPException(status_code=400, detail="사유를 2자 이상 200자 이내로 적어 주세요")

    # 시간 검사: 수업 시간(09:00~18:00) 안이어야 한다
    start, end = data.start_time, (data.end_time if data.kind == "외출" else None)
    if data.kind == "조퇴":
        if not (DAY_START <= start < DAY_END):
            raise HTTPException(status_code=400, detail=f"조퇴 시각은 {DAY_START:%H:%M} ~ {DAY_END:%H:%M} 사이여야 합니다")
    else:
        if end is None:
            raise HTTPException(status_code=400, detail="외출은 돌아오는 시각도 입력해 주세요")
        if not (DAY_START <= start < end <= DAY_END):
            raise HTTPException(status_code=400, detail=f"외출 시간은 {DAY_START:%H:%M} ~ {DAY_END:%H:%M} 사이에서 시작보다 종료가 늦어야 합니다")

    if data.day < date.today():
        raise HTTPException(status_code=400, detail="지난 날짜는 신청할 수 없습니다. 담당자에게 문의해 주세요")
    if not student.course:
        raise HTTPException(status_code=400, detail="과정이 지정되지 않은 계정입니다")
    term = get_term(session, student.course)
    if term is None:
        raise HTTPException(status_code=400, detail="아직 수업 기간이 등록되지 않았습니다. 담당자에게 문의해 주세요")
    if not is_class_day(term, {h.day for h in holidays_of(session, student.course)}, data.day):
        raise HTTPException(status_code=400, detail="수업이 없는 날에는 신청할 수 없습니다")

    # 그날 이미 결석(공결·휴가)으로 신청돼 있으면 조퇴·외출은 의미가 없다
    absent = session.exec(
        select(ExcuseRequest).where(
            ExcuseRequest.student_id == student.id,
            ExcuseRequest.status.in_(EXCUSE_ACTIVE),
            ExcuseRequest.start_date <= data.day,
            ExcuseRequest.end_date >= data.day,
        )
    ).first()
    if absent:
        raise HTTPException(status_code=400, detail="그날은 이미 결석(공결·휴가)으로 신청되어 있습니다")

    new_start, new_end = span(data.kind, start, end)
    same_day = session.exec(
        select(ShortRequest).where(
            ShortRequest.student_id == student.id,
            ShortRequest.day == data.day,
            ShortRequest.status.in_(ACTIVE_SHORT),
        )
    ).all()
    for other in same_day:
        o_start, o_end = span(other.kind, other.start_time, other.end_time)
        if o_start < new_end and o_end > new_start:  # 두 시간 구간이 겹치면
            raise HTTPException(status_code=400, detail="그 시간대에 이미 신청한 조퇴·외출이 있습니다")

    r = ShortRequest(student_id=student.id, course=student.course, kind=data.kind, day=data.day,
                     start_time=start, end_time=end, reason=reason)
    session.add(r)
    session.commit()
    session.refresh(r)
    return to_read(session, r)


@router.get("/short/mine", response_model=list[ShortRead])
def my_short(session: Session = Depends(get_session), student: User = Depends(require_student)):
    rows = session.exec(
        select(ShortRequest).where(ShortRequest.student_id == student.id).order_by(ShortRequest.id.desc())
    ).all()
    return [to_read(session, r) for r in rows]


@router.delete("/short/{short_id}")
def cancel_short(short_id: int, session: Session = Depends(get_session), student: User = Depends(require_student)):
    r = get_short(session, short_id)
    if r.student_id != student.id:
        raise HTTPException(status_code=403, detail="내 신청이 아닙니다")
    if r.status != "pending":
        raise HTTPException(status_code=400, detail="승인 대기 중인 신청만 취소할 수 있습니다")
    session.delete(r)
    session.commit()
    return {"ok": True}


# ── 담당자: 목록·승인·반려 ──────────────────────────────────
@router.get("/short", response_model=list[ShortRead])
def list_short(status: str | None = None, session: Session = Depends(get_session), _: User = Depends(require_manager)):
    query = select(ShortRequest).order_by(ShortRequest.id.desc())
    if status:
        query = query.where(ShortRequest.status == status)
    return [to_read(session, r) for r in session.exec(query).all()]


@router.post("/short/{short_id}/approve", response_model=ShortRead)
def approve_short(short_id: int, session: Session = Depends(get_session), _: User = Depends(require_manager)):
    r = get_short(session, short_id)
    if r.status != "pending":
        raise HTTPException(status_code=400, detail="승인 대기 중인 신청이 아닙니다")
    r.status = "approved"
    r.decided_at = datetime.now(timezone.utc)
    session.add(r)
    session.commit()
    return to_read(session, r)


@router.post("/short/{short_id}/reject", response_model=ShortRead)
def reject_short(short_id: int, data: CommentIn, session: Session = Depends(get_session), _: User = Depends(require_manager)):
    r = get_short(session, short_id)
    if r.status != "pending":
        raise HTTPException(status_code=400, detail="승인 대기 중인 신청이 아닙니다")
    if not data.comment.strip():
        raise HTTPException(status_code=400, detail="반려 사유를 입력해 주세요")
    r.status = "rejected"
    r.manager_comment = data.comment.strip()
    r.decided_at = datetime.now(timezone.utc)
    session.add(r)
    session.commit()
    return to_read(session, r)


# ── 학생 본인 달력: 내가 빠진 날·조퇴·외출을 칠하기 위한 데이터 ───────
@router.get("/mycalendar", response_model=list[CalendarMark])
def my_calendar(start: date, end: date, session: Session = Depends(get_session), student: User = Depends(require_student)):
    if end < start or (end - start).days > MAX_RANGE_DAYS:
        raise HTTPException(status_code=400, detail=f"조회 기간은 {MAX_RANGE_DAYS}일 이내여야 합니다")
    marks: list[CalendarMark] = []
    term = get_term(session, student.course) if student.course else None
    holiday_days = {h.day for h in holidays_of(session, student.course)} if student.course else set()

    # 결석(공결·휴가): 신청 기간 중 수업일마다 한 칸씩
    requests = session.exec(
        select(ExcuseRequest).where(
            ExcuseRequest.student_id == student.id,
            ExcuseRequest.status.in_(EXCUSE_ACTIVE),
            ExcuseRequest.start_date <= end,
            ExcuseRequest.end_date >= start,
        )
    ).all()
    for r in requests:
        d, last = max(r.start_date, start), min(r.end_date, end)
        while d <= last:
            if is_class_day(term, holiday_days, d):
                marks.append(CalendarMark(day=d, kind="휴가" if r.reason == "휴가" else "공결", label=r.reason,
                                          pending=r.status == "pending"))
            d += timedelta(days=1)

    # 조퇴·외출
    shorts = session.exec(
        select(ShortRequest).where(
            ShortRequest.student_id == student.id,
            ShortRequest.status.in_(ACTIVE_SHORT),
            ShortRequest.day >= start,
            ShortRequest.day <= end,
        )
    ).all()
    for s in shorts:
        when = f"{s.start_time:%H:%M}" + (f"~{s.end_time:%H:%M}" if s.kind == "외출" and s.end_time else "")
        marks.append(CalendarMark(day=s.day, kind=s.kind, label=f"{s.kind} {when}", pending=s.status == "pending"))

    return sorted(marks, key=lambda m: (m.day, m.kind))
