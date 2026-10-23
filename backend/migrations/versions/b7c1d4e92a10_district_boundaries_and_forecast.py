"""구 경계, 예측 지점, 단계 출처

- zones: boundary(구 경계 GeoJSON) 추가, revision(구역 락용) 제거. radius_m은 프런트 확인 전까지 남긴다.
- zone_status: source(REPORT/FORECAST/NONE), peak_date 추가
- forecast_spots: 예측 지점 테이블 신규

Revision ID: b7c1d4e92a10
Revises: 947f5a336531
Create Date: 2026-10-24 00:00:00
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

revision = "b7c1d4e92a10"
down_revision = "947f5a336531"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("zones") as batch:
        batch.add_column(sa.Column("boundary", sa.Text().with_variant(mysql.MEDIUMTEXT(), "mysql"), nullable=True))
        batch.drop_column("revision")
    with op.batch_alter_table("zone_status") as batch:
        batch.add_column(sa.Column("source", sa.String(length=12), server_default="NONE", nullable=False))
        batch.add_column(sa.Column("peak_date", sa.Date(), nullable=True))
    op.create_table(
        "forecast_spots",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("season_id", sa.String(length=20), nullable=False),
        sa.Column("zone_id", sa.String(length=40), nullable=True),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("peak_date", sa.Date(), nullable=False),
        sa.Column("source", sa.String(length=100), nullable=False),
        sa.CheckConstraint("kind IN ('MOUNTAIN','GINKGO')", name="ck_spot_kind"),
        sa.ForeignKeyConstraint(["season_id"], ["seasons.id"]),
        sa.ForeignKeyConstraint(["zone_id"], ["zones.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("season_id", "name", name="uq_spot_name"),
    )
    op.create_index("ix_spot_zone", "forecast_spots", ["zone_id", "season_id"], unique=False)


def downgrade():
    op.drop_table("forecast_spots")  # 인덱스는 테이블과 함께 사라진다(MySQL은 외래키가 쓰는 인덱스를 따로 못 지운다)
    with op.batch_alter_table("zone_status") as batch:
        batch.drop_column("peak_date")
        batch.drop_column("source")
    with op.batch_alter_table("zones") as batch:
        batch.add_column(sa.Column("revision", sa.Integer(), server_default="0", nullable=False))
        batch.drop_column("boundary")
