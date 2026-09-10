"""DataUpdateCoordinator for the School Schedule integration."""
from __future__ import annotations

import copy
import logging
from datetime import date, datetime, timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import (
    CONF_CHILD_NAME,
    CONF_IS_BREAK,
    CONF_LESSONS,
    CONF_WEEKDAY,
    CONF_LESSON_NUMBER,
    DOMAIN,
    UPDATE_INTERVAL_MINUTES,
    WEEKDAYS,
)
from .holiday_logic import (
    day_status,
    next_event,
    next_school_day,
)
from .holidays import (
    SharedHolidaysCoordinator,
    federal_state_from_entry,
    get_holidays_coordinator,
)

_LOGGER = logging.getLogger(__name__)


class SchoolScheduleCoordinator(DataUpdateCoordinator):
    """Coordinator for the School Schedule integration."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the coordinator."""
        self.entry = entry
        self.child_name: str = entry.data.get(CONF_CHILD_NAME, "")
        # Deep copy: entry.data is a MappingProxyType over the stored dict —
        # a shallow list() copy would share the lesson dicts with entry.data,
        # so in-place mutation (update_lesson) would silently change
        # entry.data too. async_update_entry() then sees
        # new_data == entry.data and skips the storage write entirely
        # (no modified_at bump, nothing persisted) — the lesson edit lives
        # only in RAM until the next restart wipes it. Deep-copying here
        # keeps self.lessons fully detached from entry.data (v2.5.2).
        self.lessons: list[dict[str, Any]] = copy.deepcopy(
            entry.data.get(CONF_LESSONS, [])
        )
        # Shared holiday data for this entry's federal state (one instance
        # per state — all children in the same state share the API fetch).
        self.holidays: SharedHolidaysCoordinator = get_holidays_coordinator(
            hass, federal_state_from_entry(entry)
        )
        self.holidays.async_setup_with_entry(entry)
        _LOGGER.info("Coordinator init: loaded %d lessons for %s", len(self.lessons), self.child_name)

        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_{self.child_name}",
            update_interval=timedelta(minutes=UPDATE_INTERVAL_MINUTES),
            update_method=self._async_update_data,
        )

    def _refresh_entry_ref(self) -> None:
        """Update self.entry to point to the latest ConfigEntry object."""
        updated = self.hass.config_entries.async_get_entry(self.entry.entry_id)
        if updated is not None:
            self.entry = updated

    async def _async_update_data(self) -> dict[str, Any]:
        """Fetch data — periodic refresh, reload lessons from config entry."""
        updated = self.hass.config_entries.async_get_entry(self.entry.entry_id)
        if updated is not None:
            self.entry = updated
            # Deep copy — see __init__: never share dicts with entry.data
            self.lessons = copy.deepcopy(updated.data.get(CONF_LESSONS, []))

        # Refresh holiday data if stale (at most one API request per 24h
        # per federal state — shared between all children in that state).
        # Falls back to the entry-cached periods when the API is offline.
        if await self.holidays.async_ensure_current():
            if self.holidays.dirty:
                self.holidays.persist_into(self.entry)
                self.holidays.dirty = False
                self._refresh_entry_ref()

        return self._build_schedule_data()

    def _build_schedule_data(self) -> dict[str, Any]:
        """Build the schedule data structure for sensors."""
        today = datetime.now()
        tomorrow = today + timedelta(days=1)
        today_date = today.date()
        tomorrow_date = tomorrow.date()

        today_weekday = WEEKDAYS[today.weekday()] if today.weekday() < 5 else None
        tomorrow_weekday = WEEKDAYS[tomorrow.weekday()] if tomorrow.weekday() < 5 else None

        periods = self.holidays.periods
        today_h = day_status(today_date, periods)
        tomorrow_h = day_status(tomorrow_date, periods)

        data: dict[str, Any] = {
            "child_name": self.child_name,
            "today": self._get_lessons_for_day(today_weekday),
            "tomorrow": self._get_lessons_for_day(tomorrow_weekday),
            "today_weekday": today_weekday,
            "tomorrow_weekday": tomorrow_weekday,
            "last_update": today.isoformat(),
            # Holiday / school-free data (v2.5.0)
            "federal_state": self.holidays.federal_state,
            "today_status": today_h["status"],
            "today_reason": today_h["reason"],
            "today_school_free": today_h["status"] != "school_day",
            "tomorrow_status": tomorrow_h["status"],
            "tomorrow_reason": tomorrow_h["reason"],
            "tomorrow_school_free": tomorrow_h["status"] != "school_day",
            "next_school_day": next_school_day(today_date, periods),
            "next_vacation": next_event(today_date, periods, event_type="vacation"),
            "next_public_holiday": next_event(today_date, periods, event_type="holiday"),
            "holidays_count": len(periods),
            "holidays_last_updated": self.holidays.last_updated_at,
        }

        for day in WEEKDAYS:
            data[day] = self._get_lessons_for_day(day)

        _LOGGER.debug("Built schedule: today=%d, monday=%d, total_lessons=%d", len(data["today"]), len(data.get("monday", [])), len(self.lessons))
        return data

    def _get_lessons_for_day(self, weekday: str | None) -> list[dict[str, Any]]:
        """Get all lessons for a given weekday, sorted by lesson number."""
        if weekday is None:
            return []
        day_lessons = [
            {**lesson, CONF_IS_BREAK: lesson.get(CONF_IS_BREAK, False)}
            for lesson in self.lessons
            if lesson.get(CONF_WEEKDAY) == weekday
        ]
        return sorted(day_lessons, key=lambda l: l.get(CONF_LESSON_NUMBER, 0))

    async def add_lesson(self, lesson: dict[str, Any]) -> bool:
        """Add a new lesson to the schedule."""
        self.lessons.append(lesson)
        self._sort_lessons()
        await self._persist_lessons()
        self.async_set_updated_data(self._build_schedule_data())
        _LOGGER.info("add_lesson: %s, total now %d", lesson.get("subject"), len(self.lessons))
        return True

    async def remove_lesson(self, weekday: str, lesson_number: int) -> bool:
        """Remove a lesson by weekday and lesson number."""
        before = len(self.lessons)
        self.lessons = [
            l for l in self.lessons
            if not (l.get(CONF_WEEKDAY) == weekday and l.get(CONF_LESSON_NUMBER) == lesson_number)
        ]
        if len(self.lessons) < before:
            await self._persist_lessons()
            self.async_set_updated_data(self._build_schedule_data())
            return True
        return False

    async def update_lesson(
        self, weekday: str, lesson_number: int, updates: dict[str, Any]
    ) -> bool:
        """Update an existing lesson."""
        for idx, lesson in enumerate(self.lessons):
            if lesson.get(CONF_WEEKDAY) == weekday and lesson.get(CONF_LESSON_NUMBER) == lesson_number:
                # Replace the lesson dict instead of mutating it — a fresh
                # dict guarantees new_data differs from the previously
                # persisted entry.data even if all field values are equal
                # (second line of defence behind the deep copy in __init__).
                self.lessons[idx] = {**lesson, **updates}
                self._sort_lessons()
                await self._persist_lessons()
                self.async_set_updated_data(self._build_schedule_data())
                return True
        return False

    def get_schedule(self, weekday: str | None = None) -> list[dict[str, Any]] | dict[str, list]:
        """Get the schedule for a specific day or all days."""
        if weekday is not None:
            return self._get_lessons_for_day(weekday)
        return {day: self._get_lessons_for_day(day) for day in WEEKDAYS}

    def _sort_lessons(self) -> None:
        """Sort lessons by weekday then lesson number."""
        self.lessons.sort(
            key=lambda l: (
                WEEKDAYS.index(l[CONF_WEEKDAY]) if l.get(CONF_WEEKDAY) in WEEKDAYS else 5,
                l.get(CONF_LESSON_NUMBER, 0),
            )
        )

    async def _persist_lessons(self) -> None:
        """Persist lessons to the config entry data without triggering a reload."""
        new_data = {**self.entry.data, CONF_LESSONS: copy.deepcopy(self.lessons)}
        # NOTE: reload_on_update was removed in HA 2026.8.x — do NOT pass it.
        changed = self.hass.config_entries.async_update_entry(
            self.entry, data=new_data
        )
        # Update entry reference but keep self.lessons as-is (we just wrote them).
        if not changed:
            # async_update_entry returns False when new_data == entry.data —
            # with the deep copies above this can only mean a real no-op
            # (identical values). Persist explicitly anyway: equality on the
            # in-memory dict is NOT proof the .storage file already holds
            # this state (e.g. after a failed save). Log loudly instead of
            # silently losing the edit (v2.5.2).
            _LOGGER.error(
                "Persist skipped: lesson data identical to entry data for %s "
                "(%d lessons) — verifying storage is expected to match",
                self.child_name,
                len(self.lessons),
            )
        self._refresh_entry_ref()
        _LOGGER.debug("Persisted %d lessons for %s", len(self.lessons), self.child_name)