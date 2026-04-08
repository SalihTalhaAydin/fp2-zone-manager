# FP2 Zone Manager

A Home Assistant custom integration for managing Aqara FP2 presence sensor zone-to-light mappings through a UI.

## Features

- Map FP2 presence zones to areas or specific entities
- Group multiple sensors together (e.g., two FP2s covering the same room)
- Configurable turn-off delay per zone
- Lights only turn off when ALL sensors in a group are clear
- Full UI configuration — no YAML needed

## Installation

### HACS
1. Add this repository as a custom repository in HACS
2. Install "FP2 Zone Manager"
3. Restart Home Assistant
4. Go to Settings → Devices & Services → Add Integration → FP2 Zone Manager

### Manual
1. Copy `custom_components/fp2_zone_manager` to your HA `custom_components` directory
2. Restart Home Assistant
3. Go to Settings → Devices & Services → Add Integration → FP2 Zone Manager

## Usage

1. After adding the integration, click **Configure**
2. Click **+ Add New Zone**
3. Select a presence sensor
4. Choose to control an area or specific entities
5. Optionally set a group name and turn-off delay
6. Save

### Groups

When multiple FP2 sensors cover the same area (e.g., two FP2 units both seeing the kitchen), give them the same **group name**. Lights will only turn off when ALL sensors in the group are clear.
