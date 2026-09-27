"""Unit tests for absence_logic (v2.6.0 — sick days, streaks, attest rule).

Run locally:  python3 tests/test_absence_logic.py
Run in CI:    invoked by .github/workflows/tests.yaml

Reference dates (all in 2026):
    2026-09-25 = Friday      2026-09-26/27 = weekend
    2026-09-28 = Monday      2026-09-29 = Tuesday (TODAY in most tests)
    2026-09-30 = Wednesday  2026-10-01 = Thursday
"""
from __future__ import annotations

import os
import sys
import types
from datetime import date

# Import WITHOUT executing school_schedule/__init__.py (HA imports) —
# same stub-package pattern as test_lesson_logic.py / test_count_real_lessons.py.
_PKG_DIR = os.path.join(os.path.dirname(__file__), "..", "custom_components", "school_schedule")
if "school_schedule" not in sys.modules:
    _pkg = types.ModuleType("school_schedule")
    _pkg.__path__ = [os.path.abspath(_PKG_DIR)]
    sys.modules["school_schedule"] = _pkg

from school_schedule.absence_logic import (  # noqa: E402
    count_sick_school_year,
    current_streak,
    future_streak,
    is_sick,
    normalise_absences,
    prune_absences,
    remove_absence,
    sick_summary,
    upsert_absence,
)

TODAY = date(2026, 9, 29)      # Tuesday
MON = date(2026, 9, 28)
FRI = date(2026, 9, 25)
WED = date(2026, 9, 30)
THU = date(2026, 10, 1)
NO_PERIODS: list = []           # no vacations/public holidays -> only weekends are free


def _mark(*days: date, note: str = "") -> list[dict]:
    return [{"date": d.isoformat(), "type": "sick", "note": note} for d in days]


# ─── normalise_absences ────────────────────────────────────────────────

# Drops invalid dates, defaults type, dedupes by date, sorts ascending
raw = [
    {"date": "2026-09-29", "note": "b"},         # valid, no type -> sick
    {"date": "not-a-date"},                      # invalid -> dropped
    {"date": "2026-09-28"},                      # valid
    {"date": "2026-09-28", "type": "sick"},      # duplicate date -> collapsed
    {"type": "sick"},                            # no date -> dropped
]
norm = normalise_absences(raw)
assert len(norm) == 2, norm
assert norm[0]["date"] == "2026-09-28"
assert norm[1]["date"] == "2026-09-29"
assert all(e["type"] == "sick" for e in norm)
assert all(e["note"] == "" or e["note"] == "b" for e in norm)
print("normalise: invalid dropped, deduped, sorted, type defaulted   [OK]")

assert normalise_absences(None) == []
assert normalise_absences([]) == []
print("normalise: None/empty -> []                                    [OK]")

# ─── is_sick / streak basics ───────────────────────────────────────────

assert is_sick(_mark(TODAY), TODAY)
assert not is_sick(_mark(MON), TODAY)
assert not is_sick([], TODAY)
print("is_sick: exact date match                                       [OK]")

# No mark today -> no running streak
assert current_streak(_mark(MON), TODAY, NO_PERIODS) == 0
print("streak: not marked today -> 0                                   [OK]")

# Simple 2-day streak (Mon + today) -> attest warning, not required
s = sick_summary(_mark(MON, TODAY), TODAY, NO_PERIODS)
assert s["streak"] == 2, s
assert s["streak_active_today"] is True
assert s["attest_warning"] is True
assert s["attest_required"] is False
assert s["sick_today"] is True
assert s["sick_tomorrow"] is False
print("streak: Mon+Today=2, warning fires, not required                [OK]")

# 3-day streak (Mon + today + tomorrow pre-marked) -> required
s = sick_summary(_mark(MON, TODAY, WED), TODAY, NO_PERIODS)
assert s["streak"] == 3, s
assert s["attest_required"] is True
assert s["attest_warning"] is True
assert s["sick_tomorrow"] is True
print("streak: Mon+Today+Wed pre-marked=3 -> attest required           [OK]")

