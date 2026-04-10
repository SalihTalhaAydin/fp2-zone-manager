# FP2 Zone Manager

Home Assistant custom integration for presence-based light automation using Aqara FP2 sensors.

## Project Structure

```
fp2-zone-manager/
  hacs.json                          # HACS integration metadata
  README.md                          # GitHub readme
  CLAUDE.md                          # This file
  custom_components/fp2_zone_manager/
    __init__.py                      # Integration setup, WebSocket API, ZoneManager engine
    config_flow.py                   # Config flow (single-instance, no options flow)
    const.py                         # Constants and config keys
    manifest.json                    # HA integration manifest
    strings.json                     # UI strings for config flow
    translations/en.json             # English translations (mirrors strings.json)
    frontend/
      __init__.py                    # Empty (makes it a package for static serving)
      zmpanel.js                     # Sidebar panel UI (custom element)
      panel.js                       # Legacy copy of panel (identical to zmpanel.js before redesign)
      fp2-zone-manager-card.js       # Lovelace card (older, simpler UI — mostly superseded by panel)
```

## How It Works

### Backend (`__init__.py`)

1. **`async_setup_entry`** registers:
   - Static file serving at `/fp2_zone_manager` pointing to the `frontend/` directory
   - A sidebar panel (`fp2-zones`) loading `zmpanel.js` as a custom panel element
   - Three WebSocket commands (registered once via `hass.data["fp2_zm_ws"]` guard)
   - A `ZoneManager` instance that tracks state changes

2. **`ZoneManager`** subscribes to state change events for all sensors in enabled zones. On state change:
   - `on` -> calls `turn_on` on target areas/entities (if within time window)
   - `off` -> schedules a delayed check; if ALL sensors in the zone are still off after the delay, calls `turn_off`

3. **Time windows** support fixed times (`HH:MM`), `sunrise`/`sunset` with optional offsets (`sunset-30m`, `sunrise+1h30m`). Windows wrap around midnight.

### Frontend (`zmpanel.js`)

Single-file custom element `fp2-zone-manager-panel` using Shadow DOM. No build step, no framework.

- Loaded as a HA sidebar panel via `frontend.async_register_built_in_panel` with `component_name="custom"`
- Uses Inter font from Google Fonts CDN
- All data flows through WebSocket (no REST calls)
- Chip-based selectors for sensors, areas, entities
- Time pickers with sunrise/sunset offset support
- Global settings modal for default time windows and delay

### Config Flow (`config_flow.py`)

Single-instance only. Creates a config entry with `data: { zones: [] }`. The panel UI handles all subsequent configuration via WebSocket.

## WebSocket API

All three commands are registered in `__init__.py`.

### `fp2_zone_manager/zones/get`

Returns current zones and global config.

**Request:** `{ "type": "fp2_zone_manager/zones/get" }`

**Response:**
```json
{
  "zones": [
    {
      "enabled": true,
      "sensors": ["binary_sensor.fp2_kitchen_presence_sensor_1"],
      "target_areas": ["kitchen"],
      "target_entities": ["light.kitchen_island"],
      "delay": 300,
      "start_time": "sunset-30m",
      "end_time": "sunrise+30m"
    }
  ],
  "entry_id": "abc123",
  "global": {
    "global_start": "sunset",
    "global_end": "sunrise",
    "global_delay": 300
  }
}
```

### `fp2_zone_manager/zones/set`

Replaces all zones. Triggers ZoneManager restart (unsubscribe + resubscribe).

**Request:** `{ "type": "fp2_zone_manager/zones/set", "zones": [...] }`

**Response:** `{ "success": true }`

### `fp2_zone_manager/global/set`

Updates global defaults. Does NOT restart the ZoneManager (globals are read at runtime).

**Request:** `{ "type": "fp2_zone_manager/global/set", "global": { "global_start": "sunset", "global_end": "sunrise", "global_delay": 300 } }`

