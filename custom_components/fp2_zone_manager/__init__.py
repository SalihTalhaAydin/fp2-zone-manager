"""FP2 Zone Manager — Presence-based light control for FP2 sensors."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import voluptuous as vol

from homeassistant.components import frontend, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_ON, STATE_OFF
from homeassistant.core import HomeAssistant, callback, Event
from homeassistant.helpers.event import async_track_state_change_event

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
PANEL_URL = "/fp2_zone_manager/panel.js"


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry
) -> bool:
    """Set up FP2 Zone Manager from a config entry."""
    # Serve frontend files
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                "/fp2_zone_manager",
                str(FRONTEND_PATH),
                cache_headers=False,
            )
        ]
    )

    # Register sidebar panel
    frontend.async_register_built_in_panel(
        hass,
        component_name="custom",
        sidebar_title="Zone Manager",
        sidebar_icon="mdi:motion-sensor",
        frontend_url_path="fp2-zones",
        config={
            "_panel_custom": {
                "name": "fp2-zone-manager-panel",
                "module_url": PANEL_URL,
            }
        },
        require_admin=False,
    )

    # Register WebSocket commands
    if "fp2_zone_manager_ws" not in hass.data:
        hass.data["fp2_zone_manager_ws"] = True
        websocket_api.async_register_command(
            hass,
            "fp2_zone_manager/zones/get",
            _ws_get_zones,
            _WS_GET_SCHEMA,
        )
        websocket_api.async_register_command(
            hass,
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
    """Save zone configs and reload the manager."""
    entries = hass.config_entries.async_entries(DOMAIN)
    if not entries:
        connection.send_error(
            msg["id"], "not_found", "No entry"
        )
        return
    entry = entries[0]
    hass.config_entries.async_update_entry(
        entry, data={CONF_ZONES: msg["zones"]}
    )
    # Reload the zone manager
    mgr = hass.data.get(DOMAIN, {}).get(entry.entry_id)
    if mgr:
        mgr.async_stop()
        hass.async_create_task(mgr.async_start())
    connection.send_result(msg["id"], {"success": True})


async def async_unload_entry(
    hass: HomeAssistant, entry: ConfigEntry
) -> bool:
    """Unload a config entry."""
    manager = hass.data[DOMAIN].pop(entry.entry_id, None)
    if manager:
        manager.async_stop()
    frontend.async_remove_panel(hass, "fp2-zones")
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
            _LOGGER.info("FP2 Zone Manager: No zones")
            return

        sensors = list(
            {zone[CONF_SENSOR] for zone in zones}
        )
        _LOGGER.info(
            "FP2 Zone Manager: %d sensors, %d zones",
            len(sensors), len(zones),
        )

        unsub = async_track_state_change_event(
            self.hass, sensors,
            self._handle_state_change,
        )
        self._unsub_listeners.append(unsub)

    @callback
    def async_stop(self) -> None:
        """Stop listeners and cancel timers."""
        for unsub in self._unsub_listeners:
            unsub()
        self._unsub_listeners.clear()
        for handle in self._pending_off.values():
            handle.cancel()
        self._pending_off.clear()

    @callback
    def _handle_state_change(self, event: Event) -> None:
        """Handle a sensor state change."""
        eid = event.data.get("entity_id")
        new_s = event.data.get("new_state")
        old_s = event.data.get("old_state")

        if not new_s or not old_s:
            return
        if new_s.state == old_s.state:
            return

        for zone in self._get_zones():
            if zone[CONF_SENSOR] != eid:
                continue
            if new_s.state == STATE_ON:
                self._handle_on(zone)
            elif new_s.state == STATE_OFF:
                self._handle_off(zone)

    @callback
    def _handle_on(self, zone: dict) -> None:
        """Presence detected — turn on."""
        key = self._key(zone)
        if key in self._pending_off:
            self._pending_off.pop(key).cancel()

        target = self._target(zone)
        _LOGGER.info("Presence ON: %s", key)
        self.hass.async_create_task(
            self.hass.services.async_call(
                "light", "turn_on", {}, target=target
            )
        )

    @callback
    def _handle_off(self, zone: dict) -> None:
        """Presence cleared — start delay."""
        key = self._key(zone)
        delay = zone.get(CONF_DELAY, DEFAULT_DELAY)

        if key in self._pending_off:
            self._pending_off.pop(key).cancel()

        self._pending_off[key] = (
            self.hass.loop.call_later(
                delay,
                lambda z=zone: self.hass.async_create_task(
                    self._check_off(z)
                ),
            )
        )

    async def _check_off(self, zone: dict) -> None:
        """Check group sensors clear, then turn off."""
        key = self._key(zone)
        self._pending_off.pop(key, None)

        group = zone.get(CONF_GROUP, "")
        if group:
            siblings = [
                z[CONF_SENSOR]
                for z in self._get_zones()
                if z.get(CONF_GROUP) == group
            ]
        else:
            siblings = [zone[CONF_SENSOR]]

        for sid in siblings:
            st = self.hass.states.get(sid)
            if st and st.state == STATE_ON:
                return

        _LOGGER.info("All clear: off %s", key)
        await self.hass.services.async_call(
            "light", "turn_off", {},
            target=self._target(zone),
        )

    def _target(self, zone: dict) -> dict:
        """Build service call target."""
        if zone[CONF_TARGET_TYPE] == TARGET_TYPE_AREA:
            return {"area_id": zone[CONF_TARGET_AREA]}
        return {
            "entity_id": zone.get(
                CONF_TARGET_ENTITIES, []
            )
        }

    def _key(self, zone: dict) -> str:
        """Unique key for zone target."""
        g = zone.get(CONF_GROUP, "")
        if g:
            return f"grp_{g}"
        if zone[CONF_TARGET_TYPE] == TARGET_TYPE_AREA:
            return f"area_{zone[CONF_TARGET_AREA]}"
        ents = zone.get(CONF_TARGET_ENTITIES, [])
        return "ents_" + "_".join(sorted(ents))
