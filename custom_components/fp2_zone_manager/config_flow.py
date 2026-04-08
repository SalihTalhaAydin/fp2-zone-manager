"""Config flow for FP2 Zone Manager."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigEntry
from homeassistant.core import callback

from .const import DOMAIN, CONF_ZONES


class FP2ZoneManagerConfigFlow(ConfigFlow, domain=DOMAIN):
    """Config flow — just creates a single entry."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> dict:
        if self._async_current_entries():
            return self.async_abort(
                reason="single_instance_allowed"
            )
        if user_input is not None:
            return self.async_create_entry(
                title="FP2 Zone Manager",
                data={CONF_ZONES: []},
            )
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({}),
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry):
        """Options flow not used — panel handles config."""
        return None
