import pytest
from sqlalchemy import select, func
from app.db import SessionLocal
from app.models import Report


def test_resolve_location_does_not_create_data(client):
    response = client.post("/api/zones/resolve", json={"latitude": 37.5964, "longitude": 127.0525})
    assert response.status_code == 200
    assert response.json() == {
        "zone": {"id": "test-zone", "name": "동대문구", "district_code": "11230"},
        "distance_m": 0,
    }
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Report)) == 0


def test_explicit_wrong_district_cannot_override_position(client, auth, image_bytes):
    response = client.post(
        "/api/reports",
        headers=auth,
        data={"zone_id": "test-zone", "latitude": 37.5172, "longitude": 127.0473, "stage": "PEAK", "species": "MAPLE"},
        files={"photo": ("tree.png", image_bytes, "image/png")},
    )
    assert response.status_code == 422
    assert "자치구 밖" in response.json()["detail"]


def test_outside_service_area_cannot_submit(client, auth, image_bytes):
    point = {"latitude": 35.1796, "longitude": 129.0756}
    assert client.post("/api/zones/resolve", json=point).json() == {"zone": None, "distance_m": None}
    response = client.post(
        "/api/reports",
        headers=auth,
        data={**point, "stage": "PEAK", "species": "GINKGO"},
        files={"photo": ("tree.png", image_bytes, "image/png")},
    )
    assert response.status_code == 422
    assert "서비스 구역 밖" in response.json()["detail"]
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Report)) == 0


def test_report_without_zone_uses_position_and_preserves_coordinates(client, auth, image_bytes):
    point = {"latitude": 37.5974, "longitude": 127.0535}
    response = client.post(
        "/api/reports",
        headers={**auth, "Idempotency-Key": "auto-position"},
        data={**point, "stage": "PEAK", "species": "GINKGO"},
        files={"photo": ("tree.png", image_bytes, "image/png")},
    )
    assert response.status_code == 202, response.text
    report = response.json()
    assert report["zone_id"] == "test-zone"
    assert report["latitude"] == point["latitude"]
    assert report["longitude"] == point["longitude"]
    # The auto-resolved zone also participates in idempotency consistently.
    retry = client.post(
        "/api/reports",
        headers={**auth, "Idempotency-Key": "auto-position"},
        data={**point, "stage": "PEAK", "species": "GINKGO"},
        files={"photo": ("tree.png", image_bytes, "image/png")},
    )
    assert retry.status_code == 202
    assert retry.json()["id"] == report["id"]


@pytest.mark.parametrize(
    "point",
    [
        {"latitude": 91, "longitude": 127},
        {"latitude": 37, "longitude": -181},
        {"latitude": "NaN", "longitude": 127},
    ],
)
def test_resolve_rejects_invalid_coordinates(client, point):
    assert client.post("/api/zones/resolve", json=point).status_code == 422
