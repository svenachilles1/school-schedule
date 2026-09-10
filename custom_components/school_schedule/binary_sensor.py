"""Binary sensor platform for School Schedule integration.

One binary sensor per child: ``binary_sensor.stundenplan_<kind>_schulfrei``

Semantics (deterministic, automation-ready):
- ``on``  = no school today (vacation OR public holiday OR weekend)
- ``off`` = regular school day

Attributes expose the complete picture for dashboards and automations:
today_status, today_reason, tomorrow_status, tomorrow_reason,
next_school_day, next_vacation, next_public_holiday.
"""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    BSENSOR_SCHULFREI,
    CONF_CHILD_NAME,
    DOMAIN,
)
from .coordinator import SchoolScheduleCoordinator
from .entity import SchoolScheduleEntity

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up School Schedule binary sensors based on a config entry."""
    coordinator: SchoolScheduleCoordinator = hass.data[DOMAIN][entry.entry_id]
    child_name = entry.data.get(CONF_CHILD_NAME, "")
    async_add_entities([SchoolFreeBinarySensor(coordinator, child_name)])


class SchoolFreeBinarySensor(SchoolScheduleEntity, BinarySensorEntity):
    """Binary sensor that is on when today is school-free for this child.

    Semantics (High-End, fully deterministic):
    - on = vacation OR public holiday OR weekend — "no school today"
    - off = regular school day
    - Attributes expose the full picture: today_status, tomorrow_status,
      next_school_day, next_vacation, next_public_holiday, reason.
    """

    _attr_device_class = None
    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: SchoolScheduleCoordinator,
        child_name: str,
    ) -> None:
        """Initialize the binary sensor."""
        super().__init__(coordinator, BSENSOR_SCHULFREI, child_name)
        self._child_name = child_name
        self._attr_name = "Schulfrei"
        self._attr_icon = "mdi:school-outline"

    @property
    def is_on(self) -> bool | None:
        """Return True if today is school-free."""
        data = self.coordinator.data
        if data is None:
            return None
        return data.get("today_school_free", False)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Expose the complete holiday picture as attributes."""
        data = self.coordinator.data
        if data is None:
            return {"child_name": self._child_name}
        attrs: dict[str, Any] = {
            "child_name": self._child_name,
            "federal_state": data.get("federal_state", ""),
        }
        for key in (
            "today_status",
            "today_reason",
            "tomorrow_status",
            "tomorrow_reason",
            "next_school_day",
            "next_vacation",
            "next_public_holiday",
            "holidays_count",
            "holidays_last_updated",
        ):
            if key in data:
                attrs[key] = data[key]
        return attrs