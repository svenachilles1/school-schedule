"""Services for the School Schedule integration."""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv

from .const import (
    ATTR_CHILD_NAME,
    ATTR_WEEKDAY,
    ATTR_LESSON_NUMBER,
    ATTR_SUBJECT,
    ATTR_ROOM,
    ATTR_TEACHER,
    ATTR_START_TIME,
    ATTR_END_TIME,
    ATTR_COLOR,
    ATTR_ICON,
    ATTR_IS_BREAK,
    CONF_CHILD_NAME,
    DOMAIN,
    SERVICE_ADD_LESSON,
    SERVICE_REMOVE_LESSON,
    SERVICE_UPDATE_LESSON,
    SERVICE_GET_SCHEDULE,
    WEEKDAYS,
    DEFAULT_COLOR,
    DEFAULT_ICON,
)
from .coordinator import SchoolScheduleCoordinator

_LOGGER = logging.getLogger(__name__)

ADD_LESSON_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_CHILD_NAME): cv.string,
        vol.Required(ATTR_WEEKDAY): vol.In(WEEKDAYS),
        vol.Required(ATTR_LESSON_NUMBER): vol.Coerce(int),
        vol.Required(ATTR_SUBJECT): cv.string,
        vol.Optional(ATTR_ROOM, default=""): cv.string,
        vol.Optional(ATTR_TEACHER, default=""): cv.string,
        vol.Required(ATTR_START_TIME): cv.string,
        vol.Required(ATTR_END_TIME): cv.string,
        vol.Optional(ATTR_COLOR, default=DEFAULT_COLOR): cv.string,
        vol.Optional(ATTR_ICON, default=DEFAULT_ICON): cv.string,
        vol.Optional(ATTR_IS_BREAK, default=False): cv.boolean,
    }
)

REMOVE_LESSON_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_CHILD_NAME): cv.string,
        vol.Required(ATTR_WEEKDAY): vol.In(WEEKDAYS),
        vol.Required(ATTR_LESSON_NUMBER): vol.Coerce(int),
    }
)

UPDATE_LESSON_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_CHILD_NAME): cv.string,
        vol.Required(ATTR_WEEKDAY): vol.In(WEEKDAYS),
        vol.Required(ATTR_LESSON_NUMBER): vol.Coerce(int),
        vol.Optional(ATTR_SUBJECT): cv.string,
        vol.Optional(ATTR_ROOM): cv.string,
        vol.Optional(ATTR_TEACHER): cv.string,
        vol.Optional(ATTR_START_TIME): cv.string,
        vol.Optional(ATTR_END_TIME): cv.string,
        vol.Optional(ATTR_COLOR): cv.string,
        vol.Optional(ATTR_ICON): cv.string,
        vol.Optional(ATTR_IS_BREAK): cv.boolean,
    }
)

GET_SCHEDULE_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_CHILD_NAME): cv.string,
        vol.Optional(ATTR_WEEKDAY): vol.In(WEEKDAYS),
    }
)


def _find_coordinator(hass: HomeAssistant, child_name: str) -> SchoolScheduleCoordinator:
    """Find the coordinator for a given child name."""
    for entry_id, coordinator in hass.data[DOMAIN].items():
        if isinstance(coordinator, SchoolScheduleCoordinator):
            if coordinator.child_name.lower() == child_name.lower():
                return coordinator
    raise HomeAssistantError(
        f"No school schedule found for child '{child_name}'"
    )


@callback
def async_setup_services(hass: HomeAssistant) -> None:
    """Set up services for School Schedule."""

    async def handle_add_lesson(call: ServiceCall) -> None:
        """Handle add_lesson service call."""
        child_name = call.data[ATTR_CHILD_NAME]
        coordinator = _find_coordinator(hass, child_name)

        lesson = {
            "weekday": call.data[ATTR_WEEKDAY],
            "lesson_number": call.data[ATTR_LESSON_NUMBER],
            "subject": call.data[ATTR_SUBJECT],
            "room": call.data.get(ATTR_ROOM, ""),
            "teacher": call.data.get(ATTR_TEACHER, ""),
            "start_time": call.data[ATTR_START_TIME],
            "end_time": call.data[ATTR_END_TIME],
            "color": call.data.get(ATTR_COLOR, DEFAULT_COLOR),
            "icon": call.data.get(ATTR_ICON, DEFAULT_ICON),
            "is_break": call.data.get(ATTR_IS_BREAK, False),
        }

        success = await coordinator.add_lesson(lesson)
        if not success:
            raise HomeAssistantError("Failed to add lesson")

    async def handle_remove_lesson(call: ServiceCall) -> None:
        """Handle remove_lesson service call."""
        child_name = call.data[ATTR_CHILD_NAME]
        coordinator = _find_coordinator(hass, child_name)

        weekday = call.data[ATTR_WEEKDAY]
        lesson_number = call.data[ATTR_LESSON_NUMBER]

        success = await coordinator.remove_lesson(weekday, lesson_number)
        if not success:
            raise HomeAssistantError(
                f"Lesson {weekday} #{lesson_number} not found"
            )

    async def handle_update_lesson(call: ServiceCall) -> None:
        """Handle update_lesson service call."""
        child_name = call.data[ATTR_CHILD_NAME]
        coordinator = _find_coordinator(hass, child_name)

        weekday = call.data[ATTR_WEEKDAY]
        lesson_number = call.data[ATTR_LESSON_NUMBER]

        updates = {}
        for field in [ATTR_SUBJECT, ATTR_ROOM, ATTR_TEACHER, ATTR_START_TIME, ATTR_END_TIME, ATTR_COLOR, ATTR_ICON, ATTR_IS_BREAK]:
            if field in call.data:
                key = field
                updates[key] = call.data[field]

        success = await coordinator.update_lesson(weekday, lesson_number, updates)
        if not success:
            raise HomeAssistantError(
                f"Lesson {weekday} #{lesson_number} not found"
            )

    async def handle_get_schedule(call: ServiceCall) -> None:
        """Handle get_schedule service call."""
        child_name = call.data[ATTR_CHILD_NAME]
        coordinator = _find_coordinator(hass, child_name)

        weekday = call.data.get(ATTR_WEEKDAY)
        schedule = coordinator.get_schedule(weekday)
        _LOGGER.info("Schedule for %s: %s", child_name, schedule)

    hass.services.async_register(
        DOMAIN, SERVICE_ADD_LESSON, handle_add_lesson, schema=ADD_LESSON_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_REMOVE_LESSON, handle_remove_lesson, schema=REMOVE_LESSON_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_UPDATE_LESSON, handle_update_lesson, schema=UPDATE_LESSON_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_GET_SCHEDULE, handle_get_schedule, schema=GET_SCHEDULE_SCHEMA
    )


@callback
def async_unload_services(hass: HomeAssistant) -> None:
    """Unload School Schedule services."""
    for service in [SERVICE_ADD_LESSON, SERVICE_REMOVE_LESSON, SERVICE_UPDATE_LESSON, SERVICE_GET_SCHEDULE]:
        if hass.services.has_service(DOMAIN, service):
            hass.services.async_remove(DOMAIN, service)