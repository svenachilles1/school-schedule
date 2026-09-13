"""Calendar platform for School Schedule — one calendar per child.

The calendar generates events on the fly from the lesson list: every
lesson and break becomes an event on its weekday (repeating weekly),
school-free days are skipped (vacation > public holiday > weekend, same
priority as the binary sensor). Nothing is stored — the config entry
lessons are the single source of truth.

Use cases:
- Native automations: "Stunde startet in X min", "Morgen Schule ja/nein"
- Calendar cards in dashboards, calendar-based automations
- The evening bag-packing reminder (backlog #2) fires only when there
  really is school tomorrow.

Event details:
- summary: subject as entered by the user
- description: teacher (if set)
- location: room (if set)
- uid: deterministic ss-<weekday>-<date>-<lesson_number> for stable identity
- Times are tz-aware local datetimes (HA dt_util), 'HH:MM' and legacy
  'HH:MM:SS' entries are both accepted (calendar_logic.parse_hhmm).
"""
from __future__ import annotations

import logging
from datetime import datetime

from homeassistant.components.calendar import (
    CalendarEntity,
    CalendarEvent,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import CONF_CHILD_NAME, DOMAIN
from .coordinator import SchoolScheduleCoordinator
from .entity import SchoolScheduleEntity
from .calendar_logic import build_events, next_upcoming_event

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the School Schedule calendar entity for this child."""
    coordinator: SchoolScheduleCoordinator = hass.data[DOMAIN][entry.entry_id]
    child_name = entry.data.get(CONF_CHILD_NAME, "")
    async_add_entities([SchoolScheduleCalendar(coordinator, child_name)])
    _LOGGER.info("Calendar entity set up for %s", child_name)


class SchoolScheduleCalendar(SchoolScheduleEntity, CalendarEntity):
    """Read-only calendar entity, one per child.

    State = the current or next lesson (local_calendar semantics: an
    event that is running counts as THE event; the state shows 'off'
    once it ends and no further lesson follows today or on the next
    school day). Read-only by design — lessons are managed via the
    integration's services and the card, not via calendar writes.
    """

    _attr_has_entity_name = True
    _attr_icon = "mdi:calendar-month"

    def __init__(
        self,
        coordinator: SchoolScheduleCoordinator,
        child_name: str,
    ) -> None:
        """Initialize the calendar entity."""
        super().__init__(coordinator, "kalender", child_name)
        self._child_name = child_name
        self._attr_name = "Kalender"

    @property
    def event(self) -> CalendarEvent | None:
        """Current or next lesson as CalendarEvent (drives entity state)."""
        data = self.coordinator.data
        if data is None or not self.coordinator.lessons:
            return None
        now = dt_util.now()
        upcoming = next_upcoming_event(
            self.coordinator.lessons,
            self.coordinator.holidays.periods,
            now,
        )
        if upcoming is None:
            return None
        return self._to_calendar_event(upcoming)

    async def async_get_events(
        self,
        hass: HomeAssistant,
        start_date: datetime,
        end_date: datetime,
    ) -> list[CalendarEvent]:
        """All events overlapping the requested window (exact datetime trim)."""
        start_local = dt_util.as_local(start_date)
        end_local = dt_util.as_local(end_date)
        tz = start_local.tzinfo

        events = build_events(
            self.coordinator.lessons,
            self.coordinator.holidays.periods,
            start_local.date(),
            end_local.date(),
            tz,
        )
        # Exact overlap trim at datetime granularity (mirrors
        # local_calendar's timeline.overlapping semantics): the day-range
        # build above may include events on the boundary day that start
        # after an exclusive end timestamp.
        return [
            self._to_calendar_event(e)
            for e in events
            if e["end"] > start_local and e["start"] < end_local
        ]

    @staticmethod
    def _to_calendar_event(e: dict) -> CalendarEvent:
        """Wrap an event dict from calendar_logic into a CalendarEvent."""
        return CalendarEvent(
            start=e["start"],
            end=e["end"],
            summary=e["summary"],
            description=e.get("description"),
            location=e.get("location"),
            uid=e.get("uid"),
        )