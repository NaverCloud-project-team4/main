import types
from datetime import date, datetime, timedelta
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app import cli, main, services
from app.db import Base, get_db
from app.foliage import stage_from_peak
from app.geography import geometry_covers
from app.models import ForecastSpot, PointLedger, Report, ReportLike, Season, User, Zone, ZoneActivity, ZoneStatus, now, uid
from app.services import aggregate_zones
from app.showcase import (
    DEMO_POINT_ROWS, ensure_demo_points, load_config, reporters_for_level, reset_showcase, seed_showcase,
)
from app.storage import get_storage

TODAY = date(2026, 10, 27)


@pytest.fixture()
def env(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(engine, expire_on_commit=False)
    with Session.begin() as db:
        db.add(Season(id="2026", name="2026 가을", starts_at=datetime(2026, 1, 1), ends_at=datetime(2027, 1, 1)))
        db.flush()
        cli.seed_districts(db)
        cli.seed_forecast_spots(db, "2026")
    monkeypatch.setattr(main.s, "forecast_today", TODAY)

    def override():
        with Session() as session:
            yield session

    main.app.dependency_overrides[get_db] = override
    yield types.SimpleNamespace(Session=Session, client=TestClient(main.app), config=load_config())
    main.app.dependency_overrides.clear()


def seeded(env):
    result = seed_showcase(env.Session, env.config, seed=7)
    with env.Session.begin() as db:
        aggregate_zones(db)
    return result


def levels(env):
    with env.Session() as db:
        return dict(db.execute(select(ZoneActivity.zone_id, ZoneActivity.tree_level)).all())


def test_level_plans_hit_the_interest_thresholds():
    assert reporters_for_level(0) == (0, 0)
    assert reporters_for_level(1) == (1, 0)
    assert reporters_for_level(2)[0] == 3
    assert reporters_for_level(3)[0] == 8


def test_seed_reaches_each_configured_level_and_leaves_the_rest_to_the_forecast(env):
    result = seeded(env)
    got = levels(env)
    planned = {e["level"] for e in env.config["popularSpots"]}
    assert len(result["zones"]) == len(env.config["popularSpots"]) + len(env.config["levelOneZones"]) + len(env.config["loadTestZones"])
    assert planned <= set(result["zones"].values()) and planned <= {2, 3}
    for zone_id, level in result["zones"].items():
        assert got[zone_id] == level, zone_id
    for zone_id in env.config["loadTestZones"]:
        assert got[zone_id] == 1, "load-test district starts at level 1"
    others = {z: lv for z, lv in got.items() if z not in result["zones"]}
    assert others and set(others.values()) == {0}
    with env.Session() as db:
        sources = dict(db.execute(select(ZoneStatus.zone_id, ZoneStatus.source)).all())
    assert {sources[z] for z in others} == {"FORECAST"}, "untouched districts are coloured by the forecast"
    assert set(got.values()) >= {0, 1, 2, 3}


def test_report_stage_follows_the_spot_forecast_and_lands_near_it_in_the_same_district(env):
    seeded(env)
    t = now()
    with env.Session() as db:
        statuses = {z.zone_id: z for z in db.scalars(select(ZoneStatus))}
        for entry in env.config["popularSpots"]:
            spot = db.scalar(select(ForecastSpot).where(ForecastSpot.name == entry["spot"]))
            zone = db.get(Zone, spot.zone_id)
            reports = db.scalars(select(Report).where(Report.zone_id == spot.zone_id, Report.request_fingerprint == "showcase")).all()
            expected = stage_from_peak(TODAY, spot.peak_date)
            assert {r.stage for r in reports} == {expected}, entry["spot"]
            assert statuses[spot.zone_id].stage == expected and statuses[spot.zone_id].source == "REPORT", "no contradiction with the forecast"
            for r in reports:
                assert r.status == "APPROVED"
                assert geometry_covers(zone.boundary, r.latitude, r.longitude), "inside the spot's own district"
                assert services.distance_m(spot.latitude, spot.longitude, r.latitude, r.longitude) <= env.config["spreadMeters"] + 1
                assert timedelta(hours=0.9) <= t - r.created_at <= timedelta(days=3), "within the last 3 days"


def test_rerunning_refreshes_instead_of_piling_up(env):
    first = seeded(env)
    second = seeded(env)
    assert first["reports"] == second["reports"]
    with env.Session() as db:
        assert db.scalar(select(func.count()).select_from(Report).where(Report.request_fingerprint == "showcase")) == second["reports"]
        assert db.scalar(select(func.count()).select_from(User).where(User.email.like("showcase-%"))) == second["accounts"]
    assert levels(env) == levels(env)


def test_reset_removes_only_showcase_and_rehearsal_data(env, tmp_path):
    seeded(env)
    with env.Session.begin() as db:
        # an ordinary user and their report, liked by a showcase account
        normal = User(email="person@example.com", nickname="일반", password_hash="x")
        db.add(normal)
        rehearsal = User(email="rehearsal-001@demo.kauroong.local", nickname="리허설", password_hash="x")
        db.add(rehearsal)
        db.flush()
        report = Report(id=uid(), user_id=normal.id, zone_id="jung", season_id="2026", status="APPROVED", stage="PEAK", species="GINKGO",
                        latitude=37.5649, longitude=126.9754, object_key=f"reports/{uid()}.jpg", photo_hash="h", request_key="n", request_fingerprint="f", like_count=1)
        db.add(report)
        db.add(Report(id=uid(), user_id=rehearsal.id, zone_id="jung", season_id="2026", status="APPROVED", stage="PEAK", species="GINKGO",
                      latitude=37.5649, longitude=126.9754, object_key=f"reports/{uid()}.jpg", photo_hash="h", request_key="r", request_fingerprint="f"))
        liker = db.scalar(select(User).where(User.email.like("showcase-%")))
        db.add(ReportLike(report_id=report.id, user_id=liker.id))
        normal_report = report.id
    with env.Session() as db:
        keys = list(db.scalars(select(Report.object_key).where(Report.request_fingerprint == "showcase")))
    assert keys and all(get_storage().exists(k) for k in keys)
    result = reset_showcase(env.Session, env.config)
    assert result["users"] >= 2 and result["reports"] >= 1
    with env.Session() as db:
        assert db.scalar(select(func.count()).select_from(User).where(User.email.like("%@demo.kauroong.local"))) == 0
        assert db.scalar(select(func.count()).select_from(Report).where(Report.request_fingerprint == "showcase")) == 0
        assert db.scalar(select(func.count()).select_from(PointLedger).where(PointLedger.reason == "제보 승인")) == 0
        kept = db.get(Report, normal_report)
        assert kept is not None and kept.like_count == 0, "the showcase like is taken back"
        assert db.scalar(select(User).where(User.email == "person@example.com")) is not None
    assert not any(get_storage().exists(k) for k in keys), "photos are removed too"


def test_demo_points_make_a_grown_tree_once(env):
    with env.Session.begin() as db:
        db.add(User(email="demo@example.com", nickname="단풍지기", password_hash="x", points=40))
    for _ in range(3):
        with env.Session.begin() as db:
            ensure_demo_points(db)
    with env.Session() as db:
        user = db.scalar(select(User).where(User.email == "demo@example.com"))
        earned = db.scalar(select(func.sum(PointLedger.amount)).where(PointLedger.user_id == user.id, PointLedger.amount > 0))
        assert earned == DEMO_POINT_ROWS * 20 and user.points == 40 + DEMO_POINT_ROWS * 20
        assert {r for r in db.scalars(select(PointLedger.reason).where(PointLedger.user_id == user.id))} == {"제보 승인"}
    assert earned + 40 >= 500 and user.points - 500 >= 0  # grown, and still points to spend


def test_production_needs_confirm(env, monkeypatch):
    monkeypatch.setattr(main.s, "environment", "production")
    with pytest.raises(SystemExit):
        seed_showcase(env.Session, env.config)
    with pytest.raises(SystemExit):
        reset_showcase(env.Session, env.config)
    assert reset_showcase(env.Session, env.config, confirm=True) == {"users": 0, "reports": 0}


def test_sheet_spots_report_recent_activity_nearby(env):
    seeded(env)
    jung = env.client.get("/api/forecast-spots", params={"zone_id": "jung"}).json()
    top = max(jung, key=lambda s: s["recent_reports"])
    assert top["name"] == "정동길" and top["recent_reports"] == reporters_for_level(3)[0]
    assert all(s["recent_reports"] is None for s in env.client.get("/api/forecast-spots").json()), "only computed per district"


def test_species_cache_holds_for_its_ttl_and_map_json_is_always_fresh(env, monkeypatch):
    calls = []
    real = services.dominant_species
    monkeypatch.setattr(services, "dominant_species", lambda db, since: calls.append(1) or real(db, since))
    monkeypatch.setattr(main.s, "species_cache_seconds", 60)
    services.clear_species_cache()
    with env.Session() as db:
        services.zone_summaries(db)
        services.zone_summaries(db)
        assert len(calls) == 1, "second call within 60 s uses the cache"
        services.map_document(db)
        assert len(calls) == 2, "the map JSON recomputes"
    monkeypatch.setattr(main.s, "species_cache_seconds", 0)
    with env.Session() as db:
        services.zone_summaries(db)
    assert len(calls) == 3, "0 turns the cache off"
    services.clear_species_cache()
