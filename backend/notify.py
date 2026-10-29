"""알림 만들기 도구. 각 API 가 신청·승인 같은 일을 처리할 때 함께 부른다.

여기서는 session.add 만 하고 commit 은 하지 않는다. 호출한 쪽이 일을 저장할 때 같이 저장되므로,
일은 저장됐는데 알림만 빠지거나 그 반대가 되는 일이 없다.
"""
from sqlmodel import Session, select

from models import Notification, User


def notify(session: Session, user_id: int, kind: str, title: str, body: str = "", link: str = "",
           dedupe_key: str | None = None) -> None:
    """한 사람에게 알림 하나. dedupe_key 가 있으면 같은 열쇠의 알림이 이미 있을 때 만들지 않는다."""
    if dedupe_key:
        exists = session.exec(
            select(Notification.id).where(Notification.user_id == user_id, Notification.dedupe_key == dedupe_key)
        ).first()
        if exists:
            return
    session.add(Notification(user_id=user_id, kind=kind, title=title, body=body, link=link, dedupe_key=dedupe_key))


def notify_managers(session: Session, kind: str, title: str, body: str = "", link: str = "") -> None:
    """승인된 담당자 모두에게."""
    for m in session.exec(select(User).where(User.role == "manager", User.status == "active")).all():
        notify(session, m.id, kind, title, body, link)


def notify_instructors(session: Session, course: str, kind: str, title: str, body: str = "", link: str = "") -> None:
    """그 과정의 강사에게."""
    for t in session.exec(select(User).where(User.role == "instructor", User.course == course)).all():
        notify(session, t.id, kind, title, body, link)
