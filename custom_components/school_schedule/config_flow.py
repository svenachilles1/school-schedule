"""Config flow for School Schedule integration."""
from __future__ import annotations

import logging
import re
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import selector

from .const import (
    CONF_CHILD_NAME,
    CONF_COLOR,
    CONF_END_TIME,
    CONF_ICON,
    CONF_IS_BREAK,
    CONF_APPLY_TO_ALL_DAYS,
    CONF_LESSON_NUMBER,
    CONF_LESSONS,
    CONF_ROOM,
    CONF_START_TIME,
    CONF_SUBJECT,
    CONF_TEACHER,
    CONF_WEEKDAY,
    DEFAULT_COLOR,
    DEFAULT_ICON,
    DEFAULT_BREAK_COLOR,
    DEFAULT_BREAK_ICON,
    DEFAULT_BREAK_SUBJECT,
    DOMAIN,
    WEEKDAYS,
)

_LOGGER = logging.getLogger(__name__)

# Time helper: strip seconds from TimeSelector output (HH:MM:SS -> HH:MM)
def _strip_seconds(value: Any) -> str:
    """Strip seconds from time string."""
    val = str(value).strip()
    if ":" in val:
        parts = val.split(":")
        if len(parts) >= 2:
            return f"{int(parts[0]):02d}:{int(parts[1]):02d}"
    return val


def _lesson_schema(defaults: dict[str, Any] | None = None) -> vol.Schema:
    """Return a schema for a single lesson entry using validated HA selectors."""
    defaults = defaults or {}
    return vol.Schema(
        {
            vol.Required(
                CONF_WEEKDAY, default=defaults.get(CONF_WEEKDAY, "monday")
            ): selector.SelectSelector(
                selector.SelectSelectorConfig(
                    options=[
                        selector.SelectOptionDict(value=day, label=day.capitalize())
                        for day in WEEKDAYS
                    ],
                    mode=selector.SelectSelectorMode.DROPDOWN,
                )
            ),
            vol.Required(
                CONF_LESSON_NUMBER, default=defaults.get(CONF_LESSON_NUMBER, 1)
            ): selector.NumberSelector(
                selector.NumberSelectorConfig(min=1, max=12, mode=selector.NumberSelectorMode.BOX)
            ),
            vol.Optional(
                CONF_SUBJECT, default=defaults.get(CONF_SUBJECT, "")
            ): selector.TextSelector(
                selector.TextSelectorConfig(type=selector.TextSelectorType.TEXT)
            ),
            vol.Optional(
                CONF_ROOM, default=defaults.get(CONF_ROOM, "")
            ): selector.TextSelector(
                selector.TextSelectorConfig(type=selector.TextSelectorType.TEXT)
            ),
            vol.Optional(
                CONF_TEACHER, default=defaults.get(CONF_TEACHER, "")
            ): selector.TextSelector(
                selector.TextSelectorConfig(type=selector.TextSelectorType.TEXT)
            ),
            vol.Required(
                CONF_START_TIME, default=defaults.get(CONF_START_TIME, "08:00")
            ): selector.TimeSelector(selector.TimeSelectorConfig()),
            vol.Required(
                CONF_END_TIME, default=defaults.get(CONF_END_TIME, "08:45")
            ): selector.TimeSelector(selector.TimeSelectorConfig()),
            vol.Optional(
                CONF_COLOR, default=defaults.get(CONF_COLOR, DEFAULT_COLOR)
            ): selector.TextSelector(
                selector.TextSelectorConfig(type=selector.TextSelectorType.TEXT)
            ),
            vol.Optional(
                CONF_ICON, default=defaults.get(CONF_ICON, DEFAULT_ICON)
            ): selector.IconSelector(selector.IconSelectorConfig()),
            vol.Optional(
                CONF_IS_BREAK, default=defaults.get(CONF_IS_BREAK, False)
            ): selector.BooleanSelector(selector.BooleanSelectorConfig()),
            vol.Optional(
                CONF_APPLY_TO_ALL_DAYS, default=defaults.get(CONF_APPLY_TO_ALL_DAYS, False)
            ): selector.BooleanSelector(selector.BooleanSelectorConfig()),
        }
    )


class SchoolScheduleConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for School Schedule."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the initial step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            child_name = user_input[CONF_CHILD_NAME].strip()
            if not child_name:
                errors[CONF_CHILD_NAME] = "name_required"
            else:
                await self.async_set_unique_id(f"school_schedule_{child_name.lower()}")
                self._abort_if_unique_id_configured()

                return self.async_create_entry(
                    title=f"Stundenplan - {child_name}",
                    data={
                        CONF_CHILD_NAME: child_name,
                        CONF_LESSONS: [],
                    },
                )

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_CHILD_NAME): selector.TextSelector(
                        selector.TextSelectorConfig(type=selector.TextSelectorType.TEXT)
                    ),
                }
            ),
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> config_entries.OptionsFlow:
        """Get the options flow for this handler."""
        return SchoolScheduleOptionsFlowHandler(config_entry)


