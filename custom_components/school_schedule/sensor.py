"""Sensor platform for School Schedule integration."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    CONF_CHILD_NAME,
    CONF_LESSON_NUMBER,
    CONF_SUBJECT,
    CONF_ROOM,
    CONF_TEACHER,
    CONF_START_TIME,
    CONF_END_TIME,
    CONF_COLOR,
    CONF_ICON,
    CONF_IS_BREAK,
    DOMAIN,
    PLATFORMS,
    SENSOR_TODAY,
    SENSOR_TOMORROW,
    SENSOR_MONDAY,
    SENSOR_TUESDAY,
    SENSOR_WEDNESDAY,
    SENSOR_THURSDAY,
    SENSOR_FRIDAY,
    WEEKDAYS,
    WEEKDAY_TRANSLATION_KEYS,
)
from .coordinator import SchoolScheduleCoordinator
from .entity import SchoolScheduleEntity

_LOGGER = logging.getLogger(__name__)

# Sensor definitions: (sensor_type, display_name, icon)
SENSOR_TYPES: list[tuple[str, str, str]] = [
    (SENSOR_TODAY, "Heute", "mdi:calendar-today"),
    (SENSOR_TOMORROW, "Morgen", "mdi:calendar-tomorrow"),
    (SENSOR_MONDAY, "Montag", "mdi:calendar-text"),
    (SENSOR_TUESDAY, "Dienstag", "mdi:calendar-text"),
    (SENSOR_WEDNESDAY, "Mittwoch", "mdi:calendar-text"),
    (SENSOR_THURSDAY, "Donnerstag", "mdi:calendar-text"),
    (SENSOR_FRIDAY, "Freitag", "mdi:calendar-text"),
]


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up School Schedule sensors based on a config entry."""
    coordinator: SchoolScheduleCoordinator = hass.data[DOMAIN][entry.entry_id]
    child_name = entry.data.get(CONF_CHILD_NAME, "")
    entities = [
        SchoolScheduleSensor(coordinator, sensor_type, child_name, display_name, icon)
        for sensor_type, display_name, icon in SENSOR_TYPES
    ]
    async_add_entities(entities)


