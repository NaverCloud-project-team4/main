import uuid
from datetime import date, datetime, timezone
from sqlalchemy import String, Integer, Float, DateTime, ForeignKey, UniqueConstraint, CheckConstraint, Index, JSON, Boolean, Date
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base


def now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def uid():
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    nickname: Mapped[str] = mapped_column(String(30))
    password_hash: Mapped[str] = mapped_column(String(256))
    role: Mapped[str] = mapped_column(String(16), default="user")
    points: Mapped[int] = mapped_column(default=0)
    last_report_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(default=now)
    __table_args__ = (CheckConstraint("points >= 0", name="ck_user_points"),)


class Season(Base):
    __tablename__ = "seasons"
    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    starts_at: Mapped[datetime] = mapped_column(DateTime)
    ends_at: Mapped[datetime] = mapped_column(DateTime)


class Zone(Base):
    __tablename__ = "zones"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    # Legacy radius retained for old rows; active districts use boundary polygons.
    radius_m: Mapped[int] = mapped_column(default=1500)
    district_code: Mapped[str | None] = mapped_column(String(5))
    boundary: Mapped[dict | None] = mapped_column(JSON)
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    __table_args__ = (Index("uq_zone_district_code", "district_code", unique=True),)


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    zone_id: Mapped[str] = mapped_column(ForeignKey("zones.id"))
    season_id: Mapped[str] = mapped_column(ForeignKey("seasons.id"))
    status: Mapped[str] = mapped_column(String(24), default="PENDING_UPLOAD")
    stage: Mapped[str] = mapped_column(String(16))
    species: Mapped[str] = mapped_column(String(16))
    description: Mapped[str] = mapped_column(String(1000), default="")
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    object_key: Mapped[str] = mapped_column(String(255), unique=True)
    photo_source: Mapped[str] = mapped_column(String(16), default="legacy", server_default="legacy")
    location_source: Mapped[str] = mapped_column(String(16), default="legacy", server_default="legacy")
    photo_hash: Mapped[str] = mapped_column(String(64))
    request_key: Mapped[str] = mapped_column(String(100))
    request_fingerprint: Mapped[str] = mapped_column(String(64))
    demo_outcome: Mapped[str | None] = mapped_column(String(16))
    reason: Mapped[str | None] = mapped_column(String(500))
    like_count: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(default=now)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime)
    __table_args__ = (
        UniqueConstraint("user_id", "request_key", name="uq_report_request"),
        CheckConstraint("like_count >= 0", name="ck_report_likes"),
        CheckConstraint(
            "status IN ('PENDING_UPLOAD','PENDING_AI','APPROVED','REVIEW','REJECTED','UPLOAD_FAILED')",
            name="ck_report_status",
        ),
        Index("ix_report_feed", "status", "created_at", "id"),
        Index("ix_report_popular", "status", "like_count", "id"),
        Index("ix_report_zone", "zone_id", "status", "created_at"),
        Index("ix_report_user", "user_id", "created_at"),
    )


class VerificationJob(Base):
    __tablename__ = "verification_jobs"
    report_id: Mapped[str] = mapped_column(ForeignKey("reports.id"), primary_key=True)
    state: Mapped[str] = mapped_column(String(20), default="WAIT_UPLOAD")
    attempts: Mapped[int] = mapped_column(default=0)
    lease_token: Mapped[str | None] = mapped_column(String(36))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime)
    next_attempt_at: Mapped[datetime] = mapped_column(default=now)
    last_error: Mapped[str | None] = mapped_column(String(500))
    __table_args__ = (Index("ix_job_due", "state", "next_attempt_at"),)


class ReportVerification(Base):
    __tablename__ = "report_verifications"
    report_id: Mapped[str] = mapped_column(ForeignKey("reports.id"), primary_key=True)
    model: Mapped[str] = mapped_column(String(60))
    prompt_version: Mapped[str] = mapped_column(String(30))
    decision: Mapped[str] = mapped_column(String(16))
    reason: Mapped[str] = mapped_column(String(500))
    verified_at: Mapped[datetime] = mapped_column(default=now)
    reviewer_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime)
    review_reason: Mapped[str | None] = mapped_column(String(500))


class ReportLike(Base):
    __tablename__ = "report_likes"
    report_id: Mapped[str] = mapped_column(ForeignKey("reports.id"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(default=now)


class ZoneStatus(Base):
    __tablename__ = "zone_status"
    zone_id: Mapped[str] = mapped_column(ForeignKey("zones.id"), primary_key=True)
    stage: Mapped[str] = mapped_column(String(16), default="UNKNOWN")
    source: Mapped[str] = mapped_column(String(12), default="NONE", server_default="NONE")
    peak_date: Mapped[date | None] = mapped_column(Date)
    latest_report_id: Mapped[str | None] = mapped_column(ForeignKey("reports.id"))
    updated_at: Mapped[datetime] = mapped_column(default=now)


class ForecastSpot(Base):
    __tablename__ = "forecast_spots"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    season_id: Mapped[str] = mapped_column(ForeignKey("seasons.id"))
    zone_id: Mapped[str | None] = mapped_column(ForeignKey("zones.id"))
    name: Mapped[str] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(16))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    peak_date: Mapped[date] = mapped_column(Date)
    source: Mapped[str] = mapped_column(String(100))
    __table_args__ = (
        UniqueConstraint("season_id", "name", name="uq_spot_name"),
        CheckConstraint("kind IN ('MOUNTAIN','GINKGO')", name="ck_spot_kind"),
        Index("ix_spot_zone", "zone_id", "season_id"),
    )


class ZoneActivity(Base):
    __tablename__ = "zone_activity"
    zone_id: Mapped[str] = mapped_column(ForeignKey("zones.id"), primary_key=True)
    report_count: Mapped[int] = mapped_column(default=0)
    reporter_count: Mapped[int] = mapped_column(default=0)
    like_count: Mapped[int] = mapped_column(default=0)
    score: Mapped[int] = mapped_column(default=0)
    tree_level: Mapped[int] = mapped_column(default=0)
    updated_at: Mapped[datetime] = mapped_column(default=now)


class PointLedger(Base):
    __tablename__ = "point_ledger"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    report_id: Mapped[str | None] = mapped_column(ForeignKey("reports.id"))
    dedupe_key: Mapped[str] = mapped_column(String(140), unique=True)
    amount: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(default=now)


class Item(Base):
    __tablename__ = "items"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    price: Mapped[int] = mapped_column(Integer)
    slot: Mapped[str] = mapped_column(String(30))
    icon: Mapped[str] = mapped_column(String(20))
    __table_args__ = (CheckConstraint("price >= 0", name="ck_item_price"),)


class UserItem(Base):
    __tablename__ = "user_items"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    item_id: Mapped[str] = mapped_column(ForeignKey("items.id"), primary_key=True)
    purchased_at: Mapped[datetime] = mapped_column(default=now)


class TreeEquipment(Base):
    __tablename__ = "tree_equipment"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    slot: Mapped[str] = mapped_column(String(30), primary_key=True)
    item_id: Mapped[str] = mapped_column(ForeignKey("items.id"))
