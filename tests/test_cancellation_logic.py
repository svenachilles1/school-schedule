"""Unit tests for cancellation_logic (v2.7.2 — Einzelstunden-Ausfall).

Run locally:  python3 tests/test_cancellation_logic.py
Run in CI:    invoked by .github/workflows/tests.yaml

Reference dates (all in 2026):
    2026-10-06 = Tuesday (TODAY)     2026-10-07 = Wednesday
    2026-10-10 = Saturday            2026-10-11 = Sunday
    2026-10-13 = next Tuesday
"""
from __future__ import annotations

import copy
import os
import sys
import types
from datetime import date

# Import WITHOUT executing school_schedule/__init__.py (HA imports) —
# same stub-package pattern as test_absence_logic.py / test_lesson_logic.py.
_PKG_DIR = os.path.join(os.path.dirname(__file__), "..", "custom_components", "school_schedule")
if "school_schedule" not in sys.modules:
    _pkg = types.ModuleType("school_schedule")
    _pkg.__path__ = [os.path.abspath(_PKG_DIR)]
    sys.modules["school_schedule"] = _pkg

from school_schedule.cancellation_logic import (  # noqa: E402
    annotate_lessons,
    cancelled_dates,
    cancellations_for_date,
    get_entry_cancellations,
    is_lesson_cancelled,
    normalise_cancellations,
    parse_cancellation_date,
    prune_cancellations,
    remove_cancellation,
    upsert_cancellation,
)
from school_schedule.lesson_logic import (  # noqa: E402
    count_active_lessons,
    count_real_lessons,
)
from school_schedule.calendar_logic import (  # noqa: E402
    build_events,
    next_upcoming_event,
)

TODAY = date(2026, 10, 6)     # Tuesday
WED = date(2026, 10, 7)
TUE_NEXT = date(2026, 10, 13)


# ─── normalise_cancellations ────────────────────────────────────────────

raw = [
    {"date": "2026-10-06", "lesson_number": 3, "note": "Lehrer krank"},
    {"date": "not-a-date", "lesson_number": 1},          # invalid date -> dropped
    {"date": "2026-10-07"},                              # no lesson_number -> dropped
    {"date": "2026-10-07", "lesson_number": "2"},          # string number -> coerced
    {"date": "2026-10-06", "lesson_number": 3, "note": "dup"},   # duplicate key -> collapsed
    {"date": "2026-10-06", "lesson_number": "3"},          # duplicate via string -> collapsed
]
norm = normalise_cancellations(raw)
assert len(norm) == 2, norm
assert norm[0] == {"date": "2026-10-06", "lesson_number": 3, "note": "Lehrer krank"}
assert norm[1] == {"date": "2026-10-07", "lesson_number": 2, "note": ""}
print("normalise: invalid dropped, coerced, deduped by (date,slot), sorted [OK]")

assert normalise_cancellations(None) == []
assert normalise_cancellations([]) == []
print("normalise: None/empty -> []                                       [OK]")

assert get_entry_cancellations({}) == []
assert get_entry_cancellations({"lesson_cancellations": raw}) == norm
print("get_entry_cancellations: reads + normalises entry data           [OK]")

# ─── parse_cancellation_date ───────────────────────────────────────────

assert parse_cancellation_date("2026-10-06") == TODAY
assert parse_cancellation_date(TODAY) == TODAY
assert parse_cancellation_date("2026-10-06T08:00") == TODAY   # datetime prefix tolerated
assert parse_cancellation_date("müll") is None
assert parse_cancellation_date(None) is None
assert parse_cancellation_date(12345) is None
print("parse_cancellation_date: iso + date + prefix + junk               [OK]")

# ─── upsert / remove ───────────────────────────────────────────────────

base: list[dict] = []
lst, changed = upsert_cancellation(base, TODAY, 3, "Lehrer krank")
assert changed is True and len(lst) == 1
assert lst[0] == {"date": "2026-10-06", "lesson_number": 3, "note": "Lehrer krank"}
assert base == []  # input untouched (immutability discipline)
print("upsert: adds entry, input list untouched                         [OK]")

# idempotent: same slot, same note -> no change
lst2, changed2 = upsert_cancellation(lst, TODAY, 3, "Lehrer krank")
assert changed2 is False and lst2 == lst
print("upsert: same slot + same note -> idempotent no-op                [OK]")

# same slot, NEW note -> note updated, still one entry
lst3, changed3 = upsert_cancellation(lst, TODAY, 3, "Ausflug")
assert changed3 is True and len(lst3) == 1
assert lst3[0]["note"] == "Ausflug"
print("upsert: same slot, new note -> note updated                       [OK]")

# second slot same day -> two entries
lst4, changed4 = upsert_cancellation(lst3, TODAY, 5, "")
assert changed4 is True and len(lst4) == 2
print("upsert: second slot same day -> 2 entries                          [OK]")

lst5, removed = remove_cancellation(lst4, TODAY, 3)
assert removed is True and len(lst5) == 1 and lst5[0]["lesson_number"] == 5
lst6, removed2 = remove_cancellation(lst5, WED, 9)
assert removed2 is False and lst6 == lst5
print("remove: removes exactly one slot; unknown -> untouched             [OK]")

# ─── queries ───────────────────────────────────────────────────────────

