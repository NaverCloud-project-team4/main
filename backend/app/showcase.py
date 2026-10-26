"""시연 데이터: 데모 계정 포인트, seed-showcase, reset-showcase.

산림청 예측(forecast_spots) 기반으로 인기 명소 주변에 승인 제보를 만들어 지도에 미리 보이게 한다.
- 관심도는 점수식(제보 2 + 제보자 3 + 좋아요)을 거꾸로 써서 구마다 목표 레벨에 정확히 맞춘다.
- 제보 단계는 명소의 예상 절정일과 예측 기준일로 정해 산림청 예측과 모순되지 않게 한다.
- 시연·리허설 데이터는 전용 이메일 접두사 계정으로만 만들고, reset은 그 계정의 데이터만 지운다.
실제 승인 로직(승인 1건 = report_points)과 스키마는 그대로 쓴다.
"""

import hashlib
import json
import math
import random
import secrets
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path

from sqlalchemy import delete, or_, select, update

from .config import ROOT, get_settings
from .foliage import interest_level, interest_score, stage_from_peak
from .geography import geometry_covers
from .models import (
    ForecastSpot,
    PointLedger,
    Report,
    ReportLike,
    ReportVerification,
    TreeEquipment,
    User,
    UserItem,
    VerificationJob,
    Zone,
    ZoneStatus,
    now,
    uid,
)
from .security import hash_password
from .services import current_season, decide_report, forecast_date, set_like
from .storage import get_storage, normalize_image

CONFIG = Path(__file__).resolve().parent / "data" / "showcase.json"
DEMO_EMAIL = "demo@example.com"
# 데모 계정이 큰나무(누적 500P)가 되고, 그 뒤에도 아이템 3~4개를 살 수 있게: 승인 20P × 26 = 520P.
DEMO_POINT_ROWS = 26
DEMO_REASON = "제보 승인"  # 기존 원장 사유를 그대로 쓴다
STAGE_TEXT = {"GREEN": "아직 초록빛이에요", "STARTING": "물들기 시작했어요", "PEAK": "지금 절정이에요", "FALLEN": "낙엽이 깔렸어요"}
NICKNAMES = ["산책하는 다람쥐", "은행잎 수집가", "단풍 마중", "가을 산책러", "골목 탐험가", "노을 사진사", "도토리 줍기", "바람 따라"]


def load_config(path: Path | None = None) -> dict:
    return json.loads((path or CONFIG).read_text(encoding="utf-8"))


# ---------- 데모 계정 포인트 ----------

def ensure_demo_points(db, email: str = DEMO_EMAIL) -> int:
    """데모 계정에 '제보 승인' 적립을 DEMO_POINT_ROWS건까지 채운다. 여러 번 실행해도 더 쌓이지 않는다."""
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        return 0
    amount = get_settings().report_points
    existing = set(db.scalars(select(PointLedger.dedupe_key).where(PointLedger.dedupe_key.like(f"demo-seed:{user.id}:%"))))
    added = 0
    for n in range(DEMO_POINT_ROWS):
        key = f"demo-seed:{user.id}:{n}"
        if key in existing:
            continue
        db.add(PointLedger(user_id=user.id, dedupe_key=key, amount=amount, reason=DEMO_REASON))
        added += amount
    if added:
        db.execute(update(User).where(User.id == user.id).values(points=User.points + added))
    db.flush()
    return added


# ---------- 관심도 계획 ----------

def reporters_for_level(level: int) -> tuple[int, int]:
    """목표 관심도 → (제보자 수, 좋아요 수). 제보자 1명당 제보 1건이므로 점수 = 5 × 제보자 + 좋아요."""
    if level <= 0:
        return 0, 0
    if level == 1:
        return 1, 0
    for reporters in range(1, 30):
        likes = 2 if level == 2 else 4
        if interest_level(interest_score(reporters, reporters, likes)) == level:
            return reporters, likes
    raise ValueError(f"unreachable interest level {level}")


@dataclass
class ZonePlan:
    """Plain values only, so plans outlive the session that read them."""
    zone_id: str
    level: int
    zone: dict  # name, latitude, longitude, boundary
    spot: dict | None  # name, latitude, longitude, peak_date, kind — 제보를 모을 명소(없으면 구 중심)


