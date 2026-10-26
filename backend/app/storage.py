from io import BytesIO
from pathlib import Path
import json
import os
import warnings
from PIL import Image, ImageOps, UnidentifiedImageError
from .config import get_settings

Image.MAX_IMAGE_PIXELS = 24_000_000


def normalize_image(raw: bytes) -> bytes:
    """Decode actual image bytes, remove EXIF/GPS and normalize for HCX-005."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw)) as image:
                if image.format not in {"JPEG", "PNG", "WEBP"}:
                    raise ValueError("JPG, PNG, WEBP 사진만 업로드할 수 있습니다.")
                image.load()
                if min(image.size) < 32 or max(image.size) / min(image.size) > 5:
                    raise ValueError("사진은 최소 32px, 가로세로 비율은 5:1 이내여야 합니다.")
                cleaned = ImageOps.exif_transpose(image).convert("RGB")
                cleaned.thumbnail((1600, 1600))
                output = BytesIO()
                cleaned.save(output, "JPEG", quality=88)
                return output.getvalue()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ValueError("정상적인 이미지 파일이 아닙니다.") from exc


class LocalStorage:
    def __init__(self):
        self.root = get_settings().storage_dir.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError("Invalid object key")
        return path

    def put(self, key: str, data: bytes):
        path = self.path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_bytes(data)
        os.replace(temporary, path)

    def get(self, key: str) -> bytes:
        return self.path(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self.path(key).is_file()

    def delete(self, key: str):
        self.path(key).unlink(missing_ok=True)


class S3Storage:
    def __init__(self):
        import boto3
        from botocore.config import Config

        s = get_settings()
        self.bucket = s.s3_bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=s.s3_endpoint_url,
            region_name=s.s3_region,
            aws_access_key_id=s.s3_access_key.get_secret_value(),
            aws_secret_access_key=s.s3_secret_key.get_secret_value(),
            config=Config(
                signature_version="s3v4",
                connect_timeout=5,
                read_timeout=30,
                retries={"max_attempts": 2},
                s3={"addressing_style": "path"},
            ),
        )

    def put(self, key: str, data: bytes):
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType="image/jpeg", ACL="private")

    def get(self, key: str) -> bytes:
        obj = self.client.get_object(Bucket=self.bucket, Key=key)
        try:
            return obj["Body"].read(get_settings().max_upload_bytes + 1)
        finally:
            obj["Body"].close()

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError as exc:
            if exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") == 404:
                return False
            raise

    def delete(self, key: str):
        self.client.delete_object(Bucket=self.bucket, Key=key)  # no error when the key is already gone

    def signed_url(self, key: str) -> str:
        return self.client.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=300
        )

    def put_json(self, key: str, data: bytes, bucket: str, acl: str, cache_seconds: int):
        self.client.put_object(
            Bucket=bucket,
            Key=key,
            Body=data,
            ContentType="application/json; charset=utf-8",
            CacheControl=f"public, max-age={cache_seconds}",
            ACL=acl,
        )


def get_storage():
    return S3Storage() if get_settings().storage_backend == "s3" else LocalStorage()


def publish_json(payload: dict) -> str:
    """지도 JSON을 올린다. S3에서는 MAP_BUCKET(없으면 S3_BUCKET)의 MAP_JSON_KEY에, 로컬에서는 .data/public 아래에 쓴다."""
    s = get_settings()
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    if s.storage_backend == "s3":
        bucket = s.map_bucket or s.s3_bucket
        S3Storage().put_json(s.map_json_key, body, bucket, s.map_json_acl, s.map_json_cache_seconds)
        return f"s3://{bucket}/{s.map_json_key}"
    path = s.storage_dir.parent / "public" / s.map_json_key
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_bytes(body)
    os.replace(temporary, path)
    return str(path)
