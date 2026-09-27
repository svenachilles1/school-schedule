"""Pure absence/sick-day logic for the School Schedule integration (v2.6.0).

NO Home Assistant imports — unit-testable and CI-checkable, same pattern as
holiday_logic / calendar_logic / lesson_logic.

Data model
----------
``absences`` is a plain list of dicts in the config entry data, one entry
per absence day:

    {"date": "2026-09-29", "type": "sick", "note": "Erk\u00e4ltung"}

- ``date``: ISO calendar date of the absence day (the day school was
  actually missed), NOT the day the entry was created. Nachtr\u00e4ge (marking
  yesterday sick today) and Vormeldungen (marking tomorrow sick today) both
  work — the date is always explicit.
- ``type``: absence type. The schema is generic (future date-based
  exceptions like school trips can reuse it); the only type produced by
  v2.6.0 is ``sick``.
- ``note``: free-text reason, optional.

Streak semantics (the German "Attestpflicht" rule)
--------------------------------------------------
A sick streak counts CONSECUTIVE SICK SCHOOL DAYS. School-free days
(weekend, public holiday, vacation) inside a streak do NOT count and do NOT
break the streak as long as the gap is <= SICK_STREAK_BREAK_GAP school-free
days — Friday sick + Monday sick = a 2-day streak (weekend bridge). Longer
gaps (summer vacation) break the streak: the illness is considered over.

The attest rule: from the 3rd consecutive sick day a doctor's note is
required. The warning fires at day 2 ("if the child stays sick tomorrow,
bring a note") so parents have a lead. ``attest_required`` is True from day
3 on. Both thresholds are constants in const.py — schools vary, the rule is
conservative (JDU/Bildungsportal guidance: ab dem 3. Tag).

A "future" streak (only tomorrow marked sick, nothing today): the streak
counts future marked days too, so marking today + tomorrow shows a
streak of 2 and the warning immediately.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from .const import (
    ABSENCE_RETENTION_DAYS,
    ABSENCE_TYPE_SICK,
    ATTEST_REQUIRED_FROM_STREAK,
    ATTEST_WARNING_FROM_STREAK,
    CONF_ABSENCES,
    SICK_STREAK_BREAK_GAP,
    STATUS_SCHOOL_DAY,
)
from .holiday_logic import day_status


# ─── Data normalisation ────────────────────────────────────────────────


def parse_absence_date(value: Any) -> date | None:
    """Parse an ISO date string (YYYY-MM-DD) to a date, never raise."""
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def normalise_absences(raw: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Normalise a raw absence list into typed, deduped, sorted entries.

    Defensive against every legacy/malformed shape:
    - Entries without a parseable date are dropped.
    - Missing ``type`` defaults to ``sick`` (the only v2.6.0 type; a legacy
      list without the key must behave identically).
    - Duplicate dates (same date, any type) are collapsed to the first
      occurrence — one absence day per date is the invariant.
    - Sorted by date ascending.
    """
    normalised: list[dict[str, Any]] = []
    seen_dates: set[str] = set()
    for entry in raw or []:
        if not isinstance(entry, dict):
            continue
        parsed = parse_absence_date(entry.get("date"))
        if parsed is None:
            continue
        iso = parsed.isoformat()
        if iso in seen_dates:
            continue
        seen_dates.add(iso)
        normalised.append(
            {
                "date": iso,
                "type": str(entry.get("type") or ABSENCE_TYPE_SICK),
                "note": str(entry.get("note") or ""),
            }
        )
    normalised.sort(key=lambda e: e["date"])
    return normalised


def prune_absences(
    absences: list[dict[str, Any]], today: date
) -> tuple[list[dict[str, Any]], bool]:
    """Drop absence days older than ABSENCE_RETENTION_DAYS (relative to today).

    Returns ``(pruned_list, changed)``. Never mutates the input list.
    """
    cutoff = today - timedelta(days=ABSENCE_RETENTION_DAYS)
    kept = []
    for e in absences:
        parsed = parse_absence_date(e.get("date"))
        if parsed is not None and parsed >= cutoff:
            kept.append(e)
    changed = len(kept) != len(absences)
    return kept, changed


