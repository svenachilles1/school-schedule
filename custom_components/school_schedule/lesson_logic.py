"""Pure lesson-identity logic for the School Schedule integration.

Historically a lesson was addressed by its (weekday, lesson_number) pair —
which is NOT unique: nothing stopped two entries with the same pair, and the
card's edit form then silently targeted the first match (the "edit shows the
wrong subject" bug). v2.5.7 introduces a deterministic ``lesson_uid`` for
every lesson and refuses duplicate slots on every add path.

Deliberately free of Home Assistant imports so the unit tests
(tests/test_lesson_logic.py) run locally and in GitHub CI via the same
stub-package pattern as holiday_logic/calendar_logic.
"""
from __future__ import annotations

from typing import Any

from .const import CONF_LESSON_NUMBER, CONF_LESSON_UID, CONF_WEEKDAY


def lesson_uid_for(weekday: str | None, number: Any) -> str:
    """Deterministic uid per (weekday, lesson_number) slot (v2.5.7)."""
    return f"{weekday}-{int(number)}"


def ensure_lesson_uids(lessons: list[dict[str, Any]]) -> None:
    """Backfill deterministic lesson_uids for legacy entries (v2.5.7).

    Old entries have no lesson_uid — every lesson gets one so the card can
    address edits/deletes unambiguously. In a slot that still holds legacy
    duplicates the 2nd+ occurrence gets a ``-dup<n>`` suffix, keeping every
    entry individually addressable. Deterministic on the stored list order,
    so uids are stable across restarts as long as the list does not change.

    v2.5.8: the taken-set is seeded with EVERY uid already present in the
    list first — a uid-less entry (e.g. after an options-flow edit replaced
    the whole dict and dropped the uid) can then never collide with a
    pre-existing uid, and re-stamping even restores the very same ``-dupN``
    uid the entry had before the edit.
    """
    taken: set[str] = set()
    for lesson in lessons:
        uid = lesson.get(CONF_LESSON_UID)
        if uid:
            taken.add(uid)
    for lesson in lessons:
        if lesson.get(CONF_LESSON_UID):
            continue
        weekday = lesson.get(CONF_WEEKDAY)
        number = lesson.get(CONF_LESSON_NUMBER)
        if weekday is None or number is None:
            continue
        base = lesson_uid_for(weekday, number)
        if base not in taken:
            lesson[CONF_LESSON_UID] = base
            taken.add(base)
        else:
            n = 2
            while f"{base}-dup{n}" in taken:
                n += 1
            lesson[CONF_LESSON_UID] = f"{base}-dup{n}"
            taken.add(f"{base}-dup{n}")


def slot_taken(lessons: list[dict[str, Any]], weekday: str, number: Any) -> bool:
    """True when the (weekday, lesson_number) slot is already used (v2.5.7)."""
    return any(
        lesson.get(CONF_WEEKDAY) == weekday and lesson.get(CONF_LESSON_NUMBER) == number
        for lesson in lessons
    )


def blocked_days(lessons: list[dict[str, Any]], number: Any) -> list[str]:
    """Weekdays where the lesson_number slot is already taken (v2.5.7)."""
    return [
        lesson.get(CONF_WEEKDAY)
        for lesson in lessons
        if lesson.get(CONF_LESSON_NUMBER) == number
    ]
