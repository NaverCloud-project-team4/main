from datetime import timedelta
from math import asin, cos, radians, sin, sqrt
from fastapi import HTTPException
from sqlalchemy import select, update, func
from sqlalchemy.orm import Session
from .geography import geometry_covers
from .config import get_settings
from .models import Report, ReportLike, PointLedger, User, Zone, ZoneStatus, ZoneActivity, now

PENDING = ("PENDING_UPLOAD", "PENDING_AI")
STAGES = ("GREEN", "STARTING", "PEAK", "FALLEN")
SPECIES = ("MAPLE", "GINKGO", "MIXED")


def distance_m(lat1, lng1, lat2, lng2):
    a = (
        sin(radians(lat2 - lat1) / 2) ** 2
        + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ** 2
    )
    return 6_371_000 * 2 * asin(min(1, sqrt(a)))


def resolve_zone(db: Session, latitude: float, longitude: float):
    """Resolve an active administrative district using its actual polygon."""
    for zone in db.scalars(select(Zone).where(Zone.active.is_(True)).order_by(Zone.id)):
        if geometry_covers(zone.boundary, latitude, longitude):
            return zone, distance_m(latitude, longitude, zone.latitude, zone.longitude)
    return None


def lock_zone(db: Session, zone_id: str):
    # Serializes approvals and likes per zone so cached aggregates cannot lose updates.
    db.execute(update(Zone).where(Zone.id == zone_id).values(revision=Zone.revision + 1))


def refresh_zone(db: Session, zone_id: str):
    cutoff = now() - timedelta(days=get_settings().activity_days)
    where = (Report.zone_id == zone_id, Report.status == "APPROVED", Report.created_at >= cutoff)
    counts = db.execute(
        select(
            func.count(Report.id),
            func.count(func.distinct(Report.user_id)),
            func.coalesce(func.sum(Report.like_count), 0),
        ).where(*where)
    ).one()
    latest = db.scalar(select(Report).where(*where).order_by(Report.created_at.desc(), Report.id.desc()).limit(1))
    count, people, likes = map(int, counts)
    score = count * 2 + people * 3 + likes
    level = 3 if score >= 40 else 2 if score >= 15 else 1 if score > 0 else 0
    db.execute(
        update(ZoneActivity)
        .where(ZoneActivity.zone_id == zone_id)
        .values(
            report_count=count, reporter_count=people, like_count=likes, score=score, tree_level=level, updated_at=now()
        )
    )
    db.execute(
        update(ZoneStatus)
        .where(ZoneStatus.zone_id == zone_id)
        .values(
            stage=latest.stage if latest else "UNKNOWN",
            latest_report_id=latest.id if latest else None,
            updated_at=now(),
        )
    )


def decide_report(db: Session, report_id: str, decision: str, reason: str, allowed=PENDING) -> bool:
    report = db.get(Report, report_id)
    if report is None:
        return False
    lock_zone(db, report.zone_id)
    changed = db.execute(
        update(Report)
        .where(Report.id == report_id, Report.status.in_(allowed))
        .values(status=decision, reason=reason[:500], approved_at=now() if decision == "APPROVED" else None)
    ).rowcount
    if not changed:
        return False
    if decision == "APPROVED":
        amount = get_settings().report_points
        db.add(
            PointLedger(
                user_id=report.user_id,
                report_id=report_id,
                dedupe_key=f"report:{report_id}:approved",
                amount=amount,
                reason="제보 승인",
            )
        )
        db.execute(update(User).where(User.id == report.user_id).values(points=User.points + amount))
    db.flush()
    refresh_zone(db, report.zone_id)
    return True


def set_like(db: Session, report_id: str, user_id: str, liked: bool):
    report = db.get(Report, report_id)
    if report is None:
        raise HTTPException(404, "제보를 찾을 수 없습니다.")
    lock_zone(db, report.zone_id)
    db.refresh(report)
    if report.status != "APPROVED":
        raise HTTPException(404, "공개된 제보가 아닙니다.")
    existing = db.get(ReportLike, (report_id, user_id))
    if liked and existing is None:
        db.add(ReportLike(report_id=report_id, user_id=user_id))
        db.execute(update(Report).where(Report.id == report_id).values(like_count=Report.like_count + 1))
    elif not liked and existing is not None:
        db.delete(existing)
        db.execute(update(Report).where(Report.id == report_id).values(like_count=Report.like_count - 1))
    db.flush()
    refresh_zone(db, report.zone_id)
    db.commit()
    db.refresh(report)
    return {"liked": liked, "like_count": report.like_count}
