"""Unit tests for school_schedule.holiday_logic (pure Python, no HA required).

Run locally:  python3 tests/test_holiday_logic.py
Run in CI:    invoked by .github/workflows/tests.yaml
"""
from __future__ import annotations

import importlib
import os
import sys
import types
from datetime import date

# Import the pure-logic modules WITHOUT executing school_schedule/__init__.py
# (which imports Home Assistant packages like voluptuous). We register a stub
# package in sys.modules pointing at the integration directory — submodule
# imports (const, holiday_logic) then resolve through the stub's __path__.
_PKG_DIR = os.path.join(os.path.dirname(__file__), "..", "custom_components", "school_schedule")
if "school_schedule" not in sys.modules:
    _pkg = types.ModuleType("school_schedule")
    _pkg.__path__ = [os.path.abspath(_PKG_DIR)]
    sys.modules["school_schedule"] = _pkg

from school_schedule.holiday_logic import (  # noqa: E402
    day_status,
    next_event,
    next_school_day,
    parse_periods,
)
from school_schedule.const import (  # noqa: E402
    STATUS_PUBLIC_HOLIDAY,
    STATUS_SCHOOL_DAY,
    STATUS_VACATION,
    STATUS_WEEKEND,
)

# ─── Test fixtures ────────────────────────────────────────────────────

# Realistic mehr-schulferien.de payload (Thüringen 2026/2027), including
# the duplicate entries the API produces when fetched once per year.
RAW_PERIODS = [
    {"id": 5190, "name": "Winter", "type": "school_vacation",
     "starts_on": "2027-02-01", "ends_on": "2027-02-06",
     "is_public_holiday": False, "is_school_vacation": True},
    {"id": 5190, "name": "Winter", "type": "school_vacation",
     "starts_on": "2027-02-01", "ends_on": "2027-02-06",
     "is_public_holiday": False, "is_school_vacation": True},  # duplicate!
    {"id": 4625, "name": "Tag der Deutschen Einheit", "type": "public_holiday",
     "starts_on": "2026-10-03", "ends_on": "2026-10-03",
     "is_public_holiday": True, "is_school_vacation": False},
    {"id": 5474, "name": "Neujahrstag", "type": "public_holiday",
     "starts_on": "2027-01-01", "ends_on": "2027-01-01",
     "is_public_holiday": True, "is_school_vacation": False},
    {"id": 4100, "name": "Herbst", "type": "school_vacation",
     "starts_on": "2026-10-05", "ends_on": "2026-10-17",
     "is_public_holiday": False, "is_school_vacation": True},
    {"id": 5522, "name": "Tag der Arbeit", "type": "public_holiday",
     "starts_on": "2027-05-01", "ends_on": "2027-05-01",
     "is_public_holiday": True, "is_school_vacation": False},
    {"id": 5538, "name": "Christi Himmelfahrt", "type": "public_holiday",
     "starts_on": "2027-05-06", "ends_on": "2027-05-06",
     "is_public_holiday": True, "is_school_vacation": False},
]

PERIODS = parse_periods(RAW_PERIODS)


def test_dedupe() -> None:
    """The known API year-parameter bug must never produce duplicates."""
    assert len(PERIODS) == 6, f"expected 6 deduped periods, got {len(PERIODS)}"
    keys = [(p["starts_on"], p["ends_on"], p["name"]) for p in PERIODS]
    assert len(keys) == len(set(map(str, keys))), "duplicates survived dedupe"
    print("PASS: dedupe (year-parameter bug handled)")


def test_sorted_and_typed() -> None:
    """Periods come back as date objects, sorted ascending."""
    assert PERIODS[0]["starts_on"] <= PERIODS[-1]["starts_on"]
    assert all(isinstance(p["starts_on"], date) for p in PERIODS)
    assert all(isinstance(p["is_school_vacation"], bool) for p in PERIODS)
    print("PASS: sorted + typed")


def test_school_day() -> None:
    """A plain Tuesday in September is a school day."""
    result = day_status(date(2026, 9, 15), PERIODS)  # Tuesday
    assert result["status"] == STATUS_SCHOOL_DAY, result
    print("PASS: school day")


def test_weekend() -> None:
    """A Saturday is weekend (when not holiday)."""
    result = day_status(date(2026, 9, 19), PERIODS)  # Saturday
    assert result["status"] == STATUS_WEEKEND, result
    print("PASS: weekend")


