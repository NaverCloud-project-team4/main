# API 계약과 데이터 처리

실행 중인 `/docs`와 `/openapi.json`을 기준으로 요청 필드와 응답 스키마를 확인할 수 있습니다. 스냅샷은 `docs/openapi.json`에 있습니다.

## 주요 API

| 메서드 | 경로 | 인증 | 기능 |
|---|---|---|---|
| POST | /api/auth/register | 없음 | 이메일·비밀번호·닉네임으로 가입 |
| POST | /api/auth/login | 없음 | JWT 발급 |
| GET | /api/me | 사용자 | 내 잔액·역할·프로필 |
| GET | /api/zones | 없음 | 활성 서울 25개 자치구·단풍 상태·관심 나무 |
| GET | /api/zones/boundaries | 없음 | 자치구 GeoJSON 경계·서울 외곽·bbox·기준일·출처 |
| POST | /api/zones/resolve | 없음 | 현재 좌표에 해당하는 제보 구역 자동 조회 |
| POST | /api/reports | 사용자 | multipart 사진 제보, 202 응답 |
| GET | /api/reports | 선택 | 승인된 피드, recent/popular 및 페이지 |
| GET | /api/reports/{id} | 선택 | 공개 제보 또는 본인·운영자의 비공개 제보 |
| GET | /api/reports/{id}/status | 선택 | 검증 상태 조회 |
| GET | /api/reports/{id}/photo?token=… | 사진 토큰 | 5분짜리 접근 권한 검사 후 사진 제공 |
| PUT / DELETE | /api/reports/{id}/like | 사용자 | 좋아요 추가·취소, 반복 호출해도 동일 결과 |
| GET | /api/me/reports | 사용자 | 내 제보와 검증 상태 |
| GET | /api/me/points | 사용자 | 잔액과 최근 포인트 내역 50개 |
| GET | /api/items | 선택 | 아이템과 보유·장착 상태 |
| PUT | /api/me/items/{item_id} | 사용자 | 보유하지 않은 아이템 한 번 구매 |
| PUT | /api/me/tree/equipment/{slot} | 사용자 | 보유 아이템 장착 |
| GET | /api/admin/reports | 운영자 | 검토 대기 제보 |
| POST | /api/admin/reports/{id}/decision | 운영자 | 검토 제보 승인·반려 |
| GET | /health/live / /health/ready | 없음 | 프로세스·DB 준비 상태 |

인증은 `Authorization: Bearer <access_token>` 헤더를 사용합니다. JWT는 브라우저 sessionStorage에 저장하며 기본 120분 후 만료됩니다. 사진 토큰과 로그인 토큰은 서로 다른 audience를 사용합니다.

## 현재 위치로 구역 찾기

`POST /api/zones/resolve`, JSON 예시:

```json
{"latitude": 37.5964, "longitude": 127.0525}
```

좌표를 포함하는 자치구가 있으면 `zone: {id, name, district_code}`와 지도 표기 중심까지의 참고 거리 `distance_m`를 반환합니다. 반경 대신 실제 구 경계(Polygon/MultiPolygon 및 내부 구멍)를 검사합니다. 공유 경계선은 자치구 ID 오름차순으로 결정합니다. 서울 밖이면 `zone: null, distance_m: null`입니다. 좌표 범위 오류는 422입니다. 조회는 DB에 위치나 제보를 저장하지 않습니다. 좌표는 URL 대신 요청 본문에 전달하며, 사진 제출 시 서버에서 구역을 다시 계산합니다.

브라우저는 사진 제보 화면 진입과 제출 직전에 위치 권한을 통해 현재 좌표를 읽습니다. 권한 거부·시간 초과·위치 기능 미지원·서비스 구역 밖이면 위치 안내와 다시 확인 버튼을 표시하고 제보 전송을 막습니다. 실배포는 HTTPS와 사용자 위치 권한이 필요합니다. API 좌표 값만으로 실제 방문이나 GPS 위변조 방지를 증명하지는 않습니다.