# ─── Sick-day queries ──────────────────────────────────────────────────


def is_sick(absences: list[dict[str, Any]], day: date) -> bool:
    """True when ``day`` has a sick absence entry."""
    iso = day.isoformat()
    return any(e.get("date") == iso and e.get("type") == ABSENCE_TYPE_SICK for e in absences)


def sick_dates(absences: list[dict[str, Any]]) -> list[date]:
    """All sick day dates, ascending."""
    out: list[date] = []
    for e in absences:
        if e.get("type") != ABSENCE_TYPE_SICK:
            continue
        parsed = parse_absence_date(e.get("date"))
        if parsed is not None:
            out.append(parsed)
    out.sort()
    return out


def count_sick_school_year(absences: list[dict[str, Any]], today: date) -> int:
    """Total sick school days in the current school year (Aug 1 - Jul 31)."""
    year_start = date(today.year, 8, 1)
    if today < year_start:
        year_start = date(today.year - 1, 8, 1)
    return sum(1 for d in sick_dates(absences) if d >= year_start)


# ─── Streak / attest logic ─────────────────────────────────────────────


def _school_days_between(
    start: date, end: date, periods: list[dict[str, Any]]
) -> list[date]:
    """All school days in (start, end] — exclusive start, inclusive end."""
    days: list[date] = []
    day = start + timedelta(days=1)
    while day <= end:
        if day_status(day, periods)["status"] == STATUS_SCHOOL_DAY:
            days.append(day)
        day += timedelta(days=1)
    return days


def current_streak(
    absences: list[dict[str, Any]],
    today: date,
    periods: list[dict[str, Any]],
) -> int:
    """Length of the currently running sick streak (counting today).

    Walks BACKWARD from today. The streak:

    1. Starts at today when today is marked sick. When today is NOT marked,
       there is no running streak (a future streak is computed separately
       in sick_summary — "only tomorrow marked" is not a running illness).
    2. Each previous school day that is marked sick extends the streak.
    3. School-free days inside the streak are skipped; the streak breaks
       after SICK_STREAK_BREAK_GAP consecutive school-free days (a weekend
       bridge keeps Friday+Monday one illness, a vacation breaks it).
    4. School days WITHOUT a sick mark break the streak immediately.

    The result includes future-marked days when today is sick AND tomorrow
    (and beyond) is also marked — a parent marking the whole week sick
    upfront sees the full expected streak, attest warning included.
    """
    if not is_sick(absences, today):
        return 0

    streak = 1
    # — forward part: future-marked consecutive school days extend it —
    gap = 0
    day = today + timedelta(days=1)
    while True:
        if day_status(day, periods)["status"] != STATUS_SCHOOL_DAY:
            gap += 1
            if gap > SICK_STREAK_BREAK_GAP:
                break
            day += timedelta(days=1)
            continue
        gap = 0
        if is_sick(absences, day):
            streak += 1
            day += timedelta(days=1)
        else:
            break

    # — backward part: previous sick school days, bridging free days —
    gap = 0
    day = today - timedelta(days=1)
    while True:
        if day_status(day, periods)["status"] != STATUS_SCHOOL_DAY:
            gap += 1
            if gap > SICK_STREAK_BREAK_GAP:
                break
            day -= timedelta(days=1)
            continue
        gap = 0
        if is_sick(absences, day):
            streak += 1
            day -= timedelta(days=1)
        else:
            break

    return streak


def future_streak(
    absences: list[dict[str, Any]],
    today: date,
    periods: list[dict[str, Any]],
) -> int:
    """Streak of FUTURE-marked sick days starting strictly after today.

    Used when today is not (yet) marked: "tomorrow is marked sick" shows
    streak 1 + the attest warning that kicks in at 2. If today is already
    sick this returns 0 — current_streak already includes the future.
    """
    if is_sick(absences, today):
        return 0
    streak = 0
    gap = 0
    day = today + timedelta(days=1)
    while True:
        if day_status(day, periods)["status"] != STATUS_SCHOOL_DAY:
            gap += 1
            if gap > SICK_STREAK_BREAK_GAP:
                break
            day += timedelta(days=1)
            continue
        gap = 0
        if is_sick(absences, day):
            streak += 1
            day += timedelta(days=1)
        else:
            break
    return streak


