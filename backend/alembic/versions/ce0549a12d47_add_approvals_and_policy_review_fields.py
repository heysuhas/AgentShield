"""add_approvals_and_policy_review_fields

Revision ID: ce0549a12d47
Revises: 246bf62ce961
Create Date: 2026-08-20 21:55:17.632481

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = 'ce0549a12d47'
down_revision: Union[str, Sequence[str], None] = '246bf62ce961'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema, tolerating a partially applied local SQLite upgrade."""
    bind = op.get_bind()
    inspector = inspect(bind)
    policy_columns = {column["name"] for column in inspector.get_columns("policies")}
    if "require_approval_above" not in policy_columns:
        op.add_column("policies", sa.Column("require_approval_above", sa.Integer(), nullable=True))
    if "require_human_approval" not in policy_columns:
        op.add_column(
            "policies",
            sa.Column(
                "require_human_approval",
                sa.Boolean(),
                server_default=sa.false(),
                nullable=False,
            ),
        )

    if "approvals" not in inspector.get_table_names():
        op.create_table(
        'approvals',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('approval_id', sa.String(length=128), nullable=False),
        sa.Column('transaction_id', sa.String(length=128), nullable=False),
        sa.Column('session_id', sa.String(length=128), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False),
        sa.Column('tool_name', sa.String(length=64), nullable=False),
        sa.Column('amount', sa.Integer(), nullable=True),
        sa.Column('currency', sa.String(length=16), nullable=False),
        sa.Column('arguments', sa.JSON(), nullable=False),
        sa.Column('risk_score', sa.Float(), nullable=False),
        sa.Column('risk_level', sa.String(length=16), nullable=False),
        sa.Column('reasons', sa.JSON(), nullable=False),
        sa.Column('reviewed_by', sa.String(length=128), nullable=True),
        sa.Column('review_notes', sa.String(length=512), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.session_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['transaction_id'], ['transactions.transaction_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )

    existing_indexes = {index["name"] for index in inspect(bind).get_indexes("approvals")}
    indexes = {
        "ix_approvals_approval_id": ("approval_id", True),
        "ix_approvals_session_id": ("session_id", False),
        "ix_approvals_status": ("status", False),
        "ix_approvals_transaction_id": ("transaction_id", False),
        "ix_approvals_created_at": ("created_at", False),
    }
    for index_name, (column, unique) in indexes.items():
        if index_name not in existing_indexes:
            op.create_index(index_name, "approvals", [column], unique=unique)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_approvals_created_at'), table_name='approvals')
    op.drop_index(op.f('ix_approvals_transaction_id'), table_name='approvals')
    op.drop_index(op.f('ix_approvals_status'), table_name='approvals')
    op.drop_index(op.f('ix_approvals_session_id'), table_name='approvals')
    op.drop_index(op.f('ix_approvals_approval_id'), table_name='approvals')
    op.drop_table('approvals')
    op.drop_column('policies', 'require_human_approval')
    op.drop_column('policies', 'require_approval_above')