`GET /api/zones/boundaries`는 `FeatureCollection`입니다. 각 feature의 `id`와 `properties.zone_id`는 `seoul-11230` 같은 제보 구역 ID입니다. `properties.district_code`는 `11230` 같은 5자리 코드입니다. 응답의 `city_geometry`와 `bbox`는 서울 전체 경계, `boundary_version`은 경계 기준일입니다. 좌표 배열은 `[longitude, latitude]` 순서입니다. 지도에 표시할 때 출처와 CC BY 4.0 라이선스를 함께 표시해야 합니다.

## 제보 요청

`POST /api/reports`, `Content-Type: multipart/form-data`:

- `photo_source`: `camera`(기본값) / `upload`. `upload`는 DB의 운영자 역할을 가진 계정만 가능하며 일반 계정은 403입니다.
- `location_source`: `current`(기본값) / `manual`. `manual`은 운영자만 가능합니다. 운영자도 서울 25개 활성 구의 경계 안 좌표만 등록할 수 있습니다.
- `photo`: JPEG / PNG / WEBP, 기본 최대 10MB. 파일명 대신 실제 디코딩 결과를 검사합니다.
- `latitude`, `longitude`: 필수 숫자 좌표. 일반 사용자는 제출 직전 현재 위치를 다시 확인하고, 운영자의 직접 지정 모드는 선택한 좌표를 전송합니다. 서버가 이 좌표를 포함하는 서비스 구역을 자동으로 정합니다. 범위 밖은 422입니다.
- `zone_id`: 이전 API 클라이언트 호환용 선택 필드. 생략하면 좌표로 자동 결정하며, 전달하면 해당 활성 자치구의 경계 안인지 검사합니다. 새 프론트에서는 보내지 않습니다.
- `stage`: GREEN / STARTING / PEAK / FALLEN.
- `species`: MAPLE / GINKGO / MIXED.
- `description`: 최대 1,000자.
- `demo_outcome`: APPROVED / REVIEW / REJECTED. 로컬·테스트의 demo 모드에서만 허용합니다. 생략 시 REVIEW입니다.
- `Idempotency-Key` 헤더: 프론트가 한 번의 제출마다 생성한 UUID 등. 전송 재시도는 같은 키를 사용합니다. 같은 사용자·키·내용이면 같은 제보가 반환되고, 내용이 바뀌면 409입니다. 업로드가 불확실하게 실패한 경우 기존 제보의 복구/실패 상태를 먼저 확인합니다.

응답은 제보 객체이며 `id`, `status`, `photo_url`, `photo_source`, `location_source` 등을 포함합니다. 두 입력 방식은 DB에 기록되고 중복 요청의 내용 비교에도 포함됩니다. 과거 제보는 입력 방식을 알 수 없어 `legacy`로 보존합니다. 대기 상태를 확인하려면 로그인 토큰을 포함해 status API를 폴링합니다. 브라우저 구현은 1.2초 간격이며 상태가 확정되면 중단합니다.

## 상태 규칙

```text
PENDING_UPLOAD → PENDING_AI → APPROVED
                           → REVIEW → 운영자 APPROVED / REJECTED
                           → REJECTED
PENDING_UPLOAD → UPLOAD_FAILED (복구 작업에서도 사진이 발견되지 않음)
```

ObjectCreated가 API의 업로드 완료 처리보다 먼저 실행될 수 있으므로 함수는 두 대기 상태 모두 처리할 수 있습니다. API의 대기 상태 변경은 조건부 갱신으로 이미 끝난 검증 결과를 덮어쓰지 않습니다.

검증 작업은 `verification_jobs`에 저장됩니다. 작업을 선점할 때 임대 토큰을 만들고, 결과 저장 시에도 같은 토큰의 소유권을 확인합니다. 다른 실행자가 회수한 작업의 늦은 결과는 반영하지 않습니다. 실패한 작업은 기본 5초, 10초 간격으로 재시도하고 3번째 오류에는 REVIEW로 보냅니다.

