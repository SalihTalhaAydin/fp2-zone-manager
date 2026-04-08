"""FP2 Zone Manager — Presence-based light control."""

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
from homeassistant.helpers.event import (
    async_track_state_change_event,
)

from .const import (
    DOMAIN, CONF_SENSORS, CONF_TARGET_AREAS,
    CONF_TARGET_ENTITIES, CONF_GROUP, CONF_DELAY,
    CONF_ZONES, DEFAULT_DELAY,
)

_LOGGER = logging.getLogger(__name__)
FE = Path(__file__).parent / "frontend"


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry
) -> bool:
    """Set up FP2 Zone Manager."""
    await hass.http.async_register_static_paths(
        [StaticPathConfig(
            "/fp2_zone_manager", str(FE),
            cache_headers=False,
        )]
    )

    frontend.async_register_built_in_panel(
        hass,
        component_name="custom",
        sidebar_title="Zone Manager",
        sidebar_icon="mdi:motion-sensor",
        frontend_url_path="fp2-zones",
        config={"_panel_custom": {
            "name": "fp2-zone-manager-panel",
            "module_url": "/fp2_zone_manager/panel.js",
        }},
        require_admin=False,
    )

    if "fp2_zm_ws" not in hass.data:
        hass.data["fp2_zm_ws"] = True
        websocket_api.async_register_command(
            hass, "fp2_zone_manager/zones/get",
            _ws_get, _WS_GET,
        )
        websocket_api.async_register_command(
            hass, "fp2_zone_manager/zones/set",
            _ws_set, _WS_SET,
        )

    mgr = ZoneManager(hass, entry)
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = mgr
    await mgr.async_start()
    entry.async_on_unload(
        entry.add_update_listener(_on_update)
    )
    return True


_WS_GET = websocket_api.BASE_COMMAND_MESSAGE_SCHEMA.extend(
    {vol.Required("type"): "fp2_zone_manager/zones/get"}
)
_WS_SET = websocket_api.BASE_COMMAND_MESSAGE_SCHEMA.extend(
    {
        vol.Required("type"): "fp2_zone_manager/zones/set",
        vol.Required("zones"): list,
    }
)


@callback
def _ws_get(hass, conn, msg):
    entries = hass.config_entries.async_entries(DOMAIN)
    zones, eid = [], None
    if entries:
        eid = entries[0].entry_id
        zones = entries[0].data.get(CONF_ZONES, [])
    conn.send_result(msg["id"], {
        "zones": zones, "entry_id": eid,
    })


@callback
def _ws_set(hass, conn, msg):
    entries = hass.config_entries.async_entries(DOMAIN)
    if not entries:
        conn.send_error(msg["id"], "not_found", "")
        return
    entry = entries[0]
    hass.config_entries.async_update_entry(
        entry, data={CONF_ZONES: msg["zones"]}
    )
    mgr = hass.data.get(DOMAIN, {}).get(entry.entry_id)
    if mgr:
        mgr.async_stop()
        hass.async_create_task(mgr.async_start())
    conn.send_result(msg["id"], {"success": True})


async def async_unload_entry(
    hass: HomeAssistant, entry: ConfigEntry
) -> bool:
    mgr = hass.data[DOMAIN].pop(entry.entry_id, None)
    if mgr:
        mgr.async_stop()
    frontend.async_remove_panel(hass, "fp2-zones")
    return True


async def _on_update(
    hass: HomeAssistant, entry: ConfigEntry
) -> None:
    mgr = hass.data[DOMAIN].get(entry.entry_id)
    if mgr:
        mgr.async_stop()
        await mgr.async_start()


