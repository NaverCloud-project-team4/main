"""Administrative coverage, API assignment, and data-preserving district conversion."""

import pytest
from sqlalchemy import select, func
from app.db import engine, SessionLocal
from app.district_setup import sync_seoul_districts
from app.geography import seoul_boundaries, geometry_covers, district_at
from app.models import Zone, Report, User, PointLedger, ReportLike, ZoneActivity
from app.services import decide_report, set_like
from conftest import upload


@pytest.fixture
def seoul():
    with engine.begin() as connection:
        sync_seoul_districts(connection)


def test_25_districts_have_unique_codes_and_centres_inside(seoul, client):
    zones = client.get("/api/zones").json()
    assert len(zones) == 25
    assert len({zone["district_code"] for zone in zones}) == 25
    boundaries = client.get("/api/zones/boundaries").json()
    assert boundaries["boundary_version"] == "2026-10-01"
    assert len(boundaries["features"]) == 25
    assert "CC BY 4.0" in boundaries["attribution"]
    for zone in zones:
        match = client.post(
            "/api/zones/resolve",
            json={
                "latitude": zone["latitude"],
                "longitude": zone["longitude"],
            },
        ).json()
        assert match["zone"]["id"] == zone["id"]
    assert all(f["properties"]["zone_id"] == f["id"] for f in boundaries["features"])


@pytest.mark.parametrize(
    "lat,lng,name",
    [
        (37.5964, 127.0525, "동대문구"),  # 경희대
        (37.5445, 127.0374, "성동구"),  # 서울숲
        (37.5663, 126.9779, "중구"),  # 서울시청
        (37.5172, 127.0473, "강남구"),  # 강남구청
        (37.5207, 127.1216, "송파구"),  # 올림픽공원
    ],
)
def test_known_points_resolve_by_boundary(seoul, client, lat, lng, name):
    response = client.post("/api/zones/resolve", json={"latitude": lat, "longitude": lng})
    assert response.json()["zone"]["name"] == name


@pytest.mark.parametrize(
    "lat,lng",
    [
        (37.4784, 126.8647),  # 광명시: 서울 전체 bbox 안이지만 서울 밖
        (37.4293, 126.9879),  # 과천시: 서울 전체 bbox 안이지만 서울 밖
        (37.5034, 126.7660),  # 부천시: 서울 전체 bbox 안이지만 서울 밖
        (35.1796, 129.0756),  # 부산
    ],
)
def test_neighbouring_cities_are_excluded(seoul, client, lat, lng):
    assert district_at(lat, lng) is None
    assert client.post("/api/zones/resolve", json={"latitude": lat, "longitude": lng}).json()["zone"] is None


def test_polygon_holes_multipolygons_and_shared_edges():
    square = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]
    hole = [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]
    geometry = {"type": "Polygon", "coordinates": [square, hole]}
    assert geometry_covers(geometry, 0.5, 0.5)
    assert not geometry_covers(geometry, 2, 2)
    assert geometry_covers(geometry, 2, 1)  # hole boundary is included
    assert geometry_covers(geometry, 2, 0)  # outer boundary is included
    assert not geometry_covers(geometry, 2, -0.1)
    multi = {"type": "MultiPolygon", "coordinates": [[square], [[[8, 8], [9, 8], [9, 9], [8, 9], [8, 8]]]]}
    assert geometry_covers(multi, 8.5, 8.5)
    # Shared gu edges have a deterministic choice in ascending official code order.
    features = seoul_boundaries()["features"]
    point = features[0]["geometry"]["coordinates"][0][0]
    matching = [f for f in features if geometry_covers(f["geometry"], point[1], point[0])]
    assert district_at(point[1], point[0])["id"] == min(f["id"] for f in matching)


def test_conversion_preserves_reports_likes_points_and_rebuilds_cache(client, auth, image_bytes):
    report = upload(client, auth, image_bytes).json()
    user_id = client.get("/api/me", headers=auth).json()["id"]
    with SessionLocal() as db:
        decide_report(db, report["id"], "APPROVED", "테스트")
        db.commit()
        set_like(db, report["id"], user_id, True)
    for _ in range(2):
        with engine.begin() as connection:
            sync_seoul_districts(connection)
        with SessionLocal() as db:
            assert db.get(Report, report["id"]).zone_id == "dongdaemun"
            assert db.get(User, user_id).points == 20
            assert db.scalar(select(func.count()).select_from(PointLedger)) == 1
            assert db.scalar(select(func.count()).select_from(ReportLike)) == 1
            assert db.get(ZoneActivity, "dongdaemun").report_count == 1
            assert db.get(ZoneActivity, "dongdaemun").like_count == 1
            assert db.get(ZoneActivity, "test-zone").report_count == 0
            assert db.get(Zone, "test-zone").active is False
    # The feed filter and real submission agree on the administrative id.
    assert client.get("/api/reports?zone_id=dongdaemun").json()["total"] == 1
    response = upload(client, auth, image_bytes, zone_id="seongdong", key="wrong-gu")
    assert response.status_code == 422


def test_new_report_uses_district_from_coordinates(seoul, client, auth, image_bytes):
    response = client.post(
        "/api/reports",
        headers=auth,
        data={"latitude": 37.5445, "longitude": 127.0374, "stage": "PEAK", "species": "MAPLE"},
        files={"photo": ("tree.png", image_bytes, "image/png")},
    )
    assert response.status_code == 202, response.text
    assert response.json()["zone_id"] == "seongdong"
    assert response.json()["zone_name"] == "성동구"


def test_legacy_local_id_still_works_with_main_ids(seoul, client, auth, image_bytes):
    from app.jobs import run_report

    response = upload(client, auth, image_bytes, zone_id="seoul-11230")
    assert response.status_code == 202, response.text
    assert response.json()["zone_id"] == "dongdaemun"
    assert run_report(response.json()["id"])
    legacy = client.get("/api/reports?zone_id=seoul-11230").json()
    current = client.get("/api/reports?zone_id=dongdaemun").json()
    assert legacy["total"] == current["total"] == 1
    assert legacy["items"][0]["id"] == current["items"][0]["id"]
