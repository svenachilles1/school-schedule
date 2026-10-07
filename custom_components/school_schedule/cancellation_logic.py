"""Pure cancellation logic for single lessons (v2.7.2 — Einzelstunden-Ausfall).

NO Home Assistant imports — unit-testable and CI-checkable, same pattern as
absence_logic / holiday_logic / calendar_logic / lesson_logic.

Data model
----------
``lesson_cancellations`` is a plain list of dicts in the config entry data,
one entry per cancelled lesson occurrence:

    {"date": "2026-10-07", "lesson_number": 3, "note": "Lehrer krank"}

- ``date``: ISO calendar date of the concrete school day the lesson is
  cancelled on (NOT a weekday name — the weekly plan itself is never
  touched, only this one occurrence).
- ``lesson_number``: the lesson slot on that day (matches the lesson's
  lesson_number in the weekly plan).
- ``note``: free-text reason, optional ("Lehrer krank", "Ausflug",
  "Vertretung entfällt").

The list is keyed by (date, lesson_number) — one cancellation per slot
per day. Marking the same slot twice is idempotent (only the note is
updated), the invariant is enforced by ``normalise_cancellations``.

Date vs. weekday semantics
--------------------------
A cancellation always targets a CONCRETE date. The weekly plan (lessons
list) stays untouched — deleting a lesson from the plan does not delete
its cancellations, and a cancellation never survives into the next week
(it lives on its date only). ``annotate_lessons`` applies cancellations
for exactly one date to that date's lesson list.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from .const import (
    CANCELLATION_RETENTION_DAYS,
    CONF_LESSON_NUMBER,
    CONF_LESSON_CANCELLATIONS,
)

# Key: date + lesson slot. One cancellation per (date, slot) — the
# canonical identity of a cancelled lesson occurrence.
_KEY_FIELDS = ("date", "lesson_number")


def parse_cancellation_date(value: Any) -> date | None:
    """Parse an ISO date string (YYYY-MM-DD) to a date, never raise."""
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def normalise_cancellations(raw: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Normalise a raw cancellation list into typed, deduped, sorted entries.

    Defensive against every malformed shape:
    - Entries without a parseable date or without a lesson_number are
      dropped (a cancellation without a slot is meaningless).
    - lesson_number is coerced to int (legacy/string forms).
    - note defaults to "".
    - Duplicate (date, lesson_number) keys collapse to the first
      occurrence — one cancellation per slot per day is the invariant.
    - Sorted by (date, lesson_number) ascending.
    """
    normalised: list[dict[str, Any]] = []
    seen: set[tuple[str, int]] = set()
    for entry in raw or []:
        if not isinstance(entry, dict):
            continue
        parsed = parse_cancellation_date(entry.get("date"))
        if parsed is None:
            continue
        raw_number = entry.get(CONF_LESSON_NUMBER)
        if raw_number is None:
            continue
        try:
            number = int(raw_number)
        except (TypeError, ValueError):
            continue
        key = (parsed.isoformat(), number)
        if key in seen:
            continue
        seen.add(key)
        normalised.append(
            {
                "date": parsed.isoformat(),
                "lesson_number": number,
                "note": str(entry.get("note") or ""),
            }
        )
    normalised.sort(key=lambda e: (e["date"], e["lesson_number"]))
    return normalised


def prune_cancellations(
    cancellations: list[dict[str, Any]], today: date
) -> tuple[list[dict[str, Any]], bool]:
    """Drop cancellation entries older than the retention window (v2.7.2).

    Entries older than CANCELLATION_RETENTION_DAYS (relative to their
    own date) are removed so entry.data cannot grow forever. Returns
    ``(pruned_list, changed)``. Never mutates the input list.
    """
    cutoff = today - timedelta(days=CANCELLATION_RETENTION_DAYS)
    kept = []
    for e in cancellations:
        parsed = parse_cancellation_date(e.get("date"))
        if parsed is not None and parsed >= cutoff:
            kept.append(e)
    changed = len(kept) != len(cancellations)
    return kept, changed


