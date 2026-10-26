import os
from sqlmodel import SQLModel, create_engine
from sqlmodel import Session

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///database.db")
engine = create_engine(DATABASE_URL)

def create_db():
    SQLModel.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session