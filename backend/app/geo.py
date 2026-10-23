"""좌표 → 구 판정. 구 경계(GeoJSON Polygon)를 DB에서 읽어 메모리에 캐시한다.

외부 의존성 없이 even-odd 규칙(ray casting)으로 판정한다. SQLite와 MySQL에서 똑같이 동작한다.
좌표 순서는 GeoJSON과 같은 [경도, 위도]다.
"""
import json
import threading
import time
from dataclasses import dataclass
from sqlalchemy import select
from sqlalchemy.orm import Session
from .models import Zone

CACHE_SECONDS = 300


@dataclass(frozen=True)
class ZoneShape:
    zone_id: str
    bbox: tuple[float, float, float, float]  # min_lng, min_lat, max_lng, max_lat
    rings: tuple[tuple[tuple[float, float], ...], ...]  # 바깥 고리만 (Polygon 하나당 한 개)


_lock = threading.Lock()
_cache: tuple[float, tuple[ZoneShape, ...]] | None = None


def clear_zone_cache():
    global _cache
    with _lock:
        _cache = None


def build_shape(zone_id: str, geometry: dict) -> ZoneShape:
    kind = geometry.get("type")
    if kind == "Polygon":
        polygons = [geometry["coordinates"]]
    elif kind == "MultiPolygon":
        polygons = geometry["coordinates"]
    else:
        raise ValueError(f"Unsupported geometry type: {kind}")
    rings = tuple(tuple((float(x), float(y)) for x, y in polygon[0]) for polygon in polygons)
    xs = [x for ring in rings for x, _ in ring]
    ys = [y for ring in rings for _, y in ring]
    return ZoneShape(zone_id, (min(xs), min(ys), max(xs), max(ys)), rings)


def point_in_ring(x: float, y: float, ring) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def shape_contains(shape: ZoneShape, lat: float, lng: float) -> bool:
    min_x, min_y, max_x, max_y = shape.bbox
    if not (min_x <= lng <= max_x and min_y <= lat <= max_y):
        return False
    return any(point_in_ring(lng, lat, ring) for ring in shape.rings)


def find_in_shapes(shapes, lat: float, lng: float) -> str | None:
    for shape in shapes:
        if shape_contains(shape, lat, lng):
            return shape.zone_id
    return None


def load_shapes(db: Session) -> tuple[ZoneShape, ...]:
    global _cache
    with _lock:
        if _cache and time.monotonic() - _cache[0] < CACHE_SECONDS:
            return _cache[1]
    shapes = tuple(
        build_shape(zone_id, json.loads(boundary))
        for zone_id, boundary in db.execute(select(Zone.id, Zone.boundary).where(Zone.boundary.is_not(None)))
    )
    with _lock:
        _cache = (time.monotonic(), shapes)
    return shapes


def zone_id_at(db: Session, lat: float, lng: float) -> str | None:
    """좌표가 속한 구의 ID. 어느 구에도 속하지 않으면 None."""
    return find_in_shapes(load_shapes(db), lat, lng)