cancels = [
    {"date": "2026-10-06", "lesson_number": 3, "note": "Lehrer krank"},
    {"date": "2026-10-06", "lesson_number": 5, "note": ""},
    {"date": "2026-10-13", "lesson_number": 1, "note": "Klassenfahrt"},
]
for_day = cancellations_for_date(cancels, TODAY)
assert len(for_day) == 2
assert is_lesson_cancelled(cancels, TODAY, 3)["note"] == "Lehrer krank"
assert is_lesson_cancelled(cancels, TODAY, "3") is not None    # string tolerated
assert is_lesson_cancelled(cancels, TODAY, 4) is None
assert is_lesson_cancelled(cancels, WED, 3) is None
assert cancelled_dates(cancels) == ["2026-10-06", "2026-10-13"]
print("queries: for_date / is_cancelled / cancelled_dates                [OK]")

# ─── annotate_lessons ──────────────────────────────────────────────────

lessons = [
    {"weekday": "tuesday", "lesson_number": 1, "subject": "Mathe", "is_break": False},
    {"weekday": "tuesday", "lesson_number": 3, "subject": "Sport", "is_break": False},
    {"weekday": "tuesday", "lesson_number": 4, "subject": "Pause", "is_break": True},
    {"weekday": "tuesday", "lesson_number": 5, "subject": "Kunst", "is_break": False},
]
day_cancels = [
    {"date": "2026-10-06", "lesson_number": 3, "note": "Lehrer krank"},
    {"date": "2026-10-07", "lesson_number": 5, "note": "morgen"},
]
annotated = annotate_lessons(lessons, day_cancels, TODAY)
assert len(annotated) == 4
assert annotated[0]["cancelled"] is False and annotated[0]["cancelled_note"] == ""
assert annotated[1]["cancelled"] is True and annotated[1]["cancelled_note"] == "Lehrer krank"
assert annotated[2]["cancelled"] is False   # break not cancelled
assert annotated[3]["cancelled"] is False   # tomorrow's cancel does not leak into today
assert lessons[1].get("cancelled") is None  # input untouched
print("annotate: flags exact (date,slot), input untouched, no leakage   [OK]")

# ─── count_active_lessons ──────────────────────────────────────────────

assert count_real_lessons(annotated) == 3
assert count_active_lessons(annotated) == 2  # Sport cancelled
assert count_active_lessons(lessons) == 3    # no cancellations -> == real
print("count_active_lessons: cancelled excluded, breaks excluded         [OK]")

# ─── prune ─────────────────────────────────────────────────────────────

old = [
    {"date": "2026-01-01", "lesson_number": 1, "note": ""},
    {"date": "2026-10-06", "lesson_number": 3, "note": ""},
]
pruned, changed = prune_cancellations(old, TODAY)
assert changed is True and len(pruned) == 1 and pruned[0]["date"] == "2026-10-06"
pruned2, changed2 = prune_cancellations(pruned, TODAY)
assert changed2 is False
print("prune: old entries dropped, fresh kept                            [OK]")

# ─── calendar integration (cancellations skip events) ───────────────────

tz = None  # build_events only combines datetimes; tzinfo=None acceptable in tests
CAL_LESSONS = [
    {"weekday": "tuesday", "lesson_number": 1, "subject": "Mathe",
     "start_time": "08:00", "end_time": "08:45"},
    {"weekday": "tuesday", "lesson_number": 2, "subject": "Sport",
     "start_time": "08:50", "end_time": "09:35"},
]
cal_cancels = [{"date": "2026-10-06", "lesson_number": 2, "note": "Lehrer krank"}]

events = build_events(CAL_LESSONS, [], TODAY, TODAY, tz, cal_cancels)
assert len(events) == 1, events
assert events[0]["summary"] == "Mathe"
print("build_events: cancelled lesson produces no event                  [OK]")

events_all = build_events(CAL_LESSONS, [], TODAY, TUE_NEXT, tz, cal_cancels)
# today: Mathe only (Sport cancelled); next Tuesday: both
tuesday_subjects = sorted(e["summary"] for e in events_all if e["uid"].endswith("-tuesday") or "-2026-10-06-" in e["uid"])
summaries_today = sorted(e["summary"] for e in events_all if "2026-10-06" in e["uid"])
summaries_next = sorted(e["summary"] for e in events_all if "2026-10-13" in e["uid"])
assert summaries_today == ["Mathe"], summaries_today
assert summaries_next == ["Mathe", "Sport"], summaries_next
print("build_events: cancel applies ONLY to its date, not the weekday    [OK]")

from datetime import datetime  # noqa: E402

# next_upcoming_event: 09:00 (after Mathe ended, Sport would be next) —
# Sport is cancelled, so the next event = next Tuesday's Mathe
now_mid = datetime(2026, 10, 6, 9, 0)
upcoming = next_upcoming_event(CAL_LESSONS, [], now_mid, cal_cancels)
assert upcoming is not None and "2026-10-13" in upcoming["uid"], upcoming
print("next_upcoming_event: skips today's cancelled, jumps to next week   [OK]")

# a RUNNING lesson still counts as the event even with a cancellation
# elsewhere on the same day (local_calendar semantics preserved)
now_running = datetime(2026, 10, 6, 8, 30)
running = next_upcoming_event(CAL_LESSONS, [], now_running, cal_cancels)
assert running is not None and running["summary"] == "Mathe"
print("next_upcoming_event: running lesson still wins (semantics kept)   [OK]")

# without cancellations the old behaviour holds
upcoming_old = next_upcoming_event(CAL_LESSONS, [], now_mid, None)
assert "2026-10-06" in upcoming_old["uid"] and upcoming_old["summary"] == "Sport"
print("next_upcoming_event: None keeps legacy behaviour                   [OK]")

print()
print("ALL CANCELLATION LOGIC TESTS PASSED ✅")