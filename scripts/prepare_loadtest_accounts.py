#!/usr/bin/env python3
"""Prepare dedicated load-test operators on the target backend, outside measurement."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import secrets
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--count", type=int, default=6)
    cli.add_argument("--output", type=Path, default=ROOT / ".data/loadtest-accounts.json")
    args = cli.parse_args()
    if not 1 <= args.count <= 1000:
        cli.error("--count는 1~1000 범위여야 합니다")
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive create protects existing credentials; compensate if the transaction fails.
    try:
        fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        cli.error("계정 파일이 이미 있습니다. 기존 파일을 사용하거나 새 출력 경로를 지정해주세요")
    try:
        from app.db import SessionLocal
        from app.models import User
        from app.security import hash_password

        prefix = "loadtest-" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S") + "-" + secrets.token_hex(3)
        rows = [{"email": f"{prefix}-{n:04d}@example.com", "password": secrets.token_urlsafe(24)}
                for n in range(1, args.count + 1)]
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            # Write before DB commit so a write failure cannot orphan newly created accounts.
            json.dump(rows, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
            with SessionLocal.begin() as db:
                db.add_all([User(email=row["email"], password_hash=hash_password(row["password"]),
                                 nickname=f"부하테스트{n:04d}", role="admin") for n, row in enumerate(rows, 1)])
    except BaseException:
        output.unlink(missing_ok=True)
        raise
    print(f"테스트 전용 운영자 {args.count}개 생성. 계정 파일: {output}")
    print("현재 백엔드 DATABASE_URL의 DB에 생성했습니다. 로그인할 API와 같은 DB인지 확인하세요.")


if __name__ == "__main__":
    main()
