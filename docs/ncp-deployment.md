# NCP 연결과 배포

로컬 실행을 확인한 코드입니다. 아래 설정은 배포 준비물이며, 실계정에 리소스를 생성하거나 서비스를 배포한 상태는 아닙니다.

## 공통 환경 설정

`.env.ncp.example`을 참고해 실제 비밀 값을 환경변수로 주입합니다. `.env`는 Git과 함수 ZIP에 포함하지 않습니다. API·워커·함수의 DB, 버킷, 적립 정책은 같은 값을 사용해야 합니다.

- `DATABASE_URL`: `mysql+pymysql://…?charset=utf8mb4`. 비밀번호의 특수문자는 URL 인코딩합니다.
- `STORAGE_BACKEND=s3`, private 사진 버킷과 Object Storage 접근 키를 지정합니다.
- `VERIFICATION_MODE=clova`, `CLOVA_API_KEY`, `CLOVA_MODEL=HCX-005`를 지정합니다.
- 모든 API 서버에 동일하고 충분히 긴 `JWT_SECRET`을 넣습니다.
- `PUBLIC_API_URL`은 브라우저가 접근하는 HTTPS API 도메인, `CORS_ORIGINS`는 실제 정적 웹 도메인입니다.
- production은 SQLite, 로컬 파일 저장소, 테스트 검증 모드, 기본 개발 JWT 키를 거부합니다.

Object Storage SDK와 서명 URL은 현재 `S3_ENDPOINT_URL`을 공통으로 사용합니다. 사진 조회 링크는 브라우저가 도달할 수 있는 엔드포인트여야 합니다. 기본값은 `https://kr.object.ncloudstorage.com`이며, 내부 엔드포인트를 사용할 계획이라면 내부 업로드 경로와 외부 조회 서명 경로를 분리해 추가 구성해야 합니다.

## DB와 API

1. NCP VPC의 별도 Private General Subnet에 Cloud DB for MySQL과 DB 스키마를 준비합니다.
2. DB 사용자와 ACG를 설정하고, API 서버 및 검증 함수의 VPC 연결에 대해서만 DB 접근을 허용합니다.
3. 배포 시 한 번 `PYTHONPATH=backend python -m app.cli init`으로 Alembic 마이그레이션과 구역·아이템·현재 연도 시즌 데이터를 생성합니다. API 프로세스가 시작할 때마다 마이그레이션하지 않습니다.
4. Private App Subnet에 서버를 두고 Dockerfile 또는 Uvicorn으로 실행합니다. DB 연결 풀의 총합은 API 프로세스 수·서버 수·함수 컨테이너 수를 곱해 DB 최대 연결 수 안에서 설정합니다.
5. Public Load Balancer Subnet의 ALB가 API의 8000 포트로 전달하도록 구성합니다. 헬스 체크는 `/health/ready`를 사용합니다. API에는 ALB의 접근만 허용합니다.
6. 실제 계정 가입 뒤 `python -m app.cli promote-admin --email 실제이메일`로 운영자를 지정합니다.

예시 Docker 빌드: `docker build -t kkawooroong-api .`. 로컬 MySQL 확인용 `docker compose up --build`도 제공하지만 이 환경에서는 Docker 데몬이 꺼져 있어 실제 실행을 확인하지 못했습니다. Compose는 로컬 테스트용이며, NCP 배포에는 관리형 DB와 공유 Object Storage 설정을 사용합니다.

## Cloud Functions

```bash
.venv/bin/python scripts/package_function.py
```

`artifacts/verification-function.zip`이 만들어집니다. ZIP에는 `__main__.py`, `requirements.txt`, 필요한 app 모듈만 포함되며 `.env`와 사진·DB·테스트 계정은 포함되지 않습니다.

- 콘솔에서 제공하는 Python 3.12 이상 런타임을 선택하고, 코드 파일로 ZIP을 올리고 `main`을 진입점으로 지정합니다. 실제 지원 버전은 콘솔에서 확인합니다.
- 웹 액션을 끄고 Object Storage의 `ObjectCreated:PUT` 트리거에 연결합니다.
- 함수는 private 사진 버킷의 `reports/` 경로에서 이미 DB에 등록된 객체만 처리합니다.
- API 업로드 후 DB에도 READY 작업이 남기 때문에 이벤트가 유실돼도 예약 작업으로 복구할 수 있습니다.
- 함수를 VPC의 private subnet에 연결하고 DB ACG를 허용합니다. Object Storage와 CLOVA Studio 호출 경로를 확인합니다.
- `requirements.txt`를 동봉해 런타임이 의존성을 설치하는 방식을 사용합니다. NCP 가이드에 따라 Private Subnet에서 이 설치 방식은 인터넷 접근과 NAT Gateway 설정이 필요합니다. 초기 의존성 설치 시간과 메모리도 실제 런타임에서 확인해야 합니다.
- 함수 타임아웃은 네트워크 호출을 포함해 충분하게 설정하고, 작업 임대 기본값 150초와의 관계를 확인합니다. 배치 예약 작업은 한 번에 한 제보만 검증합니다.

