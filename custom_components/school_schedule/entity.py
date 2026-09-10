"""Base entity for School Schedule sensors."""
from __future__ import annotations

from homeassistant.core import callback
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
        """Deterministic entity IDs — no registry surprises.

        Without this HA derives the object id from the device name at
        registration time, which produced inconsistent ids like
        ``binary_sensor.michelle_stundenplan_michelle_schulfrei`` for
        freshly added entities. With this override every entity is
        registered as ``stundenplan_<child>_<sensor_type>`` from day one.
        """
        return f"stundenplan_{self._child_name.lower()}_{self._sensor_type}"

    @property
    def available(self) -> bool:
        """Return if entity is available."""
        return self.coordinator.last_update_success

    @callback
    def _handle_coordinator_update(self) -> None:
        """Handle updated data from the coordinator."""
        self.async_write_ha_state()