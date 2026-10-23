import hashlib
import hmac
import secrets
from datetime import timedelta
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
from .config import get_settings
from .db import get_db
from .models import User, now

bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()
    return f"scrypt${salt}${digest}"


def check_password(password: str, stored: str) -> bool:
    try:
        algorithm, salt, expected = stored.split("$")
        if algorithm != "scrypt":
            return False
        actual = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()
        return hmac.compare_digest(expected, actual)
    except (ValueError, TypeError):
        return False


def make_token(user: User) -> str:
    s = get_settings()
    return jwt.encode(
        {
            "sub": user.id,
            "iat": now(),
            "exp": now() + timedelta(minutes=s.token_minutes),
            "iss": "kauroong",
            "aud": "kauroong-api",
        },
        s.jwt_secret.get_secret_value(),
        algorithm="HS256",
    )


def optional_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)):
    if credentials is None:
        return None
    try:
        claims = jwt.decode(
            credentials.credentials,
            get_settings().jwt_secret.get_secret_value(),
            algorithms=["HS256"],
            issuer="kauroong",
            audience="kauroong-api",
            options={"require": ["exp", "sub", "iat"]},
        )
        user = db.get(User, claims["sub"])
        if user is None:
            raise ValueError("Unknown user")
        return user
    except (jwt.PyJWTError, ValueError, TypeError):
        raise HTTPException(401, "로그인이 만료되었거나 유효하지 않습니다.", headers={"WWW-Authenticate": "Bearer"})


def current_user(user=Depends(optional_user)):
    if user is None:
        raise HTTPException(401, "로그인이 필요합니다.", headers={"WWW-Authenticate": "Bearer"})
    return user


def admin_user(user=Depends(current_user)):
    if user.role != "admin":
        raise HTTPException(403, "운영자 권한이 필요합니다.")
    return user
