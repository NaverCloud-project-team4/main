"""1분 주기 집계 실행: DB 계산 → commit → 지도 JSON 업로드. 동시에 두 번 돌지 않게 락을 잡는다."""
import logging
import threading
from contextlib import contextmanager
from sqlalchemy import text
from .db import SessionLocal, engine
from .services import aggregate_zones, map_document
from .storage import publish_json

logger = logging.getLogger(__name__)
LOCK_NAME = "kauroong:aggregate"
_local_lock = threading.Lock()


@contextmanager
def aggregate_lock():
    """MySQL은 GET_LOCK(세션 락), 그 외(SQLite)는 프로세스 안 락. 못 잡으면 False를 내준다."""
    if engine.dialect.name == "mysql":
        connection = engine.connect()
        try:
            acquired = connection.execute(text("SELECT GET_LOCK(:name, 0)"), {"name": LOCK_NAME}).scalar() == 1
            try:
                yield acquired
            finally:
                if acquired:
                    connection.execute(text("SELECT RELEASE_LOCK(:name)"), {"name": LOCK_NAME})
        finally:
            connection.close()
    else:
        acquired = _local_lock.acquire(blocking=False)
        try:
            yield acquired
        finally:
            if acquired:
                _local_lock.release()


def run_aggregation() -> dict:
    with aggregate_lock() as acquired:
        if not acquired:
            logger.info("aggregate_skipped reason=already_running")
            return {"skipped": True}
        with SessionLocal.begin() as db:
            result = aggregate_zones(db)
        with SessionLocal() as db:
            document = map_document(db)
        result["published"] = publish_json(document)
        result["skipped"] = False
        logger.info("aggregate_done zones=%s by_source=%s", result["zones"], result["by_source"])
        return result
