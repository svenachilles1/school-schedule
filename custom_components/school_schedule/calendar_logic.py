"""Pure event-generation logic for the calendar platform (no HA imports).

Every schedule entry (lessons AND breaks) becomes a calendar event on its
weekday, repeated weekly. School-free days are skipped with the same
priority the binary sensor uses: vacation > public holiday > weekend >
school day (delegated to holiday_logic.day_status).

This module is deliberately free of Home Assistant imports so the unit
tests (tests/test_calendar_logic.py) run locally and in GitHub CI via the
stub-package pattern — same approach as holiday_logic.

Event dict shape (consumed by calendar.py, wrapped into CalendarEvent):
    {
        "start": datetime,   # tz-aware, local wall-clock times
        "end": datetime,     # tz-aware
        "summary": str,      # subject as entered by the user
        "description": str | None,  # teacher, if set
        "location": str | None,     # room, if set
        "uid": str,          # deterministic: ss-<weekday>-<date>-<lesson_number>
    }
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any

from .const import (
    CONF_END_TIME,
    CONF_LESSON_NUMBER,
    CONF_ROOM,
    CONF_START_TIME,
    CONF_SUBJECT,
    CONF_TEACHER,
    CONF_WEEKDAY,
    WEEKDAY_MAP,
)
from .holiday_logic import STATUS_SCHOOL_DAY
from .cancellation_logic import is_lesson_cancelled
from .date_exception_logic import (
    effective_cancellations,
    effective_day_status,
)

# Safety net for the next-upcoming scan: must exceed the longest German
# summer break (~6 weeks) with a wide margin. 400 days > 1 year.
MAX_LOOKAHEAD_DAYS = 400

# Defensive fallback when an entry has a broken/missing end time
# (mirrors local_calendar's 30-minute bump for non-positive durations).
_MIN_EVENT_MINUTES = 30


def parse_hhmm(value: Any) -> time | None:
    """Parse 'HH:MM' or 'HH:MM:SS' robustly.

    Stored times are 'HH:MM' since v2.2, but legacy entries may still carry
    'HH:MM:SS' (the time-format mismatch that once broke _find_current_lesson).
    Accept both, never raise — return None for unparseable values.
    """
    if isinstance(value, time):
        return value
    if not isinstance(value, str) or not value.strip():
        return None
    parts = value.strip().split(":")
    try:
        hour = int(parts[0])
        minute = int(parts[1]) if len(parts) > 1 else 0
    except (ValueError, IndexError):
        return None
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    return time(hour=hour, minute=minute)


def _lessons_by_weekday(lessons: list[dict[str, Any]]) -> dict[int, list[dict[str, Any]]]:
    """Group lessons by ISO weekday (0=Mon..4=Fri), sorted by start time."""
    grouped: dict[int, list[dict[str, Any]]] = {}
    for lesson in lessons:
        weekday_index = WEEKDAY_MAP.get(lesson.get(CONF_WEEKDAY, ""))
        if weekday_index is None:
            continue  # unknown weekday — never happens via the form, skip safely
        start = parse_hhmm(lesson.get(CONF_START_TIME)) or time(0, 0)
        grouped.setdefault(weekday_index, []).append(lesson)
    for entries in grouped.values():
        entries.sort(key=lambda l: (parse_hhmm(l.get(CONF_START_TIME)) or time(0, 0), l.get(CONF_LESSON_NUMBER, 0)))
    return grouped


def _event_for_lesson(lesson: dict[str, Any], day: date, tz: Any) -> dict[str, Any]:
    """Build one event dict for a lesson on a concrete date."""
    start_t = parse_hhmm(lesson.get(CONF_START_TIME))
    end_t = parse_hhmm(lesson.get(CONF_END_TIME))
    if start_t is None:
        start_t = time(0, 0)
    if end_t is None or end_t <= start_t:
        # Defensive: broken end time → bump like local_calendar does
        end_dt_fallback = datetime.combine(day, start_t, tzinfo=tz) + timedelta(minutes=_MIN_EVENT_MINUTES)
        start_dt = datetime.combine(day, start_t, tzinfo=tz)
        end_dt = end_dt_fallback
    else:
        start_dt = datetime.combine(day, start_t, tzinfo=tz)
        end_dt = datetime.combine(day, end_t, tzinfo=tz)

    subject = str(lesson.get(CONF_SUBJECT) or "").strip()
    teacher = str(lesson.get(CONF_TEACHER) or "").strip()
    room = str(lesson.get(CONF_ROOM) or "").strip()

    return {
        "start": start_dt,
        "end": end_dt,
        "summary": subject or "-",
        "description": teacher or None,
        "location": room or None,
        "uid": f"ss-{lesson.get(CONF_WEEKDAY)}-{day.isoformat()}-{lesson.get(CONF_LESSON_NUMBER, 0)}",
    }


def build_events(
    lessons: list[dict[str, Any]],
    periods: list[dict[str, Any]],
    start_date: date,
    end_date: date,
    tz: Any,
    cancellations: list[dict[str, Any]] | None = None,
    exceptions: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """All events whose interval overlaps [start_date, end_date] (inclusive).

    Iterates calendar days from start_date to end_date, skips school-free
    days (vacation / public holiday / weekend via day_status) and emits one
    event per lesson of that weekday. Result is sorted by start datetime.

    v2.7.2: lessons marked cancelled for that concrete date are skipped
    (Vertretungsplan-Light) — a cancelled lesson is no event, automations
    firing on it would lie. ``cancellations`` is the coordinator's
    normalised cancellation list; None keeps the old behaviour (used by
    the pure unit tests).

    v2.7.3: date exceptions. Days with a ``free`` exception (Klassenfahrt,
    Schulfest) are skipped entirely — same treatment as a vacation day.
    ``partial`` days keep their lessons 1..until_lesson and derive
    cancellations for the rest (merged with explicit cancellations,
    explicit wins) so a half day shows exactly its real events.
    ``exceptions`` is the coordinator's normalised exception list; None
    keeps the old behaviour.
    """
    if end_date < start_date:
        return []

    grouped = _lessons_by_weekday(lessons)
    if not grouped:
        return []

    # Overlap window as datetimes so events partially outside the day range
    # are still handled correctly (HA passes tz-aware datetimes).
    window_start = datetime.combine(start_date, time.min, tzinfo=tz)
    window_end = datetime.combine(end_date, time.max, tzinfo=tz)

    events: list[dict[str, Any]] = []
    day = start_date
    while day <= end_date:
        if effective_day_status(day, periods, exceptions or [])["status"] == STATUS_SCHOOL_DAY:
            day_numbers: list[int] = []
            for lesson in grouped.get(day.weekday(), []):
                raw_number = lesson.get(CONF_LESSON_NUMBER)
                if raw_number is None:
                    continue
                try:
                    day_numbers.append(int(raw_number))
                except (TypeError, ValueError):
                    continue
            day_cancellations = (
                effective_cancellations(
                    cancellations or [], exceptions or [], day, day_numbers
                )
                if (cancellations is not None or exceptions is not None)
                else None
            )
            for lesson in grouped.get(day.weekday(), []):
                # v2.7.2/3: skip cancelled occurrences for THIS date —
                # explicit AND exception-derived ones
                if (
                    day_cancellations is not None
                    and is_lesson_cancelled(
                        day_cancellations, day, lesson.get(CONF_LESSON_NUMBER)
                    )
                ):
                    continue
                event = _event_for_lesson(lesson, day, tz)
                # True overlap semantics (mirrors local_calendar's
                # timeline.overlapping): keep events intersecting the window.
                if event["end"] > window_start and event["start"] < window_end:
                    events.append(event)
        day += timedelta(days=1)

    events.sort(key=lambda e: (e["start"], e["uid"]))
    return events


def next_upcoming_event(
    lessons: list[dict[str, Any]],
    periods: list[dict[str, Any]],
    now: datetime,
    cancellations: list[dict[str, Any]] | None = None,
    exceptions: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    """The current or next event from ``now`` (local_calendar semantics).

    - A lesson currently running (start <= now < end) counts as the event.
    - Otherwise the next lesson on ``now``'s date, or on the next school day
      (skipping weekends, public holidays and vacations).
    - None when the schedule has no lessons at all.
    - v2.7.2: cancelled occurrences are skipped — the calendar state
      must never announce a lesson that was called off.
    - v2.7.3: ``free`` exception days are skipped like vacation days;
      on ``partial`` days the derived cancellations apply.
    """
    grouped = _lessons_by_weekday(lessons)
    if not grouped:
        return None

    tz = now.tzinfo
    today = now.date()
    for offset in range(MAX_LOOKAHEAD_DAYS):
        day = today + timedelta(days=offset)
        if effective_day_status(day, periods, exceptions or [])["status"] != STATUS_SCHOOL_DAY:
            continue
        day_lessons = grouped.get(day.weekday(), [])
        if not day_lessons:
            continue
        day_numbers: list[int] = []
        for lesson in day_lessons:
            raw_number = lesson.get(CONF_LESSON_NUMBER)
            if raw_number is None:
                continue
            try:
                day_numbers.append(int(raw_number))
            except (TypeError, ValueError):
                continue
        day_cancellations = (
            effective_cancellations(
                cancellations or [], exceptions or [], day, day_numbers
            )
            if (cancellations is not None or exceptions is not None)
            else None
        )
        for lesson in day_lessons:
            if (
                day_cancellations is not None
                and is_lesson_cancelled(
                    day_cancellations, day, lesson.get(CONF_LESSON_NUMBER)
                )
            ):
                continue
            event = _event_for_lesson(lesson, day, tz)
            if event["end"] > now:
                return event
    return None