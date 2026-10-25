from collections import defaultdict
from datetime import date, datetime, timedelta
from math import asin, cos, radians, sin, sqrt
from fastapi import HTTPException
from sqlalchemy import delete, select, update, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .geography import geometry_covers
from .config import get_settings
from .foliage import STAGES, interest_level, interest_score, kst_today, stage_from_peak, resolve_zone as resolve_foliage  # noqa: F401
from .models import (
    ForecastSpot,
    Report,
    ReportLike,
    PointLedger,
    Season,
    User,
    Zone,
    ZoneStatus,
    ZoneActivity,
    now,
)

PENDING = ("PENDING_UPLOAD", "PENDING_AI")
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


def iso(t):
    return t.isoformat(timespec="milliseconds") + "Z" if t else None


def current_season(db: Session, at: datetime | None = None):
    t = at or now()
    return db.scalar(
        select(Season).where(Season.starts_at <= t, Season.ends_at > t).order_by(Season.starts_at.desc()).limit(1)
    )


def forecast_date(at: datetime | None = None) -> date:
    """예측 단계 계산에 쓰는 '오늘'. FORECAST_TODAY가 있으면 그 날짜(시연용), 없으면 한국 날짜."""
    return get_settings().forecast_today or kst_today(at or now())


def aggregate_zones(db: Session, now_utc: datetime | None = None, forecast_today: date | None = None) -> dict:
    """구별 단계(제보 우선, 부족하면 예측)와 관심도를 계산해 zone_status, zone_activity에 쓴다.

    승인·좋아요 때마다 부르지 않고 1분 주기 집계(POST /api/internal/aggregate)에서만 호출한다.
    호출하는 쪽이 commit한다.
    """
    s = get_settings()
    t = now_utc or now()
    today = forecast_today or forecast_date(t)
    activity_cutoff = t - timedelta(days=s.activity_days)
    stage_cutoff = t - timedelta(days=s.stage_window_days)
    season = current_season(db, t)

    counts = {
        zone_id: (int(reports), int(people), int(likes))
        for zone_id, reports, people, likes in db.execute(
            select(
                Report.zone_id,
                func.count(Report.id),
                func.count(func.distinct(Report.user_id)),
                func.coalesce(func.sum(Report.like_count), 0),
            )
            .where(Report.status == "APPROVED", Report.created_at >= activity_cutoff)
            .group_by(Report.zone_id)
        )
    }
    spot_query = select(ForecastSpot.zone_id, ForecastSpot.peak_date).where(ForecastSpot.zone_id.is_not(None))
    if season is not None:
        spot_query = spot_query.where(ForecastSpot.season_id == season.id)
    spot_dates = defaultdict(list)
    for zone_id, peak in db.execute(spot_query):
        spot_dates[zone_id].append(peak)

    total = 0
    by_source = defaultdict(int)
    for zone in db.scalars(select(Zone).where(Zone.active.is_(True)).order_by(Zone.id)):
        recent = db.execute(
            select(Report.stage, Report.created_at)
            .where(Report.zone_id == zone.id, Report.status == "APPROVED", Report.created_at >= stage_cutoff)
            .order_by(Report.created_at.desc(), Report.id.desc())
            .limit(s.stage_vote_size)
        ).all()
        result = resolve_foliage(
            reports=[(row.stage, row.created_at) for row in recent],
            spot_dates=spot_dates.get(zone.id, []),
            now=t,
            today=today,
            default_peak=s.forecast_default_peak,
            window_days=s.stage_window_days,
            vote_size=s.stage_vote_size,
            min_reports=s.stage_min_reports,
        )
        latest_id = db.scalar(
            select(Report.id)
            .where(Report.zone_id == zone.id, Report.status == "APPROVED", Report.created_at >= activity_cutoff)
            .order_by(Report.created_at.desc(), Report.id.desc())
            .limit(1)
        )
        report_count, reporter_count, like_count = counts.get(zone.id, (0, 0, 0))
        score = interest_score(report_count, reporter_count, like_count)
        status_values = {
            "stage": result.stage,
            "source": result.source,
            "peak_date": result.peak_date,
            "latest_report_id": latest_id,
            "updated_at": t,
        }
        activity_values = {
            "report_count": report_count,
            "reporter_count": reporter_count,
            "like_count": like_count,
            "score": score,
            "tree_level": interest_level(score),
            "updated_at": t,
        }
        if db.get(ZoneStatus, zone.id) is None:
            db.add(ZoneStatus(zone_id=zone.id, **status_values))
        else:
            db.execute(update(ZoneStatus).where(ZoneStatus.zone_id == zone.id).values(**status_values))
        if db.get(ZoneActivity, zone.id) is None:
            db.add(ZoneActivity(zone_id=zone.id, **activity_values))
        else:
            db.execute(update(ZoneActivity).where(ZoneActivity.zone_id == zone.id).values(**activity_values))
        total += 1
        by_source[result.source] += 1
    db.flush()
    return {
        "zones": total,
        "by_source": dict(by_source),
        "season": season.id if season else None,
        "forecast_date": today.isoformat(),
        "generated_at": iso(t),
    }


