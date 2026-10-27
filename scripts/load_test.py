#!/usr/bin/env python3
"""Bounded HTTP load generator. `plan` is offline; `run` creates real reports."""
from __future__ import annotations

import argparse
import asyncio
import base64
from collections import Counter, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import io
import json
import math
from pathlib import Path
import random
import resource
import signal
import sys
import time
from urllib.parse import urlsplit
import uuid
import warnings

import httpx
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.geography import geometry_covers, seoul_boundaries  # noqa: E402

DEFAULTS = Path(__file__).with_name("loadtest")
TERMINAL = {"APPROVED", "REJECTED", "REVIEW", "UPLOAD_FAILED"}
STATUSES = TERMINAL | {"PENDING_UPLOAD", "PENDING_AI"}
Image.MAX_IMAGE_PIXELS = 24_000_000


def utc():
    return datetime.now(timezone.utc).isoformat()


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def atomic_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def number(data, key, minimum=0, integer=False):
    value = data.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{key}: 유한한 숫자가 필요합니다")
    if value < minimum or (integer and not isinstance(value, int)):
        raise ValueError(f"{key}: {'정수 ' if integer else ''}{minimum} 이상이어야 합니다")
    return value


def load_scenario(path):
    data = read_json(path)
    if not isinstance(data, dict) or not isinstance(data.get("stages"), list) or not data["stages"]:
        raise ValueError("scenario.stages 목록이 필요합니다")
    for key in ("cooldown_seconds", "drain_seconds", "shutdown_seconds"):
        number(data, key)
    for key in ("max_reports", "max_requests", "max_upload_bytes", "submit_concurrency", "feed_concurrency"):
        number(data, key, 1, integer=True)
    for key in ("max_duration_seconds", "timeout_seconds", "poll_interval_seconds", "observation_rps"):
        number(data, key, 0.001)
    for key in ("status_sample_limit", "visibility_pages", "image_max_bytes"):
        number(data, key, 1, integer=True)
    for key in ("status_sample_rate", "photo_download_ratio"):
        if number(data, key) > 1:
            raise ValueError(f"{key}: 0~1 범위여야 합니다")
    names = set()
    for stage in data["stages"]:
        if not isinstance(stage.get("name"), str) or not stage["name"] or stage["name"] in names:
            raise ValueError("단계 이름은 비어 있지 않은 고유 문자열이어야 합니다")
        names.add(stage["name"])
        number(stage, "seconds", 0.001)
        for key in ("submit_rps", "feed_rps"):
            number(stage, key)
    return data


@dataclass
class Photo:
    name: str
    species: str
    stage: str
    content: bytes
    mime: str
    width: int
    height: int
    test_case: str = "foliage"
    expected_decision: str | None = None

    def public(self):
        return {"name": self.name, "species": self.species, "stage": self.stage,
                "test_case": self.test_case, "expected_decision": self.expected_decision,
                "bytes": len(self.content), "width": self.width, "height": self.height,
                "sha256": hashlib.sha256(self.content).hexdigest()}


def load_photos(path):
    path = Path(path).resolve()
    rows = read_json(path)
    if not isinstance(rows, list) or not rows:
        raise ValueError("사진 매니페스트가 비어 있습니다")
    photos = []
    for row in rows:
        species, stage = row.get("species"), row.get("stage")
        test_case = row.get("test_case", "foliage")
        expected = row.get("expected_decision")
        valid_species = {"MIXED"} if test_case == "unrelated" else {"GINKGO", "MAPLE"}
        if test_case not in {"foliage", "unrelated"} or expected not in {None, "APPROVED", "REVIEW", "REJECTED"}:
            raise ValueError("사진의 test_case/expected_decision 값을 확인해주세요")
        if species not in valid_species or stage not in {"GREEN", "STARTING", "PEAK", "FALLEN"}:
            raise ValueError("사진의 species/stage 값을 확인해주세요")
        source = (path.parent / row["path"]).resolve()
        content = source.read_bytes()
        if not content or len(content) > 10 * 1024 * 1024:
            raise ValueError(f"{source.name}: 사진 크기는 0보다 크고 10 MiB 이하여야 합니다")
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as image:
                image.load()
                if image.format not in {"JPEG", "PNG", "WEBP"}:
                    raise ValueError(f"{source.name}: 지원하지 않는 이미지 형식")
                w, h = image.size
                if min(w, h) < 32 or max(w, h) / min(w, h) > 5:
                    raise ValueError(f"{source.name}: 이미지 해상도/비율 오류")
                mime = Image.MIME[image.format]
        photos.append(Photo(source.name, species, stage, content, mime, w, h, test_case, expected))
    return photos


