# 서울 자치구 경계

- 기준일: 2026-10-01, WGS84 / EPSG:4326. GeoJSON 좌표는 `[경도, 위도]` 순서입니다.
- 원자료: 통계청 통계지리정보서비스(SGIS, https://sgis.kostat.go.kr)의 공공누리 제1유형 행정동 경계.
- 가공 자료: [vuski/admdongkor](https://github.com/vuski/admdongkor), CC BY 4.0. 상세 라이선스는 `LICENSE-DATA`.
- 고정 원본 URL, 커밋, SHA-256: `source.json`.
- 추가 가공: 서울 행정동 427개를 `sgg` 법정 자치구 코드로 병합해 25개 구와 서울 외곽 경계를 만들었습니다. 단순화/좌표 반올림을 하지 않았습니다. 지도 표기용 중심점은 경계 안의 점입니다.
- 이 데이터는 서비스의 구 분류/시각화용이며 측량이나 법적 경계 확정 용도가 아닙니다. GPS 오차로 경계 부근에서 실제 구와 다르게 판별될 수 있습니다.

## 출처 표시

본 데이터는 통계청 통계지리정보서비스(SGIS, https://sgis.kostat.go.kr)에서 공공누리 제1유형으로 개방한 행정동 경계를 가공한 것이며(가공: vuski/admdongkor, https://github.com/vuski/admdongkor), CC BY 4.0으로 배포됩니다. 까우룽까우룽에서 서울 행정동을 25개 자치구로 병합했습니다.

## 재생성

원본 파일을 `source.json`의 URL에서 내려받은 뒤 프로젝트 루트에서 실행합니다. Shapely는 빌드용으로만 필요하며 API 서버에서 사용하지 않습니다.

```sh
.venv/bin/pip install -r scripts/requirements-geodata.txt
.venv/bin/python scripts/build_seoul_districts.py /path/to/HangJeongDong_ver20261001.geojson backend/app/data/source.json
```

## DB 반영

`PYTHONPATH=backend .venv/bin/python -m app.cli init`은 마이그레이션과 25개 활성 구의 설정을 수행합니다. 이전 공원 구역은 비활성화하고 기존 제보 좌표를 기준으로 구를 재배정합니다. 포인트, 좋아요, 검증 기록은 변경하지 않습니다. 서울 밖의 과거 제보는 원래 비활성 구역에 보존하며 공개 피드에서 제외합니다. 오프라인 SQL 마이그레이션은 스키마만 생성하므로 적용 후 반드시 위 초기화 명령을 실행해야 합니다.

## 통합 구역 ID

원본 경계 파일의 `seoul-법정코드` 식별자는 보존합니다. API/DB에서는 `zones_seoul25.geojson`의 구 이름→영문 ID 매핑을 사용합니다. 경계와 서울 외곽선은 위 SGIS 2026-10-01 자료를 사용하며, `forecast_spots.csv`의 예측 지점은 이 경계로 다시 분류합니다. 원자료 CSV와 팀원이 제공한 경계 파일도 함께 보존합니다.
