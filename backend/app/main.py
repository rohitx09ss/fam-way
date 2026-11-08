import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, select, text

from .config import settings
from .db import Base, SessionLocal, engine
from .models import User
from .routers import admin, auth, merchant, verify
from .security import hash_password
from .worker import email_loop, expiry_loop

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("app")


def ensure_columns() -> None:
    """create_all never alters existing tables; add columns introduced later (Postgres + SQLite)."""
    wanted = {
        "payment_requests": {"payer_name": "VARCHAR(120)", "utr": "VARCHAR(64)"},
        "email_events": {"payer_name": "VARCHAR(120)", "utr": "VARCHAR(64)"},
    }
    insp = inspect(engine)
    with engine.begin() as conn:
        for table, cols in wanted.items():
            have = {c["name"] for c in insp.get_columns(table)}
            for name, ddl in cols.items():
                if name not in have:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


def bootstrap_admin() -> None:
    with SessionLocal() as db:
        if not db.scalar(select(User.id).where(User.email == settings.admin_email.lower())):
            db.add(User(email=settings.admin_email.lower(), password_hash=hash_password(settings.admin_password), role="admin"))
            db.commit()
            log.info("Created admin user %s", settings.admin_email)
    if settings.admin_password == "change-me-now":
        log.warning("ADMIN_PASSWORD is still the default. Change it.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)  # for larger changes later, move to Alembic migrations
    ensure_columns()
    bootstrap_admin()
    tasks = []
    if settings.run_workers:
        tasks = [asyncio.create_task(expiry_loop()), asyncio.create_task(email_loop())]
    yield
    for t in tasks:
        t.cancel()


app = FastAPI(title="Dynamic UPI QR Verification API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.frontend_origins.split(",") if o.strip()],
    allow_methods=["*"], allow_headers=["*"],
)
for r in (auth.router, merchant.router, admin.router, verify.router):
    app.include_router(r)


@app.get("/healthz", tags=["meta"])
def healthz():
    return {"ok": True}