def plan_zones(db, config: dict, season_id: str | None) -> list[ZonePlan]:
    spots = {s.name: s for s in db.scalars(select(ForecastSpot).where(ForecastSpot.season_id == season_id))} if season_id else {}
    zones = {z.id: z for z in db.scalars(select(Zone).where(Zone.active.is_(True)))}
    zone_values = lambda z: {"name": z.name, "latitude": z.latitude, "longitude": z.longitude, "boundary": z.boundary}  # noqa: E731
    spot_values = lambda s: s and {"name": s.name, "latitude": s.latitude, "longitude": s.longitude, "peak_date": s.peak_date, "kind": s.kind}  # noqa: E731
    plans: dict[str, ZonePlan] = {}
    for entry in config["popularSpots"]:
        spot = spots.get(entry["spot"])
        if spot is None or spot.zone_id not in zones:
            raise ValueError(f"인기 명소를 forecast_spots에서 찾을 수 없습니다: {entry['spot']}")
        if spot.zone_id in plans:
            raise ValueError(f"같은 구({spot.zone_id})에 인기 명소가 둘 이상입니다: {entry['spot']}")
        if entry["level"] not in (2, 3):
            raise ValueError(f"인기 명소의 목표 관심도는 2~3이어야 합니다: {entry['spot']}")
        plans[spot.zone_id] = ZonePlan(spot.zone_id, entry["level"], zone_values(zones[spot.zone_id]), spot_values(spot))
    for zone_id in [*config.get("levelOneZones", []), *config.get("loadTestZones", [])]:
        if zone_id not in zones:
            raise ValueError(f"알 수 없는 구: {zone_id}")
        if zone_id in plans:
            raise ValueError(f"인기 명소가 있는 구를 관심도 1로 둘 수 없습니다: {zone_id}")
        first_spot = next((s for s in spots.values() if s.zone_id == zone_id), None)
        plans[zone_id] = ZonePlan(zone_id, 1, zone_values(zones[zone_id]), spot_values(first_spot))
    return list(plans.values())


# ---------- 계정·사진·위치 ----------

def account_email(config: dict, prefix_key: str, n: int) -> str:
    return f"{config[prefix_key]}{n:02d}@{config['emailDomain']}"


def is_showcase_email(config: dict, email: str) -> bool:
    local, _, domain = email.partition("@")
    return domain == config["emailDomain"] and (local.startswith(config["accountPrefix"]) or local.startswith(config["rehearsalPrefix"]))


def ensure_accounts(db, config: dict, count: int) -> list[str]:
    ids = []
    for n in range(1, count + 1):
        email = account_email(config, "accountPrefix", n)
        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            user = User(email=email, nickname=NICKNAMES[(n - 1) % len(NICKNAMES)], password_hash=hash_password(secrets.token_urlsafe(24)))
            db.add(user)
            db.flush()
        ids.append(user.id)
    return ids


