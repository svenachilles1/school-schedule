"""Pure date-exception logic for the School Schedule integration (v2.7.3).

NO Home Assistant imports — unit-testable and CI-checkable, same pattern as
absence_logic / holiday_logic / cancellation_logic / calendar_logic.

Data model
----------
``date_exceptions`` is a plain list of dicts in the config entry data, one
entry per exceptional day:

    {"date": "2026-10-15", "exception_type": "free", "note": "Klassenfahrt"}
    {"date": "2026-11-04", "exception_type": "partial", "note": "Zeugnisse",
     "until_lesson": 4}

- ``date``: ISO calendar date of the exceptional day. The weekly plan
  (lessons list) is never touched — only this concrete day's OCCURRENCES
  change, exactly like lesson cancellations (v2.7.2).
- ``exception_type``:
    - ``free``    — the whole school day is off for this child (Klassenfahrt,
                    Schulfest, Ausflug). No lesson takes place.
    - ``partial`` — half day / changed plan: lessons 1..``until_lesson``
                    take place, every lesson AFTER ``until_lesson`` is
                    called off for this date (Halbtag, Zeugnis-Ausgabe).
- ``until_lesson``: mandatory for ``partial`` (1-12), meaningless for
  ``free`` (stored as None).
- ``note``: free-text reason, optional.

Semantics / priority (the backlog item's core question)
-------------------------------------------------------
A kind-specific exception is MORE specific than a state-wide vacation or
public holiday, so it wins the day-status decision:

    date exception (free)  >  vacation  >  public holiday  >  weekend  >  school day

A ``partial`` exception does NOT change the day status (school still
happens); it only derives cancellations for the lessons after
``until_lesson`` — reusing the exact v2.7.2 cancellation rendering pipeline
(struck-through lessons, excluded counters/calendar/progress). Explicit
per-lesson cancellations (mark_lesson_cancelled) win over
exception-derived ones: the more specific entry always wins.

Deliberately NOT a sick day: a free exception is not an absence — the
sick-day counters (Fehltage) and the attest streak are never touched.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from .const import (
    CONF_DATE_EXCEPTIONS,
    CONF_LESSON_NUMBER,
    EXCEPTION_RANGE_MAX_DAYS,
    EXCEPTION_RETENTION_DAYS,
    EXCEPTION_TYPE_FREE,
    EXCEPTION_TYPE_PARTIAL,
    STATUS_DATE_EXCEPTION,
    STATUS_SCHOOL_DAY,
)
from .cancellation_logic import annotate_lessons
from .holiday_logic import day_status


# Valid exception types (schema + normalisation ground truth)
EXCEPTION_TYPES: tuple[str, ...] = (EXCEPTION_TYPE_FREE, EXCEPTION_TYPE_PARTIAL)


def parse_exception_date(value: Any) -> date | None:
    """Parse an ISO date string (YYYY-MM-DD) to a date, never raise."""
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def normalise_exceptions(raw: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Normalise a raw exception list into typed, deduped, sorted entries.

    Defensive against every legacy/malformed shape:
    - Entries without a parseable date are dropped.
    - Unknown exception types are dropped (never guess).
    - ``free`` entries drop ``until_lesson`` (meaningless for them);
      ``partial`` entries keep a valid 1-12 int, invalid values drop the
      entry (a partial without a working until_lesson is meaningless).
    - Duplicate dates collapse to ONE entry. When the duplicates disagree
      on the type, ``free`` wins deterministically (a day fully off makes
      a half-day moot) — first-free wins, otherwise first occurrence.
    - Sorted by date ascending.
    """
    normalised: list[dict[str, Any]] = []
    by_date: dict[str, dict[str, Any]] = {}
    for entry in raw or []:
        if not isinstance(entry, dict):
            continue
        parsed = parse_exception_date(entry.get("date"))
        if parsed is None:
            continue
        exc_type = str(entry.get("exception_type") or "")
        if exc_type not in EXCEPTION_TYPES:
            continue
        iso = parsed.isoformat()
        note = str(entry.get("note") or "")
        if exc_type == EXCEPTION_TYPE_FREE:
            item: dict[str, Any] = {
                "date": iso,
                "exception_type": EXCEPTION_TYPE_FREE,
                "note": note,
                "until_lesson": None,
            }
        else:  # partial
            raw_until = entry.get("until_lesson")
            if raw_until is None:
                continue
            try:
                until = int(raw_until)
            except (TypeError, ValueError):
                continue
            if not (1 <= until <= 12):
                continue
            item = {
                "date": iso,
                "exception_type": EXCEPTION_TYPE_PARTIAL,
                "note": note,
                "until_lesson": until,
            }
        existing = by_date.get(iso)
        if existing is None:
            by_date[iso] = item
            normalised.append(item)
        elif (
            item["exception_type"] == EXCEPTION_TYPE_FREE
            and existing["exception_type"] != EXCEPTION_TYPE_FREE
        ):
            # free wins over a duplicate partial — replace in place,
            # keeping the list position of the first occurrence.
            existing.clear()
            existing.update(item)
    normalised.sort(key=lambda e: e["date"])
    return normalised


