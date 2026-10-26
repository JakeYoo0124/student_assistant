"""개발용 더미 학생 계정을 만든다. 과정마다 15명, 모두 승인된(active) 상태.

    python seed_dummy.py

이미 있는 이메일은 건너뛰므로 여러 번 실행해도 안전하다.
이메일은 example.com(실제로 존재하지 않는 예약 도메인)을 써서
나중에 메일 알림을 붙여도 실제 사람에게 발송되지 않는다.
"""
from sqlmodel import Session, select

from database import engine, create_db
from models import User, COURSES
from security import hash_password

DUMMY_PASSWORD = "dummy1234"
PER_COURSE = 15
EMAIL_PREFIX = {"AI에이전트과정": "ai", "아키텍처과정": "arch", "보안과정": "sec"}

SURNAMES = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권"]
GIVEN = [
    "민준", "서연", "도윤", "지우", "하준", "서윤", "시우", "하은", "예준", "지민",
    "주원", "수아", "건우", "지유", "현우", "채원", "지훈", "다은", "우진", "소율",
    "선우", "유진", "준서", "예린", "연우", "나윤", "은우", "아린", "승현", "시현",
    "재윤", "하린", "태오", "서현", "지호", "윤서", "민재", "수빈", "정우", "지안",
    "도현", "예은", "시윤", "가온", "이준",
]


def main():
    create_db()
    hashed = hash_password(DUMMY_PASSWORD)  # 더미 계정은 같은 비밀번호를 공유
    created = skipped = 0
    with Session(engine) as session:
        n = 0
        for course in COURSES:
            for i in range(1, PER_COURSE + 1):
                email = f"{EMAIL_PREFIX[course]}{i:02d}@example.com"
                name = SURNAMES[n % len(SURNAMES)] + GIVEN[n]
                n += 1
                if session.exec(select(User).where(User.email == email)).first():
                    skipped += 1
                    continue
                session.add(User(name=name, email=email, password_hash=hashed,
                                 role="student", status="active", course=course))
                created += 1
        session.commit()
    print(f"더미 학생 {created}명 생성, {skipped}명은 이미 있어서 건너뜀")
    print(f"로그인: <이메일> / {DUMMY_PASSWORD}  예) ai01@example.com")


if __name__ == "__main__":
    main()
