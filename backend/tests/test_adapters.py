import base64
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import httpx
from pydantic import SecretStr
from sqlalchemy import select, func
from app.config import get_settings
from app.db import SessionLocal, engine
from app.models import PointLedger
from app.verifier import verify_photo
from conftest import upload
from app.jobs import run_report


def test_clova_http_contract_without_paid_call(monkeypatch, image_bytes):
    settings = get_settings().model_copy(
        update={"verification_mode": "clova", "clova_api_key": SecretStr("test-not-a-real-key")}
    )
    captured = []

    def handler(request):
        captured.append(request)
        body = json.loads(request.content)
        assert request.url.path == "/v3/chat-completions/HCX-005"
        assert request.headers["Authorization"] == "Bearer test-not-a-real-key"
        photo = body["messages"][1]["content"][0]
        assert photo["type"] == "image_url"
        assert base64.b64decode(photo["dataUri"]["data"]) == image_bytes
        return httpx.Response(
            200,
            json={
                "status": {"code": "20000"},
                "result": {
                    "message": {
                        "content": json.dumps(
                            {"subject": "FOLIAGE", "stage": "PEAK", "species": "GINKGO", "reason": "노란 은행잎"}
                        )
                    }
                },
            },
        )

    real_client = httpx.Client
    monkeypatch.setattr("app.verifier.get_settings", lambda: settings)
    monkeypatch.setattr(
        "app.verifier.httpx.Client", lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs)
    )
    assert verify_photo(image_bytes, "PEAK", "GINKGO", None).status == "APPROVED"
    assert len(captured) == 1


def test_object_storage_private_put_and_signed_get(monkeypatch):
    from app.storage import S3Storage
    from botocore.stub import Stubber

    settings = get_settings().model_copy(
        update={
            "s3_bucket": "test-bucket",
            "s3_access_key": SecretStr("dummy-access-key"),
            "s3_secret_key": SecretStr("dummy-secret-key"),
        }
    )
    monkeypatch.setattr("app.storage.get_settings", lambda: settings)
    storage = S3Storage()
    stubber = Stubber(storage.client)
    stubber.add_response(
        "put_object",
        {},
        {
            "Bucket": "test-bucket",
            "Key": "reports/test.jpg",
            "Body": b"photo",
            "ContentType": "image/jpeg",
            "ACL": "private",
        },
    )
    with stubber:
        storage.put("reports/test.jpg", b"photo")
    url = storage.signed_url("reports/test.jpg")
    assert url.startswith("https://kr.object.ncloudstorage.com/test-bucket/reports/test.jpg?")
    assert "X-Amz-Expires=300" in url and "X-Amz-Signature=" in url


def test_concurrent_purchase_deducts_once(client, auth, image_bytes):
    for _ in range(2):
        run_report(upload(client, auth, image_bytes).json()["id"])
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(lambda _: client.put("/api/me/items/ribbon", headers=auth), range(4)))
    assert all(r.status_code == 200 for r in results)
    assert client.get("/api/me", headers=auth).json()["points"] == 10
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(PointLedger)) == 3


def test_initial_migration_round_trip():
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import inspect

    # This fixture DB is disposable; exercise actual migration rather than only ORM create_all.
    from app.db import Base

    Base.metadata.drop_all(engine)
    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(cfg, "head")
    tables = set(inspect(engine).get_table_names())
    assert {
        "reports",
        "verification_jobs",
        "report_verifications",
        "point_ledger",
        "report_likes",
        "tree_equipment",
    } <= tables
    command.downgrade(cfg, "base")
    assert "reports" not in inspect(engine).get_table_names()
    command.upgrade(cfg, "head")
