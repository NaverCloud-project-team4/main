"""Unify both deployed migration branches and map reports/spots to main's district IDs.

Keep all reports, likes, verification history and point ledger entries.
"""
from alembic import context, op

revision = "8d5e29c410b7"
down_revision = ("4a7d1c6e8f02", "b7c1d4e92a10")
branch_labels = None
depends_on = None


def upgrade():
    if not context.is_offline_mode():
        from app.district_setup import sync_seoul_districts
        sync_seoul_districts(op.get_bind())


def downgrade():
    # Data/foreign keys retain canonical IDs. Both parent schemas support them.
    pass
