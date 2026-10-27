import io
import json
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from loadtest_dashboard import Store, make_handler  # noqa: E402


def make_run(tmp_path):
    run_id = "20261027T110550Z-test"
    run = tmp_path / run_id
    run.mkdir()
    (run / "live.json").write_text(json.dumps({"run_id": run_id, "accepted": 3, "final": False}))
    return run_id, run


def test_store_discovers_live_runs_and_forbids_escape(tmp_path):
    run_id, run = make_run(tmp_path)
    store = Store(tmp_path)
    assert store.runs()[0]["run_id"] == run_id
    assert store.live(run_id)["accepted"] == 3
    for name in ("../.data", "../../etc", "a/b", "", ".env", "missing"):
        with pytest.raises(FileNotFoundError):
            store.live(name)
    (tmp_path / "alias").symlink_to(run, target_is_directory=True)
    with pytest.raises(FileNotFoundError):
        store.live("alias")


def test_photo_endpoint_only_reads_matching_local_photo_files(tmp_path):
    run_id, run = make_run(tmp_path)
    folder = run / "photos"
    folder.mkdir()
    name = "a" * 64 + ".jpg"
    (folder / name).write_bytes(b"JPEG data")
    store = Store(tmp_path)
    assert store.photo(run_id, name) == (b"JPEG data", "image/jpeg")
    with pytest.raises(FileNotFoundError):
        store.photo(run_id, "../live.json")
    (folder / name).unlink()
    (folder / name).symlink_to(run / "live.json")
    with pytest.raises(FileNotFoundError):
        store.photo(run_id, name)


def test_legacy_results_are_read_without_account_credentials(tmp_path):
    run_id, run = make_run(tmp_path)
    (run / "live.json").unlink()
    (run / "summary.json").write_text(json.dumps({"accepted_unique_ids": 1, "final": True,
                                                  "requests": {}, "server_config": {"verification_mode": "demo"}}))
    (run / "manifest.json").write_text(json.dumps({"accounts": [{"password": "SECRET"}], "reports": [
        {"photo": "ginkgo-1.jpeg", "status": "REVIEW", "sequence": 0, "password": "SECRET"}]}))
    data = Store(tmp_path).live(run_id)
    assert data["accepted"] == 1
    assert data["reports"][0]["photo_preview"] == "/api/photos/ginkgo-1.jpeg"
    assert "SECRET" not in json.dumps(data)


def request(store, path, host="127.0.0.1:8765"):
    class Socket:
        def __init__(self):
            self.out = bytearray()

        def makefile(self, mode, *args):
            return io.BytesIO(f"GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n".encode())

        def sendall(self, data):
            self.out.extend(data)

    sock = Socket()
    make_handler(store)(sock, ("127.0.0.1", 12345), SimpleNamespace())
    return bytes(sock.out)


def test_http_surface_is_read_only_scoped_and_loopback_only(tmp_path):
    run_id, _ = make_run(tmp_path)
    store = Store(tmp_path)
    assert b"200 OK" in request(store, "/")
    response = request(store, f"/api/runs/{run_id}")
    assert b"200 OK" in response and b"no-store" in response
    assert b"403 Forbidden" in request(store, "/api/runs", host="evil.example")
    for path in ("/.env", "/.data/loadtest-accounts.json", f"/api/runs/{run_id}/manifest.json", "/api/runs/%2e%2e"):
        assert b"404 Not Found" in request(store, path)
