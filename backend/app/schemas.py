from typing import Literal
from pydantic import BaseModel, Field, field_validator

Stage = Literal["GREEN", "STARTING", "PEAK", "FALLEN"]
Species = Literal["MAPLE", "GINKGO", "MIXED"]
Status = Literal["PENDING_UPLOAD", "PENDING_AI", "APPROVED", "REVIEW", "REJECTED", "UPLOAD_FAILED"]


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=254, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v):
        return v.strip().lower() if isinstance(v, str) else v


class RegisterIn(LoginIn):
    nickname: str = Field(min_length=1, max_length=30)

    @field_validator("nickname", mode="before")
    @classmethod
    def strip_nickname(cls, v):
        return v.strip() if isinstance(v, str) else v


class UserOut(BaseModel):
    id: str
    email: str
    nickname: str
    role: str
    points: int


class AuthOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class ReportOut(BaseModel):
    id: str
    status: Status
    stage: str
    species: str
    description: str
    zone_id: str
    zone_name: str
    author: str
    latitude: float
    longitude: float
    created_at: str
    approved_at: str | None
    like_count: int
    liked: bool
    reason: str | None
    photo_url: str | None
    verification_model: str | None


class ReportPage(BaseModel):
    items: list[ReportOut]
    total: int
    page: int
    has_more: bool


class ReviewIn(BaseModel):
    decision: Literal["APPROVED", "REJECTED"]
    reason: str = Field(min_length=1, max_length=500)


class EquipIn(BaseModel):
    item_id: str = Field(min_length=1, max_length=40)