# Weekend bridge: Fri + Mon + Today = 3 (weekend does not break, does not count)
s = sick_summary(_mark(FRI, MON, TODAY), TODAY, NO_PERIODS)
assert s["streak"] == 3, s
assert s["attest_required"] is True
print("streak: Fri+Mon+Today across weekend = 3                        [OK]")

# Unmarked school day between marks breaks the streak
s = sick_summary(_mark(FRI, TODAY), TODAY, NO_PERIODS)
assert s["streak"] == 1, s  # Mon (school day) not marked -> streak restarts
print("streak: unmarked Mon between Fri and Today -> 1                 [OK]")

# Long vacation break (> SICK_STREAK_BREAK_GAP free days) breaks the streak
LONG_AGO = date(2026, 8, 10)   # more than 3 school-free days before FRI? no — use a real gap
# Mark: long-ago Friday + today, with Monday..Thursday between being unmarked
s = sick_summary(_mark(LONG_AGO, TODAY), TODAY, NO_PERIODS)
assert s["streak"] == 1, s  # the unmarked week between breaks it
print("streak: week-long gap breaks the streak                         [OK]")

# Public holiday inside the streak is bridged like a weekend
periods = [
    {"name": "Feiertag", "starts_on": date(2026, 9, 28), "ends_on": date(2026, 9, 28),
     "is_public_holiday": True, "is_school_vacation": False},
]
s = sick_summary(_mark(FRI, TODAY), TODAY, periods)
assert s["streak"] == 2, s  # Monday is a public holiday -> bridged
print("streak: public holiday Monday bridged (Fri+Today=2)             [OK]")

# ─── future streak (Vormeldung) ────────────────────────────────────────

s = sick_summary(_mark(WED), TODAY, NO_PERIODS)
assert s["streak"] == 1, s
assert s["streak_active_today"] is False
assert s["sick_today"] is False
assert s["sick_tomorrow"] is True
assert s["attest_warning"] is False
print("future: only tomorrow marked -> streak 1, no warning yet         [OK]")

s = sick_summary(_mark(WED, THU), TODAY, NO_PERIODS)
assert s["streak"] == 2, s
assert s["attest_warning"] is True
print("future: Wed+Thu pre-marked -> streak 2, warning fires           [OK]")

# ─── summary extras ─────────────────────────────────────────────────────

s = sick_summary(_mark(FRI, TODAY), TODAY, NO_PERIODS)
assert s["last_sick_day"] == FRI.isoformat()  # strictly BEFORE today
assert s["sick_days_year"] == 2
print("summary: last_sick_day = last past day + year counter           [OK]")

# School-year boundary: sick day in July belongs to the PREVIOUS year
s = sick_summary(
    _mark(date(2026, 7, 15), TODAY), date(2026, 7, 20), NO_PERIODS
)
# today is 2026-07-20 -> school year started 2025-08-01 -> both days count
assert s["sick_days_year"] == 2, s
print("summary: July dates count into the Aug-Jul year                 [OK]")

# ─── upsert / remove (immutability + idempotency) ──────────────────────

base = _mark(MON)
snapshot = [dict(e) for e in base]
new, changed = upsert_absence(base, TODAY, "sick", "Fieber")
assert changed is True
assert len(new) == 2
assert base == snapshot  # input untouched
assert any(e["date"] == TODAY.isoformat() and e["note"] == "Fieber" for e in new)
print("upsert: adds day, input untouched                               [OK]")

new2, changed2 = upsert_absence(new, TODAY, "sick", "Erkaeltung")
assert changed2 is True
assert len(new2) == 2
assert any(e["date"] == TODAY.isoformat() and e["note"] == "Erkaeltung" for e in new2)
print("upsert: re-mark updates note only                               [OK]")

new3, changed3 = upsert_absence(new2, TODAY, "sick", "Erkaeltung")
assert changed3 is False
assert new3 == new2
print("upsert: same mark+note -> idempotent no-op                      [OK]")

kept, removed = remove_absence(new3, TODAY, "sick")
assert removed is True
assert len(kept) == 1
kept2, removed2 = remove_absence(kept, TODAY, "sick")
assert removed2 is False
print("remove: deletes once, second call False                         [OK]")

# ─── prune ──────────────────────────────────────────────────────────────

