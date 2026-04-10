"""FP2 Zone Manager — Presence-based light control."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from pathlib import Path

import voluptuous as vol
import homeassistant.util.dt as dt_util

from homeassistant.components import frontend, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_ON, STATE_OFF
from homeassistant.core import HomeAssistant, callback, Event
from homeassistant.helpers.event import (
    async_track_state_change_event,
)

from .const import (
    DOMAIN, CONF_ENABLED, CONF_SENSORS,
    CONF_TARGET_AREAS, CONF_TARGET_ENTITIES,
    CONF_DELAY, CONF_START_TIME, CONF_END_TIME,
    CONF_ZONES, CONF_GLOBAL, CONF_GLOBAL_START,
    CONF_GLOBAL_END, CONF_GLOBAL_DELAY,
    DEFAULT_DELAY,
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
            "module_url": "/fp2_zone_manager/panel.js"
                    "?v=" + str(int(__import__("time").time())),
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
        websocket_api.async_register_command(
            hass, "fp2_zone_manager/global/set",
            _ws_set_global, _WS_SET_GLOBAL,
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
_WS_SET_GLOBAL = (
    websocket_api.BASE_COMMAND_MESSAGE_SCHEMA.extend({
        vol.Required("type"): "fp2_zone_manager/global/set",
        vol.Required("global"): dict,
    })
)


@callback
def _ws_get(hass, conn, msg):
    entries = hass.config_entries.async_entries(DOMAIN)
    zones, eid, glb = [], None, {}
    if entries:
        eid = entries[0].entry_id
        zones = entries[0].data.get(CONF_ZONES, [])
        glb = entries[0].data.get(CONF_GLOBAL, {}) or {}
    conn.send_result(msg["id"], {
        "zones": zones, "entry_id": eid, "global": glb,
    })


@callback
def _ws_set(hass, conn, msg):
    entries = hass.config_entries.async_entries(DOMAIN)
    if not entries:
        conn.send_error(msg["id"], "not_found", "")
        return
    entry = entries[0]
    new_data = dict(entry.data)
    new_data[CONF_ZONES] = msg["zones"]
    hass.config_entries.async_update_entry(
        entry, data=new_data
    )
    mgr = hass.data.get(DOMAIN, {}).get(entry.entry_id)
    if mgr:
        mgr.async_stop()
        hass.async_create_task(mgr.async_start())
    conn.send_result(msg["id"], {"success": True})


@callback
def _ws_set_global(hass, conn, msg):
    entries = hass.config_entries.async_entries(DOMAIN)
    if not entries:
        conn.send_error(msg["id"], "not_found", "")
        return
    entry = entries[0]
    new_data = dict(entry.data)
    new_data[CONF_GLOBAL] = msg["global"]
    hass.config_entries.async_update_entry(
        entry, data=new_data
    )
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

    def _global(self) -> dict:
        return self.entry.data.get(CONF_GLOBAL, {}) or {}

    async def async_start(self):
        zones = self._zones()
        if not zones:
            return
        sensors = set()
        for z in zones:
            if not z.get(CONF_ENABLED, True):
                continue
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
            if not z.get(CONF_ENABLED, True):
                continue
            if eid not in z.get(CONF_SENSORS, []):
                continue
            if ns.state == STATE_ON:
                self._turn_on(z)
            elif ns.state == STATE_OFF:
                self._schedule_off(z)

    @callback
    def _turn_on(self, z: dict):
        if not self._in_window(z):
            return
        key = self._key(z)
        if key in self._timers:
            self._timers.pop(key).cancel()
        _LOGGER.info("ON: %s", key)
        self._call_services(z, "turn_on")

    @callback
    def _schedule_off(self, z: dict):
        key = self._key(z)
        delay = (
            z.get(CONF_DELAY)
            or self._global().get(CONF_GLOBAL_DELAY)
            or DEFAULT_DELAY
        )
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
        # All sensors in this zone must be off
        for s in z.get(CONF_SENSORS, []):
            st = self.hass.states.get(s)
            if st and st.state == STATE_ON:
                return
        _LOGGER.info("OFF: %s", key)
        await self._async_call_services(z, "turn_off")

    def _call_services(self, z: dict, action: str):
        self.hass.async_create_task(
            self._async_call_services(z, action)
        )

    async def _async_call_services(
        self, z: dict, action: str
    ):
        areas = z.get(CONF_TARGET_AREAS, [])
        ents = z.get(CONF_TARGET_ENTITIES, [])

        if areas:
            await self.hass.services.async_call(
                "light", action, {},
                target={"area_id": areas},
            )
            await self.hass.services.async_call(
                "switch", action, {},
                target={"area_id": areas},
            )

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
        areas = z.get(CONF_TARGET_AREAS, [])
        ents = z.get(CONF_TARGET_ENTITIES, [])
        sensors = z.get(CONF_SENSORS, [])
        return "z_" + "_".join(
            sorted(areas + ents + sensors)
        )

    def _in_window(self, z: dict) -> bool:
        start = z.get(CONF_START_TIME, "")
        end = z.get(CONF_END_TIME, "")
        if not start and not end:
            g = self._global()
            start = g.get(CONF_GLOBAL_START, "")
            end = g.get(CONF_GLOBAL_END, "")
        if not start and not end:
            return True
        now = dt_util.now()
        s = self._resolve_time(start, now)
        e = self._resolve_time(end, now)
        if s is None or e is None:
            return True
        if s <= e:
            return s <= now <= e
        return now >= s or now <= e

    def _resolve_time(self, t: str, now: datetime):
        if not t:
            return None
        t = t.strip().lower()
        if t.startswith("sunrise") or t.startswith("sunset"):
            sun = self.hass.states.get("sun.sun")
            if not sun:
                return None
            kind = (
                "sunrise" if t.startswith("sunrise")
                else "sunset"
            )
            attr = (
                "next_rising" if kind == "sunrise"
                else "next_setting"
            )
            raw = sun.attributes.get(attr)
            if not raw:
                return None
            sun_dt = dt_util.parse_datetime(raw)
            if not sun_dt:
                return None
            local = dt_util.as_local(sun_dt)
            target = now.replace(
                hour=local.hour,
                minute=local.minute,
                second=0, microsecond=0,
            )
            rest = t[len(kind):]
            off = self._parse_offset(rest)
            if off is not None:
                target += timedelta(minutes=off)
            return target
        try:
            parts = t.split(":")
            h, m = int(parts[0]), int(parts[1])
            return now.replace(
                hour=h, minute=m,
                second=0, microsecond=0,
            )
        except (ValueError, IndexError):
            return None

    def _parse_offset(self, s: str) -> int | None:
        if not s:
            return None
        sign = 1
        if s[0] == "-":
            sign = -1
            s = s[1:]
        elif s[0] == "+":
            s = s[1:]
        if not s:
            return None
        total = 0
        has_unit = False
        buf = ""
        for ch in s:
            if ch.isdigit():
                buf += ch
            elif ch == "h":
                if buf:
                    total += int(buf) * 60
                    has_unit = True
                    buf = ""
            elif ch == "m":
                if buf:
                    total += int(buf)
                    has_unit = True
                    buf = ""
            else:
                return None
        if buf:
            if has_unit:
                return None
            total = int(buf)
        return sign * total
