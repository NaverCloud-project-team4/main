from datetime import date, datetime, timedelta
from app.foliage import (
    interest_level,
    interest_score,
    kst_today,
    resolve_zone,
    stage_from_peak,
    stage_from_reports,
    zone_peak_date,
)

PEAK = date(2026, 10, 31)
NOW = datetime(2026, 10, 30, 12, 0)


def hours_ago(h):
    return NOW - timedelta(hours=h)


def test_stage_from_peak_boundaries():
    assert stage_from_peak(date(2026, 10, 17), PEAK) == "GREEN"  # d=-14
    assert stage_from_peak(date(2026, 10, 18), PEAK) == "STARTING"  # d=-13
    assert stage_from_peak(date(2026, 10, 27), PEAK) == "STARTING"  # d=-4
    assert stage_from_peak(date(2026, 10, 28), PEAK) == "PEAK"  # d=-3
    assert stage_from_peak(date(2026, 11, 3), PEAK) == "PEAK"  # d=3
    assert stage_from_peak(date(2026, 11, 4), PEAK) == "FALLEN"  # d=4


def test_zone_peak_date_uses_spot_average_or_default():
    assert zone_peak_date([], PEAK) == PEAK
    assert zone_peak_date([], None) is None
    assert zone_peak_date([date(2026, 10, 30)] * 2 + [date(2026, 10, 31)], PEAK) == date(2026, 10, 30)


def test_reports_need_three_in_window():
    assert stage_from_reports([("PEAK", hours_ago(1)), ("PEAK", hours_ago(2))], NOW) is None
    assert stage_from_reports([("PEAK", hours_ago(1)), ("PEAK", hours_ago(2)), ("STARTING", hours_ago(3))], NOW) == "PEAK"
    old = [("PEAK", hours_ago(100)), ("PEAK", hours_ago(101)), ("PEAK", hours_ago(102))]
    assert stage_from_reports(old, NOW) is None  # 3일(72시간)을 넘은 제보는 세지 않는다


def test_reports_tie_goes_to_most_recent():
    reports = [("STARTING", hours_ago(1)), ("PEAK", hours_ago(2)), ("PEAK", hours_ago(3)), ("STARTING", hours_ago(4))]
    assert stage_from_reports(reports, NOW) == "STARTING"


def test_reports_vote_uses_latest_ten_only():
    reports = [("FALLEN", hours_ago(i)) for i in range(1, 4)] + [("GREEN", hours_ago(i)) for i in range(4, 14)]
    assert stage_from_reports(reports, NOW) == "GREEN"  # 최신 10건: FALLEN 3, GREEN 7


def test_resolve_zone_prefers_reports_then_forecast_then_unknown():
    few = [("PEAK", hours_ago(1)), ("PEAK", hours_ago(2))]
    result = resolve_zone(few, [], NOW, date(2026, 10, 30), PEAK)
    assert (result.stage, result.source, result.peak_date) == ("PEAK", "FORECAST", PEAK)
    enough = [("FALLEN", hours_ago(i)) for i in (1, 2, 3)]
    result = resolve_zone(enough, [], NOW, date(2026, 10, 30), PEAK)
    assert (result.stage, result.source) == ("FALLEN", "REPORT")
    result = resolve_zone([], [], NOW, date(2026, 10, 20), PEAK)
    assert (result.stage, result.source) == ("STARTING", "FORECAST")  # 시연용 날짜 지정
    result = resolve_zone([], [], NOW, date(2026, 10, 30), None)
    assert (result.stage, result.source, result.peak_date) == ("UNKNOWN", "NONE", None)


def test_interest_score_and_level():
    assert interest_score(1, 1, 0) == 5 and interest_level(5) == 1
    assert interest_score(3, 3, 0) == 15 and interest_level(15) == 2
    assert interest_score(8, 8, 0) == 40 and interest_level(40) == 3
    assert interest_level(0) == 0 and interest_level(14) == 1 and interest_level(39) == 2


def test_kst_today_crosses_midnight():
    assert kst_today(datetime(2026, 10, 30, 14, 59)) == date(2026, 10, 30)
    assert kst_today(datetime(2026, 10, 30, 15, 0)) == date(2026, 10, 31)  # UTC 15:00 = KST 00:00