old_enough = date(2025, 9, 1)        # > 365 days before TODAY
within = FRI
pr = [{"date": old_enough.isoformat(), "type": "sick"}, {"date": within.isoformat(), "type": "sick"}]
kept_p, changed_p = prune_absences(pr, TODAY)
assert changed_p is True
assert len(kept_p) == 1
assert kept_p[0]["date"] == within.isoformat()
print("prune: >365d entries dropped, recent kept                       [OK]")

kept_p2, changed_p2 = prune_absences([{"date": TODAY.isoformat(), "type": "sick"}], TODAY)
assert changed_p2 is False
print("prune: nothing to prune -> unchanged                            [OK]")

# ─── school-year counter edge ───────────────────────────────────────────

# Aug 1 boundary: 2026-07-31 belongs to school year 2025/26, 2026-08-01 to 2026/27
cnt = count_sick_school_year(
    _mark(date(2026, 7, 31), date(2026, 8, 1)), date(2026, 8, 2)
)
assert cnt == 1, cnt  # only the Aug 1 entry is in the 2026/27 school year
print("year counter: Aug 1 boundary correct                            [OK]")

print()
print("ALL ABSENCE_LOGIC TESTS PASSED ✅")

# ─── mark_sick_range / update_absence_note (v2.7.0) ──────────────────

from school_schedule.absence_logic import mark_sick_range, update_absence_note  # noqa: E402

# Range marks every day inclusive
lst, added, err = mark_sick_range([], WED, THU, note="Grippe")
assert err is None and added == 2, (added, err)
assert [e["date"] for e in lst] == ["2026-09-30", "2026-10-01"]
assert all(e["type"] == "sick" and e["note"] == "Grippe" for e in lst)
print("range: marks every day inclusive, note applied             [OK]")

# Single-day range (start == end) works
lst, added, err = mark_sick_range([], TODAY, TODAY)
assert err is None and added == 1 and lst[0]["date"] == "2026-09-29"
print("range: single-day range (start == end) works               [OK]")

# Idempotent: re-marking the same range with same note changes nothing
base_range, _, _ = mark_sick_range([], WED, THU, note="Grippe")
lst2, added2, err2 = mark_sick_range(base_range, WED, THU, note="Grippe")
assert err2 is None and added2 == 0 and lst2 == base_range
print("range: idempotent re-mark (same note) -> 0 changes          [OK]")

# Re-marking with a DIFFERENT note updates existing entries
lst3, added3, err3 = mark_sick_range(base_range, WED, THU, note="Erkaeltung")
assert err3 is None and added3 == 2
assert all(e["note"] == "Erkaeltung" for e in lst3)
print("range: re-mark with new note updates entries               [OK]")

# Start after end -> error, input untouched
lst4, added4, err4 = mark_sick_range(lst, THU, WED)
assert err4 == "start_after_end" and added4 == 0 and lst4 == lst
print("range: start > end rejected, list untouched                [OK]")

# Range spanning a weekend marks ALL calendar days (Sa/So too)
lst5, _, _ = mark_sick_range([], FRI, MON)
assert len(lst5) == 4
assert [e["date"] for e in lst5] == ["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"]
print("range: weekend days are marked too (calendar semantics)     [OK]")

# Range cap: >366 days rejected, list untouched
from datetime import timedelta
lst6, added6, err6 = mark_sick_range([], TODAY, TODAY + timedelta(days=366))
assert err6 == "range_too_long" and added6 == 0 and lst6 == []
print("range: >366 days rejected (cap), list untouched             [OK]")

# Existing entries outside the range survive untouched
base = _mark(FRI, note="alt")
lst7, _, err7 = mark_sick_range(base, WED, THU)
assert err7 is None
assert [e["date"] for e in lst7] == ["2026-09-25", "2026-09-30", "2026-10-01"]
assert lst7[0]["note"] == "alt"
print("range: entries outside the range survive untouched         [OK]")

# update_absence_note: edits note of an existing day
lst8, changed = update_absence_note(base, FRI, "neu")
assert changed is True and lst8[0]["note"] == "neu" and lst8[0]["date"] == "2026-09-25"
print("note-update: existing day note updated                     [OK]")

print()
print("absence_logic v2.7.0 range tests: ALL GREEN")