def prune_exceptions(
    exceptions: list[dict[str, Any]], today: date
) -> tuple[list[dict[str, Any]], bool]:
    """Drop exception entries older than the retention window (v2.7.3).

    Entries older than EXCEPTION_RETENTION_DAYS (relative to their own
    date) are removed so entry.data cannot grow forever. Returns
    ``(pruned_list, changed)``. Never mutates the input list.
    """
    cutoff = today - timedelta(days=EXCEPTION_RETENTION_DAYS)
    kept = []
    for e in exceptions:
        parsed = parse_exception_date(e.get("date"))
        if parsed is not None and parsed >= cutoff:
            kept.append(e)
    changed = len(kept) != len(exceptions)
    return kept, changed


def get_entry_exceptions(entry_data: dict[str, Any]) -> list[dict[str, Any]]:
    """Read + normalise the exception list from config entry data."""
    return normalise_exceptions(entry_data.get(CONF_DATE_EXCEPTIONS, []))


# ─── Queries ────────────────────────────────────────────────────────────


def day_exception(
    exceptions: list[dict[str, Any]], day: date
) -> dict[str, Any] | None:
    """The exception entry for ``day`` or None."""
    iso = day.isoformat()
    for e in exceptions:
        if e.get("date") == iso:
            return e
    return None


def free_exception_dates(exceptions: list[dict[str, Any]]) -> set[str]:
    """ISO dates of all ``free`` exceptions (school-day exclusions)."""
    return {
        str(e["date"])
        for e in exceptions
        if e.get("exception_type") == EXCEPTION_TYPE_FREE and e.get("date")
    }


def is_day_fully_free(exceptions: list[dict[str, Any]], day: date) -> bool:
    """True when ``day`` has a ``free`` exception (no lessons take place)."""
    exc = day_exception(exceptions, day)
    return exc is not None and exc.get("exception_type") == EXCEPTION_TYPE_FREE


def exception_reason(entry: dict[str, Any] | None) -> str:
    """Human-readable reason for an exception entry (backend fallback).

    The card renders its own translations; this feeds today_reason /
    tomorrow_reason so automations and the schulfrei sensor never show an
    empty string. A user note always wins over the generic fallback.
    """
    if entry is None:
        return ""
    note = str(entry.get("note") or "").strip()
    if note:
        return note
    if entry.get("exception_type") == EXCEPTION_TYPE_FREE:
        return "Kein Unterricht"
    until = entry.get("until_lesson")
    return f"Halbtag bis Stunde {until}" if until else "Halbtag"