class SchoolScheduleOptionsFlowHandler(config_entries.OptionsFlow):
    """Options flow for managing lessons."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        """Initialize options flow."""
        self._lessons: list[dict[str, Any]] = list(
            config_entry.data.get(CONF_LESSONS, [])
        )
        self._selected_lesson_index: int | None = None
        self._is_removing: bool = False

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Manage the schedule options."""
        if user_input is not None:
            action = user_input["action"]
            if action == "add":
                return await self.async_step_add_lesson()
            if action == "edit":
                self._is_removing = False
                return await self.async_step_select_lesson()
            if action == "remove":
                self._is_removing = True
                return await self.async_step_select_lesson()

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required("action"): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=[
                                selector.SelectOptionDict(value="add", label="Stunde hinzufuegen"),
                                selector.SelectOptionDict(value="edit", label="Stunde bearbeiten"),
                                selector.SelectOptionDict(value="remove", label="Stunde entfernen"),
                            ],
                            mode=selector.SelectSelectorMode.LIST,
                        )
                    ),
                }
            ),
            description_placeholders={
                "child_name": self.config_entry.data.get(CONF_CHILD_NAME, ""),
            },
        )

    async def async_step_add_lesson(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Add a new lesson."""
        errors: dict[str, str] = {}

        if user_input is not None:
            is_break = user_input.get(CONF_IS_BREAK, False)
            apply_to_all = user_input.get(CONF_APPLY_TO_ALL_DAYS, False)

            if not is_break and not user_input.get(CONF_SUBJECT):
                errors[CONF_SUBJECT] = "subject_required"
            else:
                user_input[CONF_START_TIME] = _strip_seconds(user_input[CONF_START_TIME])
                user_input[CONF_END_TIME] = _strip_seconds(user_input[CONF_END_TIME])

                if is_break:
                    if not user_input.get(CONF_SUBJECT):
                        user_input[CONF_SUBJECT] = DEFAULT_BREAK_SUBJECT
                    if not user_input.get(CONF_COLOR):
                        user_input[CONF_COLOR] = DEFAULT_BREAK_COLOR
                    if not user_input.get(CONF_ICON):
                        user_input[CONF_ICON] = DEFAULT_BREAK_ICON
                    user_input[CONF_ROOM] = ""
                    user_input[CONF_TEACHER] = ""

                if apply_to_all:
                    base_lesson = {k: v for k, v in user_input.items() if k != CONF_WEEKDAY}
                    for day in WEEKDAYS:
                        lesson = {**base_lesson, CONF_WEEKDAY: day}
                        self._lessons.append(lesson)
                else:
                    self._lessons.append(user_input)

                self._sort_lessons()
                return await self._save_lessons()

        return self.async_show_form(
            step_id="add_lesson",
            data_schema=_lesson_schema(user_input),
            errors=errors,
        )

    async def async_step_select_lesson(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Select a lesson to edit or remove."""
        if not self._lessons:
            return self.async_abort(reason="no_lessons")

        if user_input is not None:
            idx = int(user_input["lesson_index"])
            if self._is_removing:
                self._lessons.pop(idx)
                return await self._save_lessons()

            self._selected_lesson_index = idx
            return await self.async_step_edit_lesson()

        options = [
            selector.SelectOptionDict(
                value=str(i),
                label=f"{lesson[CONF_WEEKDAY].capitalize()} - {lesson[CONF_LESSON_NUMBER]}. Std: {lesson[CONF_SUBJECT]}",
            )
            for i, lesson in enumerate(self._lessons)
        ]

        return self.async_show_form(
            step_id="select_lesson",
            data_schema=vol.Schema(
                {
                    vol.Required("lesson_index"): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=options,
                            mode=selector.SelectSelectorMode.DROPDOWN,
                        )
                    ),
                }
            ),
        )

    async def async_step_edit_lesson(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Edit an existing lesson."""
        if self._selected_lesson_index is None or self._selected_lesson_index >= len(self._lessons):
            return await self.async_step_init()

        errors: dict[str, str] = {}
        lesson = self._lessons[self._selected_lesson_index]

        if user_input is not None:
            is_break = user_input.get(CONF_IS_BREAK, False)
            if not is_break and not user_input.get(CONF_SUBJECT):
                errors[CONF_SUBJECT] = "subject_required"
            else:
                if is_break:
                    if not user_input.get(CONF_SUBJECT):
                        user_input[CONF_SUBJECT] = DEFAULT_BREAK_SUBJECT
                    if not user_input.get(CONF_COLOR):
                        user_input[CONF_COLOR] = DEFAULT_BREAK_COLOR
                    if not user_input.get(CONF_ICON):
                        user_input[CONF_ICON] = DEFAULT_BREAK_ICON
                    user_input[CONF_ROOM] = ""
                    user_input[CONF_TEACHER] = ""
                user_input[CONF_START_TIME] = _strip_seconds(user_input[CONF_START_TIME])
                user_input[CONF_END_TIME] = _strip_seconds(user_input[CONF_END_TIME])
                self._lessons[self._selected_lesson_index] = user_input
                self._sort_lessons()
                return await self._save_lessons()

        return self.async_show_form(
            step_id="edit_lesson",
            data_schema=_lesson_schema(user_input or lesson),
            errors=errors,
        )

    def _sort_lessons(self) -> None:
        """Sort lessons chronologically by weekday and lesson number."""
        self._lessons.sort(
            key=lambda l: (
                WEEKDAYS.index(l[CONF_WEEKDAY]) if l[CONF_WEEKDAY] in WEEKDAYS else 99,
                l[CONF_LESSON_NUMBER],
            )
        )

    async def _save_lessons(self) -> FlowResult:
        """Save lessons to the config entry and update coordinator."""
        new_data = {**self.config_entry.data, CONF_LESSONS: self._lessons}
        # NOTE: reload_on_update was removed in HA 2026.8.x — do NOT pass it.
        self.hass.config_entries.async_update_entry(
            self.config_entry, data=new_data
        )
        # Update coordinator directly instead of reloading the integration
        from .coordinator import SchoolScheduleCoordinator
        coordinator = self.hass.data.get(DOMAIN, {}).get(self.config_entry.entry_id)
        if coordinator and isinstance(coordinator, SchoolScheduleCoordinator):
            coordinator.lessons = list(self._lessons)
            coordinator.async_set_updated_data(coordinator._build_schedule_data())
        return self.async_create_entry(title="", data={})