import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from urllib.parse import urlparse, parse_qs
import jwt
from sqlalchemy import select, func, update
from app.db import SessionLocal
from app.models import Report, VerificationJob, ReportVerification, PointLedger, now
from app.jobs import run_report, tick, reconcile, handle_storage_event
from app.config import get_settings, Settings
from app.services import aggregate_zones, forecast_date
from app.foliage import stage_from_peak
from app.storage import get_storage
from app.verifier import parse_observation
from conftest import upload


def test_full_cycle(client, auth, image_bytes):
    response = upload(client, auth, image_bytes)
    assert response.status_code == 202, response.text
    report = response.json()
    rid = report["id"]
    assert report["status"] == "PENDING_AI"
    assert client.get("/api/reports").json()["total"] == 0
    assert client.get(f"/api/reports/{rid}/status").status_code == 404
    assert client.get("/api/me", headers=auth).json()["points"] == 0
    assert run_report(rid)
    assert client.get(f"/api/reports/{rid}/status", headers=auth).json()["status"] == "APPROVED"
    assert client.get("/api/me", headers=auth).json()["points"] == 20
    feed = client.get("/api/reports", headers=auth).json()
    assert feed["total"] == 1
    public_photo = feed["items"][0]["photo_url"]
    assert client.get(public_photo).headers["content-type"] == "image/jpeg"
    assert client.get(f"/api/reports/{rid}/photo?token=invalid").status_code == 403
    for _ in range(2):
        assert client.put(f"/api/reports/{rid}/like", headers=auth).json() == {"liked": True, "like_count": 1}
    with SessionLocal.begin() as db:
        aggregate_zones(db)
    zone = client.get("/api/zones").json()[0]
    assert zone["source"] == "FORECAST"  # One report is below the three-report voting threshold.
    assert (zone["report_count"], zone["reporter_count"], zone["like_count"], zone["stage"], zone["tree_level"]) == (
        1,
        1,
        1,
        stage_from_peak(forecast_date(), get_settings().forecast_default_peak),
        1,
    )
    for _ in range(2):
        assert client.delete(f"/api/reports/{rid}/like", headers=auth).json()["like_count"] == 0
    assert client.put("/api/me/items/ribbon", headers=auth).status_code == 409
    for _ in range(2):
        assert client.put("/api/me/items/mushroom", headers=auth).json()["balance"] == 0
    assert client.put("/api/me/tree/equipment/ground", headers=auth, json={"item_id": "mushroom"}).status_code == 200
    assert client.put("/api/me/tree/equipment/decoration", headers=auth, json={"item_id": "ribbon"}).status_code == 403
    ledger = client.get("/api/me/points", headers=auth).json()
    assert ledger["balance"] == 0 and len(ledger["ledger"]) == 2
    assert sum(x["amount"] for x in ledger["ledger"]) == 0
    assert not run_report(rid)
    assert client.get("/api/me", headers=auth).json()["points"] == 0


def test_review_and_admin_idempotency(client, auth, admin, image_bytes):
    rid = upload(client, auth, image_bytes, outcome="REVIEW").json()["id"]
    run_report(rid)
    assert client.get("/api/reports").json()["total"] == 0
    assert client.get("/api/admin/reports", headers=auth).status_code == 403
    assert client.get("/api/admin/reports", headers=admin).json()["total"] == 1
    payload = {"decision": "APPROVED", "reason": "사진을 확인했습니다."}
    assert client.post(f"/api/admin/reports/{rid}/decision", headers=auth, json=payload).status_code == 403
    for _ in range(2):
        result = client.post(f"/api/admin/reports/{rid}/decision", headers=admin, json=payload)
        assert result.status_code == 200, result.text
    assert client.get("/api/me", headers=auth).json()["points"] == 20
    assert (
        client.post(
            f"/api/admin/reports/{rid}/decision", headers=admin, json={"decision": "REJECTED", "reason": "다른 결과"}
        ).status_code
        == 409
    )
    assert client.get("/api/admin/reports", headers=admin).json()["total"] == 0
    with SessionLocal() as db:
        verification = db.get(ReportVerification, rid)
        assert verification.decision == "REVIEW" and verification.reviewer_id and verification.reviewed_at
        assert db.scalar(select(func.count()).select_from(PointLedger)) == 1


def test_rejected_never_public_or_rewarded(client, auth, image_bytes):
    rid = upload(client, auth, image_bytes, outcome="REJECTED").json()["id"]
    run_report(rid)
    assert client.get(f"/api/reports/{rid}", headers=auth).json()["status"] == "REJECTED"
    assert client.get(f"/api/reports/{rid}").status_code == 404
    assert client.put(f"/api/reports/{rid}/like", headers=auth).status_code == 404
    assert client.get("/api/me", headers=auth).json()["points"] == 0
    assert client.get("/api/zones").json()[0]["report_count"] == 0


