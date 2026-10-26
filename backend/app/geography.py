"""Seoul administrative polygons, shared by position lookup and district migration.

Coordinates use GeoJSON order [longitude, latitude]. No third-party geocoder is called.
"""

from functools import lru_cache
import json
from pathlib import Path

BOUNDARY_FILE = Path(__file__).parent / "data" / "seoul_districts_20261001.geojson"


@lru_cache(maxsize=1)
def seoul_boundaries():
    source = json.loads(BOUNDARY_FILE.read_text(encoding="utf-8"))
    ids = {f["properties"]["name"]: f["id"] for f in json.loads(
        (BOUNDARY_FILE.parent / "zones_seoul25.geojson").read_text(encoding="utf-8")
    )["features"]}
    for feature in source["features"]:
        feature["id"] = ids[feature["properties"]["name"]]
    return source


def ring_location(x, y, ring):
    """0 outside, 1 inside, 2 on an edge (inclusive, with a small floating-point tolerance)."""
    inside = False
    for a, b in zip(ring, ring[1:]):
        ax, ay = a[:2]
        bx, by = b[:2]
        cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax)
        if (
            abs(cross) <= 1e-12
            and min(ax, bx) - 1e-10 <= x <= max(ax, bx) + 1e-10
            and min(ay, by) - 1e-10 <= y <= max(ay, by) + 1e-10
        ):
            return 2
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            inside = not inside
    return int(inside)


def geometry_covers(geometry, latitude, longitude):
    if not geometry:
        return False
    if isinstance(geometry, str):
        geometry = json.loads(geometry)
    bounds = geometry.get("bbox")
    if bounds and not (
        bounds[0] - 1e-10 <= longitude <= bounds[2] + 1e-10 and bounds[1] - 1e-10 <= latitude <= bounds[3] + 1e-10
    ):
        return False
    if geometry["type"] == "Polygon":
        polygons = [geometry["coordinates"]]
    elif geometry["type"] == "MultiPolygon":
        polygons = geometry["coordinates"]
    else:
        return False
    for polygon in polygons:
        if not ring_location(longitude, latitude, polygon[0]):
            continue
        # Hole interiors are excluded; their boundary remains part of the polygon.
        if not any(ring_location(longitude, latitude, hole) == 1 for hole in polygon[1:]):
            return True
    return False


def district_at(latitude, longitude):
    # Shared boundaries deterministically belong to the lowest district code.
    return next(
        (
            feature
            for feature in seoul_boundaries()["features"]
            if geometry_covers(feature["geometry"], latitude, longitude)
        ),
        None,
    )


def canonical_zone_id(zone_id):
    if zone_id and zone_id.startswith("seoul-"):
        return next((f["id"] for f in seoul_boundaries()["features"]
                     if f["properties"]["district_code"] == zone_id[6:]), zone_id)
    return zone_id
