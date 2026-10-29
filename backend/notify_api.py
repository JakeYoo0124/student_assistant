"""알림 목록·읽음 처리 API. 알림은 받는 사람 본인만 볼 수 있다."""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlmodel import Session, select

from auth import get_current_user
from database import get_session
from models import ExcuseRequest, Notification, NotificationRead, User
from notify import notify

router = APIRouter(prefix="/notifications", tags=["notifications"])

LIST_LIMIT = 50


def ensure_deadline_notices(session: Session, user: User) -> None:
    """증빙 기한 알림은 날짜가 지나면 저절로 생겨야 해서, 확인하러 올 때 만들어 둔다.
    dedupe_key 덕분에 같은 알림이 중복으로 쌓이지 않는다."""
    if user.role != "student":
        return
    today = date.today()
    rows = session.exec(
        select(ExcuseRequest).where(ExcuseRequest.student_id == user.id, ExcuseRequest.status == "approved")
    ).all()
    for r in rows:
        if r.evidence_due is None:
            continue
        what = f"{r.reason} ({r.start_date})"
        if today > r.evidence_due:
            notify(session, user.id, "due", "증빙서류 제출 기한이 지났습니다",
                   f"{what} · 기한 {r.evidence_due}. 담당자에게 문의해 주세요.", "#status", f"overdue-{r.id}")
        elif today == r.evidence_due:
            notify(session, user.id, "due", "오늘이 증빙서류 제출 기한입니다", what, "#status", f"due-today-{r.id}")
        elif today + timedelta(days=1) == r.evidence_due:
            notify(session, user.id, "due", "증빙서류 제출 기한이 내일입니다", f"{what} · 기한 {r.evidence_due}", "#status", f"due-1-{r.id}")
    session.commit()


def unread_count(session: Session, user: User) -> int:
    return session.exec(
        select(func.count()).select_from(Notification).where(Notification.user_id == user.id, Notification.read == False)  # noqa: E712
    ).one()


@router.get("")
def list_notifications(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    ensure_deadline_notices(session, user)
    rows = session.exec(
        select(Notification).where(Notification.user_id == user.id).order_by(Notification.id.desc()).limit(LIST_LIMIT)
    ).all()
    return {
        "unread": unread_count(session, user),
        "items": [NotificationRead(id=n.id, kind=n.kind, title=n.title, body=n.body, link=n.link, read=n.read, created_at=n.created_at) for n in rows],
    }


@router.get("/unread-count")
def get_unread_count(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    ensure_deadline_notices(session, user)
    return {"unread": unread_count(session, user)}


@router.post("/read-all")
def read_all(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    for n in session.exec(select(Notification).where(Notification.user_id == user.id, Notification.read == False)).all():  # noqa: E712
        n.read = True
        session.add(n)
    session.commit()
    return {"unread": 0}


@router.post("/{notification_id}/read")
def read_one(notification_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    n = session.get(Notification, notification_id)
    if not n or n.user_id != user.id:  # 남의 알림은 없는 것처럼 404
        raise HTTPException(status_code=404, detail="없는 알림입니다")
    n.read = True
    session.add(n)
    session.commit()
    return {"unread": unread_count(session, user)}
