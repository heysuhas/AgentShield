import os
import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect


def test_alembic_migrations_upgrade_and_downgrade(tmp_path) -> None:
    """Proves that Alembic can apply all migrations up to head and roll back cleanly."""
    db_file = tmp_path / "test_migration.db"
    db_url = f"sqlite:///{db_file}"

    alembic_cfg = Config("alembic.ini")
    alembic_cfg.set_main_option("sqlalchemy.url", db_url)

    # 1. Upgrade to head
    command.upgrade(alembic_cfg, "head")

    engine = create_engine(db_url)
    inspector = inspect(engine)
    tables = inspector.get_table_names()

    assert "sessions" in tables
    assert "policies" in tables
    assert "authorized_intents" in tables
    assert "transactions" in tables
    assert "audit_events" in tables
    assert "approvals" in tables

    # Verify columns in policies
    policy_cols = {c["name"] for c in inspector.get_columns("policies")}
    assert "max_requests_per_window" in policy_cols
    assert "window_seconds" in policy_cols
    assert "max_spend_per_window" in policy_cols
    assert "require_approval_above" in policy_cols
    assert "require_human_approval" in policy_cols

    # Verify columns in audit_events
    audit_cols = {c["name"] for c in inspector.get_columns("audit_events")}
    assert "risk_level" in audit_cols
    assert "semantic_validation" in audit_cols

    # 2. Downgrade to base
    command.downgrade(alembic_cfg, "base")
    inspector_down = inspect(engine)
    tables_down = inspector_down.get_table_names()
    assert "policies" not in tables_down
    assert "transactions" not in tables_down
    assert "audit_events" not in tables_down

    # 3. Upgrade back to head
    command.upgrade(alembic_cfg, "head")
    inspector_up = inspect(engine)
    assert "transactions" in inspector_up.get_table_names()

    engine.dispose()
