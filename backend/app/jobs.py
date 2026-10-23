import logging
import uuid
from datetime import timedelta
from sqlalchemy import select, update, and_, or_
from .config import get_settings
from .db import SessionLocal
from .models import VerificationJob, Report, ReportVerification, now
from .services import decide_report, PENDING
from .storage import get_storage
from .verifier import verify_photo, Decision, PROMPT_VERSION

logger = logging.getLogger(__name__)


def enqueue(db, report_id):
    db.execute(
        update(VerificationJob)
        .where(VerificationJob.report_id == report_id, VerificationJob.state == "WAIT_UPLOAD")
        .values(state="READY", next_attempt_at=now())
    )
    db.execute(
        update(Report).where(Report.id == report_id, Report.status == "PENDING_UPLOAD").values(status="PENDING_AI")
    )


def due_clause():
    t = now()
    return or_(
        and_(VerificationJob.state.in_(("READY", "RETRY")), VerificationJob.next_attempt_at <= t),
        and_(VerificationJob.state == "PROCESSING", VerificationJob.lease_until < t),
    )


def run_report(report_id: str) -> bool:
    """Durable lease + fencing token: safe across API replicas, workers and repeated events."""
    s = get_settings()
    token = str(uuid.uuid4())
    with SessionLocal.begin() as db:
        claimed = db.execute(
            update(VerificationJob)
            .where(VerificationJob.report_id == report_id, due_clause())
            .values(
                state="PROCESSING",
                lease_token=token,
                lease_until=now() + timedelta(seconds=s.job_lease_seconds),
                attempts=VerificationJob.attempts + 1,
            )
        ).rowcount
        if not claimed:
            return False
        report = db.get(Report, report_id)
        job = db.get(VerificationJob, report_id)
        if report is None or report.status not in PENDING:
            job.state = "DONE"
            return False
        key, stage, species, demo = report.object_key, report.stage, report.species, report.demo_outcome
        attempt = job.attempts
    try:
        photo = get_storage().get(key)
        result = verify_photo(photo, stage, species, demo)
    except Exception as exc:
        # Persist exception class only: SDK messages may contain signed URLs or service details.
        logger.warning("verification_retry report=%s attempt=%s error=%s", report_id, attempt, type(exc).__name__)
        if attempt < s.job_max_attempts:
            with SessionLocal.begin() as db:
                db.execute(
                    update(VerificationJob)
                    .where(
                        VerificationJob.report_id == report_id,
                        VerificationJob.lease_token == token,
                        VerificationJob.state == "PROCESSING",
                    )
                    .values(
                        state="RETRY",
                        next_attempt_at=now() + timedelta(seconds=s.retry_base_seconds * 2 ** (attempt - 1)),
                        lease_until=None,
                        last_error=type(exc).__name__,
                    )
                )
            return True
        result = Decision(
            "REVIEW",
            "사진 검증 서비스 오류로 운영자 검토가 필요합니다.",
            s.clova_model if s.verification_mode == "clova" else "demo-no-ai",
        )
    with SessionLocal.begin() as db:
        owned = db.execute(
            update(VerificationJob)
            .where(
                VerificationJob.report_id == report_id,
                VerificationJob.lease_token == token,
                VerificationJob.state == "PROCESSING",
            )
            .values(state="DONE", lease_until=None, last_error=None)
        ).rowcount
        if not owned:
            return False
        if decide_report(db, report_id, result.status, result.reason):
            db.add(
                ReportVerification(
                    report_id=report_id,
                    model=result.model,
                    prompt_version=PROMPT_VERSION,
                    decision=result.status,
                    reason=result.reason,
                )
            )
    return True


def tick(limit=20):
    with SessionLocal() as db:
        ids = list(
            db.scalars(
                select(VerificationJob.report_id)
                .where(due_clause())
                .order_by(VerificationJob.next_attempt_at)
                .limit(limit)
            )
        )
    return sum(bool(run_report(report_id)) for report_id in ids)


def reconcile():
    """Recover uploads/events missed by a crashed API. 지도 집계는 1분 주기 집계(aggregate.py)가 맡는다."""
    s = get_settings()
    cutoff = now() - timedelta(seconds=s.upload_timeout_seconds)
    with SessionLocal() as db:
        stuck = list(
            db.execute(
                select(Report.id, Report.object_key)
                .where(Report.status == "PENDING_UPLOAD", Report.created_at < cutoff)
                .limit(100)
            )
        )
    storage = get_storage()
    for report_id, key in stuck:
        try:
            exists = storage.exists(key)
        except Exception:
            logger.warning("upload_reconcile_storage_unavailable report=%s", report_id)
            continue
        with SessionLocal.begin() as db:
            if exists:
                enqueue(db, report_id)
            else:
                changed = db.execute(
                    update(Report)
                    .where(Report.id == report_id, Report.status == "PENDING_UPLOAD")
                    .values(status="UPLOAD_FAILED", reason="사진 업로드가 완료되지 않았습니다.")
                ).rowcount
                if changed:
                    db.execute(
                        update(VerificationJob)
                        .where(VerificationJob.report_id == report_id, VerificationJob.state == "WAIT_UPLOAD")
                        .values(state="DONE")
                    )


def handle_storage_event(args):
    s = get_settings()
    if args.get("container_name") != s.s3_bucket or not args.get("event_type", "").startswith("ObjectCreated:"):
        return {"accepted": False, "reason": "unrelated_event"}
    key = args.get("object_name")
    if not isinstance(key, str) or not key.startswith("reports/"):
        return {"accepted": False, "reason": "unrelated_key"}
    with SessionLocal.begin() as db:
        report = db.scalar(select(Report).where(Report.object_key == key))
        if report is None:
            return {"accepted": False, "reason": "unknown_report"}
        report_id = report.id
        if report.status in PENDING:
            enqueue(db, report_id)
    processed = run_report(report_id)
    return {"accepted": True, "report_id": report_id, "processed": processed}
