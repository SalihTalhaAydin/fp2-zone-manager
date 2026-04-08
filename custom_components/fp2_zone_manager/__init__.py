"""FP2 Zone Manager — Presence-based light control for FP2 sensors."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_ON, STATE_OFF
from homeassistant.core import HomeAssistant, callback, Event
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.components.http import StaticPathConfig

from .const import (
    DOMAIN,
    CONF_SENSOR,
    CONF_TARGET_TYPE,
    CONF_TARGET_AREA,
    CONF_TARGET_ENTITIES,
    CONF_GROUP,
    CONF_DELAY,
    CONF_ZONES,
    TARGET_TYPE_AREA,
    DEFAULT_DELAY,
)

_LOGGER = logging.getLogger(__name__)

FRONTEND_PATH = Path(__file__).parent / "frontend"
CARD_URL = "/fp2_zone_manager/fp2-zone-manager-card.js"


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry
) -> bool:
    """Set up FP2 Zone Manager from a config entry."""
    # Serve the frontend card JS
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                "/fp2_zone_manager",
                str(FRONTEND_PATH),
                cache_headers=False,
            )
        ]
    )

    # Register WebSocket command for saving zones
    if "fp2_zone_manager_ws" not in hass.data:
        hass.data["fp2_zone_manager_ws"] = True
        hass.components.websocket_api.async_register_command(
            "fp2_zone_manager/zones/get",
            _ws_get_zones,
            _WS_GET_SCHEMA,
        )
        hass.components.websocket_api.async_register_command(
            "fp2_zone_manager/zones/set",
            _ws_set_zones,
            _WS_SET_SCHEMA,
        )

    manager = ZoneManager(hass, entry)
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = manager
    await manager.async_start()

    entry.async_on_unload(
        entry.add_update_listener(_async_update_listener)
    )
    return True


import voluptuous as vol
from homeassistant.components import websocket_api

_WS_GET_SCHEMA = websocket_api.BASE_COMMAND_MESSAGE_SCHEMA.extend(
    {vol.Required("type"): "fp2_zone_manager/zones/get"}
)

_WS_SET_SCHEMA = websocket_api.BASE_COMMAND_MESSAGE_SCHEMA.extend(
    {
        vol.Required("type"): "fp2_zone_manager/zones/set",
        vol.Required("zones"): list,
    }
)


@callback
def _ws_get_zones(hass, connection, msg):
    """Return all zone configs."""
    entries = hass.config_entries.async_entries(DOMAIN)
    zones = []
    entry_id = None
    if entries:
        entry_id = entries[0].entry_id
        zones = entries[0].data.get(CONF_ZONES, [])
    connection.send_result(
        msg["id"], {"zones": zones, "entry_id": entry_id}
    )


@callback
def _ws_set_zones(hass, connection, msg):
    """Save zone configs."""
    entries = hass.config_entries.async_entries(DOMAIN)
    if not entries:
        connection.send_error(msg["id"], "not_found", "")
        return
    entry = entries[0]
    hass.config_entries.async_update_entry(
        entry, data={CONF_ZONES: msg["zones"]}
    )
    connection.send_result(msg["id"], {"success": True})


async def async_unload_entry(
    hass: HomeAssistant, entry: ConfigEntry
) -> bool:
    """Unload a config entry."""
    manager = hass.data[DOMAIN].pop(entry.entry_id, None)
    if manager:
        manager.async_stop()
    return True


async def _async_update_listener(
    hass: HomeAssistant, entry: ConfigEntry
) -> None:
    """Handle config entry updates."""
    manager = hass.data[DOMAIN].get(entry.entry_id)
    if manager:
        manager.async_stop()
        await manager.async_start()


class ZoneManager:
    """Manages all FP2 zone-to-light mappings."""

    def __init__(
        self, hass: HomeAssistant, entry: ConfigEntry
    ) -> None:
        """Initialize the zone manager."""
        self.hass = hass
        self.entry = entry
        self._unsub_listeners: list[callback] = []
        self._pending_off: dict[str, asyncio.TimerHandle] = {}

    def _get_zones(self) -> list[dict]:
        """Get zone config from entry data."""
        return self.entry.data.get(CONF_ZONES, [])

    async def async_start(self) -> None:
        """Start listening to all configured sensors."""
        zones = self._get_zones()
        if not zones:
            _LOGGER.info("FP2 Zone Manager: No zones configured")
            return

        sensors = list(
            {zone[CONF_SENSOR] for zone in zones}
        )
        _LOGGER.info(
            "FP2 Zone Manager: %d sensors, %d zones",
            len(sensors),
            len(zones),
        )

        unsub = async_track_state_change_event(
            self.hass,
            sensors,
            self._handle_state_change,
        )
        self._unsub_listeners.append(unsub)

    @callback
    def async_stop(self) -> None:
        """Stop listeners and cancel pending timers."""
        for unsub in self._unsub_listeners:
            unsub()
        self._unsub_listeners.clear()

        for handle in self._pending_off.values():
            handle.cancel()
        self._pending_off.clear()

    @callback
    def _handle_state_change(self, event: Event) -> None:
        """Handle a sensor state change."""
        entity_id = event.data.get("entity_id")
        new_state = event.data.get("new_state")
        old_state = event.data.get("old_state")

        if new_state is None or old_state is None:
            return
        if new_state.state == old_state.state:
            return

        zones = self._get_zones()
        matching = [
            z for z in zones
            if z[CONF_SENSOR] == entity_id
        ]

        for zone in matching:
            if new_state.state == STATE_ON:
                self._handle_presence_on(zone)
            elif new_state.state == STATE_OFF:
                self._handle_presence_off(zone)

    @callback
    def _handle_presence_on(self, zone: dict) -> None:
        """Presence detected — turn on immediately."""
        key = self._get_target_key(zone)

        if key in self._pending_off:
            self._pending_off[key].cancel()
            del self._pending_off[key]

        target = self._build_target(zone)
        _LOGGER.info("Presence ON: %s", key)
        self.hass.async_create_task(
            self.hass.services.async_call(
                "light", "turn_on", {}, target=target
            )
        )

    @callback
    def _handle_presence_off(self, zone: dict) -> None:
        """Presence cleared — start delay timer."""
        key = self._get_target_key(zone)
        delay = zone.get(CONF_DELAY, DEFAULT_DELAY)

        if key in self._pending_off:
            self._pending_off[key].cancel()

        _LOGGER.debug("Presence OFF: %s, %ds", key, delay)

        self._pending_off[key] = (
            self.hass.loop.call_later(
                delay,
                lambda z=zone: self.hass.async_create_task(
                    self._async_check_and_turn_off(z)
                ),
            )
        )

    async def _async_check_and_turn_off(
        self, zone: dict
    ) -> None:
        """Check all group sensors clear, then turn off."""
        key = self._get_target_key(zone)
        self._pending_off.pop(key, None)

        group = zone.get(CONF_GROUP, "")
        zones = self._get_zones()

        if group:
            siblings = [
                z[CONF_SENSOR]
                for z in zones
                if z.get(CONF_GROUP) == group
            ]
        else:
            siblings = [zone[CONF_SENSOR]]

        for sid in siblings:
            state = self.hass.states.get(sid)
            if state and state.state == STATE_ON:
                _LOGGER.debug(
                    "Skip off %s — %s active", key, sid
                )
                return

        _LOGGER.info("All clear: off %s", key)
        target = self._build_target(zone)
        await self.hass.services.async_call(
            "light", "turn_off", {}, target=target
        )

    def _build_target(self, zone: dict) -> dict:
        """Build service call target."""
        if zone[CONF_TARGET_TYPE] == TARGET_TYPE_AREA:
            return {"area_id": zone[CONF_TARGET_AREA]}
        return {
            "entity_id": zone.get(
                CONF_TARGET_ENTITIES, []
            )
        }

    def _get_target_key(self, zone: dict) -> str:
        """Get unique key for zone target."""
        group = zone.get(CONF_GROUP, "")
        if group:
            return f"group_{group}"
        if zone[CONF_TARGET_TYPE] == TARGET_TYPE_AREA:
            return f"area_{zone[CONF_TARGET_AREA]}"
        ents = zone.get(CONF_TARGET_ENTITIES, [])
        return "ents_" + "_".join(sorted(ents))
