"""Unit tests for count_real_lessons (v2.5.9 — breaks don't count as lessons).

Breaks (is_break=True) are schedule entries for display purposes, not
actual teaching lessons. v2.5.9 excludes them from every lesson counter:
sensor state, total_lessons attribute, card badges/hero.

Run locally:  python3 tests/test_count_real_lessons.py
Run in CI:    invoked by .github/workflows/tests.yaml
"""
from __future__ import annotations

import os
import sys
import types

# Import WITHOUT executing school_schedule/__init__.py (HA imports) —
# same stub-package pattern as test_lesson_logic.py.
_PKG_DIR = os.path.join(os.path.dirname(__file__), "..", "custom_components", "school_schedule")
if "school_schedule" not in sys.modules:
    _pkg = types.ModuleType("school_schedule")
    _pkg.__path__ = [os.path.abspath(_PKG_DIR)]
    sys.modules["school_schedule"] = _pkg

from school_schedule.lesson_logic import count_real_lessons  # noqa: E402


def _lesson(weekday="monday", number=1, is_break=False):
    return {"weekday": weekday, "lesson_number": number, "is_break": is_break}


# ─── count_real_lessons ───────────────────────────────────────────────

assert count_real_lessons([]) == 0
print("empty list -> 0                                                    [OK]")

assert count_real_lessons([_lesson(), _lesson(number=2)]) == 2
print("only real lessons -> 2                                              [OK]")

assert count_real_lessons([_lesson(is_break=True), _lesson(number=2, is_break=True)]) == 0
print("only breaks -> 0                                                    [OK]")

lessons = [
    _lesson(number=1),                 # real
    _lesson(number=2, is_break=True),  # break
    _lesson(number=3),                 # real
    _lesson(number=4, is_break=True),  # break
    _lesson(number=5),                 # real
]
assert count_real_lessons(lessons) == 3
print("mixed (3 real + 2 breaks) -> 3                                     [OK]")

# Legacy entries without the is_break key are real lessons
legacy = [{"weekday": "monday", "lesson_number": 1}]
assert count_real_lessons(legacy) == 1
print("legacy entry without is_break key -> 1 (real)                       [OK]")

assert count_real_lessons([{"weekday": "monday", "lesson_number": 1, "is_break": None}]) == 1
print("is_break=None -> 1 (real)                                          [OK]")
assert count_real_lessons([{"weekday": "monday", "lesson_number": 1, "is_break": False}]) == 1
print("is_break=False -> 1 (real)                                         [OK]")
assert count_real_lessons([{"weekday": "monday", "lesson_number": 1, "is_break": True}]) == 0
print("is_break=True -> 0 (excluded)                                      [OK]")

print()
print("ALL COUNT_REAL_LESSONS TESTS PASSED ✅")