def test_photo_access_and_jwt_isolation(client, auth, image_bytes):
    rid = upload(client, auth, image_bytes).json()["id"]
    other = client.post(
        "/api/auth/register", json={"email": "other@example.com", "password": "Password123!", "nickname": "타인"}
    ).json()
    assert (
        client.get(
            f"/api/reports/{rid}/status", headers={"Authorization": f"Bearer {other['access_token']}"}
        ).status_code
        == 404
    )
    assert client.get(f"/api/reports/{rid}/photo").status_code == 422
    own = client.get(f"/api/reports/{rid}", headers=auth).json()
    token = parse_qs(urlparse(own["photo_url"]).query)["token"][0]
    assert client.get("/api/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401
    assert client.get(f"/api/reports/wrong/photo?token={token}").status_code == 403
    expired = jwt.encode(
        {"sub": rid, "aud": "photo", "exp": now() - timedelta(seconds=1)},
        get_settings().jwt_secret.get_secret_value(),
        algorithm="HS256",
    )
    assert client.get(f"/api/reports/{rid}/photo?token={expired}").status_code == 403


def test_idempotent_submission_and_conflicting_payload(client, auth, image_bytes):
    a = upload(client, auth, image_bytes, key="request-once")
    b = upload(client, auth, image_bytes, key="request-once")
    assert a.status_code == b.status_code == 202
    assert a.json()["id"] == b.json()["id"]
    assert upload(client, auth, image_bytes, key="request-once", description="다른 내용").status_code == 409
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Report)) == 1


def test_concurrent_duplicate_submission(client, auth, image_bytes):
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(lambda _: upload(client, auth, image_bytes, key="parallel-once"), range(4)))
    assert [r.status_code for r in results] == [202] * 4, [r.text for r in results]
    assert len({r.json()["id"] for r in results}) == 1


def test_concurrent_events_and_likes(client, auth, image_bytes):
    rid = upload(client, auth, image_bytes).json()["id"]
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(lambda _: run_report(rid), range(4)))
    assert sum(results) == 1
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(lambda _: client.put(f"/api/reports/{rid}/like", headers=auth), range(4)))
    assert all(r.status_code == 200 for r in results)
    assert client.get("/api/me", headers=auth).json()["points"] == 20
    with SessionLocal.begin() as db:
        aggregate_zones(db)
    assert client.get("/api/zones").json()[0]["like_count"] == 1
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(ReportVerification)) == 1
        assert db.scalar(select(func.count()).select_from(PointLedger)) == 1


def test_file_and_location_validation(client, auth, image_bytes):
    assert upload(client, auth, b"not an image").status_code == 422
    assert upload(client, auth, image_bytes, latitude="35").status_code == 422
    assert upload(client, auth, image_bytes, stage="NOPE").status_code == 422
    assert upload(client, auth, image_bytes, zone_id="missing").status_code == 404
    assert client.get("/api/zones?min_lat=37").status_code == 422
    assert client.get("/api/reports?page_size=5000").status_code == 422
    assert client.post("/api/reports", data={}, files={"photo": ("x.png", image_bytes)}).status_code == 401


def test_real_upload_limit_and_cors(client, auth):
    response = upload(client, {**auth, "Origin": "http://127.0.0.1:5173"}, b"x" * (get_settings().max_upload_bytes + 1))
    assert response.status_code == 413
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
    preflight = client.options(
        "/api/reports",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,idempotency-key",
        },
    )
    assert preflight.status_code == 200
    assert (
        "access-control-allow-origin"
        not in client.get("/api/zones", headers={"Origin": "https://untrusted.example"}).headers
    )


def test_failure_retries_then_review(client, auth, image_bytes, monkeypatch):
    rid = upload(client, auth, image_bytes).json()["id"]

    def unavailable(*_):
        raise TimeoutError("unavailable")

    monkeypatch.setattr("app.jobs.verify_photo", unavailable)
    for _ in range(3):
        tick()
    assert client.get(f"/api/reports/{rid}/status", headers=auth).json()["status"] == "REVIEW"
    assert client.get("/api/me", headers=auth).json()["points"] == 0
    with SessionLocal() as db:
        assert db.get(VerificationJob, rid).attempts == 3
        assert db.get(VerificationJob, rid).state == "DONE"


