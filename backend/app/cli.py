import argparse
import csv
import json
from datetime import date, datetime
from pathlib import Path
from alembic import command
from alembic.config import Config
from sqlalchemy import delete, select
from .aggregate import run_aggregation
from .config import get_settings, ROOT
from .db import SessionLocal
from .geo import build_shape, clear_zone_cache, find_in_shapes
from .models import (
    User,
    Season,
    Zone,
    ZoneStatus,
    ZoneActivity,
    ForecastSpot,
    Item,
    Report,
    ReportVerification,
    uid,
    now,
)
from .security import hash_password
from .storage import get_storage, normalize_image
from .services import aggregate_zones, decide_report

DATA = Path(__file__).resolve().parent / "data"

ITEMS = [
    ("ribbon", "가을 리본", 30, "decoration", "🎀"),
    ("star", "반짝이는 별", 50, "decoration", "⭐"),
    ("mushroom", "작은 버섯", 20, "ground", "🍄"),
]


def load_districts():
    with open(DATA / "zones_seoul25.geojson", encoding="utf-8") as f:
        return json.load(f)["features"]


def seed_districts(db):
    """서울 25개 구와 경계를 넣는다. 이미 있으면 이름·대표점·경계만 갱신한다(재실행 안전)."""
    for feature in load_districts():
        zid = feature["id"]
        lng, lat = feature["properties"]["marker"]
        boundary = json.dumps(feature["geometry"], separators=(",", ":"))
        zone = db.get(Zone, zid)
        if zone is None:
            db.add(Zone(id=zid, name=feature["properties"]["name"], latitude=lat, longitude=lng, boundary=boundary))
            db.flush()
            db.add(ZoneStatus(zone_id=zid))
            db.add(ZoneActivity(zone_id=zid))
        else:
            zone.name = feature["properties"]["name"]
            zone.latitude, zone.longitude, zone.boundary = lat, lng, boundary
    db.flush()
    clear_zone_cache()


def remove_legacy_zones(db):
    """예전 샘플 구역(경계 없음)을 제보가 없을 때만 지운다."""
    keep = {f["id"] for f in load_districts()}
    for zone in list(db.scalars(select(Zone).where(Zone.boundary.is_(None)))):
        if zone.id in keep:
            continue
        if db.scalar(select(Report.id).where(Report.zone_id == zone.id).limit(1)):
            print(f"Legacy zone {zone.id} has reports; kept.")
            continue
        db.execute(delete(ForecastSpot).where(ForecastSpot.zone_id == zone.id))
        db.execute(delete(ZoneStatus).where(ZoneStatus.zone_id == zone.id))
        db.execute(delete(ZoneActivity).where(ZoneActivity.zone_id == zone.id))
        db.delete(zone)
        print(f"Legacy zone {zone.id} removed.")
    db.flush()


