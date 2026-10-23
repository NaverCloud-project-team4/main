import hashlib
import json
import logging
import time
import uuid
from datetime import timedelta
from typing import Annotated, Literal
import jwt
from fastapi import FastAPI, Depends, HTTPException, Query, Form, File, UploadFile, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, RedirectResponse, JSONResponse
from sqlalchemy import select, update, func, or_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .config import get_settings
from .db import get_db
from .models import (
    User,
    Report,
    Zone,
    Season,
    VerificationJob,
    ReportVerification,
    ReportLike,
    ZoneActivity,
    ZoneStatus,
    PointLedger,
    Item,
    UserItem,
    TreeEquipment,
    now,
    uid,
)
from .schemas import LoginIn, RegisterIn, UserOut, AuthOut, ReportOut, ReportPage, ReviewIn, EquipIn, Stage, Species, LocationIn
from .security import current_user, optional_user, admin_user, hash_password, check_password, make_token
from .storage import get_storage, normalize_image
from .geography import geometry_covers, seoul_boundaries
from .services import set_like, decide_report, lock_zone, resolve_zone
from .jobs import enqueue

s = get_settings()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)
app = FastAPI(
    title="까우룽까우룽 API", version="0.1.0", description="사진 제보, 비동기 검증, 지도·피드·좋아요·포인트 API"
)
DB = Annotated[Session, Depends(get_db)]
Current = Annotated[User, Depends(current_user)]
Admin = Annotated[User, Depends(admin_user)]
Optional = Annotated[User | None, Depends(optional_user)]


class UploadLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST" or scope["path"] != "/api/reports":
            return await self.app(scope, receive, send)
        limit = s.max_upload_bytes + 64 * 1024
        headers = dict(scope.get("headers", []))
        try:
            length = int(headers.get(b"content-length", b"0"))
        except ValueError:
            return await JSONResponse({"detail": "잘못된 Content-Length입니다."}, status_code=400)(scope, receive, send)
        if length > limit:
            return await JSONResponse({"detail": "사진 업로드 용량을 초과했습니다."}, status_code=413)(
                scope, receive, send
            )
        seen = 0

        async def limited_receive():
            nonlocal seen
            message = await receive()
            seen += len(message.get("body", b""))
            if seen > limit:
                raise HTTPException(413, "사진 업로드 용량을 초과했습니다.")
            return message

        await self.app(scope, limited_receive, send)


