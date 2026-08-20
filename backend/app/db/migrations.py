"""Application database migration helpers."""

from pathlib import Path

from alembic import command
from alembic.config import Config


def upgrade_database() -> None:
    """Upgrade the configured database to the latest Alembic revision."""
    backend_root = Path(__file__).resolve().parents[2]
    alembic_config = Config(str(backend_root / "alembic.ini"))
    command.upgrade(alembic_config, "head")
