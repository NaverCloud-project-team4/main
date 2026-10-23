import os
import tempfile
from datetime import datetime

# Configure isolated resources BEFORE importing application modules.
TEST_DIR = tempfile.TemporaryDirectory(prefix="kkawooroong-tests-")
os.environ.update(
    ENVIRONMENT="test",
    DATABASE_URL=f"sqlite:///{TEST_DIR.name}/test.db",
    STORAGE_DIR=f"{TEST_DIR.name}/photos",
    VERIFICATION_MODE="demo",
    REPORT_COOLDOWN_SECONDS="0",
    RETRY_BASE_SECONDS="0",
    S3_BUCKET="test-bucket",
)
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.db import Base, engine, SessionLocal
from app.models import User, Season, Zone, ZoneActivity, ZoneStatus, Item
from app.security import hash_password
from app.geography import seoul_boundaries


@pytest.fixture(autouse=True)
def database():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    year = datetime.now().year
    with SessionLocal.begin() as db:
        db.add(
            Season(id=str(year), name="테스트 가을", starts_at=datetime(year, 1, 1), ends_at=datetime(year + 1, 1, 1))
        )
        feature = next(f for f in seoul_boundaries()['features'] if f['id'] == 'dongdaemun')
        db.add(Zone(id="test-zone", name="동대문구", latitude=37.5964, longitude=127.0525,
                    radius_m=0, district_code="11230", boundary=feature['geometry']))
        db.flush()
        db.add(ZoneActivity(zone_id="test-zone"))
        db.add(ZoneStatus(zone_id="test-zone"))
        db.add(Item(id="ribbon", name="리본", price=30, slot="decoration", icon="🎀"))
        db.add(Item(id="mushroom", name="버섯", price=20, slot="ground", icon="🍄"))
        db.add(
            User(
                email="admin@example.com", nickname="운영자", role="admin", password_hash=hash_password("AdminPass123!")
            )
        )
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def auth(client):
    result = client.post(
        "/api/auth/register", json={"email": "user@example.com", "password": "Password123!", "nickname": "테스터"}
    )
    assert result.status_code == 201
    return {"Authorization": f"Bearer {result.json()['access_token']}"}


@pytest.fixture
def admin(client):
    result = client.post("/api/auth/login", json={"email": "admin@example.com", "password": "AdminPass123!"})
    return {"Authorization": f"Bearer {result.json()['access_token']}"}


@pytest.fixture
def image_bytes():
    from io import BytesIO
    from PIL import Image

    buf = BytesIO()
    Image.new("RGB", (100, 80), "#e6bc3b").save(buf, "PNG")
    return buf.getvalue()


def upload(client, auth, image_bytes, outcome="APPROVED", key=None, **extra):
    data = {
        "zone_id": "test-zone",
        "stage": "PEAK",
        "species": "GINKGO",
        "latitude": "37.5964",
        "longitude": "127.0525",
        "description": "은행나무 테스트",
        "demo_outcome": outcome,
        **extra,
    }
    return client.post(
        "/api/reports",
        headers={**auth, **({"Idempotency-Key": key} if key else {})},
        data=data,
        files={"photo": ("tree.png", image_bytes, "image/png")},
    )