`reports.status=APPROVED`로 처음 바뀔 때에만 승인 적립 내역을 생성하고 사용자 잔액을 증가시킵니다. 적립 키는 `report:{id}:approved`이며 유니크 제약이 있습니다. 운영자가 검토 결과를 반복 전송해도 다시 적립하지 않습니다. 확정된 결과를 다른 결과로 바꾸는 API는 현재 제공하지 않습니다.

## 관심 나무와 단풍 상태

관심도는 승인된 최근 7일 제보를 대상으로 계산합니다.

```text
score = 제보 수 × 2 + 서로 다른 제보자 수 × 3 + 좋아요 수
level = 0 (score 0), 1 (1~14), 2 (15~39), 3 (40 이상)
```

가중치와 기준은 현재 MVP 정책입니다. 실제 운영 데이터를 보고 조정합니다. `zone_status`는 같은 기간의 가장 최근 제보에 적힌 단풍 단계를 사용합니다. 좋아요는 단풍 단계나 사진의 진위를 결정하지 않습니다.

승인·좋아요 처리 시 같은 구역의 집계를 직렬화하고 다시 계산합니다. 워커의 1분 주기 복구 작업은 7일 범위를 벗어난 데이터도 제거합니다. 운영에서는 예약 액션 또는 상시 워커 중 하나를 반드시 실행해야 합니다. 지금 구현은 구역 단위 잠금과 재집계를 사용하므로 아주 높은 쓰기 트래픽에서는 집계 처리의 분리와 부하 측정이 필요합니다.

## 에러

- 401: 로그인 필요 / 만료 / 잘못된 토큰.
- 403: 운영자·아이템 소유·사진 토큰 권한 오류.
- 404: 찾을 수 없거나 볼 권한이 없는 비공개 제보.
- 409: 중복 가입, 요청 키 충돌, 포인트 부족, 검토 상태 충돌.
- 413: 업로드 크기 초과.
- 422: 잘못된 입력·사진·구역 밖 좌표·운영 환경의 테스트 판별 결과 입력.
- 429: 제보 간격 제한.
- 503: 사진 저장 결과가 불확실함 / DB 준비되지 않음. DB에 남은 작업은 복구 대상입니다.

## 촬영 및 위치 입력의 신뢰 범위

일반 화면은 파일 입력 없이 `getUserMedia` 카메라 촬영만 제공합니다. 서버는 `upload`/`manual` 입력에 대해 로그인한 사용자의 DB 역할을 검사하며, 클라이언트가 전달한 역할 값은 사용하지 않습니다. 브라우저가 보낸 이미지·좌표·입력 방식 값 자체로 실제 촬영이나 현장 방문을 증명할 수는 없습니다. 입력 방식은 클라이언트가 신고한 방식이며, 별도의 기기 무결성 증명이나 위변조 방지 기능을 의미하지 않습니다.

## main 통합 추가 사항 (2026-10-23)

- `/api/zones`, `/api/map`은 활성 서울 25개 구만 반환합니다. 구역 ID는 main의 영문 ID이며 `district_code`로 법정 자치구 코드를 제공합니다. 이전 `seoul-코드`는 제보 생성·피드 구역 필터에서 호환합니다.
- 구 요약에 `source`(`REPORT`/`FORECAST`/`NONE`), `peak_date`를 추가했습니다. `/api/map`은 `generated_at`, `season`, `forecast_date`, `zones`를 반환합니다.
- `POST /api/internal/aggregate`: `X-Aggregate-Key` 헤더 필요. 키 미설정 503, 불일치 403, 집계/업로드 실패 502. 집계는 DB 반영 후 지도 JSON을 발행하며 동시 실행은 건너뜁니다.
- 지도 단계/관심도는 승인·좋아요 요청마다 갱신하지 않고 1분 집계로 반영합니다. 좌표 자동 구 판별, 촬영/업로드·현재/수동 위치 권한, 제보 입력 방식 저장은 유지합니다.
