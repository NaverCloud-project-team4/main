# 수채화 지도 에셋

`VITE_MAP_THEME=watercolor`에서만 사용합니다. 코드는 아래 파일명만 참조하므로(`MAP_ASSETS`, `frontend/src/components/WatercolorZoneMap.jsx`), **같은 이름·형식으로 덮어쓰면 교체가 끝납니다**. 현재 파일은 `scripts/make_map_placeholders.py`로 만든 임시본입니다.

| 파일 | 크기 | 형식 | 용도·조건 | 상태 |
|---|---|---|---|---|
| `paper-texture.webp` | 1024×1024 | WebP, 불투명 | 미색 한지/수채 종이 바탕. 이음매 없이 반복되어야 함(화면에서 512px로 타일링) | 임시본 |
| `pigment-grain.png` | 512×512 | PNG(그레이+알파) | 물감 입자. 알파가 안료가 고이는 곳. 이음매 없음. SVG에 data URI로 인라인되므로 **100KB 이하 권장** | 임시본 |
| `han-river.geojson` | — | GeoJSON | 한강 수면. `scripts/build_han_river.py`로 생성(© OpenStreetMap contributors, ODbL) | 최종 |
| `tree-maple.png` | 512×640 | PNG RGBA | 단풍나무. 줄기 밑동이 아래 중앙(높이 94%) | 2단계 |
| `tree-ginkgo.png` | 512×640 | PNG RGBA | 은행나무. 기준점 동일 | 2단계 |
| `tree-shadow.png` | 256×64 | PNG RGBA | 나무 아래 옅은 타원 그림자 | 2단계 |
| `leaf-maple-1~3.png`, `leaf-ginkgo-1~2.png` | 64×64 | PNG RGBA | 낙엽 장식 | 2단계 |

다시 생성: `.venv/Scripts/python scripts/make_map_placeholders.py [--only 파일명]`
