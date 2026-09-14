"""Shared holiday data coordinator for the School Schedule integration.

One instance per federal state — all children in the same state share a
single API fetch (all children in one state = 1 request). The fetched
periods are cached in each config entry's data so they survive restarts
and keep working during network outages. A shared-coordinator pattern in
``hass.data[DOMAIN]["holidays"]["<slug>"]`` prevents parallel config
entries from racing at HA startup (same lesson as the card resource
guard — parallel setups, one shared resource).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import (
    API_BASE_URL,
    API_TIMEOUT_SECONDS,
    CONF_FEDERAL_STATE,
    CONF_HOLIDAYS,
    CONF_HOLIDAYS_UPDATED_AT,
    DEFAULT_FEDERAL_STATE,
    DOMAIN,
    HOLIDAY_REFRESH_HOURS,
)
from .holiday_logic import parse_periods

_LOGGER = logging.getLogger(__name__)

HOLIDAYS_DATA_KEY = "holidays"


def get_holidays_coordinator(
    hass: HomeAssistant, federal_state: str
) -> "SharedHolidaysCoordinator":
    """Return the shared coordinator for a federal state (creating it on first call).

    Synchronous and side-effect-free on subsequent calls — safe to invoke
    from parallel config entry setups without an await in between.
    Each call takes a reference; release with ``release_holidays_coordinator``
    when the owning config entry is unloaded.
    """
    domain_data = hass.data.setdefault(DOMAIN, {})
    holidays_data = domain_data.setdefault(HOLIDAYS_DATA_KEY, {})
    ref_key = f"_refcount_{federal_state}"
    coordinator = holidays_data.get(federal_state)
    if coordinator is None:
        coordinator = SharedHolidaysCoordinator(hass, federal_state)
        holidays_data[federal_state] = coordinator
    holidays_data[ref_key] = int(holidays_data.get(ref_key, 0)) + 1
    return coordinator


def release_holidays_coordinator(hass: HomeAssistant, federal_state: str) -> None:
    """Release one reference; drop the shared coordinator when the last is gone."""
    domain_data = hass.data.get(DOMAIN, {})
    holidays_data = domain_data.get(HOLIDAYS_DATA_KEY)
    if holidays_data is None:
        return
    ref_key = f"_refcount_{federal_state}"
    count = int(holidays_data.get(ref_key, 0)) - 1
    if count > 0:
        holidays_data[ref_key] = count
        return
    holidays_data.pop(ref_key, None)
    holidays_data.pop(federal_state, None)


class SharedHolidaysCoordinator:
    """Fetches and caches holiday data for one federal state.

    This is deliberately NOT a DataUpdateCoordinator: there is nothing to
    poll per-entity. Instead the SchoolScheduleCoordinator pulls fresh
    data through ``async_ensure_current()`` on its own 15-minute tick
    (at most once per 24 h), which then pushes updates to all listeners.
    """

    def __init__(self, hass: HomeAssistant, federal_state: str) -> None:
        """Initialize."""
        self._hass = hass
        self._federal_state = federal_state
        # periods: list of normalised dicts (holiday_logic.parse_periods)
        self.periods: list[dict[str, Any]] = []
        self.last_update_success = True
        self._last_fetch_success_at: datetime | None = None
        # True after a fresh fetch that has not yet been persisted into the
        # config entries — the SchoolScheduleCoordinator persists on its tick.
        self.dirty: bool = False
        # Serialises concurrent async_ensure_current calls (both children's
        # 15-minute ticks can overlap) — second caller reaps the first
        # caller's fetch instead of firing a duplicate API request.
        self._fetch_lock: asyncio.Lock = asyncio.Lock()

    @property
    def federal_state(self) -> str:
        """Return the federal state slug."""
        return self._federal_state

    @property
    def last_updated_at(self) -> str:
        """Return the ISO timestamp of the last successful fetch."""
        return (
            self._last_fetch_success_at.isoformat()
            if self._last_fetch_success_at
            else ""
        )

    def async_setup_with_entry(self, entry: ConfigEntry) -> None:
        """Seed the coordinator from a config entry's cached holiday data."""
        cached = entry.data.get(CONF_HOLIDAYS, [])
        if cached and not self.periods:
            self.periods = parse_periods(cached)
            _LOGGER.debug(
                "Seeded %d holiday periods for %s from entry cache",
                len(self.periods),
                self._federal_state,
            )

    async def async_ensure_current(self, force: bool = False) -> bool:
        """Fetch fresh data if the cache is stale (older than HOLIDAY_REFRESH_HOURS).

        Returns True if data is current (either freshly fetched or cache
        still fresh), False if the API is unreachable AND no cache exists.
        Concurrency-safe: overlapping calls serialise on the fetch lock —
        the second caller re-checks freshness inside the lock and reuses
        the first caller's fetch.
        """
        if self._is_fresh() and not force:
            return True
        async with self._fetch_lock:
            # Re-check inside the lock: another caller may have just fetched.
            if self._is_fresh() and not force:
                return True
            if self.periods and not force:
                # have data, just stale — refresh but keep serving on failure
                try:
                    await self._async_fetch()
                    return True
                except Exception:  # noqa: BLE001
                    _LOGGER.warning(
                        "Holiday refresh failed for %s — serving cached data",
                        self._federal_state,
                    )
                    return True
            # no usable cache → must fetch; failure is fatal here
            try:
                await self._async_fetch()
                return True
            except Exception as err:  # noqa: BLE001
                _LOGGER.error("Holiday fetch failed for %s: %s", self._federal_state, err)
                self.last_update_success = False
                return False

    def _is_fresh(self) -> bool:
        """Return True if the last successful fetch is younger than the refresh interval."""
        now = datetime.now()
        return (
            self._last_fetch_success_at is not None
            and (now - self._last_fetch_success_at).total_seconds()
            < HOLIDAY_REFRESH_HOURS * 3600
        )

    async def _async_fetch(self) -> None:
        """Fetch periods from mehr-schulferien.de API v2.1 (single request).

        NOTE: the API ignores the ``year`` parameter and always returns
        the current + following year — one request is all we need (the
        card's multi-year bug fixed in v2.4.3/v2.4.4 must not return here).
        """
        import asyncio
        import json

        session = async_get_clientsession(self._hass)
        url = f"{API_BASE_URL}/federal-states/{self._federal_state}/periods"
        async with asyncio.timeout(API_TIMEOUT_SECONDS):
            resp = await session.get(url)
            resp.raise_for_status()
            payload = await resp.json(content_type=None)

        raw_periods = payload.get("data", [])
        if not isinstance(raw_periods, list) or not raw_periods:
            raise ValueError(f"Unexpected API payload for {self._federal_state}")
        self.periods = parse_periods(raw_periods)
        self._last_fetch_success_at = datetime.now()
        self.last_update_success = True
        self.dirty = True
        _LOGGER.info(
            "Fetched %d holiday periods for %s",
            len(self.periods),
            self._federal_state,
        )

    def persist_into(self, entry: ConfigEntry) -> None:
        """Serialize periods into a config entry for restart persistence.

        Dates are converted to ISO strings so the data is JSON-serializable
        for config entry storage.
        """
        serialized = [
            {
                "name": p["name"],
                "starts_on": p["starts_on"].isoformat(),
                "ends_on": p["ends_on"].isoformat(),
                "is_public_holiday": p["is_public_holiday"],
                "is_school_vacation": p["is_school_vacation"],
            }
            for p in self.periods
        ]
        new_data = {
            **entry.data,
            CONF_HOLIDAYS: serialized,
            CONF_HOLIDAYS_UPDATED_AT: (self._last_fetch_success_at or datetime.now()).isoformat(),
        }
        # reload_on_update was removed in HA 2026.8.x — do NOT pass it.
        self._hass.config_entries.async_update_entry(entry, data=new_data)


def federal_state_from_entry(entry: ConfigEntry) -> str:
    """Return the configured federal state for an entry (default Thüringen)."""
    return str(entry.data.get(CONF_FEDERAL_STATE, DEFAULT_FEDERAL_STATE))