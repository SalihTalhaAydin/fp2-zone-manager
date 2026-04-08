"""FP2 Zone Manager — Presence-based light control for Aqara FP2 sensors."""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

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


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up FP2 Zone Manager from a config entry."""
    manager = ZoneManager(hass, entry)
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = manager
    await manager.async_start()

    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    manager = hass.data[DOMAIN].pop(entry.entry_id, None)
    if manager:
        manager.async_stop()
    return True


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Handle config entry updates (zone changes from options flow)."""
    manager = hass.data[DOMAIN].get(entry.entry_id)
    if manager:
        manager.async_stop()
        await manager.async_start()


class ZoneManager:
    """Manages all FP2 zone-to-light mappings."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
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

        # Collect all unique sensor entity IDs
        sensors = list({zone[CONF_SENSOR] for zone in zones})
        _LOGGER.info(
            "FP2 Zone Manager: Watching %d sensors across %d zones",
            len(sensors),
            len(zones),
        )

        # Track state changes for all sensors
        unsub = async_track_state_change_event(
            self.hass, sensors, self._handle_state_change
        )
        self._unsub_listeners.append(unsub)

    @callback
    def async_stop(self) -> None:
        """Stop all listeners and cancel pending timers."""
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

        new = new_state.state
        old = old_state.state

        if new == old:
            return

        # Find all zones that use this sensor
        zones = self._get_zones()
        matching_zones = [z for z in zones if z[CONF_SENSOR] == entity_id]

        for zone in matching_zones:
            if new == STATE_ON:
                self._handle_presence_on(zone)
            elif new == STATE_OFF:
                self._handle_presence_off(zone)

    @callback
    def _handle_presence_on(self, zone: dict) -> None:
        """Handle presence detected — turn on lights immediately."""
        target_key = self._get_target_key(zone)

        # Cancel any pending off timer for this target
        if target_key in self._pending_off:
            self._pending_off[target_key].cancel()
            del self._pending_off[target_key]
            _LOGGER.debug("Cancelled pending off for %s", target_key)

        # Build service data
        service_data = {}
        target = self._build_target(zone)

        _LOGGER.info("Presence ON: turning on %s", target_key)
        self.hass.async_create_task(
            self.hass.services.async_call("light", "turn_on", service_data, target=target)
        )

    @callback
    def _handle_presence_off(self, zone: dict) -> None:
        """Handle presence cleared — start delay timer."""
        target_key = self._get_target_key(zone)
        delay = zone.get(CONF_DELAY, DEFAULT_DELAY)

        # Cancel existing timer if any
        if target_key in self._pending_off:
            self._pending_off[target_key].cancel()

        _LOGGER.debug(
            "Presence OFF for %s, starting %d min timer",
            target_key,
            delay,
        )

        # Schedule the turn-off check
        self._pending_off[target_key] = self.hass.loop.call_later(
            delay * 60,
            lambda: self.hass.async_create_task(
                self._async_check_and_turn_off(zone)
            ),
        )

    async def _async_check_and_turn_off(self, zone: dict) -> None:
        """Check if all sensors in the group are clear, then turn off."""
        target_key = self._get_target_key(zone)

        # Remove from pending
        self._pending_off.pop(target_key, None)

        # Find all sibling sensors (same group or same target)
        group = zone.get(CONF_GROUP, "")
        zones = self._get_zones()

        if group:
            siblings = [z[CONF_SENSOR] for z in zones if z.get(CONF_GROUP) == group]
        else:
            siblings = [zone[CONF_SENSOR]]

        # Check if any sibling sensor is still ON
        for sensor_id in siblings:
            state = self.hass.states.get(sensor_id)
            if state and state.state == STATE_ON:
                _LOGGER.debug(
                    "Not turning off %s — %s still detects presence",
                    target_key,
                    sensor_id,
                )
                return

        # All clear — turn off
        _LOGGER.info("All clear: turning off %s", target_key)
        target = self._build_target(zone)
        await self.hass.services.async_call("light", "turn_off", {}, target=target)

    def _build_target(self, zone: dict) -> dict:
        """Build the service call target from zone config."""
        if zone[CONF_TARGET_TYPE] == TARGET_TYPE_AREA:
            return {"area_id": zone[CONF_TARGET_AREA]}
        else:
            return {"entity_id": zone.get(CONF_TARGET_ENTITIES, [])}

    def _get_target_key(self, zone: dict) -> str:
        """Get a unique key for the zone's target (for timer tracking)."""
        group = zone.get(CONF_GROUP, "")
        if group:
            return f"group_{group}"
        if zone[CONF_TARGET_TYPE] == TARGET_TYPE_AREA:
            return f"area_{zone[CONF_TARGET_AREA]}"
        return f"entities_{'_'.join(sorted(zone.get(CONF_TARGET_ENTITIES, [])))}"