class SchoolScheduleSensor(SchoolScheduleEntity, SensorEntity):
    """Representation of a School Schedule sensor."""

    def __init__(
        self,
        coordinator: SchoolScheduleCoordinator,
        sensor_type: str,
        child_name: str,
        display_name: str,
        icon: str,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, sensor_type, child_name)
        self._sensor_type = sensor_type
        self._attr_name = display_name
        self._attr_icon = icon
        self._attr_has_entity_name = True

    @property
    def native_value(self) -> int:
        """Return the number of lessons (excluding breaks) for this sensor's day."""
        lessons = self._get_lessons()
        return len([l for l in lessons if not l.get(CONF_IS_BREAK, False)])

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return detailed lesson attributes."""
        lessons = self._get_lessons()
        attrs: dict[str, Any] = {
            "child_name": self._child_name,
            "total_lessons": len([l for l in lessons if not l.get(CONF_IS_BREAK, False)]),
            "total_breaks": len([l for l in lessons if l.get(CONF_IS_BREAK, False)]),
            "lessons": [],
        }

        lesson_list = []
        for lesson in lessons:
            lesson_data = {
                "lesson_number": lesson.get(CONF_LESSON_NUMBER),
                "subject": lesson.get(CONF_SUBJECT, ""),
                "room": lesson.get(CONF_ROOM, ""),
                "teacher": lesson.get(CONF_TEACHER, ""),
                "start_time": lesson.get(CONF_START_TIME, ""),
                "end_time": lesson.get(CONF_END_TIME, ""),
                "color": lesson.get(CONF_COLOR, ""),
                "icon": lesson.get(CONF_ICON, ""),
                "is_break": lesson.get(CONF_IS_BREAK, False),
            }
            lesson_list.append(lesson_data)

        attrs["lessons"] = lesson_list
        attrs["weekday"] = self._get_weekday_name()

        # Find current/next lesson if today
        if self._sensor_type == SENSOR_TODAY:
            current = self._find_current_lesson(lessons)
            if current:
                attrs["current_lesson"] = current
            next_lesson = self._find_next_lesson(lessons)
            if next_lesson:
                attrs["next_lesson"] = next_lesson

        return attrs

    def _get_lessons(self) -> list[dict[str, Any]]:
        """Get lessons for this sensor's day from coordinator data."""
        data = self.coordinator.data
        if data is None:
            return []

        if self._sensor_type == SENSOR_TODAY:
            return data.get("today", [])
        elif self._sensor_type == SENSOR_TOMORROW:
            return data.get("tomorrow", [])
        else:
            # Map German sensor type to English weekday key used by coordinator
            day_map = {
                SENSOR_MONDAY: "monday",
                SENSOR_TUESDAY: "tuesday",
                SENSOR_WEDNESDAY: "wednesday",
                SENSOR_THURSDAY: "thursday",
                SENSOR_FRIDAY: "friday",
            }
            data_key = day_map.get(self._sensor_type, self._sensor_type)
            return data.get(data_key, [])

    def _get_weekday_name(self) -> str:
        """Get the weekday name for this sensor."""
        if self._sensor_type == SENSOR_TODAY:
            return self.coordinator.data.get("today_weekday", "") if self.coordinator.data else ""
        elif self._sensor_type == SENSOR_TOMORROW:
            return self.coordinator.data.get("tomorrow_weekday", "") if self.coordinator.data else ""
        else:
            # Return English weekday name
            day_map = {
                SENSOR_MONDAY: "monday",
                SENSOR_TUESDAY: "tuesday",
                SENSOR_WEDNESDAY: "wednesday",
                SENSOR_THURSDAY: "thursday",
                SENSOR_FRIDAY: "friday",
            }
            return day_map.get(self._sensor_type, self._sensor_type)

    def _strip_seconds(self, t: str) -> str:
        """Strip seconds from time string (HH:MM:SS -> HH:MM)."""
        if not t:
            return ""
        parts = t.split(":")
        return ":".join(parts[:2]) if len(parts) >= 2 else t

    @staticmethod
    def _time_to_minutes(t: str) -> int:
        """Convert HH:MM or HH:MM:SS to minutes since midnight."""
        parts = t.split(":")
        if len(parts) >= 2:
            return int(parts[0]) * 60 + int(parts[1])
        return 0

    def _find_current_lesson(self, lessons: list[dict[str, Any]]) -> dict[str, Any] | None:
        """Find the lesson happening right now (skips breaks)."""
        now = datetime.now()
        current_min = now.hour * 60 + now.minute
        for lesson in lessons:
            if lesson.get(CONF_IS_BREAK, False):
                continue
            start = self._strip_seconds(lesson.get(CONF_START_TIME, ""))
            end = self._strip_seconds(lesson.get(CONF_END_TIME, ""))
            if not start or not end:
                continue
            start_min = self._time_to_minutes(start)
            end_min = self._time_to_minutes(end)
            # Handle midnight crossover (e.g. 23:30 - 00:15)
            if end_min < start_min:
                end_min += 24 * 60
                if current_min < start_min:
                    current_check = current_min + 24 * 60
                else:
                    current_check = current_min
            else:
                current_check = current_min
            if start_min <= current_check <= end_min:
                return {
                    "lesson_number": lesson.get(CONF_LESSON_NUMBER),
                    "subject": lesson.get(CONF_SUBJECT, ""),
                    "room": lesson.get(CONF_ROOM, ""),
                    "teacher": lesson.get(CONF_TEACHER, ""),
                    "start_time": start,
                    "end_time": end,
                }
        return None

    def _find_next_lesson(self, lessons: list[dict[str, Any]]) -> dict[str, Any] | None:
        """Find the next upcoming lesson (skips breaks)."""
        now = datetime.now()
        current_min = now.hour * 60 + now.minute
        for lesson in lessons:
            if lesson.get(CONF_IS_BREAK, False):
                continue
            start = self._strip_seconds(lesson.get(CONF_START_TIME, ""))
            if not start:
                continue
            start_min = self._time_to_minutes(start)
            if start_min > current_min:
                return {
                    "lesson_number": lesson.get(CONF_LESSON_NUMBER),
                    "subject": lesson.get(CONF_SUBJECT, ""),
                    "room": lesson.get(CONF_ROOM, ""),
                    "teacher": lesson.get(CONF_TEACHER, ""),
                    "start_time": start,
                    "end_time": self._strip_seconds(lesson.get(CONF_END_TIME, "")),
                }
        return None