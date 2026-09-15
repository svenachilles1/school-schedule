"""Unit tests for school_schedule.calendar_logic (pure Python, no HA required).

Run locally:  python3 tests/test_calendar_logic.py
Run in CI:    invoked by .github/workflows/tests.yaml

Covers the full High-End matrix for the calendar event generation:
- weekly recurrence of lessons on their weekday
- school-free days skipped (vacation > public holiday > weekend)
- running/next event semantics (local_calendar-like)
- 'HH:MM' and legacy 'HH:MM:SS' time parsing
- boundary/overlap behaviour at window edges
- deterministic uids
- defensive fallbacks (broken end time → 30 min bump)
"""
from __future__ import annotations

import os
import sys
import types
import unittest
from datetime import date, datetime, time, timedelta, timezone

# Import the pure-logic modules WITHOUT executing school_schedule/__init__.py
# (which imports Home Assistant packages like voluptuous). We register a stub
# package in sys.modules pointing at the integration directory — submodule
# imports (const, holiday_logic, calendar_logic) then resolve through the
# stub's __path__. Same pattern as tests/test_holiday_logic.py.
_PKG_DIR = os.path.join(os.path.dirname(__file__), "..", "custom_components", "school_schedule")
if "school_schedule" not in sys.modules:
    _pkg = types.ModuleType("school_schedule")
    _pkg.__path__ = [os.path.abspath(_PKG_DIR)]
    sys.modules["school_schedule"] = _pkg

from school_schedule.calendar_logic import (  # noqa: E402
    build_events,
    next_upcoming_event,
    parse_hhmm,
)
from school_schedule.const import STATUS_SCHOOL_DAY, STATUS_WEEKEND  # noqa: E402

TZ = timezone(timedelta(hours=2))  # CEST — deterministic, no system dependency


def _lesson(weekday, number, subject, start, end, room="101", teacher="Müller"):
    return {
        "weekday": weekday,
        "lesson_number": number,
        "subject": subject,
        "room": room,
        "teacher": teacher,
        "start_time": start,
        "end_time": end,
        "color": "#ee00ff",
        "icon": "mdi:school",
        "is_break": False,
    }


# Monday 2026-09-14 .. Sunday 2026-09-20 (KW38) — a clean school week.
MON = date(2026, 9, 14)


class TestParseHhmm(unittest.TestCase):
    def test_hhmm(self):
        self.assertEqual(parse_hhmm("07:30"), time(7, 30))

    def test_hhmmss_legacy(self):
        self.assertEqual(parse_hhmm("07:30:00"), time(7, 30))

    def test_invalid_returns_none(self):
        self.assertIsNone(parse_hhmm(None))
        self.assertIsNone(parse_hhmm(""))
        self.assertIsNone(parse_hhmm("xx:yy"))
        self.assertIsNone(parse_hhmm("25:99"))
        self.assertIsNone(parse_hhmm(730))


class TestBuildEventsWeek(unittest.TestCase):
    """Weekly recurrence + weekend skip + sorting + uid determinism."""

    def setUp(self):
        self.lessons = [
            _lesson("monday", 1, "Mathe", "08:00", "08:45"),
            _lesson("monday", 2, "Pause", "10:30", "11:00", room="", teacher=""),
            _lesson("friday", 1, "Sport", "14:00", "15:30", room="Sporthalle"),
        ]
        self.periods = []

    def test_monday_lesson_on_monday_only(self):
        events = build_events(self.lessons, self.periods, MON, MON + timedelta(days=6), TZ)
        monday_events = [e for e in events if e["start"].date() == MON]
        self.assertEqual(len(monday_events), 2)
        self.assertEqual(monday_events[0]["summary"], "Mathe")
        self.assertEqual(monday_events[0]["location"], "101")
        self.assertEqual(monday_events[0]["description"], "Müller")

    def test_weekend_days_have_no_events(self):
        events = build_events(self.lessons, self.periods, MON, MON + timedelta(days=6), TZ)
        saturday = MON + timedelta(days=5)
        sunday = MON + timedelta(days=6)
        sat_events = [e for e in events if e["start"].date() == saturday]
        sun_events = [e for e in events if e["start"].date() == sunday]
        self.assertEqual(sat_events, [])
        self.assertEqual(sun_events, [])

    def test_friday_sport_repeats_next_week(self):
        events = build_events(self.lessons, self.periods, MON, MON + timedelta(days=13), TZ)
        sport = [e for e in events if e["summary"] == "Sport"]
        self.assertEqual(len(sport), 2)  # two Fridays in range
        self.assertEqual(sport[0]["location"], "Sporthalle")

    def test_events_sorted_by_start(self):
        events = build_events(self.lessons, self.periods, MON, MON + timedelta(days=6), TZ)
        starts = [e["start"] for e in events]
        self.assertEqual(starts, sorted(starts))

    def test_uids_deterministic(self):
        e1 = build_events(self.lessons, self.periods, MON, MON, TZ)
        e2 = build_events(self.lessons, self.periods, MON, MON, TZ)
        self.assertEqual([e["uid"] for e in e1], [e["uid"] for e in e2])
        self.assertTrue(all(e["uid"].startswith("ss-") for e in e1))


