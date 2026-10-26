from sqlmodel import SQLModel, create_engine
from sqlmodel import Session

engine = create_engine("sqlite:///database.db")

def create_db():
    SQLModel.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session