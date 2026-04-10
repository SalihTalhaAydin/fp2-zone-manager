# FP2 Zone Manager

### Presence-Based Light Automation for Home Assistant

---

Turn your Aqara FP2 presence sensors into intelligent room-aware lighting controllers. FP2 Zone Manager maps presence zones to lights, areas, and entities with a beautiful sidebar panel UI -- no YAML required.

---

## Features

- **Zone-to-Light Mapping** -- Link FP2 presence zones to any combination of areas and entities (lights, switches, fans)
- **Multi-Sensor Grouping** -- Group multiple sensors covering the same space; lights only turn off when ALL sensors clear
- **Time Windows** -- Restrict automation to specific hours, sunrise/sunset with offsets, or global defaults
- **Per-Zone Delay** -- Configurable turn-off delay per zone, with global fallback
- **Enable/Disable Toggle** -- Instantly enable or disable individual zones without deleting them
- **Global Defaults** -- Set default time windows and delays that apply to all zones
- **Sidebar Panel UI** -- Full-featured management panel that lives in the HA sidebar
- **No YAML** -- Everything is configured through the UI

## Screenshots

> Screenshots coming soon. The panel features a modern dark-themed UI with colored chips for sensors (purple), areas (blue), and entities (amber), glowing status dots, and smooth animations.

## Installation

### HACS (Recommended)

1. Open HACS in Home Assistant
2. Click the three-dot menu (top right) and select **Custom repositories**
3. Add `https://github.com/SalihTalhaAydin/fp2-zone-manager` with category **Integration**
4. Search for "FP2 Zone Manager" and click **Install**
5. Restart Home Assistant
6. Go to **Settings > Devices & Services > Add Integration > FP2 Zone Manager**

### Manual

1. Download or clone this repository
2. Copy `custom_components/fp2_zone_manager` to your Home Assistant `custom_components/` directory
3. Restart Home Assistant
4. Go to **Settings > Devices & Services > Add Integration > FP2 Zone Manager**

## Usage

After installing and adding the integration:

1. A new **Zone Manager** item appears in the HA sidebar
2. Click **+ Add Zone** to create your first mapping
3. Select one or more **presence sensors** (auto-discovers FP2 presence zones)
4. Choose **target areas** and/or **target entities** to control
5. Optionally expand **Advanced options** to set per-zone delay and time windows
6. Click **Save**

### Global Defaults

Click **Settings** in the panel header to configure global defaults:

- **Default active from / until** -- Time window applied to all zones without their own
- **Default turn-off delay** -- Delay before lights turn off (default: 300 seconds)

### Enabling / Disabling Zones

Each zone has a toggle switch. Disabled zones are grayed out and won't respond to presence changes. The zone configuration is preserved.

## Configuration Reference

### Zone Fields

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Whether the zone is active |
| `sensors` | string[] | List of `binary_sensor.*` presence sensor entity IDs |
| `target_areas` | string[] | List of HA area IDs to control |
| `target_entities` | string[] | List of entity IDs (`light.*`, `switch.*`, `fan.*`) |
| `delay` | number | Turn-off delay in seconds (0 = use global default) |
| `start_time` | string | When automation becomes active (see time formats below) |
| `end_time` | string | When automation stops being active |

### Global Fields

| Field | Type | Description |
|-------|------|-------------|
| `global_start` | string | Default start time for all zones |
| `global_end` | string | Default end time for all zones |
| `global_delay` | number | Default turn-off delay in seconds |

## Time Format Reference

| Format | Example | Description |
|--------|---------|-------------|
| Fixed time | `22:30` | Specific time (24-hour format) |
| Sunrise | `sunrise` | At sunrise |
| Sunset | `sunset` | At sunset |
| Sunrise + offset | `sunrise+30m` | 30 minutes after sunrise |
| Sunset - offset | `sunset-1h30m` | 1 hour 30 minutes before sunset |
| Offset (hours only) | `sunset+2h` | 2 hours after sunset |
| Offset (minutes only) | `sunrise-45m` | 45 minutes before sunrise |

Time windows wrap around midnight. For example, `start_time: "sunset"` and `end_time: "sunrise"` means "from sunset to the next sunrise."

## How It Works

1. The integration registers a WebSocket API and a sidebar panel
2. When a mapped presence sensor turns **on**, the integration calls `turn_on` on all target areas and entities (if within the time window)
3. When a presence sensor turns **off**, a timer starts (configurable delay)
4. After the delay, if **all** sensors in the zone are still off, it calls `turn_off` on the targets
5. If any sensor turns back on during the delay, the timer is canceled

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Test with a real HA instance
5. Submit a pull request

## License

MIT License. See [LICENSE](LICENSE) for details.

---

Built for the Aqara FP2 presence sensor ecosystem. Works with any `binary_sensor` presence entity.