def seed_forecast_spots(db, season_id):
    """예측 지점 25곳을 넣는다. 구는 좌표로 판정하고 CSV의 구와 다르면 경고한다. 재실행하면 값을 갱신한다."""
    shapes = [build_shape(f["id"], f["geometry"]) for f in load_districts()]
    names = {f["id"]: f["properties"]["name"] for f in load_districts()}
    with open(DATA / "forecast_spots.csv", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            lat, lng = float(row["lat"]), float(row["lng"])
            zone_id = find_in_shapes(shapes, lat, lng)
            expected = row.get("구(경계 파일 판정)")
            if zone_id is None or (expected and names[zone_id] != expected):
                print(f"Spot {row['name']}: zone mismatch (found {zone_id}, csv {expected}).")
            spot = db.scalar(select(ForecastSpot).where(ForecastSpot.season_id == season_id, ForecastSpot.name == row["name"]))
            values = {
                "zone_id": zone_id,
                "kind": row["kind"],
                "latitude": lat,
                "longitude": lng,
                "peak_date": date.fromisoformat(row["peak_date"]),
                "source": row["source"],
            }
            if spot is None:
                db.add(ForecastSpot(season_id=season_id, name=row["name"], **values))
            else:
                for key, value in values.items():
                    setattr(spot, key, value)
    db.flush()


def initialize(demo=False):
    s = get_settings()
    if demo and s.environment != "local":
        raise ValueError("Demo accounts are only allowed in local environment")
    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(cfg, "head")
    year = now().year
    with SessionLocal.begin() as db:
        if not db.get(Season, str(year)):
            db.add(
                Season(
                    id=str(year), name=f"{year} 가을", starts_at=datetime(year, 1, 1), ends_at=datetime(year + 1, 1, 1)
                )
            )
        db.flush()
        seed_districts(db)
        seed_forecast_spots(db, str(year))
        remove_legacy_zones(db)
        for iid, name, price, slot, icon in ITEMS:
            if not db.get(Item, iid):
                db.add(Item(id=iid, name=name, price=price, slot=slot, icon=icon))
        if demo:
            for email, nickname, role, password in [
                ("demo@example.com", "단풍지기", "user", "DemoPass123!"),
                ("admin@example.com", "운영자", "admin", "AdminPass123!"),
            ]:
                if not db.scalar(select(User).where(User.email == email)):
                    db.add(User(email=email, nickname=nickname, role=role, password_hash=hash_password(password)))
    if demo:
        seed_reports(str(year))
    with SessionLocal.begin() as db:
        aggregate_zones(db)  # 첫 크론 전에도 지도에 예측 단계가 보이게 한다
    print(
        "Database migrated and seeded."
        + (" Local demo: demo@example.com / DemoPass123!; admin@example.com / AdminPass123!" if demo else "")
    )


def seed_reports(season_id):
    with SessionLocal() as db:
        user_id = db.scalar(select(User.id).where(User.email == "demo@example.com"))
    for zone_id, asset, species, description in [
        ("dongdaemun", "sample-ginkgo.png", "GINKGO", "샘플 제보 · 동대문구 은행나무가 노랗게 물들었어요."),
        ("seongdong", "sample-maple.png", "MAPLE", "샘플 제보 · 서울숲 산책길의 가을 풍경이에요."),
    ]:
        with SessionLocal() as db:
            if db.scalar(select(Report.id).where(Report.user_id == user_id, Report.request_key == f"seed:{zone_id}")):
                continue
            zone = db.get(Zone, zone_id)
            lat, lng = zone.latitude, zone.longitude
        data = normalize_image((ROOT / "assets" / asset).read_bytes())
        report_id = uid()
        key = f"reports/{report_id}.jpg"
        get_storage().put(key, data)
        with SessionLocal.begin() as db:
            import hashlib

            db.add(
                Report(
                    id=report_id,
                    user_id=user_id,
                    zone_id=zone_id,
                    season_id=season_id,
                    stage="PEAK",
                    species=species,
                    latitude=lat,
                    longitude=lng,
                    description=description,
                    object_key=key,
                    photo_hash=hashlib.sha256(data).hexdigest(),
                    request_key=f"seed:{zone_id}",
                    request_fingerprint="seed",
                )
            )
            db.flush()
            decide_report(db, report_id, "APPROVED", "로컬 화면 확인용 샘플 제보입니다. 실제 AI 판별 아님.")
            db.add(
                ReportVerification(
                    report_id=report_id,
                    model="seed-no-ai",
                    prompt_version="seed-v1",
                    decision="APPROVED",
                    reason="테스트 데이터",
                )
            )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["init", "promote-admin", "aggregate"])
    parser.add_argument("--demo", action="store_true")
    parser.add_argument("--email")
    args = parser.parse_args()
    if args.action == "init":
        initialize(args.demo)
    elif args.action == "aggregate":
        print(run_aggregation())
    elif not args.email:
        parser.error("--email is required")
    else:
        with SessionLocal.begin() as db:
            user = db.scalar(select(User).where(User.email == args.email.lower()))
            if not user:
                raise SystemExit("User not found; register first")
            user.role = "admin"
        print("Admin role granted.")


if __name__ == "__main__":
    main()
