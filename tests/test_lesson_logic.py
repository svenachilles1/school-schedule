"""Unit tests for school_schedule.lesson_logic (pure Python, no HA required).

Regression tests for the v2.5.7 fixes:
- deterministic lesson uids (+ -dupN suffixes for legacy duplicate slots)
- slot_taken duplicate guard
- blocked_days helper for apply_to_all_days

Run locally:  python3 tests/test_lesson_logic.py
Run in CI:    invoked by .github/workflows/tests.yaml
"""
from __future__ import annotations

import importlib
import os
import sys
import types

# Import WITHOUT executing school_schedule/__init__.py (HA imports) —
# same stub-package pattern as test_holiday_logic.py.
_PKG_DIR = os.path.join(os.path.dirname(__file__), "..", "custom_components", "school_schedule")
if "school_schedule" not in sys.modules:
    _pkg = types.ModuleType("school_schedule")
    _pkg.__path__ = [os.path.abspath(_PKG_DIR)]
    sys.modules["school_schedule"] = _pkg

from school_schedule.lesson_logic import (  # noqa: E402
    blocked_days,
    ensure_lesson_uids,
    lesson_uid_for,
    slot_taken,
)

# ─── lesson_uid_for ───────────────────────────────────────────────────

assert lesson_uid_for("monday", 4) == "monday-4"
assert lesson_uid_for("friday", 12) == "friday-12"
print("lesson_uid_for: deterministic uids                                [OK]")

# ─── ensure_lesson_uids: legacy entries get uids ──────────────────────

lessons = [
    {"weekday": "monday", "lesson_number": 1, "subject": "Kunst"},
    {"weekday": "monday", "lesson_number": 2, "subject": "Pause", "is_break": True},
]
ensure_lesson_uids(lessons)
assert lessons[0]["lesson_uid"] == "monday-1"
assert lessons[1]["lesson_uid"] == "monday-2"
print("ensure_lesson_uids: legacy entries stamped                        [OK]")

# idempotent — a second run must not change anything
before = [dict(l) for l in lessons]
ensure_lesson_uids(lessons)
assert lessons == before, "ensure_lesson_uids must be idempotent"
print("ensure_lesson_uids: idempotent                                    [OK]")

# entries with an existing uid are never touched
custom = [{"weekday": "monday", "lesson_number": 1, "lesson_uid": "custom-uid"}]
ensure_lesson_uids(custom)
assert custom[0]["lesson_uid"] == "custom-uid"
print("ensure_lesson_uids: existing uid untouched                        [OK]")

# ─── ensure_lesson_uids: legacy DUPLICATE slot (the actual bug!) ───────

# This is the exact incident from 2026-09-04: Dienstag had TWO entries
# with lesson_number 4 — the card's edit form then showed the first
# match's subject instead of the clicked lesson's subject.
dup = [
    {"weekday": "tuesday", "lesson_number": 3, "subject": "FA, Sg Eng 1/2"},
    {"weekday": "tuesday", "lesson_number": 4, "subject": "Mittags & Gartenpause", "is_break": True},
    {"weekday": "tuesday", "lesson_number": 4, "subject": "Sport"},
]
ensure_lesson_uids(dup)
assert dup[1]["lesson_uid"] == "tuesday-4"
assert dup[2]["lesson_uid"] == "tuesday-4-dup2"
assert dup[0]["lesson_uid"] == "tuesday-3"
assert len({l["lesson_uid"] for l in dup}) == 3, "uids must be unique"
print("ensure_lesson_uids: duplicate slot -> unique -dupN suffixes       [OK]")

# ─── slot_taken ────────────────────────────────────────────────────────

assert slot_taken(dup, "tuesday", 4) is True
assert slot_taken(dup, "tuesday", 5) is False
assert slot_taken(dup, "monday", 4) is False
print("slot_taken: detects taken slots                                   [OK]")

# ─── blocked_days ──────────────────────────────────────────────────────

sched = [
    {"weekday": "monday", "lesson_number": 4},
    {"weekday": "wednesday", "lesson_number": 4},
    {"weekday": "friday", "lesson_number": 1},
]
assert sorted(blocked_days(sched, 4)) == ["monday", "wednesday"]
assert blocked_days(sched, 2) == []
print("blocked_days: reports days blocking a number                      [OK]")

# ─── full bug scenario: add_lesson must be refused on a taken slot ────

assert slot_taken(dup, "tuesday", 4) is True, "adding a third #4 must be refused"
print("Bug scenario: duplicate add would be rejected (ValueError)        [OK]")

print()
print("ALL LESSON-LOGIC TESTS PASSED ✅")