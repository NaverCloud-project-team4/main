"""까우룽까우룽 구역 단계 계산 로직: 예측이 기본값, 제보가 우선.

DB 조회와 분리된 순수 함수라서 FastAPI 집계 엔드포인트에서 그대로 가져다 쓰면 된다.
`python foliage_logic.py`로 실행하면 자체 테스트가 돈다.
"""
from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Optional, Sequence

# ---------------------------------------------------------------- 상수
DEFAULT_PEAK_DATE = date(2026, 10, 31)  # 서울 기본 예상 절정일(산림청 단풍나무류 예측)
EARLY_DAYS = 14             # 절정일보다 이만큼 이상 이르면 1단계(물들기 전)
PEAK_HALF_WIDTH_DAYS = 3    # 절정일 앞뒤 이 일수까지 3단계(절정)
REPORT_WINDOW_DAYS = 3      # 제보 우선 판단에 쓰는 최근 기간
VOTE_SIZE = 10              # 다수결에 쓰는 최신 제보 수
MIN_REPORTS = 3             # 이 건수 미만이면 제보 기반으로 보지 않음
MAX_TREES_PER_ZONE = 5

SOURCE_REPORT = "REPORT"
SOURCE_FORECAST = "FORECAST"
SOURCE_NONE = "NONE"


@dataclass(frozen=True)
class ZoneResult:
    stage: Optional[int]       # 1 물들기 전, 2 물드는 중, 3 절정, 4 지는 중, None이면 회색
    source: str                # REPORT / FORECAST / NONE
    peak_date: Optional[date]  # 구 대표 예상 절정일


# ---------------------------------------------------------------- 예측 기반
def stage_from_peak(today: date, peak_date: date) -> int:
    """오늘 - 예상 절정일(d)로 단계를 정한다.

    d <= -14: 1 / -14 < d < -3: 2 / -3 <= d <= 3: 3 / d > 3: 4
    """
    d = (today - peak_date).days
    if d <= -EARLY_DAYS:
        return 1
    if d < -PEAK_HALF_WIDTH_DAYS:
        return 2
    if d <= PEAK_HALF_WIDTH_DAYS:
        return 3
    return 4


def zone_peak_date(spot_dates: Sequence[date], default: Optional[date] = DEFAULT_PEAK_DATE) -> Optional[date]:
    """구 안 지점들의 예상 절정일 평균. 지점이 없으면 서울 기본값."""
    if not spot_dates:
        return default
    mean_ordinal = sum(d.toordinal() for d in spot_dates) / len(spot_dates)
    return date.fromordinal(round(mean_ordinal))


# ---------------------------------------------------------------- 제보 기반
def stage_from_reports(
    reports: Sequence[tuple[int, datetime]],
    now: datetime,
) -> Optional[int]:
    """최근 REPORT_WINDOW_DAYS일 안 제보 중 최신 VOTE_SIZE건의 다수결.

    MIN_REPORTS건 미만이면 None. 동률이면 동률 단계 중 가장 최근 제보의 단계.
    reports는 PASSED 제보의 (단계, 서버 수신 시각) 목록이다.
    """
    since = now - timedelta(days=REPORT_WINDOW_DAYS)
    recent = sorted(
        (r for r in reports if since <= r[1] <= now),
        key=lambda r: r[1],
        reverse=True,
    )[:VOTE_SIZE]
    if len(recent) < MIN_REPORTS:
        return None
    counts = Counter(stage for stage, _ in recent)
    top = max(counts.values())
    tied = {stage for stage, c in counts.items() if c == top}
    for stage, _ in recent:  # 최신순이므로 처음 만나는 동률 단계가 가장 최근
        if stage in tied:
            return stage
    return None