class Locations:
    """Uniform district selection, then rejection sampling inside its actual polygon."""

    def __init__(self, collection, district=None):
        seoul_codes = {f["properties"]["district_code"] for f in seoul_boundaries()["features"]}
        self.features = []
        self.bounds = {}
        for feature in collection["features"]:
            props = feature["properties"]
            code = str(props.get("district_code"))
            if code not in seoul_codes or not feature.get("geometry"):
                continue
            zone_id = feature.get("id") or props.get("zone_id")
            if district and district not in {zone_id, code, props.get("name")}:
                continue
            geometry = feature["geometry"]
            polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
            points = [p for polygon in polygons for p in polygon[0]]
            self.bounds[zone_id] = (min(p[0] for p in points), min(p[1] for p in points),
                                    max(p[0] for p in points), max(p[1] for p in points))
            self.features.append({"id": zone_id, "name": props["name"], "code": code, "geometry": geometry})
        if not self.features:
            raise ValueError("선택한 서울 자치구의 활성 경계가 없습니다")

    def sample(self, rng, feature=None):
        feature = feature or rng.choice(self.features)
        x0, y0, x1, y1 = self.bounds[feature["id"]]
        for _ in range(10000):
            lng, lat = rng.uniform(x0, x1), rng.uniform(y0, y1)
            if geometry_covers(feature["geometry"], lat, lng):
                return {"zone_id": feature["id"], "zone_name": feature["name"],
                        "latitude": lat, "longitude": lng}
        raise ValueError("자치구 경계 내부 좌표를 생성하지 못했습니다")


@dataclass
class Account:
    label: str
    email: str = field(repr=False)
    password: str = field(repr=False)
    token: str = field(default="", repr=False)
    expires: float = 0
    user_id: str | None = None
    ready: float = 0
    busy: bool = False
    lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)


def load_accounts(path):
    rows = read_json(path)
    if not isinstance(rows, list) or not rows:
        raise ValueError("계정 파일은 이메일·비밀번호 객체 목록이어야 합니다")
    seen, accounts = set(), []
    for row in rows:
        email, password = row.get("email", "").strip().lower(), row.get("password", "")
        if "@" not in email or len(password) < 8 or email in seen:
            raise ValueError("계정 파일에 중복 계정 또는 잘못된 이메일·비밀번호가 있습니다")
        seen.add(email)
        accounts.append(Account(f"account_{len(accounts) + 1:04d}", email, password))
    return accounts


def slots(stage, mode):
    return sum(math.ceil(stage[key] * stage["seconds"] - 1e-9)
               for key in ("submit_rps", "feed_rps")
               if (key == "submit_rps" and mode != "feed") or (key == "feed_rps" and mode != "submit"))


def make_plan(config, photos, mode, accounts=None):
    peak = max(s["submit_rps"] for s in config["stages"]) if mode != "feed" else 0
    submits = sum(math.ceil(s["submit_rps"] * s["seconds"] - 1e-9) for s in config["stages"]) if peak else 0
    requests = sum(slots(s, mode) for s in config["stages"])
    minimum = math.ceil(peak * config["cooldown_seconds"]) if peak else 0
    # Even a zero cooldown needs enough accounts for concurrent in-flight requests.
    minimum = max(minimum, int(peak > 0))
    plan = {"mode": mode, "measurement_seconds": sum(s["seconds"] for s in config["stages"]),
            "scheduled_submits": submits, "preflight_submits": int(peak > 0),
            "scheduled_requests": requests, "minimum_accounts": minimum,
            "suggested_accounts": math.ceil(minimum * 1.2), "provided_accounts": accounts,
            "photo_payload_bytes_upper_bound": (submits + int(peak > 0)) * max((len(p.content) for p in photos), default=0),
            "photos": [p.public() for p in photos], "limits": {k: v for k, v in config.items() if k.startswith("max_")},
            "notes": ["계정 수 계산은 지연을 제외한 하한입니다. 서버의 실제 제보 간격과 설정값을 맞추세요.",
                      "사진 바이트 한도는 원본 파일 기준이며 multipart·TLS 전송 오버헤드는 별도입니다.",
                      "조회·제보 목표량은 한도 또는 생성기 포화로 줄어들 수 있습니다."]}
    if accounts is not None and accounts < minimum:
        plan["notes"].append("계정 수가 이론상 최소보다 적습니다. 요청을 보류하지 않고 dropped로 기록합니다.")
    return plan


def percentiles(values):
    if not values:
        return {"p50": None, "p95": None, "p99": None}
    values = sorted(values)
    return {f"p{p}": round(values[max(0, math.ceil(len(values) * p / 100) - 1)], 2) for p in (50, 95, 99)}


