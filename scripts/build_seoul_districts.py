"""Build checked-in Seoul gu boundaries from licensed SGIS-derived neighbourhoods.

Build-only dependency: pip install -r scripts/requirements-geodata.txt
See backend/app/data/README.md for the pinned source and reproduction command.
"""

import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
VERSION = "2026-10-01"
ATTRIBUTION = (
    "본 데이터는 통계청 통계지리정보서비스(SGIS, https://sgis.kostat.go.kr)에서 공공누리 제1유형으로 "
    "개방한 행정동 경계를 가공한 것이며(가공: vuski/admdongkor, https://github.com/vuski/admdongkor), "
    "CC BY 4.0으로 배포됩니다. 까우룽까우룽에서 서울 행정동을 25개 자치구로 병합했습니다."
)


def build(source, metadata):
    raw = source.read_bytes()
    if hashlib.sha256(raw).hexdigest() != metadata["sha256"]:
        raise ValueError("Source checksum does not match the pinned manifest")
    groups = defaultdict(list)
    names = {}
    for feature in json.loads(raw)["features"]:
        properties = feature["properties"]
        if properties["sido"] != "11":
            continue
        code = properties["sgg"]
        polygon = shape(feature["geometry"])
        if not polygon.is_valid:
            raise ValueError(f"Invalid upstream geometry: {properties['adm_nm']}")
        groups[code].append(polygon)
        names[code] = properties["sggnm"]
    if len(groups) != 25:
        raise ValueError(f"Expected 25 Seoul districts, got {len(groups)}")
    features = []
    for code, parts in sorted(groups.items()):
        polygon = unary_union(parts)
        if not polygon.is_valid or polygon.geom_type not in {"Polygon", "MultiPolygon"}:
            raise ValueError(f"Invalid merged geometry: {code}")
        centre = polygon.centroid
        if not polygon.covers(centre):
            centre = polygon.representative_point()
        geometry = mapping(polygon)
        geometry["bbox"] = list(polygon.bounds)
        features.append(
            {
                "type": "Feature",
                "id": f"seoul-{code}",
                "properties": {
                    "district_code": code,
                    "name": names[code],
                    "center": [centre.x, centre.y],
                },
                "geometry": geometry,
            }
        )
    city = unary_union([shape(f["geometry"]) for f in features])
    collection = {
        "type": "FeatureCollection",
        "name": "서울특별시 25개 자치구",
        "boundary_version": VERSION,
        "license": "CC-BY-4.0",
        "attribution": ATTRIBUTION,
        "source": metadata,
        "bbox": list(city.bounds),
        "city_geometry": mapping(city),
        "features": features,
    }
    output = ROOT / "backend/app/data/seoul_districts_20261001.geojson"
    output.write_text(json.dumps(collection, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{len(features)} districts, {output.stat().st_size} bytes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    build(args.input, json.loads(args.manifest.read_text()))
