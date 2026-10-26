"""공결·휴가 신청, 승인, 증빙서류 제출·확인 API."""
import calendar
import os
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlmodel import Session, select

from auth import get_current_user, require_manager, require_student
from database import get_session
from excuse_rule import DOC_GUIDE, EXCUSE_RULE, CourseInfo, check_excuse, missing_docs
from models import (
    CommentIn, CourseTerm, Evidence, EvidenceRead, ExcuseCreate, ExcuseRead, ExcuseRequest, User,
)
from schedule import get_term, holidays_of, is_class_day, next_class_day

router = APIRouter(prefix="/excuse", tags=["excuse"])

UPLOAD_DIR = "uploads"
ALLOWED_EXT = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
HOURS_PER_DAY = 8  # 질병·휴가 한도 계산에 쓰는 하루 훈련시간 (수업 9:10~18:00, 점심 제외)
ACTIVE = ("pending", "approved", "submitted", "confirmed")  # 한도·겹침 계산에 포함하는 상태


# ── 규칙 계산 도우미 ───────────────────────────────────────
def add_months(d: date, months: int) -> date:
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def months_between(start: date, end_exclusive: date) -> tuple[int, int]:
    """start 부터 end_exclusive 전날까지의 (개월 수, 남는 일수)."""
    months = (end_exclusive.year - start.year) * 12 + end_exclusive.month - start.month
    while months > 0 and add_months(start, months) > end_exclusive:
        months -= 1
    return months, (end_exclusive - add_months(start, months)).days


def class_days_between(term: CourseTerm, holiday_days: set[date], start: date, end: date) -> int:
    days, d = 0, start
    while d <= end:
        if is_class_day(term, holiday_days, d):
            days += 1
        d += timedelta(days=1)
    return days


def course_info(term: CourseTerm, holiday_days: set[date]) -> CourseInfo:
    """수업 기간으로 질병 상한·휴가 한도 계산에 필요한 과정 정보를 만든다."""
    total_days = class_days_between(term, holiday_days, term.start_date, term.end_date)
    months, rest = months_between(term.start_date, term.end_date + timedelta(days=1))
    return CourseInfo(
        전체소정훈련일수=total_days,
        전체소정훈련시간=total_days * HOURS_PER_DAY,
        주평균훈련일수=5,
        일평균훈련시간=HOURS_PER_DAY,
        훈련기간_개월=months,
        훈련기간_잔여일=rest,
    )


def required_docs(reason: str, target: str) -> list[str]:
    docs = EXCUSE_RULE[reason]["증빙"]
    return list(docs[target] if isinstance(docs, dict) else docs)


def used_days(session: Session, student_id: int, reason: str) -> int:
    rows = session.exec(
        select(ExcuseRequest).where(
            ExcuseRequest.student_id == student_id,
            ExcuseRequest.reason == reason,
            ExcuseRequest.status.in_(ACTIVE),
        )
    ).all()
    return sum(r.recognized_days for r in rows)


# ── 응답 만들기 ────────────────────────────────────────────
def to_read(session: Session, req: ExcuseRequest) -> ExcuseRead:
    student = session.get(User, req.student_id)
    evidence = session.exec(select(Evidence).where(Evidence.request_id == req.id).order_by(Evidence.id)).all()
    submitted = [e.doc_name for e in evidence if not e.rejected]
    return ExcuseRead(
        id=req.id,
        student_id=req.student_id,
        student_name=student.name if student else "(삭제된 사용자)",
        course=req.course,
        reason=req.reason,
        target=req.target,
        start_date=req.start_date,
        end_date=req.end_date,
        class_days=req.class_days,
        recognized_days=req.recognized_days,
        rule_note=req.rule_note,
        memo=req.memo,
        status=req.status,
        evidence_due=req.evidence_due,
        overdue=req.status == "approved" and req.evidence_due is not None and date.today() > req.evidence_due,
        required_docs=required_docs(req.reason, req.target),
        submitted_docs=submitted,
        evidence=[
            EvidenceRead(id=e.id, doc_name=e.doc_name, filename=e.filename, uploaded_at=e.uploaded_at, rejected=e.rejected)
            for e in evidence
        ],
        manager_comment=req.manager_comment,
        created_at=req.created_at,
    )


def get_request(session: Session, request_id: int) -> ExcuseRequest:
    req = session.get(ExcuseRequest, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="없는 신청입니다")
    return req


def own_request(session: Session, request_id: int, user: User) -> ExcuseRequest:
    req = get_request(session, request_id)
    if req.student_id != user.id:
        raise HTTPException(status_code=403, detail="내 신청이 아닙니다")
    return req


# ── 규칙 안내 (신청 화면용) ─────────────────────────────────
# 규칙 파일의 비고는 개발자용 메모가 섞여 있어서, 학생에게 보일 문구는 따로 둔다
STUDENT_NOTE = {
    "휴가": "매월 1일씩 발생하고, 쓰지 않은 휴가는 모아서 쓸 수 있습니다. 과정에 따라 부여되지 않을 수 있습니다.",
    "질병,입원": "일반건강검진은 인정되지 않습니다. 과정 전체 수업일의 10%까지만 인정됩니다.",
}
DAYS_LABEL = {
    "휴가": "매월 1일씩 발생 (모아서 사용 가능)",
    "질병,입원": "소요 일수 (과정 전체 수업일의 10%까지)",
}