def effective_day_status(
    target: date,
    periods: list[dict[str, Any]],
    exceptions: list[dict[str, Any]],
) -> dict[str, Any]:
    """Day status with kind-specific free exceptions applied (v2.7.3).

    Priority (the backlog item's core question — the kind-specific entry
    is more specific than a state-wide vacation):

        free date exception  >  vacation  >  public holiday  >  weekend  >  school day

    A ``partial`` exception does NOT change the day status (school still
    happens); it only derives cancellations (see annotate_with_exceptions).
    """
    exc = day_exception(exceptions, target)
    if exc is not None and exc.get("exception_type") == EXCEPTION_TYPE_FREE:
        return {
            "date": target.isoformat(),
            "status": STATUS_DATE_EXCEPTION,
            "reason": exception_reason(exc),
            "reason_type": "date_exception",
        }
    return day_status(target, periods)


def next_school_day_with_exceptions(
    start: date,
    periods: list[dict[str, Any]],
    exceptions: list[dict[str, Any]],
    *,
    max_days: int = 60,
) -> dict[str, Any] | None:
    """Next regular school day strictly after ``start`` (exclusive).

    Mirrors holiday_logic.next_school_day but also skips days with a
    ``free`` exception — a Klassenfahrt day is not a school day for this
    child, so the "next school day" attribute must point past it (the
    evening bag-packing automation would otherwise fire for a trip day).
    """
    for offset in range(1, max_days + 1):
        candidate = start + timedelta(days=offset)
        exc = day_exception(exceptions, candidate)
        if exc is not None and exc.get("exception_type") == EXCEPTION_TYPE_FREE:
            continue
        result = day_status(candidate, periods)
        if result["status"] == STATUS_SCHOOL_DAY:
            return result
    return None


# ─── Cancellation derivation (the v2.7.2 pipeline reuse) ────────────────


def exception_cancellation_entries(
    entry: dict[str, Any], lesson_numbers: list[int]
) -> list[dict[str, Any]]:
    """Synthetic cancellation entries derived from ONE exception entry.

    The returned entries are shape-compatible with lesson_cancellations
    ({"date", "lesson_number", "note"}) for exactly the exception's date,
    so they flow through the existing annotate/skip pipelines unchanged.

    - ``free``    → every lesson number is cancelled.
    - ``partial``  → every lesson number > until_lesson is cancelled.
    """
    iso = str(entry.get("date"))
    exc_type = entry.get("exception_type")
    note = str(entry.get("note") or "")
    out: list[dict[str, Any]] = []
    if exc_type == EXCEPTION_TYPE_FREE:
        for number in lesson_numbers:
            out.append({"date": iso, "lesson_number": int(number), "note": note})
        return out
    if exc_type == EXCEPTION_TYPE_PARTIAL:
        until = entry.get("until_lesson")
        if until is None:
            return out
        try:
            until_int = int(until)
        except (TypeError, ValueError):
            return out
        for number in lesson_numbers:
            if int(number) > until_int:
                out.append(
                    {"date": iso, "lesson_number": int(number), "note": note}
                )
    return out


def effective_cancellations(
    cancellations: list[dict[str, Any]],
    exceptions: list[dict[str, Any]],
    day: date,
    lesson_numbers: list[int],
) -> list[dict[str, Any]]:
    """Merge explicit cancellations with exception-derived ones for ``day``.

    Explicit per-lesson cancellations win: a synthetic entry is only added
    for slots that have no explicit cancellation on that date. The more
    specific entry always wins (mark_lesson_cancelled beats the blanket
    exception, so a note entered per-lesson is never silently replaced).
    """
    iso = day.isoformat()
    explicit = {
        int(e["lesson_number"])
        for e in cancellations
        if e.get("date") == iso and e.get("lesson_number") is not None
    }
    merged = list(cancellations)
    exc = day_exception(exceptions, day)
    if exc is not None:
        for synthetic in exception_cancellation_entries(exc, lesson_numbers):
            if synthetic["lesson_number"] not in explicit:
                merged.append(synthetic)
    return merged


