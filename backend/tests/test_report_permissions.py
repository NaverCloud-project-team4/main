import pytest
from sqlalchemy import select, func
from app.db import SessionLocal
from app.models import Report, VerificationJob
from conftest import upload


@pytest.mark.parametrize(
    "fields",
    [
        {"photo_source": "upload"},
        {"location_source": "manual"},
        {"photo_source": "upload", "location_source": "manual", "role": "admin"},
    ],
)
def test_regular_user_cannot_use_operator_inputs(client, auth, image_bytes, fields):
    response = upload(client, auth, image_bytes, **fields)
    assert response.status_code == 403
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Report)) == 0
        assert db.scalar(select(func.count()).select_from(VerificationJob)) == 0


@pytest.mark.parametrize(
    "photo_source,location_source", [("upload", "manual"), ("camera", "manual"), ("upload", "current")]
)
def test_operator_input_sources_are_persisted(client, admin, image_bytes, photo_source, location_source):
    response = upload(client, admin, image_bytes, photo_source=photo_source, location_source=location_source)
    assert response.status_code == 202, response.text
    assert response.json()["photo_source"] == photo_source
    assert response.json()["location_source"] == location_source
    with SessionLocal() as db:
        report = db.get(Report, response.json()["id"])
        assert report.photo_source == photo_source
        assert report.location_source == location_source


def test_operator_still_requires_a_valid_seoul_district(client, admin, image_bytes):
    response = upload(
        client,
        admin,
        image_bytes,
        photo_source="upload",
        location_source="manual",
        latitude="35.1796",
        longitude="129.0756",
    )
    assert response.status_code == 422


def test_input_source_is_part_of_idempotency_contract(client, admin, image_bytes):
    first = upload(client, admin, image_bytes, key="source-contract", photo_source="upload", location_source="manual")
    assert first.status_code == 202
    same = upload(client, admin, image_bytes, key="source-contract", photo_source="upload", location_source="manual")
    assert same.json()["id"] == first.json()["id"]
    changed = upload(client, admin, image_bytes, key="source-contract", photo_source="camera", location_source="manual")
    assert changed.status_code == 409


def test_regular_camera_defaults_are_recorded(client, auth, image_bytes):
    response = upload(client, auth, image_bytes)
    assert response.status_code == 202
    assert response.json()["photo_source"] == "camera"
    assert response.json()["location_source"] == "current"
