"""Config flow for FP2 Zone Manager."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    OptionsFlowWithConfigEntry,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import area_registry as ar, entity_registry as er
from homeassistant.helpers.selector import (
    EntitySelector,
    EntitySelectorConfig,
    AreaSelector,
    AreaSelectorConfig,
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    TextSelector,
    TextSelectorConfig,
)

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
    TARGET_TYPE_ENTITIES,
    DEFAULT_DELAY,
)

_LOGGER = logging.getLogger(__name__)


def _get_presence_sensors(hass: HomeAssistant) -> list[str]:
    """Get all FP2 presence sensor entity IDs."""
    registry = er.async_get(hass)
    sensors = []
    for entity in registry.entities.values():
        if (
            entity.domain == "binary_sensor"
            and "presence_sensor" in entity.entity_id
            and "fp2" in entity.entity_id
        ):
            sensors.append(entity.entity_id)
    return sorted(sensors)


class FP2ZoneManagerConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle config flow for FP2 Zone Manager."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> dict:
        """Handle the initial step — just create the entry."""
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        if user_input is not None:
            return self.async_create_entry(
                title="FP2 Zone Manager",
                data={CONF_ZONES: []},
            )

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({}),
            description_placeholders={
                "info": "Set up FP2 Zone Manager to automatically control lights based on presence zones."
            },
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> FP2ZoneManagerOptionsFlow:
        """Get the options flow."""
        return FP2ZoneManagerOptionsFlow(config_entry)


class FP2ZoneManagerOptionsFlow(OptionsFlowWithConfigEntry):
    """Handle options flow — manage zone mappings."""

    def __init__(self, config_entry: ConfigEntry) -> None:
        """Initialize options flow."""
        super().__init__(config_entry)
        self._zones: list[dict] = list(config_entry.data.get(CONF_ZONES, []))
        self._editing_index: int | None = None

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> dict:
        """Show the zone list with add/edit/delete options."""
        if user_input is not None:
            action = user_input.get("action")
            if action == "add":
                return await self.async_step_select_sensor()
            elif action.startswith("edit_"):
                self._editing_index = int(action.split("_")[1])
                return await self.async_step_select_sensor()
            elif action.startswith("delete_"):
                idx = int(action.split("_")[1])
                self._zones.pop(idx)
                return self._save_and_finish()

        # Build zone list for display
        options = [{"value": "add", "label": "+ Add New Zone"}]
        for i, zone in enumerate(self._zones):
            sensor_short = zone[CONF_SENSOR].split(".")[-1]
            if zone[CONF_TARGET_TYPE] == TARGET_TYPE_AREA:
                target = f"Area: {zone[CONF_TARGET_AREA]}"
            else:
                count = len(zone.get(CONF_TARGET_ENTITIES, []))
                target = f"{count} entities"
            group = f" [{zone[CONF_GROUP]}]" if zone.get(CONF_GROUP) else ""
            delay = zone.get(CONF_DELAY, DEFAULT_DELAY)
            label = f"{sensor_short} → {target}{group} ({delay}min)"
            options.append({"value": f"edit_{i}", "label": f"Edit: {label}"})
            options.append({"value": f"delete_{i}", "label": f"Delete: {label}"})

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required("action"): SelectSelector(
                        SelectSelectorConfig(
                            options=options,
                            mode=SelectSelectorMode.LIST,
                        )
                    ),
                }
            ),
        )

    async def async_step_select_sensor(
        self, user_input: dict[str, Any] | None = None
    ) -> dict:
        """Step 1: Select the presence sensor."""
        if user_input is not None:
            self._current_sensor = user_input[CONF_SENSOR]
            return await self.async_step_select_target()

        # Pre-fill if editing
        default_sensor = None
        if self._editing_index is not None and self._editing_index < len(self._zones):
            default_sensor = self._zones[self._editing_index][CONF_SENSOR]

        schema = {
            vol.Required(CONF_SENSOR, default=default_sensor): EntitySelector(
                EntitySelectorConfig(
                    domain="binary_sensor",
                    include_entities=_get_presence_sensors(self.hass),
                )
            ),
        }

        return self.async_show_form(
            step_id="select_sensor",
            data_schema=vol.Schema(schema),
        )

    async def async_step_select_target(
        self, user_input: dict[str, Any] | None = None
    ) -> dict:
        """Step 2: Select target type (area or entities)."""
        if user_input is not None:
            self._current_target_type = user_input[CONF_TARGET_TYPE]
            if self._current_target_type == TARGET_TYPE_AREA:
                return await self.async_step_configure_area()
            else:
                return await self.async_step_configure_entities()

        default_type = TARGET_TYPE_AREA
        if self._editing_index is not None and self._editing_index < len(self._zones):
            default_type = self._zones[self._editing_index][CONF_TARGET_TYPE]

        return self.async_show_form(
            step_id="select_target",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_TARGET_TYPE, default=default_type): SelectSelector(
                        SelectSelectorConfig(
                            options=[
                                {"value": TARGET_TYPE_AREA, "label": "Control an entire area"},
                                {"value": TARGET_TYPE_ENTITIES, "label": "Control specific entities"},
                            ],
                            mode=SelectSelectorMode.LIST,
                        )
                    ),
                }
            ),
        )

    async def async_step_configure_area(
        self, user_input: dict[str, Any] | None = None
    ) -> dict:
        """Step 3a: Configure area target."""
        if user_input is not None:
            zone = {
                CONF_SENSOR: self._current_sensor,
                CONF_TARGET_TYPE: TARGET_TYPE_AREA,
                CONF_TARGET_AREA: user_input[CONF_TARGET_AREA],
                CONF_TARGET_ENTITIES: [],
                CONF_GROUP: user_input.get(CONF_GROUP, ""),
                CONF_DELAY: user_input.get(CONF_DELAY, DEFAULT_DELAY),
            }
            if self._editing_index is not None:
                self._zones[self._editing_index] = zone
            else:
                self._zones.append(zone)
            self._editing_index = None
            return self._save_and_finish()

        defaults = {}
        if self._editing_index is not None and self._editing_index < len(self._zones):
            z = self._zones[self._editing_index]
            defaults = {
                CONF_TARGET_AREA: z.get(CONF_TARGET_AREA),
                CONF_GROUP: z.get(CONF_GROUP, ""),
                CONF_DELAY: z.get(CONF_DELAY, DEFAULT_DELAY),
            }

        return self.async_show_form(
            step_id="configure_area",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_TARGET_AREA,
                        default=defaults.get(CONF_TARGET_AREA),
                    ): AreaSelector(AreaSelectorConfig()),
                    vol.Optional(
                        CONF_GROUP,
                        default=defaults.get(CONF_GROUP, ""),
                    ): TextSelector(TextSelectorConfig()),
                    vol.Optional(
                        CONF_DELAY,
                        default=defaults.get(CONF_DELAY, DEFAULT_DELAY),
                    ): NumberSelector(
                        NumberSelectorConfig(
                            min=1,
                            max=60,
                            step=1,
                            unit_of_measurement="minutes",
                            mode=NumberSelectorMode.BOX,
                        )
                    ),
                }
            ),
            description_placeholders={
                "group_info": "Group name links multiple sensors together. Lights only turn off when ALL sensors in the group are clear."
            },
        )

    async def async_step_configure_entities(
        self, user_input: dict[str, Any] | None = None
    ) -> dict:
        """Step 3b: Configure entity targets."""
        if user_input is not None:
            zone = {
                CONF_SENSOR: self._current_sensor,
                CONF_TARGET_TYPE: TARGET_TYPE_ENTITIES,
                CONF_TARGET_AREA: "",
                CONF_TARGET_ENTITIES: user_input[CONF_TARGET_ENTITIES],
                CONF_GROUP: user_input.get(CONF_GROUP, ""),
                CONF_DELAY: user_input.get(CONF_DELAY, DEFAULT_DELAY),
            }
            if self._editing_index is not None:
                self._zones[self._editing_index] = zone
            else:
                self._zones.append(zone)
            self._editing_index = None
            return self._save_and_finish()

        defaults = {}
        if self._editing_index is not None and self._editing_index < len(self._zones):
            z = self._zones[self._editing_index]
            defaults = {
                CONF_TARGET_ENTITIES: z.get(CONF_TARGET_ENTITIES, []),
                CONF_GROUP: z.get(CONF_GROUP, ""),
                CONF_DELAY: z.get(CONF_DELAY, DEFAULT_DELAY),
            }

        return self.async_show_form(
            step_id="configure_entities",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_TARGET_ENTITIES,
                        default=defaults.get(CONF_TARGET_ENTITIES, []),
                    ): EntitySelector(
                        EntitySelectorConfig(
                            domain=["light", "switch", "fan"],
                            multiple=True,
                        )
                    ),
                    vol.Optional(
                        CONF_GROUP,
                        default=defaults.get(CONF_GROUP, ""),
                    ): TextSelector(TextSelectorConfig()),
                    vol.Optional(
                        CONF_DELAY,
                        default=defaults.get(CONF_DELAY, DEFAULT_DELAY),
                    ): NumberSelector(
                        NumberSelectorConfig(
                            min=1,
                            max=60,
                            step=1,
                            unit_of_measurement="minutes",
                            mode=NumberSelectorMode.BOX,
                        )
                    ),
                }
            ),
        )

    def _save_and_finish(self) -> dict:
        """Save zones and finish."""
        self.hass.config_entries.async_update_entry(
            self.config_entry,
            data={CONF_ZONES: self._zones},
        )
        return self.async_create_entry(title="", data={})