app.add_middleware(UploadLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[x.strip() for x in s.cors_origins.split(",") if x.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
    expose_headers=["X-Request-ID"],
)


@app.middleware("http")
async def request_log(request: Request, call_next):
    request_id = str(uuid.uuid4())
    started = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    logger.info(
        "request_id=%s method=%s path=%s status=%s ms=%.1f",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        (time.perf_counter() - started) * 1000,
    )
    return response


def user_out(user):
    return {name: getattr(user, name) for name in ("id", "email", "nickname", "role", "points")}


def iso(t):
    return t.isoformat(timespec="milliseconds") + "Z" if t else None


def visible_report(db, report_id, user):
    report = db.get(Report, report_id)
    if report is None or (
        report.status != "APPROVED" and (user is None or (user.id != report.user_id and user.role != "admin"))
    ):
        raise HTTPException(404, "제보를 찾을 수 없습니다.")
    return report


def photo_url(report, viewer):
    if report.status == "UPLOAD_FAILED":
        return None
    token = jwt.encode(
        {
            "sub": report.id,
            "viewer": viewer.id if viewer else None,
            "exp": now() + timedelta(minutes=5),
            "aud": "photo",
        },
        s.jwt_secret.get_secret_value(),
        algorithm="HS256",
    )
    return f"{s.public_api_url.rstrip('/')}/api/reports/{report.id}/photo?token={token}"


def serialize_reports(db, reports, viewer):
    if not reports:
        return []
    ids = [r.id for r in reports]
    authors = dict(db.execute(select(User.id, User.nickname).where(User.id.in_({r.user_id for r in reports}))).all())
    zones = dict(db.execute(select(Zone.id, Zone.name).where(Zone.id.in_({r.zone_id for r in reports}))).all())
    models = dict(
        db.execute(
            select(ReportVerification.report_id, ReportVerification.model).where(ReportVerification.report_id.in_(ids))
        ).all()
    )
    liked = (
        set(
            db.scalars(
                select(ReportLike.report_id).where(ReportLike.report_id.in_(ids), ReportLike.user_id == viewer.id)
            )
        )
        if viewer
        else set()
    )
    return [
        {
            "id": r.id,
            "status": r.status,
            "stage": r.stage,
            "species": r.species,
            "description": r.description,
            "zone_id": r.zone_id,
            "zone_name": zones[r.zone_id],
            "author": authors[r.user_id],
            "latitude": r.latitude,
            "longitude": r.longitude,
            "photo_source": r.photo_source,
            "location_source": r.location_source,
            "created_at": iso(r.created_at),
            "approved_at": iso(r.approved_at),
            "like_count": r.like_count,
            "liked": r.id in liked,
            "reason": r.reason,
            "photo_url": photo_url(r, viewer),
            "verification_model": models.get(r.id),
        }
        for r in reports
    ]


def report_page(db, query, viewer, page, page_size, sort="recent"):
    total = db.scalar(select(func.count()).select_from(query.order_by(None).subquery()))
    order = (
        (Report.like_count.desc(), Report.created_at.desc(), Report.id.desc())
        if sort == "popular"
        else (Report.created_at.desc(), Report.id.desc())
    )
    reports = list(db.scalars(query.order_by(*order).offset((page - 1) * page_size).limit(page_size)))
    return {
        "items": serialize_reports(db, reports, viewer),
        "total": total,
        "page": page,
        "has_more": page * page_size < total,
    }


@app.get("/health/live", tags=["운영"])
def live():
    return {"status": "ok"}


@app.get("/health/ready", tags=["운영"])
def ready(db: DB):
    try:
        db.execute(text("SELECT 1"))
        db.execute(select(Zone.id).limit(1))
        return {"status": "ready"}
    except Exception:
        return JSONResponse({"status": "unavailable"}, status_code=503)


@app.get("/api/config", tags=["운영"])
def config():
    return {
        "environment": s.environment,
        "verification_mode": s.verification_mode,
        "demo_enabled": s.environment == "local" and s.verification_mode == "demo",
        "report_points": s.report_points,
        "max_upload_bytes": s.max_upload_bytes,
    }


@app.post("/api/auth/register", response_model=AuthOut, status_code=201, tags=["인증"])
def register(payload: RegisterIn, db: DB):
    user = User(email=payload.email, nickname=payload.nickname, password_hash=hash_password(payload.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "이미 가입된 이메일입니다.")
    return {"access_token": make_token(user), "user": user_out(user)}


@app.post("/api/auth/login", response_model=AuthOut, tags=["인증"])
def login(payload: LoginIn, db: DB):
    user = db.scalar(select(User).where(User.email == payload.email))
    # Hash a dummy password too, to avoid a fast path for unknown addresses.
    if user is None:
        hash_password(payload.password)
        raise HTTPException(401, "이메일 또는 비밀번호를 확인해주세요.")
    if not check_password(payload.password, user.password_hash):
        raise HTTPException(401, "이메일 또는 비밀번호를 확인해주세요.")
    return {"access_token": make_token(user), "user": user_out(user)}


@app.get("/api/me", response_model=UserOut, tags=["내 정보"])
def me(user: Current):
    return user_out(user)


@app.get("/api/zones", tags=["지도"])
def zones(
    db: DB,
    min_lat: float | None = Query(None, ge=-90, le=90),
    max_lat: float | None = Query(None, ge=-90, le=90),
    min_lng: float | None = Query(None, ge=-180, le=180),
    max_lng: float | None = Query(None, ge=-180, le=180),
):
    q = select(Zone, ZoneStatus, ZoneActivity).join(ZoneStatus).join(ZoneActivity).where(Zone.active.is_(True))
    bounds = (min_lat, max_lat, min_lng, max_lng)
    if any(v is not None for v in bounds):
        if any(v is None for v in bounds) or min_lat > max_lat or min_lng > max_lng:
            raise HTTPException(422, "지도 범위 좌표 4개를 올바르게 전달해주세요.")
        q = q.where(Zone.latitude.between(min_lat, max_lat), Zone.longitude.between(min_lng, max_lng))
    return [
        {
            "id": z.id,
            "name": z.name,
            "latitude": z.latitude,
            "longitude": z.longitude,
            "district_code": z.district_code,
            "stage": st.stage,
            "latest_report_id": st.latest_report_id,
            "report_count": a.report_count,
            "reporter_count": a.reporter_count,
            "like_count": a.like_count,
            "interest_score": a.score,
            "tree_level": a.tree_level,
            "updated_at": iso(a.updated_at),
        }
        for z, st, a in db.execute(q.order_by(Zone.name))
    ]


@app.get("/api/zones/boundaries", tags=["지도"])
def zone_boundaries(db: DB):
    source = seoul_boundaries()
    return {
        **{key: source[key] for key in ("type", "name", "boundary_version", "license", "attribution", "bbox", "city_geometry")},
        "features": [
            {"type": "Feature", "id": zone.id,
             "properties": {"zone_id": zone.id, "name": zone.name, "district_code": zone.district_code},
             "geometry": zone.boundary}
            for zone in db.scalars(select(Zone).where(Zone.active.is_(True)).order_by(Zone.id))
        ],
    }


@app.post("/api/zones/resolve", tags=["지도"])
def resolve_location(location: LocationIn, db: DB):
    # Coordinates stay in the request body instead of URLs/access-log query strings.
    match = resolve_zone(db, location.latitude, location.longitude)
    if match is None:
        return {"zone": None, "distance_m": None}
    zone, distance = match
    return {
        "zone": {"id": zone.id, "name": zone.name, "district_code": zone.district_code},
        "distance_m": round(distance),
    }


@app.post("/api/reports", status_code=202, response_model=ReportOut, tags=["제보"])
def create_report(
    db: DB,
    user: Current,
    stage: Annotated[Stage, Form()],
    species: Annotated[Species, Form()],
    latitude: Annotated[float, Form(ge=-90, le=90)],
    longitude: Annotated[float, Form(ge=-180, le=180)],
    photo: Annotated[UploadFile, File()],
    zone_id: Annotated[str | None, Form(max_length=40)] = None,
    photo_source: Annotated[Literal["camera", "upload"], Form()] = "camera",
    location_source: Annotated[Literal["current", "manual"], Form()] = "current",
    description: Annotated[str, Form(max_length=1000)] = "",
    demo_outcome: Annotated[Literal["APPROVED", "REVIEW", "REJECTED"] | None, Form()] = None,
    idempotency_key: Annotated[str | None, Header(max_length=100, min_length=1)] = None,
):
    if user.role != "admin" and (photo_source == "upload" or location_source == "manual"):
        raise HTTPException(403, "사진 파일 선택과 위치 직접 지정은 운영자만 사용할 수 있습니다.")
    if demo_outcome is not None and (s.environment not in {"local", "test"} or s.verification_mode != "demo"):
        raise HTTPException(422, "테스트 검증 결과는 로컬 데모 환경에서만 지정할 수 있습니다.")
    raw = photo.file.read(s.max_upload_bytes + 1)
    if len(raw) > s.max_upload_bytes:
        raise HTTPException(413, "사진은 최대 10MB까지 업로드할 수 있습니다.")
    try:
        image = normalize_image(raw)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    if zone_id is None:
        match = resolve_zone(db, latitude, longitude)
        if match is None:
            raise HTTPException(422, "현재 위치는 제보 가능한 서비스 구역 밖입니다. 서울 안에서 제보해주세요.")
        zone, _ = match
        zone_id = zone.id
    else:
        # Preserve the existing API contract for older clients.
        zone = db.get(Zone, zone_id)
        if zone is None:
            raise HTTPException(404, "구역을 찾을 수 없습니다.")
        if not zone.active or not geometry_covers(zone.boundary, latitude, longitude):
            raise HTTPException(422, "제보 위치가 선택한 자치구 밖입니다.")
    season = db.scalar(
        select(Season)
        .where(Season.starts_at <= now(), Season.ends_at > now())
        .order_by(Season.starts_at.desc())
        .limit(1)
    )
    if season is None:
        raise HTTPException(409, "현재 제보 가능한 시즌이 없습니다.")
    photo_hash = hashlib.sha256(image).hexdigest()
    fingerprint = hashlib.sha256(
        json.dumps(
            [zone_id, stage, species, latitude, longitude, description, photo_hash, demo_outcome, photo_source, location_source], ensure_ascii=False
        ).encode()
    ).hexdigest()
    key = idempotency_key or uid()
    old = db.scalar(select(Report).where(Report.user_id == user.id, Report.request_key == key))
    if old:
        if old.request_fingerprint != fingerprint:
            raise HTTPException(409, "같은 요청 키로 다른 제보를 보낼 수 없습니다.")
        return serialize_reports(db, [old], user)[0]
    # Match the zone-before-user lock order used by approval transactions on MySQL.
    lock_zone(db, zone_id)
    cutoff = now() - timedelta(seconds=s.report_cooldown_seconds)
    allowed = db.execute(
        update(User)
        .where(User.id == user.id, or_(User.last_report_at.is_(None), User.last_report_at <= cutoff))
        .values(last_report_at=now())
    ).rowcount
    if not allowed:
        db.rollback()
        # A parallel duplicate request may have completed while we waited for the user lock.
        old = db.scalar(select(Report).where(Report.user_id == user.id, Report.request_key == key))
        if old and old.request_fingerprint == fingerprint:
            return serialize_reports(db, [old], user)[0]
        raise HTTPException(429, f"제보는 {s.report_cooldown_seconds}초 간격으로 등록할 수 있습니다.")
    report_id = uid()
    report = Report(
        id=report_id,
        user_id=user.id,
        zone_id=zone_id,
        season_id=season.id,
        stage=stage,
        species=species,
        latitude=latitude,
        longitude=longitude,
        description=description,
        photo_source=photo_source,
        location_source=location_source,
        object_key=f"reports/{report_id}.jpg",
        photo_hash=photo_hash,
        request_key=key,
        request_fingerprint=fingerprint,
        demo_outcome=demo_outcome,
    )
    db.add(report)
    try:
        db.flush()
        db.add(VerificationJob(report_id=report_id))
        db.commit()  # The row/job must exist BEFORE the ObjectCreated event can arrive.
    except IntegrityError:
        db.rollback()
        old = db.scalar(select(Report).where(Report.user_id == user.id, Report.request_key == key))
        if old and old.request_fingerprint == fingerprint:
            return serialize_reports(db, [old], user)[0]
        raise HTTPException(409, "중복 요청입니다.")
    try:
        get_storage().put(report.object_key, image)
    except Exception:
        # Leave pending until reconciliation: a storage timeout may happen after a successful PUT.
        logger.exception("photo_upload_failed report=%s", report_id)
        raise HTTPException(503, "사진 저장 확인이 지연되었습니다. 내 제보에서 상태를 확인해주세요.")
    enqueue(db, report_id)  # Conditional update never overwrites a result from a fast Cloud Function.
    db.commit()
    db.refresh(report)
    return serialize_reports(db, [report], user)[0]


@app.get("/api/reports", response_model=ReportPage, tags=["피드"])
def reports(
    db: DB,
    user: Optional,
    zone_id: str | None = Query(None, max_length=40),
    sort: Literal["recent", "popular"] = "recent",
    page: int = Query(1, ge=1, le=10000),
    page_size: int = Query(12, ge=1, le=50),
):
    q = select(Report).join(Zone).where(Report.status == "APPROVED", Zone.active.is_(True))
    if zone_id:
        q = q.where(Report.zone_id == zone_id)
    return report_page(db, q, user, page, page_size, sort)


@app.get("/api/me/reports", response_model=ReportPage, tags=["내 정보"])
def mine(db: DB, user: Current, page: int = Query(1, ge=1, le=10000), page_size: int = Query(20, ge=1, le=50)):
    return report_page(db, select(Report).where(Report.user_id == user.id), user, page, page_size)


@app.get("/api/reports/{report_id}", response_model=ReportOut, tags=["제보"])
def detail(report_id: str, db: DB, user: Optional):
    return serialize_reports(db, [visible_report(db, report_id, user)], user)[0]


@app.get("/api/reports/{report_id}/status", tags=["제보"])
def status(report_id: str, db: DB, user: Optional):
    report = visible_report(db, report_id, user)
    verification = db.get(ReportVerification, report_id)
    return {
        "id": report.id,
        "status": report.status,
        "reason": report.reason,
        "verification_model": verification.model if verification else None,
    }


@app.get("/api/reports/{report_id}/photo", tags=["제보"])
def photo(report_id: str, token: str, db: DB):
    try:
        claims = jwt.decode(
            token,
            s.jwt_secret.get_secret_value(),
            algorithms=["HS256"],
            audience="photo",
            options={"require": ["exp", "sub", "aud"]},
        )
        if claims["sub"] != report_id:
            raise ValueError("Wrong report")
    except (jwt.PyJWTError, ValueError):
        raise HTTPException(403, "사진 링크가 만료되었거나 유효하지 않습니다.")
    viewer = db.get(User, claims.get("viewer")) if claims.get("viewer") else None
    report = visible_report(db, report_id, viewer)
    storage = get_storage()
    if s.storage_backend == "s3":
        return RedirectResponse(storage.signed_url(report.object_key), headers={"Cache-Control": "private, no-store"})
    try:
        image = storage.get(report.object_key)
    except FileNotFoundError:
        raise HTTPException(404, "사진 업로드가 완료되지 않았습니다.")
    return Response(image, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=60"})


@app.put("/api/reports/{report_id}/like", tags=["좋아요"])
def like(report_id: str, db: DB, user: Current):
    return set_like(db, report_id, user.id, True)


@app.delete("/api/reports/{report_id}/like", tags=["좋아요"])
def unlike(report_id: str, db: DB, user: Current):
    return set_like(db, report_id, user.id, False)


@app.get("/api/me/points", tags=["내 정보"])
def points(db: DB, user: Current):
    rows = db.scalars(
        select(PointLedger).where(PointLedger.user_id == user.id).order_by(PointLedger.created_at.desc()).limit(50)
    )
    return {
        "balance": user.points,
        "ledger": [{"id": p.id, "amount": p.amount, "reason": p.reason, "created_at": iso(p.created_at)} for p in rows],
    }


@app.get("/api/items", tags=["나무"])
def items(db: DB, user: Optional):
    owned = set(db.scalars(select(UserItem.item_id).where(UserItem.user_id == user.id))) if user else set()
    equipped = set(db.scalars(select(TreeEquipment.item_id).where(TreeEquipment.user_id == user.id))) if user else set()
    return [
        {
            "id": i.id,
            "name": i.name,
            "price": i.price,
            "slot": i.slot,
            "icon": i.icon,
            "owned": i.id in owned,
            "equipped": i.id in equipped,
        }
        for i in db.scalars(select(Item).order_by(Item.price))
    ]


@app.put("/api/me/items/{item_id}", tags=["나무"])
def purchase(item_id: str, db: DB, user: Current):
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(404, "아이템을 찾을 수 없습니다.")
    db.execute(update(User).where(User.id == user.id).values(points=User.points))
    db.refresh(user)
    if db.get(UserItem, (user.id, item_id)) is not None:
        return {"owned": True, "balance": user.points}
    if user.points < item.price:
        raise HTTPException(409, "포인트가 부족합니다.")
    db.add(UserItem(user_id=user.id, item_id=item_id))
    user.points -= item.price
    db.add(
        PointLedger(
            user_id=user.id, dedupe_key=f"purchase:{user.id}:{item_id}", amount=-item.price, reason=f"{item.name} 구매"
        )
    )
    db.commit()
    return {"owned": True, "balance": user.points}


@app.put("/api/me/tree/equipment/{slot}", tags=["나무"])
def equip(slot: str, payload: EquipIn, db: DB, user: Current):
    db.execute(update(User).where(User.id == user.id).values(points=User.points))
    item = db.get(Item, payload.item_id)
    if item is None or item.slot != slot:
        raise HTTPException(422, "아이템 장착 위치가 올바르지 않습니다.")
    if db.get(UserItem, (user.id, item.id)) is None:
        raise HTTPException(403, "보유한 아이템만 장착할 수 있습니다.")
    equipment = db.get(TreeEquipment, (user.id, slot))
    if equipment:
        equipment.item_id = item.id
    else:
        db.add(TreeEquipment(user_id=user.id, slot=slot, item_id=item.id))
    db.commit()
    return {"slot": slot, "item_id": item.id}


@app.get("/api/admin/reports", response_model=ReportPage, tags=["운영자"])
def review_queue(db: DB, user: Admin, page: int = Query(1, ge=1, le=10000), page_size: int = Query(20, ge=1, le=50)):
    return report_page(db, select(Report).where(Report.status == "REVIEW"), user, page, page_size)


@app.post("/api/admin/reports/{report_id}/decision", response_model=ReportOut, tags=["운영자"])
def review(report_id: str, payload: ReviewIn, db: DB, user: Admin):
    report = db.get(Report, report_id)
    if report is None:
        raise HTTPException(404, "제보를 찾을 수 없습니다.")
    changed = decide_report(db, report_id, payload.decision, payload.reason, allowed=("REVIEW",))
    db.refresh(report)
    if not changed and report.status != payload.decision:
        raise HTTPException(409, "검토 대기 상태의 제보만 처리할 수 있습니다.")
    if changed:
        verification = db.get(ReportVerification, report_id)
        verification.reviewer_id = user.id
        verification.reviewed_at = now()
        verification.review_reason = payload.reason
    db.commit()
    db.refresh(report)
    return serialize_reports(db, [report], user)[0]