class ZoneManager:
    """Manages FP2 zone-to-light mappings."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry):
        self.hass = hass
        self.entry = entry
        self._unsubs: list = []
        self._timers: dict[str, asyncio.TimerHandle] = {}

    def _zones(self) -> list[dict]:
        return self.entry.data.get(CONF_ZONES, [])

    async def async_start(self):
        zones = self._zones()
        if not zones:
            return
        # Collect ALL sensors from all zones
        sensors = set()
        for z in zones:
            for s in z.get(CONF_SENSORS, []):
                sensors.add(s)
        if not sensors:
            return
        _LOGGER.info(
            "FP2 ZM: %d sensors, %d zones",
            len(sensors), len(zones),
        )
        self._unsubs.append(
            async_track_state_change_event(
                self.hass, list(sensors),
                self._on_change,
            )
        )

    @callback
    def async_stop(self):
        for u in self._unsubs:
            u()
        self._unsubs.clear()
        for t in self._timers.values():
            t.cancel()
        self._timers.clear()

    @callback
    def _on_change(self, event: Event):
        eid = event.data["entity_id"]
        ns = event.data.get("new_state")
        os = event.data.get("old_state")
        if not ns or not os or ns.state == os.state:
            return
        for z in self._zones():
            if eid not in z.get(CONF_SENSORS, []):
                continue
            if ns.state == STATE_ON:
                self._turn_on(z)
            elif ns.state == STATE_OFF:
                self._schedule_off(z)

    @callback
    def _turn_on(self, z: dict):
        key = self._key(z)
        if key in self._timers:
            self._timers.pop(key).cancel()
        _LOGGER.info("ON: %s", key)
        self._call_services(z, "turn_on")

    @callback
    def _schedule_off(self, z: dict):
        key = self._key(z)
        delay = z.get(CONF_DELAY, DEFAULT_DELAY)
        if key in self._timers:
            self._timers.pop(key).cancel()
        self._timers[key] = self.hass.loop.call_later(
            delay,
            lambda zz=z: self.hass.async_create_task(
                self._check_off(zz)
            ),
        )

    async def _check_off(self, z: dict):
        key = self._key(z)
        self._timers.pop(key, None)

        # Get all sensors that share this group
        grp = z.get(CONF_GROUP, "")
        if grp:
            all_sensors = set()
            for zz in self._zones():
                if zz.get(CONF_GROUP) == grp:
                    for s in zz.get(CONF_SENSORS, []):
                        all_sensors.add(s)
        else:
            all_sensors = set(z.get(CONF_SENSORS, []))

        # If ANY sensor is still on, don't turn off
        for s in all_sensors:
            st = self.hass.states.get(s)
            if st and st.state == STATE_ON:
                return

        _LOGGER.info("OFF: %s", key)
        await self._async_call_services(z, "turn_off")

    def _call_services(self, z: dict, action: str):
        """Call turn_on/turn_off for areas, lights, switches."""
        self.hass.async_create_task(
            self._async_call_services(z, action)
        )

    async def _async_call_services(
        self, z: dict, action: str
    ):
        """Handle areas + split entities by domain."""
        areas = z.get(CONF_TARGET_AREAS, [])
        ents = z.get(CONF_TARGET_ENTITIES, [])

        # Areas — call light service (covers all lights)
        if areas:
            await self.hass.services.async_call(
                "light", action, {},
                target={"area_id": areas},
            )
            # Also call switch for any switches in areas
            await self.hass.services.async_call(
                "switch", action, {},
                target={"area_id": areas},
            )

        # Entities — split by domain
        lights = [e for e in ents if e.startswith("light.")]
        switches = [e for e in ents
                    if e.startswith("switch.")]
        fans = [e for e in ents if e.startswith("fan.")]

        if lights:
            await self.hass.services.async_call(
                "light", action, {},
                target={"entity_id": lights},
            )
        if switches:
            await self.hass.services.async_call(
                "switch", action, {},
                target={"entity_id": switches},
            )
        if fans:
            await self.hass.services.async_call(
                "fan", action, {},
                target={"entity_id": fans},
            )

    def _key(self, z: dict) -> str:
        grp = z.get(CONF_GROUP, "")
        if grp:
            return f"grp_{grp}"
        areas = z.get(CONF_TARGET_AREAS, [])
        ents = z.get(CONF_TARGET_ENTITIES, [])
        return "t_" + "_".join(sorted(areas + ents))
