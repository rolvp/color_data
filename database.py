from datetime import datetime, timezone, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# Beijing timezone (UTC+8)
BEIJING_TZ = timezone(timedelta(hours=8))


def beijing_now() -> datetime:
    """Return current datetime in Beijing timezone."""
    return datetime.now(BEIJING_TZ)


SQLALCHEMY_DATABASE_URL = "sqlite:///./color_data.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
