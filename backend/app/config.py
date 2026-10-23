from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]
LOCAL_SECRET = "local-development-only-change-before-deployment-2026"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")
    environment: Literal["local", "test", "production"] = "local"
    database_url: str = f"sqlite:///{ROOT / '.data/app.db'}"
    jwt_secret: SecretStr = SecretStr(LOCAL_SECRET)
    token_minutes: int = 120
    cors_origins: str = "http://127.0.0.1:5173,http://localhost:5173"
    public_api_url: str = "http://127.0.0.1:8000"
    storage_backend: Literal["local", "s3"] = "local"
    storage_dir: Path = ROOT / ".data/photos"
    s3_endpoint_url: str = "https://kr.object.ncloudstorage.com"
    s3_region: str = "kr-standard"
    s3_bucket: str = ""
    s3_access_key: SecretStr = SecretStr("")
    s3_secret_key: SecretStr = SecretStr("")
    verification_mode: Literal["demo", "clova"] = "demo"
    clova_api_key: SecretStr = SecretStr("")
    clova_base_url: str = "https://clovastudio.stream.ntruss.com"
    clova_model: str = "HCX-005"
    clova_timeout: float = 60
    max_upload_bytes: int = 10 * 1024 * 1024
    report_cooldown_seconds: int = 5
    report_points: int = 20
    activity_days: int = 7
    job_max_attempts: int = 3
    job_lease_seconds: int = 150
    retry_base_seconds: int = 5
    upload_timeout_seconds: int = 120
    db_pool_size: int = 5
    db_max_overflow: int = 5

    @model_validator(mode="after")
    def check_production(self):
        if self.environment == "production":
            if self.jwt_secret.get_secret_value() == LOCAL_SECRET or len(self.jwt_secret.get_secret_value()) < 32:
                raise ValueError("Production requires a unique JWT_SECRET of at least 32 characters")
            if self.database_url.startswith("sqlite") or self.storage_backend != "s3":
                raise ValueError("Production requires shared MySQL and Object Storage")
            if self.verification_mode != "clova":
                raise ValueError("Demo verification is disabled in production")
            if not self.public_api_url.startswith("https://"):
                raise ValueError("Production PUBLIC_API_URL requires HTTPS")
        if self.storage_backend == "s3" and not all(
            [self.s3_bucket, self.s3_access_key.get_secret_value(), self.s3_secret_key.get_secret_value()]
        ):
            raise ValueError("S3 storage requires bucket and credentials")
        if self.verification_mode == "clova" and not self.clova_api_key.get_secret_value():
            raise ValueError("CLOVA_API_KEY is required")
        return self


@lru_cache
def get_settings():
    return Settings()