@router.get("/rules")
def rules(_: User = Depends(get_current_user)):
    out = []
    for reason, rule in EXCUSE_RULE.items():
        max_days = rule["인정일수"]
        out.append({
            "reason": reason,
            "targets": rule["대상"],
            "docs": {t: required_docs(reason, t) for t in rule["대상"]},
            "max_days": max_days,
            "days_label": DAYS_LABEL.get(reason) or (f"최대 {max_days}일" if max_days else "소요 일수"),
            "note": STUDENT_NOTE.get(reason, rule.get("비고", "")),
        })
    return {"rules": out, "doc_guide": DOC_GUIDE}


# ── 학생: 신청 ─────────────────────────────────────────────
@router.post("", response_model=ExcuseRead)
def create_request(data: ExcuseCreate, session: Session = Depends(get_session), student: User = Depends(require_student)):
    rule = EXCUSE_RULE.get(data.reason)
    if rule is None:
        raise HTTPException(status_code=400, detail="없는 사유입니다")
    if data.target not in rule["대상"]:
        raise HTTPException(status_code=400, detail=f"'{data.reason}'의 대상은 {', '.join(rule['대상'])} 중에서 골라 주세요")
    if data.end_date < data.start_date:
        raise HTTPException(status_code=400, detail="종료일은 시작일보다 빠를 수 없습니다")
    if data.start_date < date.today():
        raise HTTPException(status_code=400, detail="지난 날짜는 신청할 수 없습니다. 담당자에게 문의해 주세요")
    if not student.course:
        raise HTTPException(status_code=400, detail="과정이 지정되지 않은 계정입니다")

    term = get_term(session, student.course)
    if term is None:
        raise HTTPException(status_code=400, detail="아직 수업 기간이 등록되지 않았습니다. 담당자에게 문의해 주세요")
    holiday_days = {h.day for h in holidays_of(session, student.course)}
    class_days = class_days_between(term, holiday_days, data.start_date, data.end_date)
    if class_days == 0:
        raise HTTPException(status_code=400, detail="신청 기간에 수업일이 없습니다")

    overlap = session.exec(
        select(ExcuseRequest).where(
            ExcuseRequest.student_id == student.id,
            ExcuseRequest.status.in_(ACTIVE),
            ExcuseRequest.start_date <= data.end_date,
            ExcuseRequest.end_date >= data.start_date,
        )
    ).first()
    if overlap:
        raise HTTPException(status_code=400, detail="같은 기간에 이미 신청한 내역이 있습니다")

    # 신청 단계에서는 사유·대상·한도만 검사한다 (증빙은 승인 후에 낸다)
    result = check_excuse(
        data.reason, data.target, [], class_days,
        course=course_info(term, holiday_days),
        사용한_질병일수=used_days(session, student.id, "질병,입원"),
        사용한_휴가일수=used_days(session, student.id, "휴가"),
        현재_훈련월=months_between(term.start_date, data.start_date)[0] + 1,
        증빙_확인=False,
    )
    if not result["인정"]:
        raise HTTPException(status_code=400, detail=result["사유"])

    req = ExcuseRequest(
        student_id=student.id, course=student.course, reason=data.reason, target=data.target,
        start_date=data.start_date, end_date=data.end_date, class_days=class_days,
        recognized_days=result["인정일수"], rule_note=result["사유"], memo=data.memo.strip(),
    )
    session.add(req)
    session.commit()
    session.refresh(req)
    return to_read(session, req)


@router.get("/mine", response_model=list[ExcuseRead])
def my_requests(session: Session = Depends(get_session), student: User = Depends(require_student)):
    rows = session.exec(
        select(ExcuseRequest).where(ExcuseRequest.student_id == student.id).order_by(ExcuseRequest.id.desc())
    ).all()
    return [to_read(session, r) for r in rows]


@router.delete("/{request_id}")
def cancel_request(request_id: int, session: Session = Depends(get_session), student: User = Depends(require_student)):
    req = own_request(session, request_id, student)
    if req.status != "pending":
        raise HTTPException(status_code=400, detail="승인 대기 중인 신청만 취소할 수 있습니다")
    session.delete(req)
    session.commit()
    return {"ok": True}


# ── 담당자: 목록·승인·반려 ──────────────────────────────────
@router.get("", response_model=list[ExcuseRead])
def list_requests(status: str | None = None, session: Session = Depends(get_session), _: User = Depends(require_manager)):
    query = select(ExcuseRequest).order_by(ExcuseRequest.id.desc())
    if status:
        query = query.where(ExcuseRequest.status == status)
    return [to_read(session, r) for r in session.exec(query).all()]