**Response:** `{ "success": true }`

## Data Structures

### Zone Object

```json
{
  "enabled": true,
  "sensors": ["binary_sensor.xxx"],
  "target_areas": ["area_id"],
  "target_entities": ["light.xxx", "switch.xxx", "fan.xxx"],
  "delay": 300,
  "start_time": "sunset-30m",
  "end_time": "sunrise+30m"
}
```

- `delay: 0` or missing means "use global default"
- `start_time`/`end_time` empty means "use global default"
- `enabled` missing or `true` means active

### Global Object

```json
{
  "global_start": "sunset",
  "global_end": "sunrise",
  "global_delay": 300
}
```

### Time Format Strings

- `""` — not set
- `"22:30"` — fixed time
- `"sunrise"` / `"sunset"` — solar event
- `"sunset-30m"` — 30 min before sunset
- `"sunrise+1h30m"` — 1h 30min after sunrise

Offset parsing: `[+-][Nh][Mm]` where N and M are integers. The `h` and `m` suffixes are required when both are present.

## Constants (`const.py`)

```python
DOMAIN = "fp2_zone_manager"
CONF_ENABLED = "enabled"
CONF_SENSORS = "sensors"
CONF_TARGET_AREAS = "target_areas"
CONF_TARGET_ENTITIES = "target_entities"
CONF_DELAY = "delay"
CONF_START_TIME = "start_time"
CONF_END_TIME = "end_time"
CONF_ZONES = "zones"
CONF_GLOBAL = "global"
CONF_GLOBAL_START = "global_start"
CONF_GLOBAL_END = "global_end"
CONF_GLOBAL_DELAY = "global_delay"
DEFAULT_DELAY = 300
```

## Development & Testing

### Local Development

1. Symlink or copy `custom_components/fp2_zone_manager` into your HA dev instance's `custom_components/`
2. Restart HA
3. Add the integration via Settings > Devices & Services
4. Edit `zmpanel.js` directly — HA caches aggressively, see cache busting below

### Cache Busting

The panel URL includes a timestamp query parameter:
```python
"module_url": "/fp2_zone_manager/zmpanel.js?v=" + str(int(time.time()))
```

This ensures browsers load the latest version after each HA restart. During development, you may need to hard-refresh (Ctrl+Shift+R) or restart HA to pick up JS changes.

Static paths are registered with `cache_headers=False` to prevent server-side caching.

### Testing

No automated tests currently. Test manually:
1. Add the integration
2. Create/edit/delete zones via the sidebar panel
3. Verify lights turn on/off with presence changes
4. Test time windows with sunrise/sunset offsets
5. Test the enable/disable toggle
6. Test global defaults (remove per-zone values, verify global applies)

## HACS Deployment

### Repository Setup

- `hacs.json` at repo root with `{ "name": "FP2 Zone Manager", "render_readme": true }`
- Integration code lives in `custom_components/fp2_zone_manager/`
- `manifest.json` contains the version number

### Releasing a New Version

1. Update `version` in `custom_components/fp2_zone_manager/manifest.json`
2. Commit and push to `master`
3. Create a GitHub release with a tag matching the version (e.g., `v1.5.0`)
4. HACS will pick up the new release automatically

### Default Branch

The repository uses `master` as the default branch (not `main`).

## Key Implementation Details

- The integration is single-instance (`single_instance_allowed` in config flow)
- All zone data is stored in the config entry's `data` dict, not `options`
- `hass.config_entries.async_update_entry` is used to persist changes (triggers HA to write to storage)
- WebSocket commands are registered once (guarded by `hass.data["fp2_zm_ws"]`) to avoid duplicate registration on reload
- The ZoneManager is stopped and restarted on every zone save to re-subscribe to the correct sensors
- Target services (`light.turn_on`, `switch.turn_on`, `fan.turn_on`) are called separately per domain using `target=` parameter
- Area targeting calls both `light` and `switch` services on the area
