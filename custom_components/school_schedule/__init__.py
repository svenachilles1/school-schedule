"""The School Schedule integration."""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv

from .const import (
    DOMAIN, PLATFORMS, CONF_CHILD_NAME, CONF_LESSONS,
    CONF_WEEKDAY, CONF_LESSON_NUMBER, CONF_SUBJECT,
    CONF_ROOM, CONF_TEACHER, CONF_START_TIME, CONF_END_TIME,
    CONF_COLOR, CONF_ICON, WEEKDAYS, DEFAULT_COLOR, DEFAULT_ICON,
    SERVICE_ADD_LESSON, SERVICE_REMOVE_LESSON, SERVICE_UPDATE_LESSON, SERVICE_GET_SCHEDULE,
)
from .coordinator import SchoolScheduleCoordinator

_LOGGER = logging.getLogger(__name__)

ADD_LESSON_SCHEMA = vol.Schema({
    vol.Required("child_name"): cv.string,
    vol.Required("weekday"): vol.In(WEEKDAYS),
    vol.Required("lesson_number"): vol.Coerce(int),
    vol.Required("subject"): cv.string,
    vol.Optional("room", default=""): cv.string,
    vol.Optional("teacher", default=""): cv.string,
    vol.Required("start_time"): cv.string,
    vol.Required("end_time"): cv.string,
    vol.Optional("color", default=DEFAULT_COLOR): cv.string,
    vol.Optional("icon", default=DEFAULT_ICON): cv.string,
})

REMOVE_LESSON_SCHEMA = vol.Schema({
    vol.Required("child_name"): cv.string,
    vol.Required("weekday"): vol.In(WEEKDAYS),
    vol.Required("lesson_number"): vol.Coerce(int),
})

UPDATE_LESSON_SCHEMA = vol.Schema({
    vol.Required("child_name"): cv.string,
    vol.Required("weekday"): vol.In(WEEKDAYS),
    vol.Required("lesson_number"): vol.Coerce(int),
    vol.Optional("subject"): cv.string,
    vol.Optional("room"): cv.string,
    vol.Optional("teacher"): cv.string,
    vol.Optional("start_time"): cv.string,
    vol.Optional("end_time"): cv.string,
    vol.Optional("color"): cv.string,
    vol.Optional("icon"): cv.string,
})

GET_SCHEDULE_SCHEMA = vol.Schema({
    vol.Required("child_name"): cv.string,
    vol.Optional("weekday"): vol.In(WEEKDAYS),
})


def _find_coordinator(hass: HomeAssistant, child_name: str) -> SchoolScheduleCoordinator:
    """Find the coordinator for a given child name."""
    _LOGGER.info("Looking for coordinator for child '%s' in %s", child_name, list(hass.data.get(DOMAIN, {}).keys()))
    for entry_id, coordinator in hass.data.get(DOMAIN, {}).items():
        if isinstance(coordinator, SchoolScheduleCoordinator):
            _LOGGER.info("Found coordinator: child='%s' vs '%s'", coordinator.child_name, child_name)
            if coordinator.child_name.lower() == child_name.lower():
                return coordinator
    raise HomeAssistantError(f"No school schedule found for child '{child_name}'. Available: {[c.child_name for c in hass.data.get(DOMAIN, {}).values() if isinstance(c, SchoolScheduleCoordinator)]}")


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up School Schedule from a config entry."""
    _LOGGER.info("Setting up School Schedule for %s (entry_id=%s)", entry.data.get("child_name", "unknown"), entry.entry_id)

    coordinator = SchoolScheduleCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = coordinator

    # Set up platforms (sensors)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Register services inline
    if not hass.services.has_service(DOMAIN, SERVICE_ADD_LESSON):
        async def handle_add_lesson(call: ServiceCall) -> None:
            """Handle add_lesson service call."""
            child_name = call.data["child_name"]
            _LOGGER.info("add_lesson called for %s", child_name)
            coordinator = _find_coordinator(hass, child_name)

            lesson = {
                "weekday": call.data["weekday"],
                "lesson_number": call.data["lesson_number"],
                "subject": call.data["subject"],
                "room": call.data.get("room", ""),
                "teacher": call.data.get("teacher", ""),
                "start_time": call.data["start_time"],
                "end_time": call.data["end_time"],
                "color": call.data.get("color", DEFAULT_COLOR),
                "icon": call.data.get("icon", DEFAULT_ICON),
            }

            success = await coordinator.add_lesson(lesson)
            _LOGGER.info("add_lesson result: %s", success)
            if not success:
                raise HomeAssistantError("Failed to add lesson")

        async def handle_remove_lesson(call: ServiceCall) -> None:
            """Handle remove_lesson service call."""
            child_name = call.data["child_name"]
            coordinator = _find_coordinator(hass, child_name)
            success = await coordinator.remove_lesson(call.data["weekday"], call.data["lesson_number"])
            if not success:
                raise HomeAssistantError(f"Lesson not found")

        async def handle_update_lesson(call: ServiceCall) -> None:
            """Handle update_lesson service call."""
            child_name = call.data["child_name"]
            coordinator = _find_coordinator(hass, child_name)
            updates = {}
            for field in ["subject", "room", "teacher", "start_time", "end_time", "color", "icon"]:
                if field in call.data:
                    updates[field] = call.data[field]
            success = await coordinator.update_lesson(call.data["weekday"], call.data["lesson_number"], updates)
            if not success:
                raise HomeAssistantError(f"Lesson not found")

        async def handle_get_schedule(call: ServiceCall) -> None:
            """Handle get_schedule service call."""
            child_name = call.data["child_name"]
            coordinator = _find_coordinator(hass, child_name)
            schedule = coordinator.get_schedule(call.data.get("weekday"))
            _LOGGER.info("Schedule for %s: %s", child_name, schedule)

        hass.services.async_register(DOMAIN, SERVICE_ADD_LESSON, handle_add_lesson, schema=ADD_LESSON_SCHEMA)
        hass.services.async_register(DOMAIN, SERVICE_REMOVE_LESSON, handle_remove_lesson, schema=REMOVE_LESSON_SCHEMA)
        hass.services.async_register(DOMAIN, SERVICE_UPDATE_LESSON, handle_update_lesson, schema=UPDATE_LESSON_SCHEMA)
        hass.services.async_register(DOMAIN, SERVICE_GET_SCHEDULE, handle_get_schedule, schema=GET_SCHEDULE_SCHEMA)
        _LOGGER.info("School Schedule services registered")

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    _LOGGER.info("Unloading School Schedule for %s", entry.data.get("child_name", "unknown"))

    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
        if not hass.data[DOMAIN]:
            for service in [SERVICE_ADD_LESSON, SERVICE_REMOVE_LESSON, SERVICE_UPDATE_LESSON, SERVICE_GET_SCHEDULE]:
                if hass.services.has_service(DOMAIN, service):
                    hass.services.async_remove(DOMAIN, service)

    return unload_ok