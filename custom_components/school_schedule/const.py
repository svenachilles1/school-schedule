"""Constants for the School Schedule integration."""
from __future__ import annotations

from typing import Final

# Integration domain
DOMAIN: Final[str] = "school_schedule"

# Platform types
# Platform list — async_forward_entry_setups uses this (see __init__.py).
# calendar platform added in v2.5.4: one calendar entity per child,
# events generated on the fly from the lesson list.
PLATFORMS: Final[list[str]] = ["sensor", "binary_sensor", "calendar"]

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

# Lovelace card resource
CARD_FILE_NAME: Final[str] = "school-schedule-card.js"
CARD_URL_BASE: Final[str] = "/school_schedule.js"
LEGACY_CARD_URL_BASE: Final[str] = "/local/school-schedule-card.js"

# Weekday translation keys
WEEKDAY_TRANSLATION_KEYS: Final[dict[str, str]] = {
    "monday": "weekday_monday",
    "tuesday": "weekday_tuesday",
    "wednesday": "weekday_wednesday",
    "thursday": "weekday_thursday",
    "friday": "weekday_friday",
}

# ─── Holidays / school-free days (v2.5.0) ─────────────────────────────
CONF_FEDERAL_STATE: Final[str] = "federal_state"
CONF_HOLIDAYS: Final[str] = "holidays"          # cached API payload in entry data
CONF_HOLIDAYS_UPDATED_AT: Final[str] = "holidays_updated_at"

DEFAULT_FEDERAL_STATE: Final[str] = "thueringen"

# mehr-schulferien.de API v2.1
API_BASE_URL: Final[str] = "https://www.mehr-schulferien.de/api/v2.1"
API_TIMEOUT_SECONDS: Final[int] = 15

# German federal states (matching the card's slug list)
FEDERAL_STATES: Final[dict[str, str]] = {
    "baden-wuerttemberg": "Baden-Württemberg",
    "bayern": "Bayern",
    "berlin": "Berlin",
    "brandenburg": "Brandenburg",
    "bremen": "Bremen",
    "hamburg": "Hamburg",
    "hessen": "Hessen",
    "mecklenburg-vorpommern": "Mecklenburg-Vorpommern",
    "niedersachsen": "Niedersachsen",
    "nordrhein-westfalen": "Nordrhein-Westfalen",
    "rheinland-pfalz": "Rheinland-Pfalz",
    "saarland": "Saarland",
    "sachsen": "Sachsen",
    "sachsen-anhalt": "Sachsen-Anhalt",
    "schleswig-holstein": "Schleswig-Holstein",
    "thueringen": "Thüringen",
}

# Service names (holidays)
SERVICE_SET_FEDERAL_STATE: Final[str] = "set_federal_state"

# Service fields (holidays)
ATTR_FEDERAL_STATE: Final[str] = "federal_state"

# Day status values
STATUS_SCHOOL_DAY: Final[str] = "school_day"
STATUS_VACATION: Final[str] = "vacation"
STATUS_PUBLIC_HOLIDAY: Final[str] = "public_holiday"
STATUS_WEEKEND: Final[str] = "weekend"

# Binary sensor types
BSENSOR_SCHULFREI: Final[str] = "schulfrei"

# Holiday refresh interval (API cache in entry data, refreshed by coordinator)
HOLIDAY_REFRESH_HOURS: Final[int] = 24