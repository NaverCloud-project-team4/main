"""Record photo and location input methods, preserving provenance of older reports."""

from alembic import op
import sqlalchemy as sa

revision = "4a7d1c6e8f02"
down_revision = "2b8c341f902a"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("reports", sa.Column("photo_source", sa.String(16), nullable=False, server_default="legacy"))
    op.add_column("reports", sa.Column("location_source", sa.String(16), nullable=False, server_default="legacy"))


def downgrade():
    op.drop_column("reports", "location_source")
    op.drop_column("reports", "photo_source")