def dominant_species(db: Session, since: datetime) -> dict[str, str]:
    """구별 최근 승인 제보의 우세 수종. MIXED는 세지 않고, 동률이거나 제보가 없으면 MAPLE."""
    counts = defaultdict(lambda: {"MAPLE": 0, "GINKGO": 0})
    for zone_id, species, n in db.execute(
        select(Report.zone_id, Report.species, func.count(Report.id))
        .where(Report.status == "APPROVED", Report.created_at >= since, Report.species.in_(("MAPLE", "GINKGO")))
        .group_by(Report.zone_id, Report.species)
    ):
        counts[zone_id][species] = n
    return {zone_id: "GINKGO" if c["GINKGO"] > c["MAPLE"] else "MAPLE" for zone_id, c in counts.items()}


def forecast_spot_list(db: Session, zone_id: str | None = None) -> list[dict]:
    """현재 시즌의 예측 명소. 단계는 예측 기준일과 지점별 예상 절정일로 계산한다."""
    t = now()
    today = forecast_date(t)
    season = current_season(db, t)
    q = select(ForecastSpot).order_by(ForecastSpot.peak_date, ForecastSpot.name)
    if season is not None:
        q = q.where(ForecastSpot.season_id == season.id)
    if zone_id:
        q = q.where(ForecastSpot.zone_id == zone_id)
    return [
        {
            "id": spot.id,
            "zone_id": spot.zone_id,
            "name": spot.name,
            "kind": spot.kind,
            "latitude": spot.latitude,
            "longitude": spot.longitude,
            "peak_date": spot.peak_date.isoformat(),
            "stage": stage_from_peak(today, spot.peak_date),
            "source": spot.source,
        }
        for spot in db.scalars(q)
    ]


def zone_summaries(db: Session, bounds=None, legacy_radius=False) -> list[dict]:
    """구역 목록(단계, 출처, 관심도). /api/zones 응답과 지도 JSON이 같은 필드를 쓴다."""
    species = dominant_species(db, now() - timedelta(days=get_settings().activity_days))
    q = select(Zone, ZoneStatus, ZoneActivity).join(ZoneStatus).join(ZoneActivity).where(Zone.active.is_(True))
    if bounds is not None:
        min_lat, max_lat, min_lng, max_lng = bounds
        q = q.where(Zone.latitude.between(min_lat, max_lat), Zone.longitude.between(min_lng, max_lng))
    rows = []
    for z, st, a in db.execute(q.order_by(Zone.name)):
        row = {
            "id": z.id,
            "name": z.name,
            "latitude": z.latitude,
            "longitude": z.longitude,
            "district_code": z.district_code,
            "stage": st.stage,
            "source": st.source,
            "peak_date": st.peak_date.isoformat() if st.peak_date else None,
            "latest_report_id": st.latest_report_id,
            "report_count": a.report_count,
            "reporter_count": a.reporter_count,
            "like_count": a.like_count,
            "interest_score": a.score,
            "tree_level": a.tree_level,
            "dominant_species": species.get(z.id, "MAPLE"),
            "updated_at": iso(a.updated_at),
        }
        if legacy_radius:
            row["radius_m"] = z.radius_m  # 프런트가 아직 쓰는지 확인되면 제거
        rows.append(row)
    return rows


def map_document(db: Session) -> dict:
    t = now()
    season = current_season(db, t)
    return {
        "generated_at": iso(t),
        "season": season.id if season else None,
        "forecast_date": forecast_date(t).isoformat(),
        "zones": zone_summaries(db),
    }


def decide_report(db: Session, report_id: str, decision: str, reason: str, allowed=PENDING) -> bool:
    """제보 상태를 정하고 승인이면 포인트를 적립한다. 지도 집계는 1분 주기 집계가 맡는다."""
    report = db.get(Report, report_id)
    if report is None:
        return False
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
    return True


def set_like(db: Session, report_id: str, user_id: str, liked: bool):
    """좋아요 추가·취소. 같은 요청이 동시에 와도 한 번만 반영한다(PK와 삭제 행 수로 판정)."""
    report = db.get(Report, report_id)
    if report is None:
        raise HTTPException(404, "제보를 찾을 수 없습니다.")
    if report.status != "APPROVED":
        raise HTTPException(404, "공개된 제보가 아닙니다.")
    if liked:
        try:
            with db.begin_nested():
                db.add(ReportLike(report_id=report_id, user_id=user_id))
                db.flush()
        except IntegrityError:
            pass  # 다른 요청이 먼저 좋아요를 눌렀다
        else:
            db.execute(update(Report).where(Report.id == report_id).values(like_count=Report.like_count + 1))
    else:
        deleted = db.execute(
            delete(ReportLike).where(ReportLike.report_id == report_id, ReportLike.user_id == user_id)
        ).rowcount
        if deleted:
            db.execute(update(Report).where(Report.id == report_id).values(like_count=Report.like_count - 1))
    db.commit()
    db.refresh(report)
    return {"liked": liked, "like_count": report.like_count}
