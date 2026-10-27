"""Client scheduling/protocol tests; no real network or cloud traffic."""
import asyncio
from collections import Counter
from email import policy
from email.parser import BytesParser
import json
from pathlib import Path
import random
import sys
from types import SimpleNamespace

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import load_test as lt  # noqa: E402


def settings(**extra):
    config = lt.load_scenario(lt.DEFAULTS / "smoke.json")
    config.update(cooldown_seconds=0.02, drain_seconds=0.05, shutdown_seconds=0.05,
                  poll_interval_seconds=0.01, observation_rps=10000,
                  max_reports=20, max_requests=100,
                  stages=[{"name": "test", "seconds": 0.21, "submit_rps": 20, "feed_rps": 20}])
    config.update(extra)
    return config


def args(tmp_path, mode="mixed"):
    return SimpleNamespace(seed=42, district=None, output_dir=tmp_path, mode=mode, base_url="https://test.invalid")


class API:
    def __init__(self, submit_status=202, role="admin", pending=False):
        self.calls = Counter()
        self.submissions = []
        self.submit_status, self.role, self.pending = submit_status, role, pending
        self.collection = lt.seoul_boundaries()

    async def __call__(self, request):
        self.calls[request.url.path] += 1
        path = request.url.path
        if path == "/health/ready":
            return httpx.Response(200, json={"status": "ready"})
        if path == "/api/config":
            return httpx.Response(200, json={"environment": "test", "verification_mode": "demo", "max_upload_bytes": 10485760})
        if path == "/api/zones/boundaries":
            return httpx.Response(200, json=self.collection)
        if path == "/api/auth/login":
            payload = json.loads(request.content)
            return httpx.Response(200, json={"access_token": "NOT_A_REAL_JWT", "user": {"id": payload["email"].split('@')[0], "role": self.role}})
        if path == "/api/zones/resolve":
            point = json.loads(request.content)
            feature = next(f for f in self.collection["features"]
                           if lt.geometry_covers(f["geometry"], point["latitude"], point["longitude"]))
            return httpx.Response(200, json={"zone": {"id": feature["id"]}})
        if path == "/api/reports" and request.method == "POST":
            raw = b"Content-Type: " + request.headers["content-type"].encode() + b"\r\n\r\n" + request.content
            parts = BytesParser(policy=policy.default).parsebytes(raw)
            fields = {}
            for part in parts.iter_parts():
                name = part.get_param("name", header="content-disposition")
                fields[name] = part.get_filename() if name == "photo" else part.get_content().strip()
            fields["key"] = request.headers["idempotency-key"]
            self.submissions.append(fields)
            n = len(self.submissions)
            if self.submit_status != 202:
                return httpx.Response(self.submit_status, json={"detail": "do not log secrets"})
            return httpx.Response(202, json={"id": f"report-{n}", "status": "PENDING_AI"})
        if path.endswith("/status"):
            return httpx.Response(200, json={"status": "PENDING_AI" if self.pending else "APPROVED"})
        if path == "/api/reports":
            return httpx.Response(200, json={"items": [{"id": f"report-{n}", "photo_url": None}
                                                       for n in range(1, len(self.submissions) + 1)],
                                            "total": len(self.submissions), "has_more": False})
        raise AssertionError(f"unexpected request: {request.method} {path}")


async def execute(tmp_path, config=None, api=None, account_count=2, mode="mixed"):
    api = api or API()
    accounts = [lt.Account(f"account_{n}", f"user{n}@example.com", "SECRET-password") for n in range(account_count)]
    async with httpx.AsyncClient(base_url="https://test.invalid", transport=httpx.MockTransport(api)) as client:
        runner = lt.Runner(args(tmp_path, mode), config or settings(), lt.load_photos(lt.DEFAULTS / "photos.example.json"), accounts, client)
        code = await runner.execute()
    return runner, api, code


def test_plan_is_offline_and_full_scenario_counts(monkeypatch):
    def forbidden(*a, **kw):
        raise AssertionError("plan must not create an HTTP client")
    monkeypatch.setattr(httpx, "AsyncClient", forbidden)
    monkeypatch.setattr(sys, "argv", ["load_test.py", "plan", "--scenario", str(lt.DEFAULTS / "scenarios.example.json")])
    assert lt.main() == 0
    config = lt.load_scenario(lt.DEFAULTS / "scenarios.example.json")
    plan = lt.make_plan(config, lt.load_photos(lt.DEFAULTS / "photos.example.json"), "mixed")
    assert plan["scheduled_submits"] == 4200
    assert plan["scheduled_requests"] == 26520
    assert plan["minimum_accounts"] == 50


