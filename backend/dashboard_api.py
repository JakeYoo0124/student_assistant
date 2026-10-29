"""홈 화면 대시보드. 역할마다 다른 요약을 돌려준다.

실제 출결 기록(고용24)이 아직 이 앱에 없어서 '출석률'은 만들지 않는다.
신청·일정 데이터로 정확히 계산되는 것만 보여준다.
"""
import calendar
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlmodel import Session, select

from auth import get_current_user
from database import get_session
from excuse_api import class_days_between, course_info, months_between, used_days
from excuse_rule import accrued_vacation, sick_limit, vacation_limit
from models import COURSES, ExcuseRequest, ShortRequest, User
from schedule import get_term, holidays_of, is_class_day

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

APPROVED_LIKE = ("approved", "submitted", "confirmed")  # 담당자가 승인한 결석
WATCH_RATIO = 0.8  # 질병·입원 상한의 80% 이상 쓰면 '주의'


def month_bounds(today: date) -> tuple[date, date]:
    return today.replace(day=1), today.replace(day=calendar.monthrange(today.year, today.month)[1])


def count(session: Session, model, *conditions) -> int:
    return session.exec(select(func.count()).select_from(model).where(*conditions)).one()


def short_when(s: ShortRequest) -> str:
    if s.kind == "외출" and s.end_time:
        return f"{s.start_time:%H:%M}~{s.end_time:%H:%M}"
    return f"{s.start_time:%H:%M} 퇴실"


def name_of(session: Session, user_id: int) -> str:
    u = session.get(User, user_id)
    return u.name if u else "(삭제된 사용자)"


# ── 학생 ───────────────────────────────────────────────────
def student_summary(session: Session, user: User, today: date) -> dict:
    out: dict = {"role": "student", "course": user.course, "has_term": False}
    term = get_term(session, user.course) if user.course else None
    holiday_days = {h.day for h in holidays_of(session, user.course)} if user.course else set()
    first, last = month_bounds(today)
    absence_days = 0

    if term:
        info = course_info(term, holiday_days)
        total = info.전체소정훈련일수
        done = class_days_between(term, holiday_days, term.start_date, min(today, term.end_date)) if today >= term.start_date else 0
        month_no = max(1, months_between(term.start_date, today)[0] + 1) if today >= term.start_date else 1
        limit = vacation_limit(info)
        accrued = accrued_vacation(info, month_no)
        used_vacation = used_days(session, user.id, "휴가")
        out.update(
            has_term=True,
            progress={"done": done, "total": total, "percent": round(done * 100 / total) if total else 0},
            vacation={"limit": limit, "accrued": accrued, "used": used_vacation, "left": max(accrued - used_vacation, 0)},
            sick={"limit": sick_limit(info), "used": used_days(session, user.id, "질병,입원")},
        )
        for r in session.exec(
            select(ExcuseRequest).where(
                ExcuseRequest.student_id == user.id, ExcuseRequest.status.in_(APPROVED_LIKE),
                ExcuseRequest.start_date <= last, ExcuseRequest.end_date >= first,
            )
        ).all():
            absence_days += class_days_between(term, holiday_days, max(r.start_date, first), min(r.end_date, last))

    shorts = session.exec(
        select(ShortRequest).where(
            ShortRequest.student_id == user.id, ShortRequest.status == "approved",
            ShortRequest.day >= first, ShortRequest.day <= last,
        )
    ).all()
    out["month"] = {
        "absence_days": absence_days,
        "early": sum(1 for s in shorts if s.kind == "조퇴"),
        "out": sum(1 for s in shorts if s.kind == "외출"),
    }

    waiting = session.exec(
        select(ExcuseRequest).where(ExcuseRequest.student_id == user.id, ExcuseRequest.status == "approved").order_by(ExcuseRequest.evidence_due)
    ).all()
    out["todo"] = {
        "evidence": [
            {"id": r.id, "reason": r.reason, "start_date": r.start_date, "end_date": r.end_date,
             "due": r.evidence_due, "overdue": r.evidence_due is not None and today > r.evidence_due}
            for r in waiting
        ],
        "pending": count(session, ExcuseRequest, ExcuseRequest.student_id == user.id, ExcuseRequest.status == "pending")
        + count(session, ShortRequest, ShortRequest.student_id == user.id, ShortRequest.status == "pending"),
    }
    return out