def photo_files(config: dict) -> dict[str, list[Path]]:
    """species → 사진 목록. 폴더가 비어 있으면 레포의 샘플 사진을 쓴다."""
    base = ROOT / config["photosDir"]
    found = {}
    for species, folder, fallback in (("GINKGO", "ginkgo", "sample-ginkgo.png"), ("MAPLE", "maple", "sample-maple.png")):
        files = sorted(p for p in (base / folder).glob("*") if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"})
        found[species] = files or [ROOT / "assets" / fallback]
    return found


def nearby_point(zone: dict, lat: float, lng: float, meters: float, rng: random.Random) -> tuple[float, float]:
    """명소 반경 안, 그 명소가 있는 구 경계 안의 점."""
    for _ in range(40):
        r = meters * math.sqrt(rng.random())
        a = rng.random() * math.tau
        point = (lat + r * math.cos(a) / 111_320, lng + r * math.sin(a) / (111_320 * math.cos(math.radians(lat))))
        if geometry_covers(zone["boundary"], *point):
            return point
    return (lat, lng) if geometry_covers(zone["boundary"], lat, lng) else (zone["latitude"], zone["longitude"])


# ---------- seed / reset ----------

def guard(confirm: bool):
    if get_settings().environment == "production" and not confirm:
        raise SystemExit("운영 환경에서는 --confirm을 붙여야 시연 데이터를 바꿀 수 있습니다.")


def reset_showcase(session_factory, config: dict | None = None, confirm: bool = False) -> dict:
    """시연(showcase-)·리허설(rehearsal-) 계정과 그 데이터만 지운다. 다른 사용자의 데이터는 건드리지 않는다."""
    guard(confirm)
    config = config or load_config()
    storage = get_storage()
    with session_factory.begin() as db:
        users = [u for u in db.scalars(select(User).where(User.email.like(f"%@{config['emailDomain']}"))) if is_showcase_email(config, u.email)]
        user_ids = [u.id for u in users]
        if not user_ids:
            return {"users": 0, "reports": 0}
        reports = list(db.execute(select(Report.id, Report.object_key).where(Report.user_id.in_(user_ids))))
        report_ids = [r.id for r in reports]
        # 이 계정들이 다른 사람 제보에 누른 좋아요는 그 제보의 좋아요 수에서 빼고 지운다.
        for (report_id,) in db.execute(
            select(ReportLike.report_id).where(ReportLike.user_id.in_(user_ids), ReportLike.report_id.not_in(report_ids or [""]))
        ):
            db.execute(update(Report).where(Report.id == report_id, Report.like_count > 0).values(like_count=Report.like_count - 1))
        if report_ids:
            db.execute(update(ZoneStatus).where(ZoneStatus.latest_report_id.in_(report_ids)).values(latest_report_id=None))
        db.execute(delete(ReportLike).where(or_(ReportLike.user_id.in_(user_ids), ReportLike.report_id.in_(report_ids or [""]))))
        db.execute(delete(ReportVerification).where(ReportVerification.report_id.in_(report_ids or [""])))
        db.execute(update(ReportVerification).where(ReportVerification.reviewer_id.in_(user_ids)).values(reviewer_id=None))
        db.execute(delete(VerificationJob).where(VerificationJob.report_id.in_(report_ids or [""])))
        db.execute(delete(PointLedger).where(or_(PointLedger.user_id.in_(user_ids), PointLedger.report_id.in_(report_ids or [""]))))
        db.execute(delete(UserItem).where(UserItem.user_id.in_(user_ids)))
        db.execute(delete(TreeEquipment).where(TreeEquipment.user_id.in_(user_ids)))
        db.execute(delete(Report).where(Report.id.in_(report_ids or [""])))
        db.execute(delete(User).where(User.id.in_(user_ids)))
    for report in reports:  # 사진은 DB에서 지운 뒤 정리한다(실패해도 데이터는 이미 정리됨)
        try:
            storage.delete(report.object_key)
        except Exception:  # noqa: BLE001 - 남은 사진은 다음 reset에서도 영향 없음
            pass
    return {"users": len(user_ids), "reports": len(reports)}


def seed_showcase(session_factory, config: dict | None = None, confirm: bool = False, seed: int | None = None) -> dict:
    """기존 시연 데이터를 지우고 실행 시점 기준으로 다시 만든다(발표 직전에 다시 돌려도 시간이 맞음)."""
    guard(confirm)
    config = config or load_config()
    reset_showcase(session_factory, config, confirm=True)
    rng = random.Random(seed)
    storage = get_storage()
    photos = photo_files(config)
    photo_turn = {species: 0 for species in photos}
    t = now()
    today = forecast_date(t)
    low, high = config["hoursAgo"]
    with session_factory.begin() as db:
        season = current_season(db, t)
        if season is None:
            raise SystemExit("현재 시즌이 없습니다. 먼저 'python -m app.cli init'을 실행하세요.")
        plans = plan_zones(db, config, season.id)
        user_ids = ensure_accounts(db, config, max(reporters_for_level(p.level)[0] for p in plans))
        demo_points = ensure_demo_points(db)
    created, liked = [], 0
    for plan in plans:
        reporters, likes = reporters_for_level(plan.level)
        zone, spot = plan.zone, plan.spot
        base = (spot["latitude"], spot["longitude"]) if spot else (zone["latitude"], zone["longitude"])
        stage = stage_from_peak(today, spot["peak_date"]) if spot else "PEAK"
        species = "GINKGO" if spot and spot["kind"] == "GINKGO" else "MAPLE"
        zone_reports = []
        for n in range(reporters):
            lat, lng = nearby_point(zone, *base, config["spreadMeters"], rng)
            files = photos[species]
            data = normalize_image(files[photo_turn[species] % len(files)].read_bytes())
            photo_turn[species] += 1
            report_id = uid()
            key = f"reports/{report_id}.jpg"
            storage.put(key, data)
            created_at = t - timedelta(hours=rng.uniform(low, high))
            place = spot["name"] if spot else zone["name"]
            with session_factory.begin() as db:
                db.add(Report(
                    id=report_id, user_id=user_ids[n], zone_id=plan.zone_id, season_id=season.id, stage=stage, species=species,
                    description=f"{place} · {STAGE_TEXT[stage]}", latitude=lat, longitude=lng, object_key=key,
                    photo_source="camera", location_source="current", photo_hash=hashlib.sha256(data).hexdigest(),
                    request_key=f"showcase:{plan.zone_id}:{n}", request_fingerprint="showcase", created_at=created_at,
                ))
                db.flush()
                decide_report(db, report_id, "APPROVED", "시연용 데이터입니다. 실제 AI 판별 아님.")
                db.add(ReportVerification(report_id=report_id, model="showcase-no-ai", prompt_version="showcase-v1", decision="APPROVED", reason="시연 데이터"))
                db.execute(update(Report).where(Report.id == report_id).values(approved_at=created_at))
            zone_reports.append(report_id)
            created.append(report_id)
        # 좋아요는 같은 구의 다른 시연 계정이 누른다(자기 제보 제외). set_like가 스스로 commit한다.
        with session_factory() as db:
            for k in range(likes):
                report_id = zone_reports[k % len(zone_reports)]
                liker = user_ids[(k + 1) % len(user_ids)]
                if liker != user_ids[zone_reports.index(report_id)]:
                    set_like(db, report_id, liker, True)
                    liked += 1
    return {"zones": {p.zone_id: p.level for p in plans}, "reports": len(created), "likes": liked, "accounts": len(user_ids),
            "demo_points_added": demo_points, "forecast_date": today.isoformat()}
