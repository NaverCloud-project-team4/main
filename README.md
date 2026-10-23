# 까우룽까우룽 · 실행 가능한 백엔드 MVP

FastAPI 백엔드와 React 동작 확인 화면입니다. 화면의 데이터는 실제 API와 DB를 사용합니다. 로컬 AI 검증은 명시적인 테스트 시나리오이며 실제 사진 분류가 아닙니다.

## 바로 실행

현재 작업 환경에는 Python 가상환경과 프론트 의존성을 설치해두었습니다. 프로젝트 루트에서:

```bash
./scripts/dev.sh
```

- 화면: http://127.0.0.1:5173
- API 문서 / Swagger: http://127.0.0.1:8000/docs
- DB 준비 상태: http://127.0.0.1:8000/health/ready
- 종료: 실행한 터미널에서 `Ctrl+C`

API, 검증 워커, 프론트를 함께 실행합니다. 워커를 실행하지 않으면 사진은 검증 대기 상태로 남습니다. 기본 로컬 DB는 `.data/app.db`, 사진은 `.data/photos/`에 저장되며 재실행해도 유지됩니다. 초기화 명령은 기존 데이터를 삭제하지 않습니다.

다른 환경에 새로 설치할 경우 Python 3.12 이상, Node.js 24, pnpm 11을 준비하고:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements-dev.txt
cd frontend
pnpm install --frozen-lockfile
cd ..
./scripts/dev.sh
```

`.env`는 없어도 로컬 기본값으로 실행됩니다. 설정을 바꾸려면 `.env.example`을 `.env`로 복사합니다. `frontend/.env.example`에는 별도 프론트 배포 시 API 주소를 설정하는 방법이 있습니다.

## 테스트 계정

| 구분 | 이메일 | 비밀번호 |
|---|---|---|
| 사용자 | demo@example.com | DemoPass123! |
| 운영자 | admin@example.com | AdminPass123! |

로컬 화면에서 테스트 계정 버튼으로 바로 로그인할 수 있습니다. 샘플 제보 2건과 사용자 포인트 40P를 초기 데이터로 넣었습니다. 새 회원가입은 0P부터 시작합니다. 이 계정들은 `init --demo`로만 생성되며 production에서는 이 명령을 차단합니다.

## 화면에서 확인하는 순서

1. 일반 사용자로 로그인 → **사진 제보하기** → 위치 권한 허용 → **카메라 켜기** → 카메라 권한 허용 → **사진 찍기** → 제출. 파일 선택과 샘플 사진 버튼은 제공하지 않습니다.
2. 운영자로 로그인 → **사진 제보하기** → **직접 지정**에서 지도 클릭·자치구 선택·좌표 입력 중 하나로 서울 안의 위치 지정 → **사진 파일 선택** 또는 직접 촬영 → 제출. **현재 위치**로 전환해 GPS를 사용할 수도 있습니다. 기기 위치 권한 없이 직접 지정 방식으로 제보할 수 있습니다.
3. 로컬의 샘플 사진과 검증 시나리오 선택은 운영자 화면에서만 제공합니다. 일반 사용자 제보는 로컬 데모 기본값인 검토 대기로 처리됩니다. 운영자 검토에서 승인·반려를 확인할 수 있습니다.
4. 승인되면 피드에 공개되고 포인트 20P가 적립됩니다. 좋아요를 누르면 지역 집계에도 반영됩니다. 나만의 나무에서 아이템 구매·적용도 확인할 수 있습니다.
5. 로그인 후 왼쪽 상단 프로필을 누르면 내 프로필과 제보 내역을 볼 수 있습니다. 반려 제보는 공개 피드·지도·포인트에 반영되지 않습니다.
6. 화면 아래 **개발자 도구** → **API 통신 기록**에서 실제 요청 경로, 상태 코드, 응답 시간을 확인합니다.

카메라는 `getUserMedia`의 영상 프레임을 JPEG로 저장하며, 일반 사용자 화면에는 파일 입력이 없습니다. 후면 카메라를 우선 요청하며 촬영·닫기·화면 이탈 시 카메라 트랙을 종료합니다. HTTPS(로컬은 localhost)와 카메라가 있는 기기가 필요합니다. [카메라 API 안내](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

지도 화면은 NCP Maps의 네이버 지도 JavaScript SDK와 실제 지도 타일을 사용합니다. DB에서 가져온 구역을 자치구 경계와 이름으로 표시하고 구별 정보를 조회합니다. 일반 사용자 사진 제보의 장소는 지도에서 선택한 구역과 별도로 현재 브라우저 위치를 기준으로 자동 결정합니다. 관심 나무의 단계와 좋아요도 구역 데이터에서 표시합니다. 현재 위치 모드는 제보 화면에 들어올 때와 전송 직전에 위치를 확인합니다. 일반 사용자에게 구역 선택·좌표 수동 입력은 제공하지 않으며, 운영자에게는 직접 지정 기능을 제공합니다. 제보 구역은 서울 25개 자치구입니다. 지도는 서울 경계 밖의 타일을 가리고, 화면 크기·확대 수준·실제 서울 경계를 기준으로 이동을 제한합니다. 서울 전체 보기에서는 위치가 고정되고, 확대하면 허용된 서울 내부에서 이동할 수 있습니다. 실제 행정 경계 폴리곤으로 좌표가 속한 구를 판별하며, 서울 밖·권한 거부·위치 확인 실패 시 전송을 막고 다시 확인할 수 있습니다. 실배포에서는 HTTPS가 필요합니다. 클라이언트 위치 값 자체가 현장 방문을 증명하지는 않습니다.

네이버 지도 Client ID는 `frontend/.env.local`의 `VITE_NAVER_MAP_CLIENT_ID`로 설정합니다. 이 파일은 Git에서 제외됩니다. 새 설치나 배포 환경에서는 `frontend/.env.example`을 참고해 Maps Client ID와 허용 웹 서비스 URL을 설정하세요. Client Secret은 프론트에 넣지 않습니다. 단풍 지도와 운영자 위치 지도는 GL 벡터 모드와 Style Editor ID `2ca6dae8-1af8-4390-b762-6f2736423d59`를 공유합니다. `VITE_NAVER_MAP_STYLE_ID`로 변경할 수 있습니다. SDK는 별도 버전 옵션 없이 ID에 연결된 발행본을 불러옵니다. 전달받은 버전은 `20261023163956`, 확인 시 서버의 발행본은 `20261023164102`였습니다. SDK 로딩·인증 실패 시 지도 영역에 오류를 표시하며, 아래 구역 목록은 계속 사용할 수 있습니다.

## 구현된 기능

- 회원가입·로그인, scrypt 비밀번호 해시, 만료되는 JWT, 사용자/운영자 권한.
- 구역 및 지도 범위 조회, 최신 단풍 상태와 최근 7일 지역 관심도 집계.
- 사진 형식·용량·실제 디코딩 검사, 구역 밖 위치 거부, 제보 간격 제한.
- EXIF/GPS 제거, 이미지 크기 정규화, 비공개 사진 보관과 5분짜리 조회 링크.
- DB에 먼저 제보/작업을 생성한 뒤 사진 업로드. `Idempotency-Key`가 같으면 같은 제보를 반환하고, 내용이 다르면 409.
- 별도 프로세스에서 DB에 저장된 검증 작업 처리. 중복 이벤트 방지, 작업 임대 만료 후 복구, 지수 간격 재시도, 3회 오류 후 운영자 검토.
- CLOVA Studio HTTP 연동 어댑터와 NCP Object Storage SDK 어댑터.
- 승인된 제보만 공개, 최신순·좋아요순 피드와 페이지 조회.
- 사용자별 중복 좋아요 방지. PUT/DELETE를 반복해도 개수는 한 번만 변경.
- 승인 상태 변경·포인트 내역·사용자 잔액을 같은 트랜잭션에서 반영. 고유 적립 키로 이중 적립 방지.
- 운영자 검토, 포인트 내역, 아이템 구매·장착, 동시 구매 시 이중 차감 방지.
- 헬스 체크, 요청 ID, 요청 로그, 명시적인 CORS, MySQL 연결 풀 설정.
- Alembic 마이그레이션, Dockerfile, 로컬 MySQL용 Compose, Cloud Functions ZIP 패키징.

## 코드 구조

```text
backend/app/
  main.py        API와 접근 권한, 업로드, 응답
  schemas.py     요청·응답 계약
  models.py      테이블과 제약·인덱스
  services.py    승인·포인트·좋아요·지역 집계 트랜잭션
  jobs.py        작업 선점·재시도·이벤트 처리·복구
  worker.py      로컬 검증 워커
  verifier.py    테스트 검증 / CLOVA Studio 어댑터
  storage.py     로컬 파일 / NCP Object Storage 어댑터
  security.py    비밀번호·JWT
  cli.py         마이그레이션·초기 데이터·운영자 지정
