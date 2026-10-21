"""Unit tests for the v2.7.7 vacation pause (school-free days report 0 lessons).

Backlog item: "Wenn Ferien sind, sollen die Stunden pausiert werden" -
day sensors must not show weekday template lessons for concrete dates
that are school-free. pauses_lessons() is the single decision point the
coordinator uses for today, tomorrow and all weekday sensors.

Run locally:  python3 tests/test_schedule_pause.py
Run in CI:    invoked by .github/workflows/tests.yaml
"""
from __future__ import annotations

import os
import sys
import types
from datetime import date

# Import the pure-logic modules WITHOUT executing school_schedule/__init__.py
# (which imports Home Assistant packages like voluptuous). We register a stub
# package in sys.modules pointing at the integration directory - submodule
# imports (const, holiday_logic, date_exception_logic) then resolve through
# the stub's __path__.
_PKG_DIR = os.path.join(os.path.dirname(__file__), "..", "custom_components", "school_schedule")
if "school_schedule" not in sys.modules:
    _pkg = types.ModuleType("school_schedule")
    _pkg.__path__ = [os.path.abspath(_PKG_DIR)]
    sys.modules["school_schedule"] = _pkg

from school_schedule.holiday_logic import day_status, parse_periods, pauses_lessons  # noqa: E402
from school_schedule.date_exception_logic import effective_day_status  # noqa: E402
from school_schedule.const import (  # noqa: E402
    EXCEPTION_TYPE_FREE,
    EXCEPTION_TYPE_PARTIAL,
    STATUS_DATE_EXCEPTION,
    STATUS_PUBLIC_HOLIDAY,
    STATUS_SCHOOL_DAY,
    STATUS_VACATION,
    STATUS_WEEKEND,
)

PASS = 0
FAIL = 0


def check(name: str, cond: bool) -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        print("FAIL:", name)


# ─── Fixtures ───────────────────────────────────────────────────────────

# Thüringen-like periods: Herbstferien 12.-23.10.2026 (Mo-Fr days inside!)
PERIODS = parse_periods(
    [
        {
            "name": "Herbstferien",
            "starts_on": "2026-10-12",
            "ends_on": "2026-10-23",
            "is_school_vacation": True,
            "is_public_holiday": False,
        }
    ]
)

# ─── 1. pauses_lessons: every status ────────────────────────────────────

check("school_day does NOT pause", pauses_lessons(STATUS_SCHOOL_DAY) is False)
check("vacation pauses", pauses_lessons(STATUS_VACATION) is True)
check("public_holiday pauses", pauses_lessons(STATUS_PUBLIC_HOLIDAY) is True)
check("weekend pauses", pauses_lessons(STATUS_WEEKEND) is True)
check("date_exception (free) pauses", pauses_lessons(STATUS_DATE_EXCEPTION) is True)

# ─── 2. day_status integration: vacation on a WEEKDAY ──────────────────

# Wednesday 2026-10-21 lies INSIDE the Herbstferien - the exact live bug:
# the today-sensor showed 4 lessons although schulfrei=on.
mid_vacation = date(2026, 10, 21)
st = day_status(mid_vacation, PERIODS)
check("mid-vacation Wednesday is vacation", st["status"] == STATUS_VACATION)
check("mid-vacation pauses the plan", pauses_lessons(st["status"]) is True)

# Thursday inside the break: tomorrow-sensor case
st = day_status(date(2026, 10, 22), PERIODS)
check("second vacation day pauses too", pauses_lessons(st["status"]) is True)

# ─── 3. school day AFTER the vacation keeps the plan ────────────────────

after = date(2026, 10, 26)  # Monday right after the break
st2 = day_status(after, PERIODS)
check("Monday after vacation is a school day", st2["status"] == STATUS_SCHOOL_DAY)
check("school day keeps the plan", pauses_lessons(st2["status"]) is False)

# Friday 2026-10-23 is the LAST vacation day - still paused
st3 = day_status(date(2026, 10, 23), PERIODS)
check("last vacation day still pauses", pauses_lessons(st3["status"]) is True)

# ─── 4. free date exception (Klassenfahrt) pauses ───────────────────────

free_exc = [{"date": "2026-11-05", "exception_type": EXCEPTION_TYPE_FREE, "note": "Klassenfahrt", "until_lesson": None}]
st4 = effective_day_status(date(2026, 11, 5), [], free_exc)
check("free exception yields status date_exception", st4["status"] == STATUS_DATE_EXCEPTION)
check("free exception (Klassenfahrt) pauses", pauses_lessons(st4["status"]) is True)
check("free exception carries its note as reason", st4["reason"] == "Klassenfahrt")

# ─── 5. partial exception (half day) does NOT pause ─────────────────────

partial_exc = [{"date": "2026-11-06", "exception_type": EXCEPTION_TYPE_PARTIAL, "note": "Halbtag", "until_lesson": 2}]
st5 = effective_day_status(date(2026, 11, 6), [], partial_exc)
check("partial exception stays a school day", st5["status"] == STATUS_SCHOOL_DAY)
check("partial exception does NOT pause the plan", pauses_lessons(st5["status"]) is False)

# ─── 6. weekend pauses (consistent with the schulfrei binary sensor) ────

st6 = day_status(date(2026, 10, 24), PERIODS)  # Saturday
check("Saturday is weekend status", st6["status"] == STATUS_WEEKEND)
check("weekend pauses (binary sensor consistency)", pauses_lessons(st6["status"]) is True)

# ─── 7. public holiday on a weekday pauses ─────────────────────────────

periods_holiday = parse_periods(
    [
        {
            "name": "Weihnachtsfeiertag",
            "starts_on": "2026-12-25",
            "ends_on": "2026-12-25",
            "is_public_holiday": True,
            "is_school_vacation": False,
        }
    ]
)
st7 = day_status(date(2026, 12, 25), periods_holiday)
check("Friday public holiday is public_holiday", st7["status"] == STATUS_PUBLIC_HOLIDAY)
check("public holiday pauses", pauses_lessons(st7["status"]) is True)

# ─── summary ────────────────────────────────────────────────────────────

print(f"\nschedule pause tests: {PASS} passed, {FAIL} failed")
if FAIL:
    sys.exit(1)
print("ALL SCHEDULE PAUSE CHECKS PASSED ✅")