def sick_summary(
    absences: list[dict[str, Any]],
    today: date,
    periods: list[dict[str, Any]],
) -> dict[str, Any]:
    """Complete sick-day picture for sensors and the card (v2.6.0).

    Returns a dict with:
        sick_today          bool — today has a sick mark
        sick_tomorrow       bool — tomorrow has a sick mark
        streak              int   — running streak (today sick: incl. future;
                                   else the future-only streak)
        streak_active_today bool  — True only when the streak includes today
        attest_required     bool  — streak >= 3 (from day 3 on)
        attest_warning      bool  — streak == 2 (warning for tomorrow)
        last_sick_day       str|None — most recent past sick date
        sick_days_year      int   — total in current school year (Aug-Jul)
        next_sick_dates     list[str] — future-marked sick dates (<= 14d)
    """
    sick_today = is_sick(absences, today)
    tomorrow = today + timedelta(days=1)
    sick_tomorrow = is_sick(absences, tomorrow)

    if sick_today:
        streak = current_streak(absences, today, periods)
        streak_active_today = True
    else:
        streak = future_streak(absences, today, periods)
        streak_active_today = False

    dates = sick_dates(absences)
    past = [d for d in dates if d < today]
    future = [d for d in dates if d > today]

    # History for the card modal: the last 5 past sick days with their
    # notes (notes ride along from the absences list, keyed by date).
    note_by_date = {
        str(e.get("date")): str(e.get("note") or "") for e in absences
    }
    recent_sick_days = [
        {"date": d.isoformat(), "note": note_by_date.get(d.isoformat(), "")}
        for d in past[-5:]
    ]

    return {
        "sick_today": sick_today,
        "sick_tomorrow": sick_tomorrow,
        "streak": streak,
        "streak_active_today": streak_active_today,
        "attest_required": streak >= ATTEST_REQUIRED_FROM_STREAK,
        "attest_warning": streak >= ATTEST_WARNING_FROM_STREAK,
        "last_sick_day": past[-1].isoformat() if past else None,
        "sick_days_year": count_sick_school_year(absences, today),
        "next_sick_dates": [d.isoformat() for d in future if (d - today).days <= 14],
        "recent_sick_days": recent_sick_days,
    }


# ─── Mutation helpers (used by the coordinator) ────────────────────────


def upsert_absence(
    absences: list[dict[str, Any]],
    day: date,
    absence_type: str = ABSENCE_TYPE_SICK,
    note: str = "",
) -> tuple[list[dict[str, Any]], bool]:
    """Add or update the absence entry for ``day``.

    Idempotent: re-marking an existing day only updates the note (and
    type). Returns a NEW list (input untouched) and whether it changed.
    """
    iso = day.isoformat()
    new_list = [dict(e) for e in absences]
    for e in new_list:
        if e.get("date") == iso:
            note = str(note or "")
            if e.get("type") == absence_type and e.get("note", "") == note:
                return new_list, False
            e["type"] = absence_type
            e["note"] = note
            return new_list, True
    entry = {"date": iso, "type": absence_type, "note": str(note or "")}
    new_list.append(entry)
    new_list.sort(key=lambda e: e["date"])
    return new_list, True


def remove_absence(
    absences: list[dict[str, Any]],
    day: date,
    absence_type: str | None = None,
) -> tuple[list[dict[str, Any]], bool]:
    """Remove the absence entry for ``day`` (optionally by type).

    Returns a new list and whether an entry was removed.
    """
    iso = day.isoformat()
    kept = [
        e
        for e in absences
        if not (
            e.get("date") == iso
            and (absence_type is None or e.get("type") == absence_type)
        )
    ]
    return kept, len(kept) != len(absences)


def get_entry_absences(entry_data: dict[str, Any]) -> list[dict[str, Any]]:
    """Read + normalise the absences list from config entry data."""
    return normalise_absences(entry_data.get(CONF_ABSENCES, []))