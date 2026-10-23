"""Replace local park/campus reporting areas with the 25 Seoul gu polygons.

Revision: 2b8c341f902a
"""

from alembic import op, context
import sqlalchemy as sa

revision = "2b8c341f902a"
down_revision = "947f5a336531"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("zones", sa.Column("district_code", sa.String(5), nullable=True))
    op.add_column("zones", sa.Column("boundary", sa.JSON(), nullable=True))
    op.add_column("zones", sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.create_index("uq_zone_district_code", "zones", ["district_code"], unique=True)
    if context.is_offline_mode():
        # Offline SQL contains DDL only. app.cli init performs the same idempotent data conversion.
        return
    from app.district_setup import sync_seoul_districts

    sync_seoul_districts(op.get_bind())


def downgrade():
    # Polygon ids and report associations are preserved; no report, like, or points are removed.
    op.drop_index("uq_zone_district_code", table_name="zones")
    op.drop_column("zones", "active")
    op.drop_column("zones", "boundary")
    op.drop_column("zones", "district_code")
