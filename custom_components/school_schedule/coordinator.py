"""DataUpdateCoordinator for the School Schedule integration."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import (
    CONF_CHILD_NAME,
    CONF_LESSONS,
    CONF_WEEKDAY,
    CONF_LESSON_NUMBER,
    DOMAIN,
    UPDATE_INTERVAL_MINUTES,
    WEEKDAYS,
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
        self.lessons: list[dict[str, Any]] = list(entry.data.get(CONF_LESSONS, []))
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
            self.lessons = list(updated.data.get(CONF_LESSONS, []))
        return self._build_schedule_data()

    def _build_schedule_data(self) -> dict[str, Any]:
        """Build the schedule data structure for sensors."""
        today = datetime.now()
        tomorrow = today + timedelta(days=1)

        today_weekday = WEEKDAYS[today.weekday()] if today.weekday() < 5 else None
        tomorrow_weekday = WEEKDAYS[tomorrow.weekday()] if tomorrow.weekday() < 5 else None

        data: dict[str, Any] = {
            "child_name": self.child_name,
            "today": self._get_lessons_for_day(today_weekday),
            "tomorrow": self._get_lessons_for_day(tomorrow_weekday),
            "today_weekday": today_weekday,
            "tomorrow_weekday": tomorrow_weekday,
            "last_update": today.isoformat(),
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
            lesson for lesson in self.lessons
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
        for lesson in self.lessons:
            if lesson.get(CONF_WEEKDAY) == weekday and lesson.get(CONF_LESSON_NUMBER) == lesson_number:
                lesson.update(updates)
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
        new_data = {**self.entry.data, CONF_LESSONS: list(self.lessons)}
        # NOTE: reload_on_update was removed in HA 2026.8.x — do NOT pass it.
        self.hass.config_entries.async_update_entry(
            self.entry, data=new_data
        )
        # Update entry reference but keep self.lessons as-is (we just wrote them)
        self._refresh_entry_ref()
        _LOGGER.debug("Persisted %d lessons for %s", len(self.lessons), self.child_name)