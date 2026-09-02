"""Constants for the School Schedule integration."""
from __future__ import annotations

from typing import Final

# Integration domain
DOMAIN: Final[str] = "school_schedule"

# Platform types
PLATFORMS: Final[list[str]] = ["sensor"]

# Configuration data fields
CONF_CHILD_NAME: Final[str] = "child_name"
CONF_LESSONS: Final[str] = "lessons"

# Lesson fields
CONF_WEEKDAY: Final[str] = "weekday"
CONF_LESSON_NUMBER: Final[str] = "lesson_number"
CONF_SUBJECT: Final[str] = "subject"
CONF_ROOM: Final[str] = "room"
CONF_TEACHER: Final[str] = "teacher"
CONF_START_TIME: Final[str] = "start_time"
CONF_END_TIME: Final[str] = "end_time"
CONF_COLOR: Final[str] = "color"
CONF_ICON: Final[str] = "icon"
CONF_IS_BREAK: Final[str] = "is_break"
CONF_APPLY_TO_ALL_DAYS: Final[str] = "apply_to_all_days"

# Service names
SERVICE_ADD_LESSON: Final[str] = "add_lesson"
SERVICE_REMOVE_LESSON: Final[str] = "remove_lesson"
SERVICE_UPDATE_LESSON: Final[str] = "update_lesson"
SERVICE_GET_SCHEDULE: Final[str] = "get_schedule"

# Service fields
ATTR_CHILD_NAME: Final[str] = "child_name"
ATTR_WEEKDAY: Final[str] = "weekday"
ATTR_LESSON_NUMBER: Final[str] = "lesson_number"
ATTR_SUBJECT: Final[str] = "subject"
ATTR_ROOM: Final[str] = "room"
ATTR_TEACHER: Final[str] = "teacher"
ATTR_START_TIME: Final[str] = "start_time"
ATTR_END_TIME: Final[str] = "end_time"
ATTR_COLOR: Final[str] = "color"
ATTR_ICON: Final[str] = "icon"
ATTR_LESSONS: Final[str] = "lessons"
ATTR_IS_BREAK: Final[str] = "is_break"
ATTR_APPLY_TO_ALL_DAYS: Final[str] = "apply_to_all_days"

# Weekdays
WEEKDAYS: Final[list[str]] = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
]

WEEKDAY_MAP: Final[dict[str, int]] = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
}

# Sensor types
SENSOR_TODAY: Final[str] = "heute"
SENSOR_TOMORROW: Final[str] = "morgen"
SENSOR_MONDAY: Final[str] = "montag"
SENSOR_TUESDAY: Final[str] = "dienstag"
SENSOR_WEDNESDAY: Final[str] = "mittwoch"
SENSOR_THURSDAY: Final[str] = "donnerstag"
SENSOR_FRIDAY: Final[str] = "freitag"

# Default values
DEFAULT_COLOR: Final[str] = "#44739e"
DEFAULT_ICON: Final[str] = "mdi:school"
DEFAULT_BREAK_COLOR: Final[str] = "#7a8a99"
DEFAULT_BREAK_ICON: Final[str] = "mdi:coffee"
DEFAULT_BREAK_SUBJECT: Final[str] = "Pause"

# Update interval
UPDATE_INTERVAL_MINUTES: Final[int] = 15

# Weekday translation keys
WEEKDAY_TRANSLATION_KEYS: Final[dict[str, str]] = {
    "monday": "weekday_monday",
    "tuesday": "weekday_tuesday",
    "wednesday": "weekday_wednesday",
    "thursday": "weekday_thursday",
    "friday": "weekday_friday",
}