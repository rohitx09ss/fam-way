from .models import AuditLog


def audit(db, actor: str, action: str, entity: str = "", detail: str = "") -> None:
    """Add an audit row to the current transaction (caller commits)."""
    db.add(AuditLog(actor=actor, action=action, entity=entity, detail=detail[:2000]))