# ---------------------------------------------------------------- 합치기
def resolve_zone(
    now: datetime,
    reports: Sequence[tuple[int, datetime]],
    spot_dates: Sequence[date],
    forecast_today: Optional[date] = None,
    default_peak: Optional[date] = DEFAULT_PEAK_DATE,
) -> ZoneResult:
    """제보가 충분하면 제보 기반, 아니면 예측 기반, 둘 다 없으면 회색(NONE).

    forecast_today는 시연용으로 예측 계산에 쓰는 날짜만 바꾸고 싶을 때 쓴다.
    (제보 기간 판단은 항상 실제 now 기준이다.)
    """
    peak = zone_peak_date(spot_dates, default_peak)

    report_stage = stage_from_reports(reports, now)
    if report_stage is not None:
        return ZoneResult(report_stage, SOURCE_REPORT, peak)

    if peak is not None:
        today = forecast_today or now.date()
        return ZoneResult(stage_from_peak(today, peak), SOURCE_FORECAST, peak)

    return ZoneResult(None, SOURCE_NONE, None)


# ---------------------------------------------------------------- 나무 수
def tree_count(report_count: int, max_report_count: int, max_trees: int = MAX_TREES_PER_ZONE) -> int:
    """제보 수 기준 나무 수. 제보가 없으면 0, 있으면 최소 1."""
    if report_count <= 0 or max_report_count <= 0:
        return 0
    return max(1, math.ceil(report_count / max_report_count * max_trees))


# ---------------------------------------------------------------- 자체 테스트
def _selftest() -> None:
    peak = date(2026, 10, 31)
    assert stage_from_peak(date(2026, 10, 17), peak) == 1   # d=-14
    assert stage_from_peak(date(2026, 10, 18), peak) == 2   # d=-13
    assert stage_from_peak(date(2026, 10, 23), peak) == 2   # 오늘(d=-8)
    assert stage_from_peak(date(2026, 10, 27), peak) == 2   # d=-4
    assert stage_from_peak(date(2026, 10, 28), peak) == 3   # d=-3
    assert stage_from_peak(date(2026, 10, 30), peak) == 3   # 시연일
    assert stage_from_peak(date(2026, 11, 3), peak) == 3    # d=3
    assert stage_from_peak(date(2026, 11, 4), peak) == 4    # d=4

    assert zone_peak_date([]) == DEFAULT_PEAK_DATE
    assert zone_peak_date([date(2026, 10, 30)] * 2 + [date(2026, 10, 31)]) == date(2026, 10, 30)

    now = datetime(2026, 10, 30, 12, 0)
    h = lambda hours: now - timedelta(hours=hours)

    assert stage_from_reports([(3, h(1)), (3, h(2))], now) is None            # 2건 미만 기준
    assert stage_from_reports([(3, h(1)), (3, h(2)), (2, h(3))], now) == 3    # 다수결
    assert stage_from_reports([(2, h(1)), (3, h(2)), (3, h(3)), (2, h(4))], now) == 2  # 동률 -> 가장 최근
    assert stage_from_reports([(3, h(100)), (3, h(101)), (3, h(102))], now) is None    # 3일(72h) 초과
    many = [(4, h(i)) for i in range(1, 4)] + [(1, h(i)) for i in range(4, 14)]
    assert stage_from_reports(many, now) == 1                                  # 최신 10건만 투표: 4가 3건, 1이 7건

    r = resolve_zone(now, [(3, h(1)), (3, h(2))], [])
    assert (r.stage, r.source) == (3, SOURCE_FORECAST)                         # 제보 부족 -> 예측
    r = resolve_zone(now, [(4, h(1)), (4, h(2)), (4, h(3))], [])
    assert (r.stage, r.source) == (4, SOURCE_REPORT)                           # 제보 우선
    r = resolve_zone(now, [], [], forecast_today=date(2026, 10, 20))
    assert (r.stage, r.source) == (2, SOURCE_FORECAST)                         # 시연용 날짜 지정
    r = resolve_zone(now, [], [], default_peak=None)
    assert (r.stage, r.source) == (None, SOURCE_NONE)                          # 회색

    assert tree_count(0, 10) == 0
    assert tree_count(1, 10) == 1
    assert tree_count(3, 10) == 2
    assert tree_count(7, 10) == 4
    assert tree_count(10, 10) == 5
    assert tree_count(5, 0) == 0
    print("모든 테스트 통과")


if __name__ == "__main__":
    _selftest()
