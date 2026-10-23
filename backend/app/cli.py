import argparse
from datetime import datetime
from pathlib import Path
from alembic import command
from alembic.config import Config
from sqlalchemy import select
from .config import get_settings, ROOT
from .db import SessionLocal
from .models import User, Season, Zone, Item, Report, ReportVerification, uid, now
from .security import hash_password
from .storage import get_storage, normalize_image
from .services import decide_report
from .district_setup import sync_seoul_districts

ITEMS = [
    ("ribbon", "가을 리본", 30, "decoration", "🎀"),
    ("star", "반짝이는 별", 50, "decoration", "⭐"),
    ("mushroom", "작은 버섯", 20, "ground", "🍄"),
]


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
        sync_seoul_districts(db.connection())
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
    print(
        "Database migrated and seeded."
        + (" Local demo: demo@example.com / DemoPass123!; admin@example.com / AdminPass123!" if demo else "")
    )


def seed_reports(season_id):
    with SessionLocal() as db:
        user_id = db.scalar(select(User.id).where(User.email == "demo@example.com"))
    for zone_id, asset, species, description in [
        ("seoul-11230", "sample-ginkgo.png", "GINKGO", "샘플 제보 · 경희대 은행나무가 노랗게 물들었어요."),
        ("seoul-11200", "sample-maple.png", "MAPLE", "샘플 제보 · 서울숲 산책길의 가을 풍경이에요."),
    ]:
        with SessionLocal() as db:
            legacy_key = {"seoul-11230": "seed:kyunghee", "seoul-11200": "seed:seoulforest"}[zone_id]
            if db.scalar(select(Report.id).where(Report.user_id == user_id, Report.request_key.in_([f"seed:{zone_id}", legacy_key]))):
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
    parser.add_argument("action", choices=["init", "promote-admin"])
    parser.add_argument("--demo", action="store_true")
    parser.add_argument("--email")
    args = parser.parse_args()
    if args.action == "init":
        initialize(args.demo)
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
