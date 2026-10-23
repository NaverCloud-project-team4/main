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

1. 사용자로 로그인 → 지도에서 구역 선택 → **이 구역 사진 제보하기**로 이동하거나 왼쪽 **사진 제보하기** 메뉴 선택 → **샘플 은행 사진 넣기** 또는 사진 업로드.
   로그인 후 왼쪽 상단 프로필을 누르면 내 프로필과 제보 내역을 볼 수 있습니다.
2. `승인 흐름 확인`을 선택하고 제출 → API가 202를 반환 → 별도 워커가 검증 → 화면이 상태 API를 폴링해 결과를 표시.
3. 승인되면 피드에 공개되고 포인트 20P가 적립됩니다. 좋아요를 누르면 지역 집계에도 반영됩니다.
4. 나만의 나무에서 아이템 구매·적용 → 포인트 차감, 보유 아이템과 장착 정보가 DB에 저장됩니다.
5. `운영자 검토 흐름 확인`으로 제출 → 운영자로 로그인 → 운영자 검토에서 승인·반려.
6. `반려 흐름 확인`으로 제출 → 내 제보에 사유가 보이고, 공개 피드·지도·포인트에는 반영되지 않습니다.
7. 화면 아래 **개발자 도구**를 펼치면 **API 통신 기록**에서 실제 요청 경로, 상태 코드, 응답 시간을 볼 수 있습니다.

지도 화면은 NCP Maps의 네이버 지도 JavaScript SDK와 실제 지도 타일을 사용합니다. DB에서 가져온 구역을 마커로 표시하고, 마커나 구역 목록에서 선택한 장소를 사진 제보 화면으로 넘깁니다. 관심 나무의 단계와 좋아요도 구역 데이터에서 표시합니다. 제보 위치는 테스트 편의를 위해 구역 중앙을 기본값으로 사용하며, 펼쳐서 좌표를 수정하거나 브라우저의 현재 위치를 가져올 수 있습니다. 클라이언트 위치 값 자체가 현장 방문을 증명하지는 않습니다.

네이버 지도 Client ID는 `frontend/.env.local`의 `VITE_NAVER_MAP_CLIENT_ID`로 설정합니다. 이 파일은 Git에서 제외됩니다. 새 설치나 배포 환경에서는 `frontend/.env.example`을 참고해 Maps Client ID와 허용 웹 서비스 URL을 설정하세요. Client Secret은 프론트에 넣지 않습니다. SDK 로딩·인증 실패 시 지도 영역에 오류를 표시하며, 아래 구역 목록은 계속 사용할 수 있습니다.

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
cd frontend
pnpm build
```

브라우저 테스트는 먼저 API·워커·프론트를 실행한 상태에서 Playwright를 사용합니다. 테스트는 UI를 통해 새 로컬 테스트 계정과 제보를 생성합니다. 실제 HTTP를 사용하며 API 응답을 모킹하지 않습니다.

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
