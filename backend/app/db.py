from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings


def _normalize(url: str) -> str:
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


DATABASE_URL = _normalize(settings.database_url)
_sqlite = DATABASE_URL.startswith("sqlite")

# pool_pre_ping + recycle: Neon suspends idle compute and drops idle connections.
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=240,
    connect_args={"check_same_thread": False} if _sqlite else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