class Runner:
    def __init__(self, args, config, photos, accounts, client):
        self.args, self.config, self.photos, self.accounts, self.client = args, config, photos, accounts, client
        self.rng = random.Random(args.seed)
        self.observer_rng = random.Random(args.seed + 1)
        self.run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex[:8]
        self.output = Path(args.output_dir).resolve() / self.run_id
        self.output.mkdir(parents=True, exist_ok=False)
        self.log = (self.output / "requests.jsonl").open("w", encoding="utf-8", buffering=1)
        self.journal = (self.output / "manifest.jsonl").open("w", encoding="utf-8", buffering=1)
        self.started_at = utc()
        self.started = time.monotonic()
        self.resources_start = resource.getrusage(resource.RUSAGE_SELF)
        self.records, self.manifest, self.observations = [], [], []
        self.recent = {}
        self.feed_pages = {}
        self.dropped = Counter()
        self.scheduled = Counter()
        self.active = Counter()
        self.attempts = 0
        self.photo_bytes = 0
        self.stop = asyncio.Event()
        self.interrupted = False
        self.reason = "completed"
        self.tasks = set()
        self.sequence = 0
        self.stage = "preflight"
        self.locations = Locations(seoul_boundaries(), args.district)
        self.last_observation = 0.0
        self.setup_error = None
        preview_dir = self.output / "photos"
        preview_dir.mkdir()
        self.photo_previews = {}
        for photo in photos:
            filename = hashlib.sha256(photo.content).hexdigest() + {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[photo.mime]
            (preview_dir / filename).write_bytes(photo.content)
            self.photo_previews[photo.name] = f"/api/runs/{self.run_id}/photos/{filename}"

    def halt(self, reason):
        if not self.stop.is_set():
            self.reason = reason
            self.stop.set()

    def interrupt(self):
        self.interrupted = True
        self.halt("interrupted")

    def add_record(self, record):
        self.records.append(record)
        self.log.write(json.dumps(record, ensure_ascii=False) + "\n")
        if record["phase"] != "measure":
            return
        if record["status"] == 429:
            self.halt("rate_limited")
        elif record["status"] in {401, 403, 413, 422}:
            self.halt("authentication_or_input_error")
        recent = self.recent.setdefault(record["kind"], deque())
        recent.append(record)
        while recent and record["elapsed_seconds"] - recent[0]["elapsed_seconds"] > 30:
            recent.popleft()
        if len(recent) >= 20 and sum(r["status"] >= 500 or (r["status"] == 0 and r["error"] != "cancelled")
                                     for r in recent) / len(recent) >= 0.1:
            self.halt("error_threshold")

    async def request(self, method, path, *, kind, phase, stage=None, expected=(200,), account=None, **kwargs):
        record = {"at": utc(), "elapsed_seconds": round(time.monotonic() - self.started, 3),
                  "kind": kind, "phase": phase, "stage": stage or self.stage, "status": 0, "error": None}
        if account:
            record["account"] = account.label
        start = time.monotonic()
        response = None
        try:
            response = await self.client.request(method, path, **kwargs)
            record["status"] = response.status_code
            if response.status_code not in expected:
                record["error"] = "unexpected_status"
        except asyncio.CancelledError:
            record["error"] = "cancelled"
            raise
        except httpx.HTTPError as exc:
            record["error"] = "TimeoutException" if isinstance(exc, httpx.TimeoutException) else type(exc).__name__
        finally:
            record["latency_ms"] = round((time.monotonic() - start) * 1000, 2)
            record["finished_at"] = utc()
            record["elapsed_seconds"] = round(time.monotonic() - self.started, 3)
            # Deliberately omit URLs, bodies, tokens, email addresses and exception messages.
            self.add_record(record)
        return response

    async def login(self, account):
        async with account.lock:
            if account.token and account.expires > time.time() + 30:
                return
            response = await self.request("POST", "/api/auth/login", kind="login", phase="auth", account=account,
                                          json={"email": account.email, "password": account.password})
            if response is None or response.status_code != 200:
                raise ValueError(f"{account.label}: 로그인 실패")
            payload = response.json()
            if payload.get("user", {}).get("role") != "admin":
                raise ValueError(f"{account.label}: 테스트 전용 운영자 계정이 필요합니다")
            account.token = payload["access_token"]
            account.user_id = payload["user"]["id"]
            try:
                part = account.token.split(".")[1]
                account.expires = float(json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))["exp"])
            except (ValueError, KeyError, IndexError, TypeError):
                account.expires = time.time() + 60

    async def headers(self, account):
        await self.login(account)
        return {"Authorization": f"Bearer {account.token}"}

    def reserve(self, photo):
        if self.attempts >= self.config["max_reports"]:
            self.halt("max_reports")
            return False
        if self.photo_bytes + len(photo.content) > self.config["max_upload_bytes"]:
            self.halt("max_upload_bytes")
            return False
        self.attempts += 1
        self.photo_bytes += len(photo.content)
        return True

    async def submit(self, account, photo, location, sequence, stage, phase="measure"):
        key = f"{self.run_id}:{sequence}"
        subject = "무관 이미지 반려 검증" if photo.test_case == "unrelated" else ("은행" if photo.species == "GINKGO" else "단풍")
        description = f"[LOADTEST:{key}] {location['zone_name']} {subject} 테스트 제보"
        entry = {"sequence": sequence, "key": key, "account": account.label, "description": description,
                 "species": photo.species, "stage": photo.stage, "photo": photo.name, "phase": phase,
                 "test_case": photo.test_case, "expected_decision": photo.expected_decision,
                 **location, "report_id": None, "status": "UNCERTAIN", "submitted_at": utc(),
                 "submitted_monotonic": time.monotonic(), "http_status": None}
        self.manifest.append(entry)
        self.journal.write(json.dumps({k: v for k, v in entry.items() if k != "submitted_monotonic"}, ensure_ascii=False) + "\n")
        try:
            headers = await self.headers(account)
            response = await self.request("POST", "/api/reports", kind="submit", phase=phase, stage=stage,
                                          expected=(202,), account=account,
                                          headers={**headers, "Idempotency-Key": key},
                                          data={"stage": photo.stage, "species": photo.species,
                                                "latitude": str(location["latitude"]), "longitude": str(location["longitude"]),
                                                "description": description, "photo_source": "upload", "location_source": "manual"},
                                          files={"photo": (photo.name, photo.content, photo.mime)})
            entry["http_status"] = response.status_code if response is not None else 0
            if response is not None and response.status_code == 202:
                payload = response.json()
                if not isinstance(payload.get("id"), str) or payload.get("status") not in STATUSES:
                    raise ValueError("제보 202 응답 형식이 서버 계약과 다릅니다")
                entry["report_id"], entry["status"] = payload["id"], payload["status"]
                entry["accepted_at"] = utc()
                entry["accepted_monotonic"] = time.monotonic()
                if entry["status"] in TERMINAL:
                    entry["verification_observed_ms"] = 0
                if len(self.observations) < self.config["status_sample_limit"] and (
                        phase == "preflight" or self.observer_rng.random() < self.config["status_sample_rate"]):
                    entry["next_poll"] = time.monotonic()
                    entry["sampled"] = True
                    self.observations.append((entry, account))
            elif response is not None and response.status_code not in {503} and response.status_code < 500:
                entry["status"] = "NOT_ACCEPTED"
        finally:
            account.busy = False
            account.ready = time.monotonic() + self.config["cooldown_seconds"]
            self.journal.write(json.dumps({k: v for k, v in entry.items()
                                          if not k.endswith("_monotonic") and k != "next_poll"}, ensure_ascii=False) + "\n")

    async def feed(self, stage, params, download):
        response = await self.request("GET", "/api/reports", kind="feed", phase="measure", stage=stage, params=params)
        if response is None or response.status_code != 200:
            return
        payload = response.json()
        if not isinstance(payload.get("items"), list):
            raise ValueError("피드 응답 형식 오류")
        total = payload.get("total", 0)
        self.feed_pages[(params.get("zone_id"), params["sort"])] = max(1, min(5, math.ceil(total / 12)))
        if download:
            item = next((row for row in payload["items"] if row.get("photo_url")), None)
            if item:
                await self.download_photo(item["photo_url"], stage)

    async def download_photo(self, url, stage):
        start = time.monotonic()
        record = {"at": utc(), "elapsed_seconds": round(start - self.started, 3), "kind": "photo",
                  "phase": "measure", "stage": stage, "status": 0, "error": None, "bytes": 0}
        try:
            # Never forward API authentication to signed photo URLs, including external Object Storage.
            async with self.client.stream("GET", url, headers={}) as response:
                record["status"] = response.status_code
                if response.status_code != 200:
                    record["error"] = "unexpected_status"
                async for block in response.aiter_bytes():
                    record["bytes"] += len(block)
                    if record["bytes"] > self.config["image_max_bytes"]:
                        record["error"] = "image_download_limit"
                        break
        except asyncio.CancelledError:
            record["error"] = "cancelled"
            raise
        except httpx.HTTPError as exc:
            record["error"] = "TimeoutException" if isinstance(exc, httpx.TimeoutException) else type(exc).__name__
        finally:
            record["latency_ms"] = round((time.monotonic() - start) * 1000, 2)
            record["finished_at"] = utc()
            record["elapsed_seconds"] = round(time.monotonic() - self.started, 3)
            self.add_record(record)

    async def preflight(self):
        for path in ("/health/ready", "/api/config"):
            response = await self.request("GET", path, kind="preflight", phase="preflight")
            if response is None or response.status_code != 200:
                raise ValueError(f"사전 점검 실패: {path}")
            if path == "/api/config":
                server = response.json()
                self.server_config = {k: server.get(k) for k in ("environment", "verification_mode", "max_upload_bytes")}
                if self.photos and max(len(p.content) for p in self.photos) > server["max_upload_bytes"]:
                    raise ValueError("배포 서버의 사진 바이트 한도를 초과합니다")
        boundaries = await self.request("GET", "/api/zones/boundaries", kind="boundaries", phase="preflight")
        if boundaries is None or boundaries.status_code != 200:
            raise ValueError("활성 자치구 경계 조회 실패")
        self.locations = Locations(boundaries.json(), self.args.district)
        if self.args.mode == "feed":
            return
        for account in self.accounts:
            if self.interrupted:
                return
            await self.login(account)
        for feature in self.locations.features:
            if self.interrupted:
                return
            location = self.locations.sample(self.rng, feature)
            response = await self.request("POST", "/api/zones/resolve", kind="resolve", phase="preflight",
                                          json={k: location[k] for k in ("latitude", "longitude")})
            if response is None or response.status_code != 200 or (response.json().get("zone") or {}).get("id") != location["zone_id"]:
                raise ValueError("서버의 자치구 경계 판정과 생성 좌표가 일치하지 않습니다")
        photo = self.rng.choice(self.photos)
        if self.interrupted:
            return
        if not self.reserve(photo):
            return
        account = self.accounts[0]
        account.busy = True
        await self.submit(account, photo, self.locations.sample(self.rng), 0, "preflight", "preflight")
        if not self.manifest[-1]["report_id"]:
            raise ValueError("사전 제보 1건이 접수되지 않았습니다. HTTP 상태와 manifest를 확인해주세요")

    async def observation_slot(self):
        delay = 1 / self.config["observation_rps"] - (time.monotonic() - self.last_observation)
        if delay > 0:
            await asyncio.sleep(delay)
        self.last_observation = time.monotonic()

    async def observe_once(self):
        for entry, account in list(self.observations):
            if self.interrupted:
                return
            if entry["status"] in TERMINAL or time.monotonic() < entry["next_poll"]:
                continue
            await self.observation_slot()
            response = await self.request("GET", f"/api/reports/{entry['report_id']}/status",
                                          kind="status", phase="observe", headers=await self.headers(account), account=account)
            entry["next_poll"] = time.monotonic() + self.config["poll_interval_seconds"]
            if response is not None and response.status_code == 200:
                status = response.json().get("status")
                if status not in STATUSES:
                    raise ValueError("제보 상태 응답 형식 오류")
                entry["status"] = status
                entry["status_observed_at"] = utc()
                if status in TERMINAL:
                    entry["verification_observed_ms"] = round((time.monotonic() - entry["accepted_monotonic"]) * 1000, 2)

    async def observer(self):
        while True:
            await self.observe_once()
            await asyncio.sleep(min(1, self.config["poll_interval_seconds"]))

    async def visibility(self):
        pending = {entry["report_id"]: entry for entry, _ in self.observations if entry["status"] == "APPROVED"}
        for entry in pending.values():
            entry["visibility"] = "visibility_unknown"
        for page in range(1, self.config["visibility_pages"] + 1):
            if not pending or self.interrupted:
                break
            await self.observation_slot()
            response = await self.request("GET", "/api/reports", kind="visibility", phase="observe",
                                          params={"sort": "recent", "page": page, "page_size": 50})
            if response is None or response.status_code != 200:
                break
            payload = response.json()
            for row in payload["items"]:
                entry = pending.pop(row["id"], None)
                if entry:
                    entry["visibility"] = "visible"
                    entry["visible_observed_at"] = utc()
                    entry["visible_observed_ms"] = round((time.monotonic() - entry["accepted_monotonic"]) * 1000, 2)
            if not payload.get("has_more"):
                break

    async def guarded(self, kind, coroutine):
        try:
            await coroutine
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.setup_error = type(exc).__name__
            self.halt("client_or_contract_error")
        finally:
            self.active[kind] -= 1

    def launch(self, kind, coroutine):
        self.active[kind] += 1
        task = asyncio.create_task(self.guarded(kind, coroutine))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    def dispatch(self, kind, stage):
        if self.stop.is_set():
            return
        if sum(self.scheduled.values()) >= self.config["max_requests"]:
            self.halt("max_requests")
            return
        self.scheduled[kind] += 1
        if self.active[kind] >= self.config[f"{kind}_concurrency"]:
            self.dropped[f"{kind}:concurrency"] += 1
            return
        if kind == "submit":
            account = next((a for a in self.accounts if not a.busy and a.ready <= time.monotonic()), None)
            if account is None:
                self.dropped["submit:account_cooldown"] += 1
                return
            photo = self.rng.choice(self.photos)
            if not self.reserve(photo):
                return
            self.sequence += 1
            location = self.locations.sample(self.rng)
            account.busy = True
            self.launch(kind, self.submit(account, photo, location, self.sequence, stage))
        else:
            params = {"sort": "recent" if self.rng.random() < 0.7 else "popular", "page": 1, "page_size": 12}
            if self.rng.random() < 0.5:
                params["zone_id"] = self.rng.choice(self.locations.features)["id"]
            params["page"] = self.rng.randint(1, self.feed_pages.get((params.get("zone_id"), params["sort"]), 1))
            self.launch(kind, self.feed(stage, params, self.rng.random() < self.config["photo_download_ratio"]))

    async def stages(self):
        self.measure_start = time.monotonic()
        self.stage_timings = []
        for stage in self.config["stages"]:
            if self.stop.is_set():
                break
            self.stage = stage["name"]
            began = time.monotonic()
            self.stage_timings.append({"name": self.stage, "at": utc(),
                                       "target_submit_rps": stage["submit_rps"] if self.args.mode != "feed" else 0,
                                       "target_feed_rps": stage["feed_rps"] if self.args.mode != "submit" else 0,
                                       "seconds": stage["seconds"]})
            print(f"[{self.run_id}] {self.stage}: 제보 {stage['submit_rps']}/s · 피드 {stage['feed_rps']}/s", flush=True)
            next_at = {kind: began for kind in ("submit", "feed")
                       if stage[f"{kind}_rps"] > 0 and (self.args.mode == "mixed" or self.args.mode == kind)}
            next_progress = began + 10
            while not self.stop.is_set() and time.monotonic() < began + stage["seconds"]:
                now = time.monotonic()
                if now - self.measure_start >= self.config["max_duration_seconds"]:
                    self.halt("max_duration_seconds")
                    break
                for kind in next_at:
                    period = 1 / stage[f"{kind}_rps"]
                    if now >= next_at[kind]:
                        missed = max(0, math.floor((now - next_at[kind]) / period))
                        if missed:
                            self.dropped[f"{kind}:scheduler_lag"] += missed
                            self.scheduled[kind] += missed
                            next_at[kind] += missed * period
                        self.dispatch(kind, self.stage)
                        next_at[kind] += period
                if now >= next_progress:
                    print(f"  접수 {sum(bool(e['report_id']) for e in self.manifest)}건 · 미발송 {sum(self.dropped.values())} · 진행 중 {sum(self.active.values())}", flush=True)
                    self.checkpoint()
                    next_progress = now + 10
                wait = max(0.001, min([0.2, began + stage["seconds"] - now] + [t - now for t in next_at.values()]))
                try:
                    await asyncio.wait_for(self.stop.wait(), timeout=wait)
                except asyncio.TimeoutError:
                    pass
            self.stage_timings[-1]["elapsed_seconds"] = time.monotonic() - began
        self.measure_seconds = time.monotonic() - self.measure_start

    async def settle(self):
        if self.tasks:
            _, pending = await asyncio.wait(list(self.tasks), timeout=self.config["shutdown_seconds"])
            for task in pending:
                task.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)

    async def execute(self):
        observer = None
        publisher = asyncio.create_task(self.publish_live())
        try:
            await self.preflight()
            if not self.stop.is_set():
                # A one-account run must not immediately violate its preflight cooldown.
                if self.accounts:
                    delay = max(0, min(a.ready for a in self.accounts) - time.monotonic())
                    try:
                        await asyncio.wait_for(self.stop.wait(), timeout=delay)
                    except asyncio.TimeoutError:
                        pass
                observer = asyncio.create_task(self.observer())
                def observer_done(task):
                    if not task.cancelled() and task.exception() is not None:
                        self.setup_error = type(task.exception()).__name__
                        self.halt("observation_error")
                observer.add_done_callback(observer_done)
                await self.stages()
            await self.settle()
            self.stage = "drain"
            if not self.interrupted:
                deadline = time.monotonic() + self.config["drain_seconds"]
                while not self.interrupted and time.monotonic() < deadline and any(e["status"] not in TERMINAL for e, _ in self.observations):
                    if observer and observer.done():
                        await observer
                    await asyncio.sleep(min(0.2, max(0, deadline - time.monotonic())))
            if observer:
                observer.cancel()
                await asyncio.gather(observer, return_exceptions=True)
                observer = None
            if not self.interrupted:
                await self.visibility()
        except asyncio.CancelledError:
            self.interrupt()
        except Exception as exc:
            self.setup_error = type(exc).__name__
            self.halt("setup_or_runtime_error")
            # Input errors have controlled messages; never display arbitrary HTTP/response exception text.
            print(f"테스트 중단: {str(exc) if isinstance(exc, ValueError) else type(exc).__name__}", file=sys.stderr)
        finally:
            publisher.cancel()
            await asyncio.gather(publisher, return_exceptions=True)
            if observer:
                observer.cancel()
                await asyncio.gather(observer, return_exceptions=True)
            await self.settle()
            self.checkpoint(final=True)
            self.write_live(final=True)
            self.log.close()
            self.journal.close()
        print(f"결과: {self.output / 'report.md'}", flush=True)
        return 130 if self.interrupted else (1 if self.reason not in {"completed", "max_reports", "max_requests", "max_duration_seconds", "max_upload_bytes"} else 0)

    async def publish_live(self):
        while True:
            try:
                self.write_live()
            except OSError as exc:
                # Monitoring failure must not terminate a test or lose its primary result files.
                print(f"실시간 기록 갱신 실패: {type(exc).__name__}", file=sys.stderr)
            await asyncio.sleep(1)

    def write_live(self, final=False):
        elapsed = time.monotonic() - self.started
        completed = Counter(r["kind"] for r in self.records)
        errors = Counter(r["kind"] for r in self.records if r["error"] is not None)
        states = Counter(e["status"] for e in self.manifest)
        recent = [r for r in self.records if r["phase"] == "measure" and r["elapsed_seconds"] >= elapsed - 60]
        buckets = {}
        for record in recent:
            bucket = buckets.setdefault(int(record["elapsed_seconds"]), Counter())
            bucket[record["kind"]] += 1
            if record["error"]:
                bucket["errors"] += 1
        series = [{"second": second, "submit": buckets.get(second, {}).get("submit", 0),
                   "feed": buckets.get(second, {}).get("feed", 0), "errors": buckets.get(second, {}).get("errors", 0)}
                  for second in range(max(0, int(elapsed) - 59), int(elapsed) + 1)]
        reports = [{key: entry.get(key) for key in ("sequence", "report_id", "species", "stage", "photo", "zone_name",
                    "latitude", "longitude", "status", "http_status", "submitted_at", "status_observed_at", "sampled",
                    "test_case", "expected_decision")}
                   | {"photo_preview": self.photo_previews.get(entry["photo"])} for entry in self.manifest[-1000:]]
        active_stage = next((s for s in self.config["stages"] if s["name"] == self.stage), {})
        atomic_json(self.output / "live.json", {
            "run_id": self.run_id, "updated_at": utc(), "started_at": self.started_at, "final": final,
            "target": self.args.base_url, "stage": self.stage, "reason": self.reason,
            "elapsed_seconds": round(elapsed, 1), "mode": self.args.mode,
            "server_environment": getattr(self, "server_config", {}).get("environment"),
            "verification_mode": getattr(self, "server_config", {}).get("verification_mode"),
            "attempts": self.attempts, "accepted": sum(bool(e["report_id"]) for e in self.manifest),
            "states": dict(states), "completed": dict(completed), "errors": dict(errors),
            "active": dict(self.active), "dropped": sum(self.dropped.values()),
            "recent_submit_rps": round(sum(r["kind"] == "submit" and r["elapsed_seconds"] >= elapsed - 10
                                           for r in recent) / min(10, max(elapsed, 1)), 2),
            "recent_feed_rps": round(sum(r["kind"] == "feed" and r["elapsed_seconds"] >= elapsed - 10
                                         for r in recent) / min(10, max(elapsed, 1)), 2),
            "recent_latency_ms": percentiles([r["latency_ms"] for r in recent]),
            "target_submit_rps": active_stage.get("submit_rps", 0) if self.args.mode != "feed" else 0,
            "target_feed_rps": active_stage.get("feed_rps", 0) if self.args.mode != "submit" else 0,
            "series": series, "reports": reports, "report_limit": self.config["max_reports"],
            "map_report_limit": 1000,
        })

    def checkpoint(self, final=False):
        manifest = [{k: v for k, v in entry.items() if not k.endswith("_monotonic") and k != "next_poll"}
                    for entry in self.manifest]
        atomic_json(self.output / "manifest.json", {"run_id": self.run_id, "reports": manifest,
                    "accounts": [{"label": a.label, "user_id": a.user_id} for a in self.accounts],
                    "cleanup": "삭제 API 없음. 이 목록을 이용한 별도 관리 작업 필요. 미확정 제출은 사후 대조 필요."})
        groups = {}
        for record in self.records:
            key = f"{record['phase']}/{record['stage']}/{record['kind']}"
            groups.setdefault(key, []).append(record)
        metrics = {}
        durations = {s["name"]: s.get("elapsed_seconds", 0) for s in getattr(self, "stage_timings", [])}
        for key, records in groups.items():
            success = [r for r in records if r["error"] is None]
            metrics[key] = {"count": len(records), "success": len(success),
                            "status_codes": dict(Counter(str(r["status"]) for r in records)),
                            "errors": dict(Counter(r["error"] for r in records if r["error"])),
                            "average_rps": round(len(records) / durations[records[0]["stage"]], 3)
                            if records[0]["phase"] == "measure" and durations.get(records[0]["stage"]) else None,
                            "latency_ms": percentiles([r["latency_ms"] for r in records]),
                            "success_latency_ms": percentiles([r["latency_ms"] for r in success])}
        usage = resource.getrusage(resource.RUSAGE_SELF)
        measurement = [r for r in self.records if r["phase"] == "measure"]
        kinds = {}
        seconds = getattr(self, "measure_seconds", 0)
        for kind in ("submit", "feed", "photo"):
            rows = [r for r in measurement if r["kind"] == kind]
            kinds[kind] = {"sent": len(rows), "success": sum(r["error"] is None for r in rows),
                           "average_rps": round(len(rows) / seconds, 3) if seconds else 0,
                           "latency_ms": percentiles([r["latency_ms"] for r in rows])}
        objectives = {}
        for kind, p95_limit in (("submit", 2000), ("feed", 500)):
            rows = [r for r in measurement if r["kind"] == kind]
            successes = [r for r in rows if not r["error"]]
            success_rate = len(successes) / len(rows) if rows else None
            p95 = percentiles([r["latency_ms"] for r in successes])["p95"]
            objectives[kind] = {"success_rate": success_rate, "success_rate_target": 0.99,
                                "p95_limit_ms": p95_limit, "passed": (success_rate >= 0.99 and p95 <= p95_limit)
                                if success_rate is not None and p95 is not None else None}
        summary = {"run_id": self.run_id, "started_at": self.started_at, "updated_at": utc(), "final": final,
                   "target": self.args.base_url, "seed": self.args.seed, "mode": self.args.mode,
                   "reason": self.reason, "error_type": self.setup_error, "scenario": self.config,
                   "server_config": getattr(self, "server_config", {}), "account_count": len(self.accounts),
                   "districts": [f["id"] for f in self.locations.features],
                   "photos": [p.public() for p in self.photos], "stage_timings": getattr(self, "stage_timings", []),
                   "measurement_seconds": round(seconds, 3), "requests": kinds,
                   "draft_objectives": objectives,
                   "scheduled": dict(self.scheduled), "dropped": dict(self.dropped),
                   "photo_payload_bytes_reserved": self.photo_bytes,
                   "accepted_unique_ids": len({e['report_id'] for e in manifest if e['report_id']}),
                   "last_known_report_states": dict(Counter(e["status"] for e in manifest)),
                   "sampled_statuses": dict(Counter(e["status"] for e, _ in self.observations)),
                   "verification_observed_ms": percentiles([e["verification_observed_ms"] for e, _ in self.observations
                                                              if "verification_observed_ms" in e]),
                   "visibility": dict(Counter(e.get("visibility", "not_checked") for e, _ in self.observations)),
                   "generator": {"user_cpu_seconds": round(usage.ru_utime - self.resources_start.ru_utime, 3),
                                 "system_cpu_seconds": round(usage.ru_stime - self.resources_start.ru_stime, 3),
                                 "peak_rss_platform_units": usage.ru_maxrss,
                                 "wall_seconds": round(time.monotonic() - self.started, 3),
                                 "average_cpu_percent_one_core": round(100 * (usage.ru_utime + usage.ru_stime
                                     - self.resources_start.ru_utime - self.resources_start.ru_stime)
                                     / max(0.001, time.monotonic() - self.started), 2),
                                 "photo_download_bytes": sum(r.get("bytes", 0) for r in self.records)},
                   "metrics": metrics, "autoscaling": {"verified": False, "reason": "NCP 정책·실행 이력·LB 대상 상태를 별도 대조해야 합니다"}}
        atomic_json(self.output / "summary.json", summary)
        lines = [f"# 부하 테스트 {self.run_id}", "", f"- 종료 상태: {self.reason}",
                 f"- 측정 시간: {seconds:.2f}초", f"- 접수 고유 ID: {summary['accepted_unique_ids']}건 (사전 제보 포함)",
                 f"- 미발송: {sum(self.dropped.values())}건", "", "| API | 발송 | 성공 | 평균 RPS | p95 ms |",
                 "|---|---:|---:|---:|---:|"]
        for kind, values in kinds.items():
            lines.append(f"| {kind} | {values['sent']} | {values['success']} | {values['average_rps']} | {values['latency_ms']['p95']} |")
        lines += ["", "상태 수는 마지막 관측값이며 전체 작업 완료 수가 아닙니다. 상태 표본 밖의 제보는 접수 당시 상태가 남습니다.",
                  "검증·피드 노출 시간은 폴링에 따른 상한 관측값입니다. 미노출은 탐색 범위 밖일 수 있습니다.",
                  "", "## NCP 관측 기록 (수동 입력)", "", "| 항목 | 값 |", "|---|---|",
                  "| 정책 지표·임계값·평가 시간 | |", "| 임계값 충족 시각 (UTC) | |", "| 확장 이벤트 시각 | |",
                  "| 서버 수 변화 | |", "| LB 정상 대상 편입 시각 | |", "| 확장 후 지연·처리량 | |",
                  "", "자동 확장 결과는 미검증입니다. 위 기록을 summary.json의 단계 시각과 대조하세요.",
                  "", "생성 데이터 정리 목록: manifest.json. 불확실 제출은 실행 표식으로 별도 대조하세요."]
        (self.output / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def parser():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("action", choices=("plan", "run"))
    cli.add_argument("--scenario", type=Path, default=DEFAULTS / "smoke.json")
    cli.add_argument("--photos-file", type=Path, default=DEFAULTS / "photos.example.json")
    cli.add_argument("--accounts-file", type=Path)
    cli.add_argument("--base-url")
    cli.add_argument("--mode", choices=("submit", "feed", "mixed"), default="mixed")
    cli.add_argument("--district", help="생략 시 서울 구를 균등 무작위 선택. 지정 시 영문 ID·구 코드·구 이름")
    cli.add_argument("--seed", type=int, default=42)
    cli.add_argument("--output-dir", type=Path, default=ROOT / "artifacts/loadtest")
    return cli


async def run_cli(args, config, photos, accounts):
    limit = config["submit_concurrency"] + config["feed_concurrency"] + 5
    async with httpx.AsyncClient(base_url=args.base_url.rstrip("/") + "/", timeout=config["timeout_seconds"],
                                 limits=httpx.Limits(max_connections=limit, max_keepalive_connections=limit),
                                 follow_redirects=False, trust_env=False) as client:
        runner = Runner(args, config, photos, accounts, client)
        loop = asyncio.get_running_loop()
        previous = {}
        for sig in (signal.SIGINT, signal.SIGTERM):
            previous[sig] = signal.getsignal(sig)
            loop.add_signal_handler(sig, runner.interrupt)
        try:
            return await runner.execute()
        finally:
            for sig, handler in previous.items():
                loop.remove_signal_handler(sig)
                signal.signal(sig, handler)


def main():
    cli = parser()
    args = cli.parse_args()
    try:
        config = load_scenario(args.scenario)
        photos = load_photos(args.photos_file) if args.mode != "feed" else []
        accounts = load_accounts(args.accounts_file) if args.accounts_file else []
        Locations(seoul_boundaries(), args.district)
        plan = make_plan(config, photos, args.mode, len(accounts) if args.accounts_file else None)
        print(json.dumps(plan, ensure_ascii=False, indent=2), flush=True)
        if args.action == "plan":
            return 0
        target = urlsplit(args.base_url or "")
        if target.scheme not in {"http", "https"} or not target.hostname or target.username or target.password or target.query or target.fragment:
            raise ValueError("--base-url에 인증정보·쿼리 없는 HTTP(S) API 주소가 필요합니다")
        if target.path not in {"", "/"}:
            raise ValueError("--base-url은 /api 경로를 붙이지 않은 API origin 주소여야 합니다")
        if args.mode != "feed" and not accounts:
            raise ValueError("제보 생성에는 --accounts-file이 필요합니다")
        return asyncio.run(run_cli(args, config, photos, accounts))
    except (ValueError, OSError, KeyError, Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        # Do not echo file contents, credentials or arbitrary HTTP exception text.
        message = str(exc) if isinstance(exc, ValueError) else type(exc).__name__
        cli.error(message)


if __name__ == "__main__":
    sys.exit(main())
