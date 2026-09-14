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
    CONF_COLOR, CONF_ICON, CONF_IS_BREAK, CONF_APPLY_TO_ALL_DAYS,
    CONF_FEDERAL_STATE, FEDERAL_STATES,
    WEEKDAYS, DEFAULT_COLOR, DEFAULT_ICON,
    DEFAULT_BREAK_COLOR, DEFAULT_BREAK_ICON, DEFAULT_BREAK_SUBJECT,
    SERVICE_ADD_LESSON, SERVICE_REMOVE_LESSON, SERVICE_UPDATE_LESSON, SERVICE_GET_SCHEDULE,
    SERVICE_SET_FEDERAL_STATE,
)
from .coordinator import SchoolScheduleCoordinator
from .card_resource import async_setup_card_resource
from .holidays import federal_state_from_entry, release_holidays_coordinator
from .lesson_logic import slot_taken

_LOGGER = logging.getLogger(__name__)

ADD_LESSON_SCHEMA = vol.Schema({
    vol.Required("child_name"): cv.string,
    vol.Required("weekday"): vol.In(WEEKDAYS),
    vol.Required("lesson_number"): vol.Coerce(int),
    vol.Optional("subject"): cv.string,
    vol.Optional("room", default=""): cv.string,
    vol.Optional("teacher", default=""): cv.string,
    vol.Required("start_time"): cv.string,
    vol.Required("end_time"): cv.string,
    vol.Optional("color", default=DEFAULT_COLOR): cv.string,
    vol.Optional("icon", default=DEFAULT_ICON): cv.string,
    vol.Optional("is_break", default=False): cv.boolean,
    vol.Optional("apply_to_all_days", default=False): cv.boolean,
})

REMOVE_LESSON_SCHEMA = vol.Schema({
    vol.Required("child_name"): cv.string,
    vol.Required("weekday"): vol.In(WEEKDAYS),
    vol.Required("lesson_number"): vol.Coerce(int),
    vol.Optional("lesson_uid", default=None): vol.Any(None, cv.string),
})

UPDATE_LESSON_SCHEMA = vol.Schema({
    vol.Required("child_name"): cv.string,
    vol.Required("weekday"): vol.In(WEEKDAYS),
    vol.Required("lesson_number"): vol.Coerce(int),
    vol.Optional("lesson_uid", default=None): vol.Any(None, cv.string),
    vol.Optional("subject"): cv.string,
    vol.Optional("room"): cv.string,
    vol.Optional("teacher"): cv.string,
    vol.Optional("start_time"): cv.string,
    vol.Optional("end_time"): cv.string,
    vol.Optional("color"): cv.string,
    vol.Optional("icon"): cv.string,
    vol.Optional("is_break"): cv.boolean,
})

GET_SCHEDULE_SCHEMA = vol.Schema({
    vol.Required("child_name"): cv.string,
    vol.Optional("weekday"): vol.In(WEEKDAYS),
})

