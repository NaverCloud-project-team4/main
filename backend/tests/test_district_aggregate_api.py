import io
import json
import types
from datetime import date, datetime
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import SecretStr
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app import aggregate as aggregate_module, cli, geo, main
from app.db import Base, get_db
from app.models import Report, Season, User, ZoneActivity, ZoneStatus, uid
from app.security import hash_password, make_token
from app.services import decide_report

DATA = Path(__file__).resolve().parents[1] / "app" / "data"
MARKER = {
    f["id"]: f["properties"]["marker"]
    for f in json.loads((DATA / "zones_seoul25.geojson").read_text(encoding="utf-8"))["features"]
}
KEY = "k" * 20


class MemoryStorage:
    def __init__(self):
        self.objects = {}

    def put(self, key, data):
        self.objects[key] = data

    def get(self, key):
        return self.objects[key]

    def exists(self, key):
        return key in self.objects


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

    def override():
        with Session() as session:
            yield session

    main.app.dependency_overrides[get_db] = override
    published = []
    monkeypatch.setattr(main, "get_storage", lambda: MemoryStorage())
    monkeypatch.setattr(aggregate_module, "SessionLocal", Session)
    monkeypatch.setattr(aggregate_module, "publish_json", lambda doc: published.append(doc) or "memory://map")
    monkeypatch.setattr(main.s, "forecast_today", date(2026, 10, 27))
    monkeypatch.setattr(main.s, "aggregate_key", SecretStr(""))
    geo.clear_zone_cache()
    yield types.SimpleNamespace(Session=Session, client=TestClient(main.app), published=published)
    main.app.dependency_overrides.clear()
    geo.clear_zone_cache()


def make_user(Session, name):
    with Session.begin() as db:
        user = User(email=f"{name}@example.com", nickname=name, password_hash=hash_password("Passw0rd!"))
        db.add(user)
        db.flush()
        return make_token(user), user.id


def jpeg():
    buffer = io.BytesIO()
    Image.new("RGB", (64, 64), (200, 80, 40)).save(buffer, "JPEG")
    return buffer.getvalue()


def post_report(client, token, zone_id, lat, lng):
    return client.post(
        "/api/reports",
        headers={"Authorization": f"Bearer {token}"},
        data={"zone_id": zone_id, "stage": "PEAK", "species": "GINKGO", "latitude": lat, "longitude": lng},
        files={"photo": ("p.jpg", jpeg(), "image/jpeg")},
    )


def add_pending_report(db, user_id, zone_id, stage, n):
    report = Report(
        user_id=user_id,
        zone_id=zone_id,
        season_id="2026",
        status="PENDING_AI",
        stage=stage,
        species="GINKGO",
        latitude=0.0,
        longitude=0.0,
        object_key=f"reports/{uid()}.jpg",
        photo_hash="h",
        request_key=f"k{n}",
        request_fingerprint="f",
    )
    db.add(report)
    db.flush()
    return report.id


def test_report_inside_selected_district_is_accepted(env):
    token, _ = make_user(env.Session, "inside")
    lng, lat = MARKER["jongno"]
    response = post_report(env.client, token, "jongno", lat, lng)
    assert response.status_code == 202, response.text
    assert response.json()["zone_id"] == "jongno"


def test_report_in_another_district_is_rejected(env):
    token, _ = make_user(env.Session, "wrong")
    lng, lat = MARKER["gangnam"]
    response = post_report(env.client, token, "jongno", lat, lng)
    assert response.status_code == 422
    assert "구 밖" in response.json()["detail"]


def test_report_outside_seoul_or_unknown_zone(env):
    token, _ = make_user(env.Session, "outside")
    assert post_report(env.client, token, "jongno", 37.4563, 126.7052).status_code == 422  # 인천
    lng, lat = MARKER["jongno"]
    assert post_report(env.client, token, "nowhere", lat, lng).status_code == 404


def test_aggregate_endpoint_needs_the_key(env):
    assert env.client.post("/api/internal/aggregate").status_code == 503  # 키가 설정되지 않음
    main.s.aggregate_key = SecretStr(KEY)
    assert env.client.post("/api/internal/aggregate").status_code == 403
    assert env.client.post("/api/internal/aggregate", headers={"X-Aggregate-Key": "wrong"}).status_code == 403
    response = env.client.post("/api/internal/aggregate", headers={"X-Aggregate-Key": KEY})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["zones"] == 25 and body["skipped"] is False and body["by_source"] == {"FORECAST": 25}
    document = env.published[-1]
    assert len(document["zones"]) == 25 and document["forecast_date"] == "2026-10-27"
    assert all("radius_m" not in z for z in document["zones"])


