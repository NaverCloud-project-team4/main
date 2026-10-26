# 시연 런북 (seed-showcase / reset-showcase)

산림청 예측(forecast_spots)을 바탕으로 **시연 시점에 인기 있는 명소가 지도에 미리 보이도록** 시연 데이터를 만들고 지우는 절차입니다.
실제 서비스 규칙(승인 1건 = 20P, 집계 1분 주기, 스키마)은 그대로이며, 시연 데이터는 전용 계정으로만 만들어집니다.

## 무엇이 만들어지나
설정: [`backend/app/data/showcase.json`](../backend/app/data/showcase.json)

| 항목 | 내용 |
|---|---|
| 인기 명소 (`popularSpots`) | forecast_spots 이름 + 목표 관심도(2~3). 명소 반경 `spreadMeters`(300m) 안, **그 명소의 구 경계 안**에 승인 제보를 만든다. 시트의 [대표 명소]에서 "요즘 인기"로 맨 위에 보인다 |
| 관심도 1 구 (`levelOneZones`) | 제보 1건. 나머지 구에 관심도 0~1이 섞이게 |
| 부하 테스트 공략 구 (`loadTestZones`) | 관심도 1로 시작 → 리허설·시연 때 부하 테스트로 나무가 자라는 장면 |
| 그 밖의 구 | 시연 제보 없음. 산림청 예측 단계로만 색이 나온다 |
| 제보 단계 | 명소의 예상 절정일과 예측 기준일(`FORECAST_TODAY`, 없으면 오늘)로 계산 → 예측과 제보가 모순되지 않음 |
| 제보 시각 | 실행 시점 기준 1~60시간 전(`hoursAgo`). **발표 직전에 다시 실행하면 시간이 다시 맞춰진다** |
| 계정 | `showcase-01..08@demo.kauroong.local` (로그인 불가 비밀번호) |
| 사진 | `assets/showcase/ginkgo/`, `assets/showcase/maple/` → 현재 `STORAGE_BACKEND`(local/NCP)로 업로드. 비어 있으면 레포 샘플 2장 |
| 데모 계정 포인트 | `demo@example.com`에 "제보 승인" 20P × 26건(멱등). 큰나무 + 아이템 몇 개를 살 잔액 |

관심도는 점수식(제보 2 + 제보자 3 + 좋아요; 레벨 1 >0, 2 ≥15, 3 ≥40)에 맞춰 정확히 만든다: 레벨 1 = 1명, 레벨 2 = 3명 + 좋아요 2, 레벨 3 = 8명 + 좋아요 4.

`seed-showcase`는 항상 **기존 시연 데이터를 먼저 지우고 다시 만든다**. `reset-showcase`는 `showcase-*`·`rehearsal-*@demo.kauroong.local` 계정과 그 제보·좋아요·포인트·아이템·사진만 지운다. 데모 계정과 일반 사용자 데이터는 남는다. 두 명령 모두 끝나면 집계와 지도 JSON 게시까지 바로 실행한다.

> 운영 환경(`ENVIRONMENT=production`)에서는 `--confirm`을 붙여야 실행된다.

### 리허설(부하 테스트) 계정
부하 테스트 도구는 **`rehearsal-<번호>@demo.kauroong.local`** 로 가입하게 한다. 그래야 `reset-showcase`가 리허설 데이터도 함께 지운다. 그 밖의 이메일로 만든 데이터는 지우지 않는다.

### 성장 단계 기준일
예측 단계는 `FORECAST_TODAY`(YYYY-MM-DD)로 고정할 수 있다. 발표일 기준 색을 미리 보려면 발표일을 넣는다(예: `2026-10-30`이면 은행 명소는 절정). 설정하지 않으면 오늘(KST) 기준.

## Windows (로컬 개발, SQLite)
PowerShell, 저장소 루트에서.

```powershell
# 0) 준비: 시연 사진을 넣는다 (선택)
#    assets\showcase\ginkgo\*.jpg, assets\showcase\maple\*.jpg

# 1) DB 초기화 + 데모 계정 (+ 데모 포인트)
$env:PYTHONPATH = "backend"; $env:PYTHONUTF8 = "1"
.venv\Scripts\python -m app.cli init --demo

# 2) 시연 데이터 (발표일 기준 단계로 보고 싶으면 FORECAST_TODAY 지정)
$env:FORECAST_TODAY = "2026-10-30"
.venv\Scripts\python -m app.cli seed-showcase

# 3) 실행 (수채화 지도가 기본값, 15초 갱신)
$env:VITE_ZONE_POLL_MS = "15000"
powershell -ExecutionPolicy Bypass -File scripts\dev.ps1

# 4) 끝나면 시연 데이터만 지우기
.venv\Scripts\python -m app.cli reset-showcase
```