SET_FEDERAL_STATE_SCHEMA = vol.Schema({
    vol.Required("child_name"): cv.string,
    vol.Required("federal_state"): vol.In(FEDERAL_STATES),
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

    # Register the bundled Lovelace card as a dashboard resource (auto-setup)
    try:
        await async_setup_card_resource(hass)
    except Exception:  # noqa: BLE001 — card registration must never block setup
        _LOGGER.exception("Failed to set up School Schedule card resource")

    # Set up platforms (sensors)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Register services inline
    if not hass.services.has_service(DOMAIN, SERVICE_ADD_LESSON):
        async def handle_add_lesson(call: ServiceCall) -> None:
            """Handle add_lesson service call."""
            child_name = call.data["child_name"]
            _LOGGER.info("add_lesson called for %s", child_name)
            coordinator = _find_coordinator(hass, child_name)

            is_break = call.data.get("is_break", False)
            apply_to_all = call.data.get("apply_to_all_days", False)

            if is_break:
                subject = call.data.get("subject", "") or DEFAULT_BREAK_SUBJECT
                color = call.data.get("color", DEFAULT_BREAK_COLOR)
                icon = call.data.get("icon", DEFAULT_BREAK_ICON)
            else:
                subject = call.data.get("subject", "")
                if not subject:
                    raise HomeAssistantError("subject is required for non-break lessons")
                color = call.data.get("color", DEFAULT_COLOR)
                icon = call.data.get("icon", DEFAULT_ICON)

            base_lesson = {
                "lesson_number": call.data["lesson_number"],
                "subject": subject,
                "room": call.data.get("room", "") if not is_break else "",
                "teacher": call.data.get("teacher", "") if not is_break else "",
                "start_time": call.data["start_time"],
                "end_time": call.data["end_time"],
                "color": color,
                "icon": icon,
                "is_break": is_break,
            }

            if apply_to_all:
                blocked = [
                    day
                    for day in WEEKDAYS
                    if slot_taken(coordinator.lessons, day, call.data["lesson_number"])
                ]
                if blocked:
                    raise HomeAssistantError(
                        f"Lesson number {call.data['lesson_number']} is already taken on: {', '.join(blocked)}"
                    )
                for day in WEEKDAYS:
                    lesson = {**base_lesson, "weekday": day}
                    success = await coordinator.add_lesson(lesson)
                    _LOGGER.info("add_lesson (all days, %s) result: %s", day, success)
            else:
                if slot_taken(coordinator.lessons, call.data["weekday"], call.data["lesson_number"]):
                    raise HomeAssistantError(
                        f"Lesson {call.data['weekday']} #{call.data['lesson_number']} already exists — edit it instead"
                    )
                lesson = {**base_lesson, "weekday": call.data["weekday"]}
                try:
                    success = await coordinator.add_lesson(lesson)
                except ValueError as err:
                    raise HomeAssistantError(str(err)) from err
                _LOGGER.info("add_lesson result: %s", success)
                if not success:
                    raise HomeAssistantError("Failed to add lesson")

        async def handle_remove_lesson(call: ServiceCall) -> None:
            """Handle remove_lesson service call."""
            child_name = call.data["child_name"]
            coordinator = _find_coordinator(hass, child_name)
            success = await coordinator.remove_lesson(
                call.data["weekday"],
                call.data["lesson_number"],
                lesson_uid=call.data.get("lesson_uid"),
            )
            if not success:
                raise HomeAssistantError(f"Lesson not found")

        async def handle_update_lesson(call: ServiceCall) -> None:
            """Handle update_lesson service call."""
            child_name = call.data["child_name"]
            coordinator = _find_coordinator(hass, child_name)
            updates = {}
            for field in ["subject", "room", "teacher", "start_time", "end_time", "color", "icon", "is_break"]:
                if field in call.data:
                    updates[field] = call.data[field]
            success = await coordinator.update_lesson(
                call.data["weekday"],
                call.data["lesson_number"],
                updates,
                lesson_uid=call.data.get("lesson_uid"),
            )
            if not success:
                raise HomeAssistantError(f"Lesson not found")

        async def handle_get_schedule(call: ServiceCall) -> None:
            """Handle get_schedule service call."""
            child_name = call.data["child_name"]
            coordinator = _find_coordinator(hass, child_name)
            schedule = coordinator.get_schedule(call.data.get("weekday"))
            _LOGGER.info("Schedule for %s: %s", child_name, schedule)

        async def handle_set_federal_state(call: ServiceCall) -> None:
            """Handle set_federal_state service call."""
            child_name = call.data["child_name"]
            federal_state = call.data["federal_state"]
            coordinator = _find_coordinator(hass, child_name)
            old_state = federal_state_from_entry(coordinator.entry)
            _LOGGER.info(
                "set_federal_state called: %s %s -> %s",
                child_name, old_state, federal_state,
            )

            # Persist into the config entry (no reload — reload_on_update
            # no longer exists in HA 2026.8.x anyway).
            new_data = {**coordinator.entry.data, CONF_FEDERAL_STATE: federal_state}
            hass.config_entries.async_update_entry(
                coordinator.entry, data=new_data
            )
            coordinator._refresh_entry_ref()

            # Re-bind the entry to the (possibly different) shared coordinator.
            from .holidays import get_holidays_coordinator
            if federal_state != old_state:
                # Release the reference to the old state's coordinator first
                # (otherwise its refcount leaks until the next HA restart).
                release_holidays_coordinator(hass, old_state)
            coordinator.holidays = get_holidays_coordinator(hass, federal_state)
            coordinator.holidays.async_setup_with_entry(coordinator.entry)
            # Force a fresh fetch so the new state's data is available
            # immediately (falls back to empty cache gracefully if offline).
            await coordinator.holidays.async_ensure_current(force=True)
            if coordinator.holidays.dirty:
                coordinator.holidays.persist_into(coordinator.entry)
                coordinator.holidays.dirty = False
                coordinator._refresh_entry_ref()
            coordinator.async_set_updated_data(coordinator._build_schedule_data())
            _LOGGER.info(
                "Federal state for %s is now %s", child_name, federal_state
            )

        hass.services.async_register(DOMAIN, SERVICE_ADD_LESSON, handle_add_lesson, schema=ADD_LESSON_SCHEMA)
        hass.services.async_register(DOMAIN, SERVICE_REMOVE_LESSON, handle_remove_lesson, schema=REMOVE_LESSON_SCHEMA)
        hass.services.async_register(DOMAIN, SERVICE_UPDATE_LESSON, handle_update_lesson, schema=UPDATE_LESSON_SCHEMA)
        hass.services.async_register(DOMAIN, SERVICE_GET_SCHEDULE, handle_get_schedule, schema=GET_SCHEDULE_SCHEMA)
        hass.services.async_register(DOMAIN, SERVICE_SET_FEDERAL_STATE, handle_set_federal_state, schema=SET_FEDERAL_STATE_SCHEMA)
        _LOGGER.info("School Schedule services registered")

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    _LOGGER.info("Unloading School Schedule for %s", entry.data.get("child_name", "unknown"))

    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

    if unload_ok:
        # Release the shared holiday coordinator reference BEFORE popping
        # the entry from hass.data (release reads hass.data[DOMAIN]).
        coordinator = hass.data.get(DOMAIN, {}).get(entry.entry_id)
        if isinstance(coordinator, SchoolScheduleCoordinator):
            release_holidays_coordinator(hass, coordinator.holidays.federal_state)
        hass.data[DOMAIN].pop(entry.entry_id, None)
        # Only count real coordinators — the dict also holds housekeeping
        # keys (_card_resource_setup_done, holidays) that must not keep
        # the services alive after the last child was unloaded.
        remaining = [
            v for v in hass.data[DOMAIN].values()
            if isinstance(v, SchoolScheduleCoordinator)
        ]
        if not remaining:
            for service in [SERVICE_ADD_LESSON, SERVICE_REMOVE_LESSON, SERVICE_UPDATE_LESSON, SERVICE_GET_SCHEDULE, SERVICE_SET_FEDERAL_STATE]:
                if hass.services.has_service(DOMAIN, service):
                    hass.services.async_remove(DOMAIN, service)

    return unload_ok