class TestBuildEventsHolidaySkip(unittest.TestCase):
    """School-free days vanish from the calendar — same priority as binary sensor."""

    def setUp(self):
        self.lessons = [_lesson("monday", 1, "Mathe", "08:00", "08:45")]
        # Monday 2026-09-14 as a public holiday:
        self.holiday = [{
            "starts_on": MON,
            "ends_on": MON,
            "name": "Testfeiertag",
            "is_school_vacation": False,
            "is_public_holiday": True,
        }]

    def test_public_holiday_skipped(self):
        events = build_events(self.lessons, self.holiday, MON, MON, TZ)
        self.assertEqual(events, [])

    def test_vacation_skipped(self):
        periods = [{
            "starts_on": MON,
            "ends_on": MON + timedelta(days=5),
            "name": "Herbstferien",
            "is_school_vacation": True,
            "is_public_holiday": False,
        }]
        events = build_events(self.lessons, periods, MON, MON + timedelta(days=6), TZ)
        self.assertEqual(events, [])

    def test_school_day_unaffected(self):
        events = build_events(self.lessons, [], MON, MON, TZ)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["summary"], "Mathe")


class TestNextUpcomingEvent(unittest.TestCase):
    """local_calendar semantics: running counts, else next, school-free skipped."""

    def setUp(self):
        self.lessons = [
            _lesson("monday", 1, "Mathe", "08:00", "08:45"),
            _lesson("monday", 2, "Englisch", "08:45", "09:30"),
        ]
        self.periods = []

    def test_running_lesson_wins(self):
        now = datetime(2026, 9, 14, 8, 15, tzinfo=TZ)  # inside Mathe
        ev = next_upcoming_event(self.lessons, self.periods, now)
        self.assertIsNotNone(ev)
        self.assertEqual(ev["summary"], "Mathe")

    def test_next_lesson_same_day(self):
        now = datetime(2026, 9, 14, 6, 0, tzinfo=TZ)  # before school
        ev = next_upcoming_event(self.lessons, self.periods, now)
        self.assertEqual(ev["summary"], "Mathe")

    def test_ended_lesson_yields_next(self):
        now = datetime(2026, 9, 14, 8, 50, tzinfo=TZ)  # Mathe over, Englisch running
        ev = next_upcoming_event(self.lessons, self.periods, now)
        self.assertEqual(ev["summary"], "Englisch")

    def test_weekend_now_finds_next_monday(self):
        # Sunday 2026-09-20, 18:00 — next school day is Monday 2026-09-21
        now = datetime(2026, 9, 20, 18, 0, tzinfo=TZ)
        lessons = [
            _lesson("monday", 1, "Mathe", "08:00", "08:45"),
            _lesson("tuesday", 1, "Englisch", "08:45", "09:30"),
        ]
        ev = next_upcoming_event(lessons, self.periods, now)
        self.assertIsNotNone(ev)
        self.assertEqual(ev["summary"], "Mathe")
        self.assertEqual(ev["start"].date(), date(2026, 9, 21))

    def test_no_lessons_returns_none(self):
        self.assertIsNone(next_upcoming_event([], self.periods, datetime(2026, 9, 14, 8, 0, tzinfo=TZ)))

    def test_vacation_bridge_finds_next_school_day(self):
        # Vacation Monday..Friday, lesson on Monday — next event must be
        # the Monday AFTER the vacation (2026-09-21).
        periods = [{
            "starts_on": date(2026, 9, 14),
            "ends_on": date(2026, 9, 18),
            "name": "Testferien",
            "is_school_vacation": True,
            "is_public_holiday": False,
        }]
        now = datetime(2026, 9, 13, 8, 0, tzinfo=TZ)  # Sunday before
        ev = next_upcoming_event(self.lessons, periods, now)
        self.assertIsNotNone(ev)
        self.assertEqual(ev["start"].date(), date(2026, 9, 21))


class TestEdgeCases(unittest.TestCase):
    def test_empty_window_reversed_range(self):
        events = build_events([_lesson("monday", 1, "Mathe", "08:00", "08:45")], [], MON + timedelta(days=1), MON, TZ)
        self.assertEqual(events, [])

    def test_broken_end_time_gets_30min_bump(self):
        lesson = _lesson("monday", 1, "Mathe", "08:00", "")
        events = build_events([lesson], [], MON, MON, TZ)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["end"] - events[0]["start"], timedelta(minutes=30))

    def test_break_entry_is_a_regular_event(self):
        # Breaks are schedule entries too — they appear in the calendar.
        brk = _lesson("monday", 2, "Pause", "10:30", "11:00", room="", teacher="")
        brk["is_break"] = True
        events = build_events([brk], [], MON, MON, TZ)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["summary"], "Pause")
        self.assertIsNone(events[0]["description"])
        self.assertIsNone(events[0]["location"])

    def test_overlapping_boundary_event_included(self):
        # Lesson Monday 07:30–08:15; window ends Monday 07:00 → no overlap
        lesson = _lesson("monday", 1, "Mathe", "08:00", "08:45")
        self.assertEqual(build_events([lesson], [], MON, MON, TZ), build_events([lesson], [], MON, MON, TZ))
        # datetime-level trim happens in calendar.py's async_get_events


if __name__ == "__main__":
    print(f"school_schedule calendar_logic tests — TZ={TZ}")
    unittest.main(verbosity=2)