def test_public_holiday_on_weekend() -> None:
    """Tag der Deutschen Einheit 2026 falls on a Saturday — holiday wins
    over weekend (reason must say the holiday, not 'weekend')."""
    result = day_status(date(2026, 10, 3), PERIODS)
    assert result["status"] == STATUS_PUBLIC_HOLIDAY, result
    assert result["reason"] == "Tag der Deutschen Einheit", result
    print("PASS: public holiday beats weekend")


def test_vacation_beats_weekend() -> None:
    """Saturday inside the autumn vacation is 'vacation', not weekend."""
    result = day_status(date(2026, 10, 10), PERIODS)  # Saturday in Herbst
    assert result["status"] == STATUS_VACATION, result
    assert result["reason"] == "Herbst", result
    print("PASS: vacation beats weekend")


def test_vacation_beats_holiday() -> None:
    """If a holiday falls inside a vacation, the vacation wins (priority)."""
    periods = parse_periods(RAW_PERIODS + [
        {"name": "Reformationstag", "starts_on": "2026-10-31", "ends_on": "2026-10-31",
         "is_public_holiday": True, "is_school_vacation": False},
        {"name": "Herbst 2", "starts_on": "2026-10-26", "ends_on": "2026-11-07",
         "is_public_holiday": False, "is_school_vacation": True},
    ])
    result = day_status(date(2026, 10, 31), periods)  # Saturday, holiday AND vacation
    assert result["status"] == STATUS_VACATION, result
    assert result["reason"] == "Herbst 2", result
    print("PASS: vacation beats public holiday")


def test_next_school_day_plain() -> None:
    """Thursday -> next school day is Friday."""
    result = next_school_day(date(2026, 9, 17), PERIODS)  # Thursday
    assert result is not None and result["date"] == "2026-09-18", result
    print("PASS: next_school_day plain")


def test_next_school_day_over_weekend() -> None:
    """Friday -> next school day is Monday (weekend skipped)."""
    result = next_school_day(date(2026, 9, 18), PERIODS)  # Friday
    assert result is not None and result["date"] == "2026-09-21", result
    print("PASS: next_school_day over weekend")


def test_next_school_day_over_vacation() -> None:
    """Day before autumn vacation -> next school day is the Monday after
    (Oct 3 holiday-Sat, vacation Oct 5-17, so first school day is 2026-10-19)."""
    result = next_school_day(date(2026, 10, 2), PERIODS)  # Friday
    assert result is not None and result["date"] == "2026-10-19", result
    print("PASS: next_school_day over vacation + holiday")


def test_next_vacation() -> None:
    """From mid-September the next vacation is Herbst (2026-10-05)."""
    result = next_event(date(2026, 9, 15), PERIODS, event_type="vacation")
    assert result is not None and result["date"] == "2026-10-05", result
    assert result["name"] == "Herbst", result
    print("PASS: next vacation")


def test_next_public_holiday() -> None:
    """From mid-September the next public holiday is Oct 3 (inside vacation,
    but still the next HOLIDAY — the countdown pill wants it anyway)."""
    result = next_event(date(2026, 9, 15), PERIODS, event_type="holiday")
    assert result is not None and result["date"] == "2026-10-03", result
    print("PASS: next public holiday")


def test_next_vacation_none_when_exhausted() -> None:
    """Beyond the horizon there is nothing — must return None, not crash."""
    result = next_event(date(2026, 9, 15), PERIODS, event_type="vacation", max_days=40)
    assert result is not None  # Herbst is within 40 days
    result = next_event(date(2026, 9, 15), PERIODS, event_type="vacation", max_days=20)
    assert result is not None
    result = next_event(date(2027, 6, 1), PERIODS, event_type="vacation", max_days=30)
    assert result is None, result
    print("PASS: exhausted horizon returns None")


def test_unparseable_dropped() -> None:
    """Junk entries must be dropped, not crash the parse."""
    periods = parse_periods(RAW_PERIODS + [
        {"name": "Junk", "starts_on": "not-a-date", "ends_on": "2026-01-01",
         "is_public_holiday": True, "is_school_vacation": False},
    ])
    assert all(p["name"] != "Junk" for p in periods)
    print("PASS: unparseable dates dropped")


if __name__ == "__main__":
    test_dedupe()
    test_sorted_and_typed()
    test_school_day()
    test_weekend()
    test_public_holiday_on_weekend()
    test_vacation_beats_weekend()
    test_vacation_beats_holiday()
    test_next_school_day_plain()
    test_next_school_day_over_weekend()
    test_next_school_day_over_vacation()
    test_next_vacation()
    test_next_public_holiday()
    test_next_vacation_none_when_exhausted()
    test_unparseable_dropped()
    print("\nALL HOLIDAY_LOGIC TESTS PASSED ✅")