환경변수를 직접 주입할 수 없는 경우, 액션 기본 파라미터에 아래처럼 `settings` 객체를 넣습니다. 진입점이 이 값을 환경변수에 옮긴 후 app을 불러옵니다. 비밀 값은 콘솔의 접근 통제된 설정에 넣고 로그나 소스에 남기지 않습니다.

```json
{
  "settings": {
    "ENVIRONMENT": "production",
    "DATABASE_URL": "mysql+pymysql://실제사용자:인코딩한비밀번호@내부호스트:3306/스키마?charset=utf8mb4",
    "JWT_SECRET": "API와동일한32자이상의실제비밀키",
    "PUBLIC_API_URL": "https://api.실제도메인",
    "STORAGE_BACKEND": "s3",
    "S3_BUCKET": "실제비공개버킷",
    "S3_ACCESS_KEY": "실제접근키",
    "S3_SECRET_KEY": "실제비밀키",
    "VERIFICATION_MODE": "clova",
    "CLOVA_API_KEY": "실제CLOVA키",
    "DB_POOL_SIZE": 1,
    "DB_MAX_OVERFLOW": 0
  }
}
```

같은 ZIP으로 별도의 예약 액션을 만들고 같은 `settings`와 `scheduled: true`를 기본 파라미터로 추가해 1분 간격으로 호출합니다. 이 액션은 미완료 업로드 복구·오류 재시도·오래된 지역 집계 갱신을 담당합니다. 저장소 이벤트 액션에는 `scheduled: true`를 넣지 않습니다. 설정을 바꾸면 새 실행 환경에 반영되도록 액션을 갱신하고 실제 호출로 확인합니다.

Cloud Functions 대신 같은 코드를 `python -m app.worker`로 상시 실행할 수도 있습니다. 로컬은 이 방식을 사용합니다. 두 방식을 함께 실행해도 DB 작업 임대로 중복 반영을 막지만, 불필요한 실행 비용을 줄이려면 운영 경로를 정해두는 편이 좋습니다.

## 정적 프론트

`frontend/.env` 또는 `.env.local`에 `VITE_API_BASE_URL=https://실제API도메인`과 `VITE_NAVER_MAP_CLIENT_ID=실제Maps클라이언트ID`를 지정한 뒤 `pnpm build`합니다. Maps 애플리케이션에서 Web Dynamic Map을 활성화하고 실제 웹 도메인을 허용합니다. 새 Maps 애플리케이션의 SDK는 `ncpKeyId` 파라미터를 사용합니다. 로컬 개발 주소가 인증되지 않으면 네이버 가이드에 따라 포트·경로를 제외한 `http://127.0.0.1`을 확인하고, `localhost`로도 접속한다면 `http://localhost`를 함께 등록합니다. `frontend/dist/`를 정적 웹 전용 Object Storage에 업로드하고 Global Edge의 원본으로 연결합니다. 제보 사진 비공개 버킷과 정적 웹 버킷을 분리합니다. 빌드 결과에 DB·Object Storage·CLOVA 비밀키를 넣지 않습니다.

## 실제 연결 후 확인할 사항

- 브라우저의 HTTPS·CORS와 카메라·위치 권한.
- MySQL 마이그레이션, 연결 풀, 동시 승인·좋아요·포인트 트랜잭션.
- Object Storage 업로드 → 실제 이벤트 파라미터 → 함수 실행 → DB 반영.
- CLOVA 실응답의 이미지 입력·JSON 응답 처리. 형식 오류는 자동 승인하지 않습니다.
- 함수 오류, DB 장애, 사진 저장 지연 때 재시도·검토 전환.
- 부하 테스트에서 API 응답 시간과 DB·함수·CLOVA 호출량. 현재의 구역별 잠금과 전체 재집계는 MVP 방식이므로 병목을 측정한 뒤 집계 분리 등을 결정합니다.

## 근거 문서

- [NCP Object Storage 트리거 이벤트 형식](https://guide.ncloud-docs.com/docs/en/cloudfunctions-objectstorage-vpc)
- [NCP Python 액션 패키징과 requirements.txt](https://guide.ncloud-docs.com/docs/en/cloudfunctions-example-python)
- [CLOVA Studio Chat Completions V3 이미지 입력](https://api.ncloud-docs.com/docs/en/clovastudio-chatcompletionsv3)
- [FastAPI 여러 워커 실행](https://fastapi.tiangolo.com/deployment/server-workers/)

- [네이버 지도 JavaScript API 시작하기·인증 실패 처리](https://navermaps.github.io/maps.js.ncp/docs/tutorial-2-Getting-Started.html)
- [네이버 Maps 웹 서비스 URL 인증 문제 해결](https://guide.ncloud-docs.com/docs/maps-troubleshoot)
