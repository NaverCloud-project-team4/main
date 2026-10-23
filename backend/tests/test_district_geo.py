import csv
import json
import random
from pathlib import Path
import pytest
from app.geo import build_shape, find_in_shapes

DATA = Path(__file__).resolve().parents[1] / "app" / "data"
FEATURES = json.loads((DATA / "zones_seoul25.geojson").read_text(encoding="utf-8"))["features"]
SHAPES = [build_shape(f["id"], f["geometry"]) for f in FEATURES]


def test_25_districts_loaded():
    assert len(FEATURES) == 25 and len({f["id"] for f in FEATURES}) == 25


def test_every_marker_is_inside_its_own_district():
    for feature in FEATURES:
        lng, lat = feature["properties"]["marker"]
        assert find_in_shapes(SHAPES, lat, lng) == feature["id"], feature["id"]


def test_every_forecast_spot_maps_to_the_district_in_csv():
    names = {f["id"]: f["properties"]["name"] for f in FEATURES}
    with open(DATA / "forecast_spots.csv", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 25
    for row in rows:
        zone_id = find_in_shapes(SHAPES, float(row["lat"]), float(row["lng"]))
        assert zone_id is not None and names[zone_id] == row["구(경계 파일 판정)"], row["name"]


def test_points_outside_seoul_belong_to_no_district():
    assert find_in_shapes(SHAPES, 37.4563, 126.7052) is None  # 인천
    assert find_in_shapes(SHAPES, 37.2636, 127.0286) is None  # 수원
    assert find_in_shapes(SHAPES, 35.1796, 129.0756) is None  # 부산
    assert find_in_shapes(SHAPES, 0.0, 0.0) is None


def test_matches_shapely_on_random_points():
    shapely_geometry = pytest.importorskip("shapely.geometry")
    polygons = {f["id"]: shapely_geometry.shape(f["geometry"]) for f in FEATURES}
    rng = random.Random(7)
    mismatches = 0
    for _ in range(3000):
        lng, lat = rng.uniform(126.76, 127.19), rng.uniform(37.42, 37.71)
        expected = next((zid for zid, p in polygons.items() if p.contains(shapely_geometry.Point(lng, lat))), None)
        if find_in_shapes(SHAPES, lat, lng) != expected:
            mismatches += 1
    assert mismatches == 0
