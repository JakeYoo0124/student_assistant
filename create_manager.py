"""첫 담당자 계정을 만드는 스크립트. 터미널에서 한 번 실행한다.

    python create_manager.py
"""
from getpass import getpass

from sqlmodel import Session, select

from database import engine, create_db
from models import User
from security import hash_password


def main():
    create_db()
    name = input("이름: ").strip()
    email = input("이메일: ").strip()
    password = getpass("비밀번호(8자 이상): ")
    if getpass("비밀번호 확인: ") != password:
        raise SystemExit("비밀번호가 서로 다릅니다.")
    if not name or not email or len(password) < 8:
        raise SystemExit("이름과 이메일을 입력하고, 비밀번호는 8자 이상이어야 합니다.")

    with Session(engine) as session:
        if session.exec(select(User).where(User.email == email)).first():
            raise SystemExit("이미 가입된 이메일입니다.")
        session.add(User(name=name, email=email, password_hash=hash_password(password), role="manager"))
        session.commit()
    print(f"담당자 계정을 만들었습니다: {email}")


if __name__ == "__main__":
    main()
