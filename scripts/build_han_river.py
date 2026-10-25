"""Build the simplified Han River water band for the watercolor map.

Build-only dependency: pip install -r scripts/requirements-geodata.txt
Source: OpenStreetMap via the Overpass API (ODbL; "© OpenStreetMap contributors").

    python scripts/build_han_river.py --cache <scratch>/han-river-overpass.json
"""

import argparse
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from shapely.geometry import LineString, mapping, shape
from shapely.ops import polygonize, unary_union

ROOT = Path(__file__).resolve().parents[1]
BOUNDARY = ROOT / "backend/app/data/seoul_districts_20261001.geojson"
OUTPUT = ROOT / "frontend/public/map-assets/han-river.geojson"
OVERPASS = "https://overpass-api.de/api/interpreter"
# Roughly 15 m at Seoul's latitude; keeps the band smooth and the file small.
TOLERANCE = 0.00015
ATTRIBUTION = "© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)"


def query(bbox):
    west, south, east, north = bbox
    area = f"({south},{west},{north},{east})"
    return (
        "[out:json][timeout:90];"
        f'(relation["natural"="water"]["name"="한강"]{area};'
        f'way["natural"="water"]["name"="한강"]{area};'
        f'relation["waterway"="riverbank"]["name"="한강"]{area};'
        f'way["waterway"="riverbank"]["name"="한강"]{area};);'
        "out geom;"
    )


def fetch(bbox, cache):
    if cache and cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    request = Request(
        OVERPASS,
        data=urlencode({"data": query(bbox)}).encode(),
        headers={"User-Agent": "kauroong-map-build/1.0"},
    )
    with urlopen(request, timeout=120) as response:
        raw = response.read().decode("utf-8")
    if cache:
        cache.write_text(raw, encoding="utf-8")
    return json.loads(raw)


def water_polygons(elements):
    """Closed ways become polygons; relation outer members are stitched with polygonize."""
    outers, inners = [], []
    for element in elements:
        if element["type"] == "way" and element.get("geometry"):
            points = [(p["lon"], p["lat"]) for p in element["geometry"]]
            if len(points) >= 4 and points[0] == points[-1]:
                outers.extend(polygonize([LineString(points)]))
        elif element["type"] == "relation":
            for member in element.get("members", []):
                if member["type"] != "way" or not member.get("geometry"):
                    continue
                line = LineString([(p["lon"], p["lat"]) for p in member["geometry"]])
                (inners if member.get("role") == "inner" else outers).append(line)
    polygons = [g for g in outers if g.geom_type == "Polygon"]
    lines = [g for g in outers if g.geom_type == "LineString"]
    water = unary_union(polygons + list(polygonize(unary_union(lines))))
    holes = list(polygonize(unary_union(inners))) if inners else []
    return water.difference(unary_union(holes)) if holes else water


def build(cache):
    boundary = json.loads(BOUNDARY.read_text(encoding="utf-8"))
    seoul = shape(boundary["city_geometry"])
    source = fetch(boundary["bbox"], cache)
    water = water_polygons(source["elements"])
    if water.is_empty:
        raise ValueError("Overpass returned no Han River water polygons")
    river = water.intersection(seoul.buffer(0.002)).simplify(TOLERANCE, preserve_topology=True)
    river = river.buffer(0)
    if river.is_empty or river.geom_type not in {"Polygon", "MultiPolygon"}:
        raise ValueError(f"Unexpected river geometry: {river.geom_type}")
    # Drop specks left by clipping; the band only needs the main channel.
    parts = list(river.geoms) if river.geom_type == "MultiPolygon" else [river]
    river = unary_union([p for p in parts if p.area > 2e-6])
    geometry = mapping(river)
    document = {
        "type": "FeatureCollection",
        "name": "han-river",
        "attribution": ATTRIBUTION,
        "license": "ODbL-1.0",
        "features": [{"type": "Feature", "id": "han-river", "properties": {"name": "한강"}, "geometry": geometry}],
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(document, ensure_ascii=False, separators=(",", ":"))
    # Six decimals (~0.1 m) is far finer than the simplification tolerance.
    text = json.dumps(json.loads(text, parse_float=lambda x: round(float(x), 6)), ensure_ascii=False, separators=(",", ":"))
    OUTPUT.write_text(text, encoding="utf-8")
    return river, len(text)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path, help="Store/reuse the raw Overpass response here (not committed)")
    args = parser.parse_args()
    river, size = build(args.cache)
    print(f"{OUTPUT.relative_to(ROOT)}: {river.geom_type}, area={river.area:.6f}deg², {size / 1024:.1f} KB")
