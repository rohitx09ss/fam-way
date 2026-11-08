from datetime import timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app import models  # noqa: F401  (register tables)
from app.models import PS, PaymentRequest, User, utcnow


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine, expire_on_commit=False)() as s:
        s.add(User(id=1, email="m@x.com", password_hash="x", role="merchant"))
        s.commit()
        yield s


@pytest.fixture()
def make_payment(db):
    n = {"i": 0}

    def _make(amount=500, age_s=0, ttl_s=300, status=PS.WAITING):
        n["i"] += 1
        created = utcnow() - timedelta(seconds=age_s)
        p = PaymentRequest(reference=f"PAY{n['i']:010X}", merchant_id=1, amount_paise=amount * 100,
                           status=status, created_at=created, expires_at=created + timedelta(seconds=ttl_s))
        db.add(p)
        db.commit()
        return p
    return _make