`FORECAST_TODAY`는 API·워커에도 같은 값이어야 하므로 3)을 같은 창에서 실행한다(dev.ps1이 환경변수를 물려받는다).

## Linux (서버, docker compose + MySQL)
저장소 루트에서. 사진은 `assets/showcase/`에 넣으면 컨테이너에 읽기 전용으로 마운트된다(이미지 재빌드 불필요).

```bash
# 0) 발표일 기준 단계 (선택): compose.yaml의 x-app environment에 FORECAST_TODAY: "2026-10-30" 추가
# 1) 빌드·DB·초기화(init --demo)·API·워커
docker compose build
docker compose up -d mysql
docker compose run --rm migrate
docker compose up -d api worker

# 2) 시연 데이터
docker compose run --rm api python -m app.cli seed-showcase
# 운영 환경 설정(ENVIRONMENT=production)이면:
# docker compose run --rm api python -m app.cli seed-showcase --confirm

# 3) 확인 (아래 체크리스트)
curl -s http://127.0.0.1:8000/api/zones | python3 -c "import json,sys; z=json.load(sys.stdin); print(sorted((x['tree_level'], x['id'], x['stage'], x['source']) for x in z if x['tree_level']))"
curl -s "http://127.0.0.1:8000/api/forecast-spots?zone_id=jung"

# 4) 발표 직전: 다시 실행해 제보 시각을 최근으로
docker compose run --rm api python -m app.cli seed-showcase

# 5) 발표 후: 시연·리허설 데이터만 지우기
docker compose run --rm api python -m app.cli reset-showcase
```

NCP Object Storage를 쓰는 서버면 `STORAGE_BACKEND=s3`와 버킷·키 환경변수가 이미 설정된 상태에서 같은 명령을 쓴다(사진이 그 버킷에 올라가고 reset 때 지워진다).

## 확인 체크리스트
- [ ] `seed-showcase` 출력의 `zones`가 설정과 같다(인기 명소 구 2~3, levelOne·loadTest 구 1)
- [ ] `/api/zones`: 인기 구는 `source: REPORT`, 단계는 명소 예측 단계와 같다. 나머지는 `FORECAST`
- [ ] 지도: 인기 구에 숲, 관심도 1 구에 작은 나무, 나머지는 예측 색
- [ ] 인기 구 시트 → [대표 명소] 맨 위에 "요즘 인기" 명소, "최근 제보 N건"
- [ ] [사용자 게시물]에 시연 사진이 보인다
- [ ] 데모 계정(`demo@example.com` / `DemoPass123!`) → 나만의 나무가 큰나무, 잔액으로 아이템 구매 가능
- [ ] 부하 테스트 공략 구가 관심도 1에서 시작한다
- [ ] `reset-showcase` 후 시연·리허설 계정이 0, 데모 계정은 남아 있다

## 시연 당일 순서
1. (전날) `init --demo` → `seed-showcase` → 체크리스트 → 리허설(부하 테스트, `rehearsal-*` 계정) → `reset-showcase`
2. (발표 30분 전) `seed-showcase` 다시 실행 → 체크리스트
3. (발표) 지도 → 인기 구 시트 → 명소 팝업북 → 부하 테스트로 공략 구 나무 성장(집계 1분 + 폴링 15초, 최대 약 75초) → 나만의 나무
4. (발표 후) `reset-showcase`

## 참고: 우세 수종 캐시 효과 (발표 자료용)
`/api/zones`의 구별 우세 수종은 API 프로세스 메모리에 60초 캐시(`SPECIES_CACHE_SECONDS`, 집계 주기와 같음). 지도 JSON은 1분마다 새로 계산한다.
측정: 승인 제보 50,000건(전부 최근 7일), 같은 프로세스에서 각 20회, SQLite.

| 경우 | p50 | p95 |
|---|---|---|
| 캐시 없음 (이전) | 293.9 ms | 334.3 ms |
| 캐시 적용 · 캐시 적중 | **14.1 ms** | **19.5 ms** |
| 캐시 적용 · 만료 직후 첫 요청 (60초에 한 번, 프로세스당) | 289.1 ms | 527.1 ms |
| 참고: 수종 계산 자체를 뺀 경우 | 14.8 ms | 23.4 ms |
