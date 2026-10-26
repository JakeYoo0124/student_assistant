import os
from pathlib import Path
from sqlmodel import SQLModel, create_engine
from sqlmodel import Session

# DB 파일은 어디서 실행하든 backend/database.db 를 쓴다
DEFAULT_DB = Path(__file__).resolve().parent / "database.db"
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DEFAULT_DB.as_posix()}")
engine = create_engine(DATABASE_URL)

def create_db():
    SQLModel.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session