@router.post("/{request_id}/approve", response_model=ExcuseRead)
def approve(request_id: int, session: Session = Depends(get_session), _: User = Depends(require_manager)):
    req = get_request(session, request_id)
    if req.status != "pending":
        raise HTTPException(status_code=400, detail="승인 대기 중인 신청이 아닙니다")
    term = get_term(session, req.course)
    holiday_days = {h.day for h in holidays_of(session, req.course)}
    # 증빙 기한: 결석 마지막 날의 다음 수업일 (수업이 끝나 없으면 마지막 날)
    req.evidence_due = next_class_day(term, holiday_days, req.end_date) or req.end_date
    req.status = "approved"
    req.decided_at = datetime.now(timezone.utc)
    session.add(req)
    session.commit()
    return to_read(session, req)


@router.post("/{request_id}/reject", response_model=ExcuseRead)
def reject(request_id: int, data: CommentIn, session: Session = Depends(get_session), _: User = Depends(require_manager)):
    req = get_request(session, request_id)
    if req.status != "pending":
        raise HTTPException(status_code=400, detail="승인 대기 중인 신청이 아닙니다")
    if not data.comment.strip():
        raise HTTPException(status_code=400, detail="반려 사유를 입력해 주세요")
    req.status = "rejected"
    req.manager_comment = data.comment.strip()
    req.decided_at = datetime.now(timezone.utc)
    session.add(req)
    session.commit()
    return to_read(session, req)


# ── 증빙서류 ───────────────────────────────────────────────
@router.post("/{request_id}/evidence", response_model=ExcuseRead)
async def upload_evidence(
    request_id: int,
    doc_name: str = Form(...),
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    student: User = Depends(require_student),
):
    req = own_request(session, request_id, student)
    if req.status != "approved":
        raise HTTPException(status_code=400, detail="승인된 신청에만 증빙서류를 올릴 수 있습니다")
    if doc_name not in required_docs(req.reason, req.target):
        raise HTTPException(status_code=400, detail="이 신청에 필요한 서류가 아닙니다")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail="PDF, JPG, PNG 파일만 올릴 수 있습니다")
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="파일은 5MB 이하여야 합니다")
    if not content:
        raise HTTPException(status_code=400, detail="빈 파일입니다")

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    stored = f"{uuid.uuid4().hex}{ext}"
    with open(os.path.join(UPLOAD_DIR, stored), "wb") as f:
        f.write(content)

    # 같은 서류를 다시 올리면 이전 파일은 교체한다
    for old in session.exec(
        select(Evidence).where(Evidence.request_id == req.id, Evidence.doc_name == doc_name, Evidence.rejected == False)  # noqa: E712
    ).all():
        try:
            os.remove(os.path.join(UPLOAD_DIR, old.stored_name))
        except OSError:
            pass
        session.delete(old)

    session.add(Evidence(request_id=req.id, doc_name=doc_name, filename=os.path.basename(file.filename or stored), stored_name=stored))
    session.commit()

    active = [e.doc_name for e in session.exec(select(Evidence).where(Evidence.request_id == req.id, Evidence.rejected == False)).all()]  # noqa: E712
    if not missing_docs(required_docs(req.reason, req.target), active):
        req.status = "submitted"
        session.add(req)
        session.commit()
    return to_read(session, req)


@router.get("/{request_id}/evidence/{evidence_id}/file")
def download_evidence(request_id: int, evidence_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    req = get_request(session, request_id)
    if user.role != "manager" and req.student_id != user.id:
        raise HTTPException(status_code=403, detail="볼 수 없는 서류입니다")
    ev = session.get(Evidence, evidence_id)
    if not ev or ev.request_id != req.id:
        raise HTTPException(status_code=404, detail="없는 서류입니다")
    path = os.path.join(UPLOAD_DIR, ev.stored_name)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다")
    media = ALLOWED_EXT.get(os.path.splitext(ev.stored_name)[1], "application/octet-stream")
    return FileResponse(path, media_type=media, filename=ev.filename, content_disposition_type="inline")


@router.post("/{request_id}/evidence/confirm", response_model=ExcuseRead)
def confirm_evidence(request_id: int, session: Session = Depends(get_session), _: User = Depends(require_manager)):
    req = get_request(session, request_id)
    if req.status != "submitted":
        raise HTTPException(status_code=400, detail="증빙 확인 대기 중인 신청이 아닙니다")
    req.status = "confirmed"
    session.add(req)
    session.commit()
    return to_read(session, req)


@router.post("/{request_id}/evidence/reject", response_model=ExcuseRead)
def reject_evidence(request_id: int, data: CommentIn, session: Session = Depends(get_session), _: User = Depends(require_manager)):
    req = get_request(session, request_id)
    if req.status != "submitted":
        raise HTTPException(status_code=400, detail="증빙 확인 대기 중인 신청이 아닙니다")
    if not data.comment.strip():
        raise HTTPException(status_code=400, detail="반려 사유를 입력해 주세요")
    for ev in session.exec(select(Evidence).where(Evidence.request_id == req.id, Evidence.rejected == False)).all():  # noqa: E712
        ev.rejected = True
        session.add(ev)
    req.status = "approved"  # 다시 올리도록 되돌린다 (기한은 그대로)
    req.manager_comment = data.comment.strip()
    session.add(req)
    session.commit()
    return to_read(session, req)
