"""Automatic Lovelace card resource registration for School Schedule.

The integration ships its Lovelace card inside the integration directory
(``custom_components/school_schedule/school-schedule-card.js``) — which HACS
keeps up to date automatically. This module serves that file via a static
HTTP path and registers (or migrates) the Lovelace dashboard resource on
integration setup, following the pattern established by browser_mod.

Benefits:
- No manual copy of the card JS to ``<config>/www/`` needed.
- No manual dashboard resource registration needed.
- Version parameter in the resource URL busts the browser cache
  whenever HACS updates the integration.
- Existing manual resources (``/local/school-schedule-card.js``) are
  migrated to the new URL automatically.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from homeassistant.components.http import StaticPathConfig
from homeassistant.components.lovelace.resources import ResourceStorageCollection
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

from .const import (
    CARD_FILE_NAME,
    CARD_URL_BASE,
    DOMAIN,
    LEGACY_CARD_URL_BASE,
)

_LOGGER = logging.getLogger(__name__)


def _read_version() -> str:
    """Read the integration version from manifest.json."""
    try:
        manifest = Path(__file__).parent / "manifest.json"
        return str(json.loads(manifest.read_text(encoding="utf-8")).get("version", "0"))
    except (OSError, ValueError) as err:
        _LOGGER.warning("Could not read manifest.json: %s", err)
        return "0"


def _card_file_exists(card_path: str) -> bool:
    """Check if the card file exists on disk."""
    return Path(card_path).is_file()


async def async_setup_card_resource(hass: HomeAssistant) -> bool:
    """Serve the bundled card JS and register the Lovelace resource.

    Returns True if the resource is available (registered or already present).
    Safe to call once per config entry — the actual work runs only once per
    Home Assistant start (multiple children share one card resource).
    """
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get("_card_resource_setup_done"):
        _LOGGER.debug("Card resource already set up — skipping")
        return True

    card_path = hass.config.path("custom_components", DOMAIN, CARD_FILE_NAME)
    version = await hass.async_add_executor_job(_read_version)

    if not await hass.async_add_executor_job(_card_file_exists, card_path):
        _LOGGER.error(
            "School Schedule card file not found at %s — "
            "Lovelace resource not registered", card_path,
        )
        return False

    # Serve the card directly from the integration directory.
    await hass.http.async_register_static_paths(
        [StaticPathConfig(CARD_URL_BASE, card_path, True)]
    )

    resource_url = f"{CARD_URL_BASE}?v={version}"

    lovelace_data = hass.data.get("lovelace")
    resources = getattr(lovelace_data, "resources", None) if lovelace_data else None
    if resources is None:
        _LOGGER.warning(
            "Lovelace resources collection not available — "
            "School Schedule card resource not registered"
        )
        return False

    if not getattr(resources, "loaded", True):
        await resources.async_load()
        resources.loaded = True

    existing: dict[str, Any] | None = None
    for item in resources.async_items():
        url = str(item.get("url", ""))
        if url.startswith(CARD_URL_BASE) or url.startswith(LEGACY_CARD_URL_BASE):
            existing = item
            break

    try:
        if existing is None:
            if isinstance(resources, ResourceStorageCollection):
                await resources.async_create_item(
                    {"res_type": "module", "url": resource_url}
                )
                _LOGGER.info(
                    "Registered Lovelace resource for School Schedule card: %s",
                    resource_url,
                )
            elif getattr(resources, "data", None) is not None and hasattr(
                resources.data, "append"
            ):
                # YAML mode — can only add for this session.
                resources.data.append({"type": "module", "url": resource_url})
                _LOGGER.warning(
                    "Lovelace is in YAML mode — added the School Schedule card "
                    "resource for this session only. To make it permanent, add "
                    "this to your lovelace resources in configuration.yaml: "
                    "{url: %s, type: module}",
                    resource_url,
                )
        elif existing.get("url") != resource_url:
            if isinstance(resources, ResourceStorageCollection):
                await resources.async_update_item(
                    existing["id"], {"res_type": "module", "url": resource_url}
                )
                _LOGGER.info(
                    "Migrated School Schedule card resource to %s", resource_url
                )
            else:
                # YAML mode — best effort, reverts on restart.
                existing["url"] = resource_url
                _LOGGER.warning(
                    "Lovelace is in YAML mode — updated the School Schedule card "
                    "resource for this session only. Adjust your lovelace "
                    "resources in configuration.yaml to match: %s",
                    resource_url,
                )
        else:
            _LOGGER.debug(
                "School Schedule card resource already up to date: %s",
                resource_url,
            )
    except HomeAssistantError as err:
        _LOGGER.error("Failed to register School Schedule card resource: %s", err)
        return False

    domain_data["_card_resource_setup_done"] = True
    return True