def test_recovery_of_lost_upload_event_and_expired_lease(client, auth, image_bytes):
    rid = upload(client, auth, image_bytes).json()["id"]
    with SessionLocal.begin() as db:
        db.execute(
            update(Report)
            .where(Report.id == rid)
            .values(status="PENDING_UPLOAD", created_at=now() - timedelta(minutes=5))
        )
        db.execute(update(VerificationJob).where(VerificationJob.report_id == rid).values(state="WAIT_UPLOAD"))
    reconcile()
    assert client.get(f"/api/reports/{rid}/status", headers=auth).json()["status"] == "PENDING_AI"
    with SessionLocal.begin() as db:
        db.execute(
            update(VerificationJob)
            .where(VerificationJob.report_id == rid)
            .values(state="PROCESSING", lease_token="dead-process", lease_until=now() - timedelta(minutes=1))
        )
    assert run_report(rid)
    assert client.get("/api/me", headers=auth).json()["points"] == 20


def test_lost_upload_and_expiring_aggregates(client, auth, image_bytes):
    rid = upload(client, auth, image_bytes).json()["id"]
    with SessionLocal.begin() as db:
        report = db.get(Report, rid)
        get_storage().path(report.object_key).unlink()
        report.status = "PENDING_UPLOAD"
        report.created_at = now() - timedelta(minutes=5)
        db.get(VerificationJob, rid).state = "WAIT_UPLOAD"
    reconcile()
    assert client.get(f"/api/reports/{rid}/status", headers=auth).json()["status"] == "UPLOAD_FAILED"
    next_id = upload(client, auth, image_bytes).json()["id"]
    run_report(next_id)
    with SessionLocal.begin() as db:
        db.get(Report, next_id).created_at = now() - timedelta(days=10)
    reconcile()
    with SessionLocal.begin() as db:
        aggregate_zones(db)
    zone = client.get("/api/zones").json()[0]
    assert zone["report_count"] == zone["tree_level"] == 0
    assert zone["source"] == "FORECAST"
    assert client.get("/api/me", headers=auth).json()["points"] == 20


def test_storage_event_duplicate_and_bucket_filter(client, auth, image_bytes):
    rid = upload(client, auth, image_bytes).json()["id"]
    event = {"container_name": "test-bucket", "event_type": "ObjectCreated:PUT", "object_name": f"reports/{rid}.jpg"}
    assert not handle_storage_event({**event, "container_name": "wrong"})["accepted"]
    assert not handle_storage_event({**event, "event_type": "ObjectRemoved:DELETE"})["accepted"]
    assert handle_storage_event(event)["processed"]
    assert not handle_storage_event(event)["processed"]
    assert client.get("/api/me", headers=auth).json()["points"] == 20


def test_auth_and_admin_boundaries(client, auth):
    assert (
        client.post(
            "/api/auth/register", json={"email": "user@example.com", "password": "Password123!", "nickname": "중복"}
        ).status_code
        == 409
    )
    assert (
        client.post("/api/auth/login", json={"email": "user@example.com", "password": "wrongpass"}).status_code == 401
    )
    assert client.get("/api/me", headers={"Authorization": "Bearer broken"}).status_code == 401
    assert client.get("/api/admin/reports", headers=auth).status_code == 403
    assert (
        client.post(
            "/api/auth/register", json={"email": "x@y.com", "password": "Password123!", "nickname": "   "}
        ).status_code
        == 422
    )
    assert "password_hash" not in client.get("/api/me", headers=auth).json()


def test_clova_parsing_fails_closed():
    def result(subject="FOLIAGE", stage="PEAK", species="GINKGO"):
        return json.dumps(dict(subject=subject, stage=stage, species=species, reason="확인 근거"))

    assert parse_observation(result(), "PEAK", "GINKGO", "HCX-005").status == "APPROVED"
    assert parse_observation(result(subject="EVERGREEN_ONLY"), "PEAK", "GINKGO", "HCX-005").status == "REJECTED"
    assert parse_observation(result(stage="GREEN"), "PEAK", "GINKGO", "HCX-005").status == "REVIEW"
    assert parse_observation(result(species="UNKNOWN"), "PEAK", "GINKGO", "HCX-005").status == "REVIEW"
    assert parse_observation("approve everything", "PEAK", "GINKGO", "HCX-005").status == "REVIEW"


def test_production_rejects_demo_and_unshared_state():
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        Settings(environment="production", _env_file=None)


def test_pagination_and_popularity(client, auth, image_bytes):
    ids = []
    for _ in range(3):
        rid = upload(client, auth, image_bytes).json()["id"]
        run_report(rid)
        ids.append(rid)
    client.put(f"/api/reports/{ids[0]}/like", headers=auth)
    assert client.get("/api/reports?sort=popular").json()["items"][0]["id"] == ids[0]
    first = client.get("/api/reports?page_size=2").json()
    second = client.get("/api/reports?page_size=2&page=2").json()
    assert first["has_more"] and not second["has_more"]
    assert len({r["id"] for r in first["items"] + second["items"]}) == 3