def test_forecast_stage_on_oct_27_splits_ginkgo_and_mountain_districts(env):
    main.s.aggregate_key = SecretStr(KEY)
    env.client.post("/api/internal/aggregate", headers={"X-Aggregate-Key": KEY})
    stages = {z["id"]: (z["stage"], z["source"], z["peak_date"]) for z in env.client.get("/api/map").json()["zones"]}
    assert stages["jongno"] == ("PEAK", "FORECAST", "2026-10-30")  # 은행길 지점: d=-3
    assert stages["gwangjin"] == ("STARTING", "FORECAST", "2026-10-31")  # 산·공원 지점: d=-4


def test_approvals_do_not_change_the_map_until_the_next_aggregation(env):
    main.s.aggregate_key = SecretStr(KEY)
    env.client.post("/api/internal/aggregate", headers={"X-Aggregate-Key": KEY})
    ids = []
    with env.Session.begin() as db:
        for n in range(3):
            user = User(email=f"u{n}@example.com", nickname=f"u{n}", password_hash="x")
            db.add(user)
            db.flush()
            report_id = add_pending_report(db, user.id, "jongno", "FALLEN", n)
            assert decide_report(db, report_id, "APPROVED", "ok")
            ids.append(user.id)
    with env.Session() as db:
        assert db.get(ZoneStatus, "jongno").source == "FORECAST"  # 아직 반영 전
        assert {db.get(User, uid_).points for uid_ in ids} == {20}  # 포인트는 승인 즉시
    env.client.post("/api/internal/aggregate", headers={"X-Aggregate-Key": KEY})
    with env.Session() as db:
        status, activity = db.get(ZoneStatus, "jongno"), db.get(ZoneActivity, "jongno")
        assert (status.stage, status.source) == ("FALLEN", "REPORT")
        assert (activity.report_count, activity.reporter_count, activity.score, activity.tree_level) == (3, 3, 15, 2)


def test_two_reports_are_not_enough_for_report_source(env):
    main.s.aggregate_key = SecretStr(KEY)
    with env.Session.begin() as db:
        for n in range(2):
            user = User(email=f"v{n}@example.com", nickname=f"v{n}", password_hash="x")
            db.add(user)
            db.flush()
            decide_report(db, add_pending_report(db, user.id, "jongno", "FALLEN", n), "APPROVED", "ok")
    env.client.post("/api/internal/aggregate", headers={"X-Aggregate-Key": KEY})
    with env.Session() as db:
        assert (db.get(ZoneStatus, "jongno").stage, db.get(ZoneStatus, "jongno").source) == ("PEAK", "FORECAST")
        assert db.get(ZoneActivity, "jongno").tree_level == 1  # 제보 2건·제보자 2명 = 10점


def test_likes_are_idempotent_and_never_negative(env):
    token, user_id = make_user(env.Session, "liker")
    with env.Session.begin() as db:
        report_id = add_pending_report(db, user_id, "jongno", "PEAK", 1)
        decide_report(db, report_id, "APPROVED", "ok")
    headers = {"Authorization": f"Bearer {token}"}
    url = f"/api/reports/{report_id}/like"
    assert env.client.put(url, headers=headers).json()["like_count"] == 1
    assert env.client.put(url, headers=headers).json()["like_count"] == 1
    assert env.client.delete(url, headers=headers).json()["like_count"] == 0
    assert env.client.delete(url, headers=headers).json()["like_count"] == 0


def test_zones_endpoint_keeps_legacy_radius_and_adds_source(env):
    zones = env.client.get("/api/zones").json()
    assert len(zones) == 25
    assert {"source", "peak_date", "radius_m", "tree_level", "interest_score"} <= set(zones[0])
    assert env.client.get("/api/zones?min_lat=37.5&max_lat=37.6").status_code == 422


def test_aggregation_lock_skips_a_second_run(env):
    main.s.aggregate_key = SecretStr(KEY)
    with aggregate_module.aggregate_lock() as first:
        assert first is True
        assert env.client.post("/api/internal/aggregate", headers={"X-Aggregate-Key": KEY}).json() == {"skipped": True}