# ── 강사: 오늘 우리 과정에서 빠지는 사람 ─────────────────────
def instructor_summary(session: Session, user: User, today: date) -> dict:
    out: dict = {"role": "instructor", "course": user.course, "class_day": False, "absent": [], "short": [], "students": 0}
    if not user.course:
        return out
    term = get_term(session, user.course)
    holiday_days = {h.day for h in holidays_of(session, user.course)}
    out["class_day"] = is_class_day(term, holiday_days, today)
    out["students"] = count(session, User, User.role == "student", User.status == "active", User.course == user.course)
    if not out["class_day"]:
        return out

    for r in session.exec(
        select(ExcuseRequest).where(
            ExcuseRequest.course == user.course, ExcuseRequest.status.in_(APPROVED_LIKE),
            ExcuseRequest.start_date <= today, ExcuseRequest.end_date >= today,
        )
    ).all():
        out["absent"].append({"student": name_of(session, r.student_id), "start_date": r.start_date, "end_date": r.end_date})
    for s in session.exec(
        select(ShortRequest).where(ShortRequest.course == user.course, ShortRequest.status == "approved", ShortRequest.day == today)
        .order_by(ShortRequest.start_time)
    ).all():
        out["short"].append({"student": name_of(session, s.student_id), "kind": s.kind, "when": short_when(s)})
    return out


# ── 담당자: 전체 ───────────────────────────────────────────
def manager_summary(session: Session, today: date) -> dict:
    first, last = month_bounds(today)
    out: dict = {
        "role": "manager",
        "pending": {
            "signups": count(session, User, User.role == "student", User.status == "pending"),
            "absences": count(session, ExcuseRequest, ExcuseRequest.status == "pending"),
            "evidence": count(session, ExcuseRequest, ExcuseRequest.status == "submitted"),
            "short": count(session, ShortRequest, ShortRequest.status == "pending"),
        },
        "overdue": [], "today_absent": [], "today_short": [], "courses": [], "watch": [],
    }

    for r in session.exec(
        select(ExcuseRequest).where(ExcuseRequest.status == "approved", ExcuseRequest.evidence_due < today).order_by(ExcuseRequest.evidence_due)
    ).all():
        out["overdue"].append({"id": r.id, "student": name_of(session, r.student_id), "course": r.course, "reason": r.reason, "due": r.evidence_due})

    for course in COURSES:
        term = get_term(session, course)
        holiday_days = {h.day for h in holidays_of(session, course)}
        students = session.exec(select(User).where(User.role == "student", User.status == "active", User.course == course)).all()
        month_days = 0
        class_today = term is not None and is_class_day(term, holiday_days, today)
        info = course_info(term, holiday_days) if term else None
        s_limit = sick_limit(info) if info else 0

        for r in session.exec(
            select(ExcuseRequest).where(
                ExcuseRequest.course == course, ExcuseRequest.status.in_(APPROVED_LIKE),
                ExcuseRequest.start_date <= last, ExcuseRequest.end_date >= first,
            )
        ).all():
            if term:
                month_days += class_days_between(term, holiday_days, max(r.start_date, first), min(r.end_date, last))
            if class_today and r.start_date <= today <= r.end_date:
                out["today_absent"].append({"student": name_of(session, r.student_id), "course": course, "start_date": r.start_date, "end_date": r.end_date})

        month_short = session.exec(
            select(ShortRequest).where(ShortRequest.course == course, ShortRequest.status == "approved", ShortRequest.day >= first, ShortRequest.day <= last)
        ).all()
        for s in month_short:
            if s.day == today:
                out["today_short"].append({"student": name_of(session, s.student_id), "course": course, "kind": s.kind, "when": short_when(s)})

        out["courses"].append({
            "course": course, "students": len(students), "has_term": term is not None,
            "month_absence_days": month_days, "month_early": sum(1 for s in month_short if s.kind == "조퇴"),
            "month_out": sum(1 for s in month_short if s.kind == "외출"),
        })

        # 질병·입원 상한의 80% 이상을 쓴 학생
        if s_limit:
            for st in students:
                used = used_days(session, st.id, "질병,입원")
                if used and used >= s_limit * WATCH_RATIO:
                    out["watch"].append({"student": st.name, "course": course, "why": f"질병·입원 {used}/{s_limit}일 사용"})

    out["today_short"].sort(key=lambda x: x["when"])
    return out


@router.get("")
def dashboard(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    today = date.today()
    if user.role == "manager":
        return manager_summary(session, today)
    if user.role == "instructor":
        return instructor_summary(session, user, today)
    return student_summary(session, user, today)
