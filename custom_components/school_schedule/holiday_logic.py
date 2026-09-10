"""Pure holiday logic for the School Schedule integration.

This module contains NO Home Assistant imports so it stays unit-testable
and CI-checkable. It implements the day-status decision logic:

    vacation  >  public holiday  >  weekend  >  school day

Data source: mehr-schulferien.de API v2.1 ``/periods`` endpoint, which
returns public holidays AND school vacations in one response — each entry
carries ``is_public_holiday`` / ``is_school_vacation`` flags.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from .const import (
    STATUS_PUBLIC_HOLIDAY,
    STATUS_SCHOOL_DAY,
    STATUS_VACATION,
    STATUS_WEEKEND,
)

# ─── Data normalisation ────────────────────────────────────────────────


def _parse_date(value: str) -> date | None:
    """Parse an ISO date string (YYYY-MM-DD) to a date object."""
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _dedupe_periods(periods: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Deduplicate periods.

    mehr-schulferien.de's API ignores the ``year`` parameter and returns
    the same payload for every year request. Naive multi-year fetching
    therefore yields every period twice — the same bug the Lovelace card
    hit in v2.4.2 (fixed in v2.4.3/v2.4.4). This helper dedupes by
    ``starts_on + ends_on + name`` so the backend can never produce
    duplicates, regardless of how the data was fetched.
    """
    seen: set[tuple[str, str, str]] = set()
    result: list[dict[str, Any]] = []
    for period in periods:
        key = (
            str(period.get("starts_on", "")),
            str(period.get("ends_on", "")),
            str(period.get("name", "")),
        )
        if key in seen:
            continue
        seen.add(key)
        result.append(period)
    return result


def parse_periods(raw_periods: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalise raw API periods into a sorted, deduped, typed list.

    Returns a list of dicts with keys:
        name, starts_on (date), ends_on (date),
        is_public_holiday (bool), is_school_vacation (bool)
    Sorted by starts_on ascending. Entries with unparseable dates are
    dropped.
    """
    normalised: list[dict[str, Any]] = []
    for period in _dedupe_periods(raw_periods):
        start = _parse_date(period.get("starts_on", ""))
        end = _parse_date(period.get("ends_on", ""))
        if start is None or end is None:
            continue
        normalised.append(
            {
                "name": str(period.get("name", "")),
                "starts_on": start,
                "ends_on": end,
                "is_public_holiday": bool(period.get("is_public_holiday", False)),
                "is_school_vacation": bool(period.get("is_school_vacation", False)),
            }
        )
    normalised.sort(key=lambda p: (p["starts_on"], p["ends_on"]))
    return normalised


# ─── Day status decision logic ─────────────────────────────────────────


def day_status(
    target: date,
    periods: list[dict[str, Any]],
    *,
    weekend_days: tuple[int, ...] = (5, 6),
) -> dict[str, Any]:
    """Compute the status of a single day.

    Priority: vacation > public holiday > weekend > school day.

    Returns a dict with keys:
        date (str), status, reason (str), reason_type (str)
    """
    vacation_name = ""
    holiday_name = ""
    for period in periods:
        start: date = period["starts_on"]
        end: date = period["ends_on"]
        if start <= target <= end:
            if period["is_school_vacation"]:
                vacation_name = str(period["name"])
            if period["is_public_holiday"]:
                holiday_name = str(period["name"])

    if vacation_name:
        return {
            "date": target.isoformat(),
            "status": STATUS_VACATION,
            "reason": vacation_name,
            "reason_type": "school_vacation",
        }
    if holiday_name:
        return {
            "date": target.isoformat(),
            "status": STATUS_PUBLIC_HOLIDAY,
            "reason": holiday_name,
            "reason_type": "public_holiday",
        }
    if target.weekday() in weekend_days:
        return {
            "date": target.isoformat(),
            "status": STATUS_WEEKEND,
            "reason": "",
            "reason_type": "weekend",
        }
    return {
        "date": target.isoformat(),
        "status": STATUS_SCHOOL_DAY,
        "reason": "",
        "reason_type": "",
    }


def next_school_day(
    start: date,
    periods: list[dict[str, Any]],
    *,
    max_days: int = 60,
) -> dict[str, Any] | None:
    """Find the next school day strictly after ``start`` (exclusive)."""
    for offset in range(1, max_days + 1):
        candidate = start + timedelta(days=offset)
        result = day_status(candidate, periods)
        if result["status"] == STATUS_SCHOOL_DAY:
            return result
    return None


def next_event(
    start: date,
    periods: list[dict[str, Any]],
    *,
    event_type: str,
    max_days: int = 400,
) -> dict[str, Any] | None:
    """Find the next vacation or public holiday period starting after ``start``.

    ``event_type``: "vacation" or "holiday" (or "any").
    """
    for offset in range(1, max_days + 1):
        candidate = start + timedelta(days=offset)
        for period in periods:
            if period["starts_on"] == candidate:
                if event_type == "vacation" and not period["is_school_vacation"]:
                    continue
                if event_type == "holiday" and not period["is_public_holiday"]:
                    continue
                return {
                    "date": candidate.isoformat(),
                    "name": str(period["name"]),
                    "ends_on": period["ends_on"].isoformat(),
                }
    return None