def test_photos_and_random_coordinates_match_species_and_every_district():
    photos = lt.load_photos(lt.DEFAULTS / "photos.example.json")
    assert Counter(p.species for p in photos) == {"MAPLE": 3, "GINKGO": 3, "MIXED": 1}
    assert all(p.name.startswith("ginkgo" if p.species == "GINKGO" else "maple") for p in photos if p.test_case == "foliage")
    negative = next(p for p in photos if p.test_case == "unrelated")
    assert negative.name == "unrelated-usagi.jpeg" and negative.expected_decision == "REJECTED"
    locations, rng = lt.Locations(lt.seoul_boundaries()), random.Random(7)
    seen = set()
    for _ in range(1000):
        point = locations.sample(rng)
        feature = next(f for f in locations.features if f["id"] == point["zone_id"])
        assert lt.geometry_covers(feature["geometry"], point["latitude"], point["longitude"])
        seen.add(point["zone_id"])
    assert len(seen) == 25


def test_polygon_holes_are_never_sampled():
    collection = {"features": [{"id": "dongdaemun", "properties": {"district_code": "11230", "name": "동대문구"},
                               "geometry": {"type": "Polygon", "coordinates": [
                                   [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
                                   [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]]}}]}
    locations, rng = lt.Locations(collection), random.Random(2)
    for _ in range(200):
        point = locations.sample(rng)
        assert not (1 < point["latitude"] < 3 and 1 < point["longitude"] < 3)


def test_http_contract_results_and_no_secrets(tmp_path):
    runner, api, code = asyncio.run(execute(tmp_path))
    assert code == 0
    assert len(api.submissions) == 6  # one preflight, five paced measurement submissions
    assert len({row["key"] for row in api.submissions}) == 6
    for row in api.submissions:
        assert row["photo"].startswith({"GINKGO": "ginkgo", "MAPLE": "maple", "MIXED": "unrelated"}[row["species"]])
        assert row["photo_source"] == "upload" and row["location_source"] == "manual"
        assert "demo_outcome" not in row and "zone_id" not in row
        assert row["description"].startswith("[LOADTEST:")
    summary = lt.read_json(runner.output / "summary.json")
    assert summary["accepted_unique_ids"] == 6
    assert summary["requests"]["submit"]["sent"] == 5
    assert summary["visibility"]["visible"] == 6
    assert summary["autoscaling"]["verified"] is False
    for path in runner.output.iterdir():
        if not path.is_file():
            continue
        text = path.read_text()
        assert "SECRET-password" not in text and "NOT_A_REAL_JWT" not in text
        assert "user0@example.com" not in text


def test_account_cooldown_drops_instead_of_bursting(tmp_path):
    runner, api, _ = asyncio.run(execute(tmp_path, settings(cooldown_seconds=0.2), account_count=1))
    assert runner.dropped["submit:account_cooldown"] >= 3
    assert len(api.submissions) <= 3


def test_503_is_not_retried_and_manifest_remains_uncertain(tmp_path):
    runner, api, code = asyncio.run(execute(tmp_path, api=API(submit_status=503)))
    assert code == 1 and len(api.submissions) == 1
    report = lt.read_json(runner.output / "manifest.json")["reports"][0]
    assert report["status"] == "UNCERTAIN" and report["http_status"] == 503


def test_non_admin_is_rejected_before_any_write(tmp_path):
    runner, api, code = asyncio.run(execute(tmp_path, api=API(role="user")))
    assert code == 1 and not api.submissions
    assert runner.reason == "setup_or_runtime_error"


def test_photo_and_report_limits_include_preflight(tmp_path):
    runner, api, code = asyncio.run(execute(tmp_path, settings(max_reports=2)))
    assert code == 0 and len(api.submissions) == 2 and runner.reason == "max_reports"
    runner, api, code = asyncio.run(execute(tmp_path / "bytes", settings(max_upload_bytes=1)))
    assert code == 0 and not api.submissions and runner.reason == "max_upload_bytes"


def test_interrupt_flushes_manifest_and_bounds_pending_requests(tmp_path):
    async def run():
        api = API(pending=True)
        async with httpx.AsyncClient(base_url="https://test.invalid", transport=httpx.MockTransport(api)) as client:
            config = settings(drain_seconds=10, stages=[{"name": "long", "seconds": 10, "submit_rps": 1, "feed_rps": 0}])
            runner = lt.Runner(args(tmp_path), config, lt.load_photos(lt.DEFAULTS / "photos.example.json"),
                               [lt.Account("test", "user@example.com", "SECRET-password")], client)
            task = asyncio.create_task(runner.execute())
            await asyncio.sleep(0.1)
            runner.interrupt()
            code = await asyncio.wait_for(task, 0.5)
        assert code == 130
        assert lt.read_json(runner.output / "summary.json")["final"] is True
        assert lt.read_json(runner.output / "manifest.json")["reports"]
    asyncio.run(run())


def test_live_snapshot_uses_latest_status_and_local_preview(tmp_path):
    runner, api, code = asyncio.run(execute(tmp_path))
    live = lt.read_json(runner.output / "live.json")
    assert code == 0 and live["final"] is True
    assert live["accepted"] == len(api.submissions)
    assert live["states"]["APPROVED"] == len(api.submissions)
    assert all(row["photo_preview"].startswith(f"/api/runs/{runner.run_id}/photos/") for row in live["reports"])
    assert all(row["status"] == "APPROVED" for row in live["reports"])
    assert all(len(lt.read_json(runner.output / "live.json")["series"]) <= 60 for _ in range(1))
    serialized = json.dumps(live)
    assert "SECRET-password" not in serialized and "NOT_A_REAL_JWT" not in serialized


def test_invalid_scenario_refuses_nan_or_unbounded_inputs(tmp_path):
    config = settings()
    config["max_reports"] = -1
    path = tmp_path / "bad.json"
    path.write_text(json.dumps(config))
    with pytest.raises(ValueError):
        lt.load_scenario(path)


def test_error_threshold_is_per_api_not_hidden_by_successful_feed(tmp_path):
    async def run():
        async with httpx.AsyncClient(base_url="https://test.invalid") as client:
            runner = lt.Runner(args(tmp_path), settings(), [], [], client)
            for n in range(100):
                runner.add_record({"phase": "measure", "kind": "feed", "stage": "test", "status": 200,
                                   "error": None, "elapsed_seconds": 1, "latency_ms": 1})
            for n in range(20):
                runner.add_record({"phase": "measure", "kind": "submit", "stage": "test", "status": 503,
                                   "error": "unexpected_status", "elapsed_seconds": 1, "latency_ms": 1})
            assert runner.reason == "error_threshold"
            runner.log.close()
            runner.journal.close()
    asyncio.run(run())


def test_photo_download_is_bounded_and_never_forwards_jwt(tmp_path):
    async def run():
        async def handler(request):
            assert "authorization" not in request.headers
            return httpx.Response(200, content=b"a" * 100)
        async with httpx.AsyncClient(base_url="https://test.invalid", transport=httpx.MockTransport(handler)) as client:
            runner = lt.Runner(args(tmp_path), settings(image_max_bytes=10), [], [], client)
            await runner.download_photo("https://photos.invalid/image?token=SECRET_SIGNED_TOKEN", "test")
            assert runner.records[-1]["error"] == "image_download_limit"
            runner.log.close()
            runner.journal.close()
            assert "SECRET_SIGNED_TOKEN" not in (runner.output / "requests.jsonl").read_text()
    asyncio.run(run())


def test_feed_only_uses_no_login_or_submission_and_caps_requests(tmp_path):
    runner, api, code = asyncio.run(execute(tmp_path, settings(max_requests=2), account_count=0, mode="feed"))
    assert code == 0 and runner.reason == "max_requests"
    assert api.calls["/api/auth/login"] == 0 and not api.submissions
    assert runner.scheduled["feed"] == 2  # third slot hits cap, is never reserved or sent
    assert sum(r["kind"] == "feed" for r in runner.records) == 2


def test_rate_limit_is_not_counted_as_success_or_retried(tmp_path):
    class LimitedAPI(API):
        async def __call__(self, request):
            if request.method == "POST" and request.url.path == "/api/reports" and self.submissions:
                self.calls["limited"] += 1
                return httpx.Response(429, json={"detail": "too fast"})
            return await super().__call__(request)
    runner, api, code = asyncio.run(execute(tmp_path, api=LimitedAPI()))
    assert code == 1 and runner.reason == "rate_limited"
    assert api.calls["limited"] == 1
    summary = lt.read_json(runner.output / "summary.json")
    assert summary["requests"]["submit"]["success"] == 0
