"""구역 단계·관심도 계산: 제보 우선, 부족하면 산림청 예측.

DB와 분리된 순수 함수만 둔다. 집계(services.aggregate_zones)가 이 함수들을 호출한다.
"""
from collections import Counter
from dataclasses import dataclass
from collections.abc import Sequence
from datetime import date, datetime, timedelta, timezone

STAGES = ("GREEN", "STARTING", "PEAK", "FALLEN")
UNKNOWN = "UNKNOWN"
SOURCE_REPORT = "REPORT"
SOURCE_FORECAST = "FORECAST"
SOURCE_NONE = "NONE"

EARLY_DAYS = 14  # 예상 절정일보다 이만큼 이상 이르면 GREEN
PEAK_HALF_WIDTH_DAYS = 3  # 절정일 앞뒤 이 일수까지 PEAK
KST = timezone(timedelta(hours=9))  # 한국은 서머타임이 없어 고정 오프셋으로 충분하다


@dataclass(frozen=True)
class ZoneResult:
    stage: str
    source: str
    peak_date: date | None


def kst_today(now_utc: datetime) -> date:
    """naive UTC 시각을 한국 날짜로 바꾼다."""
    return (now_utc.replace(tzinfo=timezone.utc).astimezone(KST)).date()


def stage_from_peak(today: date, peak_date: date) -> str:
    """d = 오늘 - 예상 절정일. d<=-14 GREEN, -14<d<-3 STARTING, -3<=d<=3 PEAK, d>3 FALLEN."""
    d = (today - peak_date).days
    if d <= -EARLY_DAYS:
        return "GREEN"
    if d < -PEAK_HALF_WIDTH_DAYS:
        return "STARTING"
    if d <= PEAK_HALF_WIDTH_DAYS:
        return "PEAK"
    return "FALLEN"


def zone_peak_date(spot_dates: Sequence[date], default: date | None) -> date | None:
    """구 안 예측 지점의 예상 절정일 평균. 지점이 없으면 기본값."""
    if not spot_dates:
        return default
    mean_ordinal = sum(d.toordinal() for d in spot_dates) / len(spot_dates)
    return date.fromordinal(round(mean_ordinal))


def stage_from_reports(
    reports: Sequence[tuple[str, datetime]],
    now: datetime,
    window_days: int = 3,
    vote_size: int = 10,
    min_reports: int = 3,
) -> str | None:
    """최근 window_days일 안 승인 제보 중 최신 vote_size건의 다수결. 동률이면 가장 최근 제보의 단계.

    min_reports건 미만이면 None(제보 기반으로 보지 않음).
    """
    since = now - timedelta(days=window_days)
    recent = sorted((r for r in reports if since <= r[1] <= now), key=lambda r: r[1], reverse=True)[:vote_size]
    if len(recent) < min_reports:
        return None
    counts = Counter(stage for stage, _ in recent)
    top = max(counts.values())
    tied = {stage for stage, c in counts.items() if c == top}
    for stage, _ in recent:  # 최신순이므로 처음 만나는 동률 단계가 가장 최근
        if stage in tied:
            return stage
    return None


def resolve_zone(
    reports: Sequence[tuple[str, datetime]],
    spot_dates: Sequence[date],
    now: datetime,
    today: date,
    default_peak: date | None,
    window_days: int = 3,
    vote_size: int = 10,
    min_reports: int = 3,
) -> ZoneResult:
    """제보가 충분하면 제보 기반, 아니면 예측 기반, 둘 다 없으면 UNKNOWN(NONE)."""
    peak = zone_peak_date(spot_dates, default_peak)
    voted = stage_from_reports(reports, now, window_days, vote_size, min_reports)
    if voted is not None:
        return ZoneResult(voted, SOURCE_REPORT, peak)
    if peak is not None:
        return ZoneResult(stage_from_peak(today, peak), SOURCE_FORECAST, peak)
    return ZoneResult(UNKNOWN, SOURCE_NONE, None)


def interest_score(report_count: int, reporter_count: int, like_count: int) -> int:
    return report_count * 2 + reporter_count * 3 + like_count


def interest_level(score: int) -> int:
    return 3 if score >= 40 else 2 if score >= 15 else 1 if score > 0 else 0
