#!/usr/bin/env python3
"""Read-only, loopback-only dashboard for local load generator results. No API traffic."""
import argparse
from collections import Counter
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.geography import seoul_boundaries  # noqa: E402

RUN_NAME = re.compile(r"[A-Za-z0-9_-]{1,100}\Z")
PHOTO_NAME = re.compile(r"[a-f0-9]{64}\.(jpg|png|webp)\Z")
LEGACY_PHOTOS = {f"{species}-{n}.jpeg" for species in ("ginkgo", "maple") for n in range(1, 4)}


class Store:
    def __init__(self, directory):
        self.root = Path(directory).resolve()

    def run_path(self, run_id):
        if not RUN_NAME.fullmatch(run_id):
            raise FileNotFoundError
        path = self.root / run_id
        if path.is_symlink() or not path.is_dir() or path.resolve().parent != self.root:
            raise FileNotFoundError
        return path

    def json_file(self, path):
        if path.is_symlink():
            raise FileNotFoundError
        return json.loads(path.read_text(encoding="utf-8"))

    def live(self, run_id):
        path = self.run_path(run_id)
        if (path / "live.json").is_file():
            return self.json_file(path / "live.json")
        # Older, completed runs remain viewable without modifying their result files.
        summary = self.json_file(path / "summary.json")
        manifest = self.json_file(path / "manifest.json")
        reports = []
        for entry in manifest.get("reports", [])[-1000:]:
            row = {k: entry.get(k) for k in ("sequence", "report_id", "species", "stage", "photo", "zone_name",
                   "latitude", "longitude", "status", "http_status", "submitted_at", "status_observed_at", "sampled")}
            row["photo_preview"] = f"/api/photos/{row['photo']}" if row["photo"] in LEGACY_PHOTOS else None
            reports.append(row)
        requests = summary.get("requests", {})
        return {"run_id": run_id, "updated_at": summary.get("updated_at"), "started_at": summary.get("started_at"),
                "final": summary.get("final", False), "target": summary.get("target"), "mode": summary.get("mode"),
                "stage": "finished", "reason": summary.get("reason"), "elapsed_seconds": summary.get("measurement_seconds", 0),
                "server_environment": summary.get("server_config", {}).get("environment"),
                "verification_mode": summary.get("server_config", {}).get("verification_mode"),
                "attempts": len(manifest.get("reports", [])), "accepted": summary.get("accepted_unique_ids", 0),
                "states": dict(Counter(e["status"] for e in manifest.get("reports", []))),
                "errors": {k: v.get("sent", 0) - v.get("success", 0) for k, v in requests.items()},
                "dropped": sum(summary.get("dropped", {}).values()), "active": {},
                "recent_submit_rps": 0, "recent_feed_rps": 0, "series": [], "reports": reports,
                "report_limit": summary.get("scenario", {}).get("max_reports"), "map_report_limit": 1000,
                "recent_latency_ms": {}, "target_submit_rps": 0, "target_feed_rps": 0}

    def runs(self):
        rows = []
        paths = sorted(self.root.iterdir(), reverse=True) if self.root.is_dir() else []
        for path in paths:
            try:
                live = self.live(path.name)
                rows.append({key: live.get(key) for key in ("run_id", "started_at", "updated_at", "final", "accepted")})
            except (OSError, ValueError, KeyError, TypeError):
                continue
            if len(rows) >= 100:
                break
        return rows

    def photo(self, run_id, filename):
        if not PHOTO_NAME.fullmatch(filename):
            raise FileNotFoundError
        root = self.run_path(run_id) / "photos"
        path = root / filename
        if root.is_symlink() or path.is_symlink() or path.resolve().parent != root.resolve():
            raise FileNotFoundError
        return path.read_bytes(), {".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}[path.suffix]


def make_handler(store):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, status, content, content_type):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(content)

        def send_json(self, value):
            self.send(200, json.dumps(value, ensure_ascii=False, allow_nan=False).encode(), "application/json; charset=utf-8")

        def do_GET(self):
            host = self.headers.get("Host", "").split(":")[0]
            if host not in {"127.0.0.1", "localhost"}:
                self.send(403, b"Local access only", "text/plain")
                return
            path = unquote(urlsplit(self.path).path)
            try:
                if path == "/":
                    self.send(200, (ROOT / "scripts/loadtest/dashboard.html").read_bytes(), "text/html; charset=utf-8")
                elif path == "/api/runs":
                    self.send_json({"runs": store.runs()})
                elif path == "/api/boundaries":
                    self.send_json(seoul_boundaries())
                elif path.startswith("/api/runs/"):
                    parts = path.split("/")
                    if len(parts) == 4:
                        self.send_json(store.live(parts[3]))
                    elif len(parts) == 6 and parts[4] == "photos":
                        content, mime = store.photo(parts[3], parts[5])
                        self.send(200, content, mime)
                    else:
                        raise FileNotFoundError
                elif path.startswith("/api/photos/") and path.split("/")[-1] in LEGACY_PHOTOS:
                    self.send(200, (ROOT / "assets/loadtest" / path.split("/")[-1]).read_bytes(), "image/jpeg")
                else:
                    raise FileNotFoundError
            except (OSError, ValueError, KeyError, TypeError):
                self.send(404, b"Result not available", "text/plain")

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--results-dir", type=Path, default=ROOT / "artifacts/loadtest")
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(Store(args.results_dir)))
    print(f"제보 실시간 대시보드: http://127.0.0.1:{server.server_port}", flush=True)
    print("조회 전용 · 생성기와 같은 장비에서 실행 · Ctrl+C로 종료", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