backend/migrations/  DB 버전 관리
backend/tests/       API·트랜잭션·동시 요청·어댑터 테스트
frontend/            React 화면·네이버 지도·모바일 하단 메뉴
docs/schema.mysql.sql  MySQL 테이블 정의
architecture/        전체·백엔드·DB 아키텍처 설계와 이미지
design/              Figma 화면 구성 스크립트
assets/              샘플 단풍·은행 이미지
cloud_function/      NCP 검증 액션 진입점
scripts/             개발 실행·브라우저 테스트·함수 ZIP 생성
```

## 검증 실행

```bash
.venv/bin/pytest -q
.venv/bin/ruff check backend cloud_function scripts/package_function.py
node --test scripts/report-location.test.mjs
cd frontend
pnpm build
```

브라우저 테스트는 먼저 API·워커·프론트를 실행한 상태에서 Playwright를 사용합니다. 테스트는 UI를 통해 새 로컬 테스트 계정과 제보를 생성합니다. 실제 HTTP를 사용하며 API 응답을 모킹하지 않습니다. 재현 가능한 위치 검증을 위해 테스트 브라우저의 위치 권한을 부여하고 서울의 고정 좌표를 설정합니다. 이는 실제 기기의 GPS 측정이 아닙니다.

```bash
# Playwright가 설치된 환경에서 프로젝트 루트 기준
NODE_PATH=frontend/node_modules node scripts/browser-smoke.cjs
# 시스템 Chrome을 사용할 경우 (macOS 예)
CHROME_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  NODE_PATH=frontend/node_modules node scripts/browser-smoke.cjs
```

브라우저와 Playwright가 없다면 프론트 디렉터리에서 `pnpm add -D playwright@1.62.1` 및 `pnpm exec playwright install chromium`으로 준비할 수 있습니다. 현재 Codex 환경에서는 번들 Playwright와 시스템 Chrome으로 실행했습니다. 결과 JSON과 데스크톱·모바일 스크린샷은 `artifacts/`에 생성됩니다.

구체적인 결과와 검증 범위는 [검증 기록](docs/verification.md), API 목록과 상태 규칙은 [API 명세](docs/api.md), NCP 배포 순서는 [NCP 연결 가이드](docs/ncp-deployment.md)를 참고하세요.

## 현재 검증 범위

로컬 SQLite + 로컬 비공개 파일 저장소 + 테스트 검증 모드에서 API 두 프로세스와 별도 워커를 함께 실행해 확인했습니다. NCP 실계정, 관리형 MySQL, 실제 CLOVA 유료 호출과 Cloud Functions 배포는 아직 실행하지 않았습니다. Docker 데몬이 실행 중이지 않아 MySQL Compose의 실제 구동도 확인하지 못했습니다.

NCP 전환을 위한 코드와 설정은 포함되어 있습니다. 공개 서비스에 배포하기 전 실제 NCP 연결 검증과 부하 측정, 로그인 시도 제한, 비밀번호 복구·이메일 검증 등 계정 운영 정책을 추가해야 합니다.

### 서울 자치구 데이터

`zones.district_code`는 5자리 자치구 코드, `boundary`는 WGS84 GeoJSON, `active`는 서비스 구역 여부입니다. 2026-10-01 SGIS 유래 경계를 사용하며 [출처·라이선스·재생성 방법](backend/app/data/README.md)을 포함했습니다. 새 설치와 기존 DB 모두 `app.cli init`으로 25개 구를 구성합니다. 기존 공원/캠퍼스 구역은 비활성화하고 제보 좌표로 구를 재배정하며 좋아요·검증·포인트 기록을 보존합니다. 적용 전 DB를 백업하세요. 오프라인 MySQL SQL은 스키마만 생성하므로 적용 뒤에도 `app.cli init`을 실행해야 합니다.