def annotate_with_exceptions(
    lessons: list[dict[str, Any]],
    cancellations: list[dict[str, Any]],
    exceptions: list[dict[str, Any]],
    day: date,
) -> list[dict[str, Any]]:
    """Annotate one day's lesson list with cancellations AND exceptions.

    Thin wrapper over cancellation_logic.annotate_lessons: when the day has
    no exception it is a pure pass-through (identical behaviour to v2.7.2).
    With an exception, the derived entries are merged first (explicit
    cancellations win), then the standard annotation runs — every consumer
    of the annotated list (sensors, card, progress) behaves identically
    whether a lesson was called off explicitly or derived from an
    exception.
    """
    exc = day_exception(exceptions, day)
    if exc is None:
        return annotate_lessons(lessons, cancellations, day)
    numbers: list[int] = []
    for lesson in lessons:
        raw = lesson.get(CONF_LESSON_NUMBER)
        if raw is None:
            continue
        try:
            numbers.append(int(raw))
        except (TypeError, ValueError):
            continue
    merged = effective_cancellations(cancellations, exceptions, day, numbers)
    return annotate_lessons(lessons, merged, day)


# ─── Mutations (used by the coordinator) ────────────────────────────────


def upsert_exception(
    exceptions: list[dict[str, Any]],
    day: date,
    exception_type: str,
    note: str = "",
    until_lesson: int | None = None,
) -> tuple[list[dict[str, Any]], bool]:
    """Add or update the exception for ``day``.

    Idempotent: re-marking an existing day only updates type/note/until.
    Returns a NEW list (input untouched) and whether it changed.
    """
    iso = day.isoformat()
    new_list = [dict(e) for e in exceptions]
    for e in new_list:
        if e.get("date") == iso:
            new_entry = {
                "date": iso,
                "exception_type": exception_type,
                "note": str(note or ""),
                "until_lesson": (
                    int(until_lesson)
                    if exception_type == EXCEPTION_TYPE_PARTIAL
                    and until_lesson is not None
                    else None
                ),
            }
            if e == new_entry:
                return new_list, False
            e.clear()
            e.update(new_entry)
            return new_list, True
    new_list.append(
        {
            "date": iso,
            "exception_type": exception_type,
            "note": str(note or ""),
            "until_lesson": (
                int(until_lesson)
                if exception_type == EXCEPTION_TYPE_PARTIAL
                and until_lesson is not None
                else None
            ),
        }
    )
    new_list.sort(key=lambda e: e["date"])
    return new_list, True


def mark_exception_range(
    exceptions: list[dict[str, Any]],
    start: date,
    end: date,
    exception_type: str,
    note: str = "",
    until_lesson: int | None = None,
) -> tuple[list[dict[str, Any]], int, str | None]:
    """Mark every day from ``start`` to ``end`` (inclusive) with the
    exception (v2.7.3 — Klassenfahrten are multi-day by nature).

    Returns ``(new_list, added_count, error)`` — the list is only modified
    when ``error`` is None. Guards (mirroring mark_sick_range):
    - start must be <= end (swapped dates are a user typo, not silently
      fixed — the caller shows a clear error instead)
    - range length is capped at EXCEPTION_RANGE_MAX_DAYS
    - the range is built atomically: when a guard trips, the input list
      is returned untouched (no partial writes)
    """
    if start > end:
        return exceptions, 0, "start_after_end"
    if (end - start).days + 1 > EXCEPTION_RANGE_MAX_DAYS:
        return exceptions, 0, "range_too_long"
    new_list = [dict(e) for e in exceptions]
    changed = 0
    current = start
    while current <= end:
        new_list, day_changed = upsert_exception(
            new_list, current, exception_type, note, until_lesson
        )
        if day_changed:
            changed += 1
        current += timedelta(days=1)
    return new_list, changed, None


def remove_exception(
    exceptions: list[dict[str, Any]], day: date
) -> tuple[list[dict[str, Any]], bool]:
    """Remove the exception entry for ``day`` (any type).

    Returns a new list and whether an entry was removed.
    """
    iso = day.isoformat()
    kept = [e for e in exceptions if e.get("date") != iso]
    return kept, len(kept) != len(exceptions)