def get_entry_cancellations(entry_data: dict[str, Any]) -> list[dict[str, Any]]:
    """Read + normalise the cancellation list from config entry data."""
    return normalise_cancellations(entry_data.get(CONF_LESSON_CANCELLATIONS, []))


# ─── Queries ────────────────────────────────────────────────────────────


def cancellations_for_date(
    cancellations: list[dict[str, Any]], day: date
) -> list[dict[str, Any]]:
    """All cancellations for ``day`` (any slot)."""
    iso = day.isoformat()
    return [e for e in cancellations if e.get("date") == iso]


def is_lesson_cancelled(
    cancellations: list[dict[str, Any]], day: date, lesson_number: Any
) -> dict[str, Any] | None:
    """The cancellation entry for (day, lesson_number) or None.

    Returns the full entry (note included) so callers can surface the
    reason, not just the boolean fact.
    """
    iso = day.isoformat()
    try:
        number = int(lesson_number)
    except (TypeError, ValueError):
        return None
    for e in cancellations:
        if e.get("date") == iso and e.get("lesson_number") == number:
            return e
    return None


def annotate_lessons(
    lessons: list[dict[str, Any]],
    cancellations: list[dict[str, Any]],
    day: date,
) -> list[dict[str, Any]]:
    """Annotate one day's lesson list with cancellation flags (v2.7.2).

    Returns a NEW list of NEW dicts (input untouched — same discipline as
    the coordinator's deep-copy lesson handling, the v2.5.2 aliasing
    lesson). Every lesson dict gains:
        cancelled: bool   — this occurrence is called off
        cancelled_note: str — the reason, "" when not cancelled
    Lessons without a cancellation are annotated with the falsy defaults
    so consumers never need .get() fallbacks.
    """
    day_cancels = cancellations_for_date(cancellations, day)
    by_number: dict[int, str] = {
        int(e["lesson_number"]): str(e.get("note") or "") for e in day_cancels
    }
    out: list[dict[str, Any]] = []
    for lesson in lessons:
        annotated = dict(lesson)
        raw_number = lesson.get(CONF_LESSON_NUMBER)
        number: int | None
        if raw_number is None:
            number = None
        else:
            try:
                number = int(raw_number)
            except (TypeError, ValueError):
                number = None
        note = by_number.get(number) if number is not None else None
        if note is not None:
            annotated["cancelled"] = True
            annotated["cancelled_note"] = note
        else:
            annotated["cancelled"] = False
            annotated["cancelled_note"] = ""
        out.append(annotated)
    return out


def cancelled_dates(cancellations: list[dict[str, Any]]) -> list[str]:
    """Distinct cancelled dates, ascending."""
    return sorted({str(e["date"]) for e in cancellations if e.get("date")})


# ─── Mutations (used by the coordinator) ────────────────────────────────


def upsert_cancellation(
    cancellations: list[dict[str, Any]],
    day: date,
    lesson_number: int,
    note: str = "",
) -> tuple[list[dict[str, Any]], bool]:
    """Add or update the cancellation for (day, lesson_number).

    Idempotent: re-marking an existing slot only updates the note.
    Returns a NEW list (input untouched) and whether it changed.
    """
    iso = day.isoformat()
    new_list = [dict(e) for e in cancellations]
    for e in new_list:
        if e.get("date") == iso and e.get("lesson_number") == lesson_number:
            if e.get("note", "") == str(note or ""):
                return new_list, False
            e["note"] = str(note or "")
            return new_list, True
    new_list.append(
        {"date": iso, "lesson_number": int(lesson_number), "note": str(note or "")}
    )
    new_list.sort(key=lambda e: (e["date"], e["lesson_number"]))
    return new_list, True


def remove_cancellation(
    cancellations: list[dict[str, Any]],
    day: date,
    lesson_number: int,
) -> tuple[list[dict[str, Any]], bool]:
    """Remove the cancellation for (day, lesson_number).

    Returns a new list and whether an entry was removed.
    """
    iso = day.isoformat()
    kept = [
        e
        for e in cancellations
        if not (e.get("date") == iso and e.get("lesson_number") == lesson_number)
    ]
    return kept, len(kept) != len(cancellations)