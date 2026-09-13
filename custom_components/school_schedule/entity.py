"""Base entity for School Schedule sensors."""
from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import SchoolScheduleCoordinator


class SchoolScheduleEntity(CoordinatorEntity):
    """Base entity for School Schedule."""

    def __init__(
        self,
        coordinator: SchoolScheduleCoordinator,
        sensor_type: str,
        child_name: str,
    ) -> None:
        """Initialize the entity."""
        super().__init__(coordinator)
        self._sensor_type = sensor_type
        self._child_name = child_name
        self._attr_unique_id = f"school_schedule_{child_name.lower()}_{sensor_type}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, f"school_schedule_{child_name.lower()}")},
            name=f"Stundenplan - {child_name}",
            manufacturer="School Schedule",
            model="Schedule Manager",
        )

    @property
    def suggested_object_id(self) -> str:
        """Deterministic entity IDs — no registry surprises (v2.5.1).

        Without this HA derives the object id from the device name at
        registration time, which produced inconsistent ids like
        ``binary_sensor.michelle_stundenplan_michelle_schulfrei`` for
        freshly added entities. With this override every entity is
        registered as ``stundenplan_<child>_<sensor_type>`` from day one.

        ⚠️ HA 2026.9.x (entity_id_parts naming): the suggested object id is
        treated as an ENTITY name part and gets prefixed with the area and
        device name again (AREA+DEVICE+ENTITY). The registry-verified way to
        get an unprefixed deterministic id is setting ``entity.entity_id``
        directly — done in ``_setup_deterministic_entity_id`` (v2.5.5).
        """
        return f"stundenplan_{self._child_name.lower()}_{self._sensor_type}"

    def add_to_platform_start(
        self,
        hass: HomeAssistant,
        platform: Any,
        parallel_updates: Any,
    ) -> None:
        """Set a deterministic entity_id before the platform derives one (v2.5.5).

        Called by the entity platform first thing when adding the entity
        (entity_platform.py: add_to_platform_start → … → reads entity.entity_id).

        Why: HA 2026.9.x derives entity IDs from name parts
        (area + device + entity). Our suggested_object_id property then lands
        as the ENTITY part and gets prefixed with the area and device name —
        the v2.5.4 calendar entity was registered as
        ``calendar.michelle_stundenplan_michelle_stundenplan_michelle_kalender``.

        Setting ``entity.entity_id`` here makes the platform take the id
        verbatim (``internal_integration_suggested_object_id`` — valid id +
        correct domain, so no deprecation warning; same mechanism exists in
        HA 2026.8.x). For entities already registered under our unique_id the
        registry lookup wins and this value is ignored — existing entity IDs
        are never touched by this.
        """
        super().add_to_platform_start(hass, platform, parallel_updates)
        try:
            self.entity_id = f"{platform.domain}.{self.suggested_object_id}"
        except Exception:  # noqa: BLE001 — defensive: never break setup
            pass

    @property
    def available(self) -> bool:
        """Return if entity is available."""
        return self.coordinator.last_update_success

    @callback
    def _handle_coordinator_update(self) -> None:
        """Handle updated data from the coordinator."""
        self.async_write_ha_state()