"""수업일 계산. 수업일 = 수업 기간 안의 평일(월~금) 중 휴강일이 아닌 날.

휴강일은 두 가지다.
- 공휴일: holidays 라이브러리로 자동 계산한다 (대체공휴일 포함). 담당자가 입력하지 않는다.
- 담당자가 입력한 휴강일: 모든 과정 공통이거나 특정 과정만.
"""
from datetime import date, timedelta

import holidays
from sqlmodel import Session, select, or_

from models import CourseTerm, Holiday, HolidayRead


def get_term(session: Session, course: str) -> CourseTerm | None:
    return session.get(CourseTerm, course)


def public_holiday_name(day: date) -> str | None:
    return holidays.country_holidays("KR", years=day.year, language="ko").get(day)


def public_holidays(term: CourseTerm | None) -> list[HolidayRead]:
    """수업 기간 안의 공휴일. 기간이 없으면 올해 공휴일."""
    if term is None:
        years, start, end = [date.today().year], date.min, date.max
    else:
        years = range(term.start_date.year, term.end_date.year + 1)
        start, end = term.start_date, term.end_date
    kr = holidays.country_holidays("KR", years=years, language="ko")
    return [
        HolidayRead(day=d, reason=name, public=True)
        for d, name in sorted(kr.items())
        if start <= d <= end
    ]


def holidays_of(session: Session, course: str) -> list[HolidayRead]:
    """이 과정에 적용되는 모든 휴강일 (공휴일 + 전체 공통 + 이 과정만)."""
    term = get_term(session, course)
    rows = session.exec(
        select(Holiday).where(or_(Holiday.course == None, Holiday.course == course))  # noqa: E711
    ).all()
    custom = [HolidayRead(id=h.id, course=h.course, day=h.day, reason=h.reason) for h in rows]
    return sorted(public_holidays(term) + custom, key=lambda h: (h.day, h.id or 0))


def is_class_day(term: CourseTerm | None, holiday_days: set[date], day: date) -> bool:
    if term is None or not (term.start_date <= day <= term.end_date):
        return False
    return day.weekday() < 5 and day not in holiday_days


def next_class_day(term: CourseTerm | None, holiday_days: set[date], after: date) -> date | None:
    """after 다음 날부터 처음 만나는 수업일. 수업 기간이 끝났으면 None."""
    if term is None:
        return None
    day = max(after + timedelta(days=1), term.start_date)
    while day <= term.end_date:
        if is_class_day(term, holiday_days, day):
            return day
        day += timedelta(days=1)
    return None
