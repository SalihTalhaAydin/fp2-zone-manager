class FP2ZoneManagerPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._zones = [];
    this._editIdx = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) {
      this._build();
      this._built = true;
      this._load();
    }
  }

  set panel(panel) {
    this._panel = panel;
  }

  _build() {
    this.shadowRoot.innerHTML = `
    <style>
      :host {
        display: block;
        padding: 24px;
        max-width: 900px;
        margin: 0 auto;
        font-family: var(--ha-card-font-family, Roboto, sans-serif);
        color: var(--primary-text-color);
      }
      .header {
        display: flex; justify-content: space-between;
        align-items: center; margin-bottom: 24px;
      }
      h1 { margin: 0; font-size: 1.5em; font-weight: 400; }
      .subtitle {
        color: var(--secondary-text-color);
        font-size: 0.9em; margin-top: 4px;
      }
      .add-btn {
        background: var(--primary-color); color: white;
        border: none; border-radius: 10px; padding: 10px 20px;
        cursor: pointer; font-size: 0.95em; font-weight: 500;
        transition: opacity 0.2s;
      }
      .add-btn:hover { opacity: 0.85; }

      /* Table */
      .zones-table {
        width: 100%;
        background: var(--ha-card-background, var(--card-background-color));
        border-radius: 12px;
        overflow: hidden;
        box-shadow: var(--ha-card-box-shadow, 0 2px 6px rgba(0,0,0,0.1));
      }
      table { width: 100%; border-collapse: collapse; }
      th {
        text-align: left; padding: 14px 16px;
        background: var(--table-header-background-color, rgba(0,0,0,0.04));
        color: var(--secondary-text-color);
        font-size: 0.8em; font-weight: 600;
        text-transform: uppercase; letter-spacing: 0.8px;
      }
      td {
        padding: 14px 16px;
        border-top: 1px solid var(--divider-color);
        vertical-align: middle;
      }
      tr:first-child td { border-top: none; }
      tr:hover td {
        background: var(--table-row-alternative-background-color, rgba(0,0,0,0.02));
      }

      /* Status dot */
      .dot {
        display: inline-block; width: 10px; height: 10px;
        border-radius: 50%; vertical-align: middle;
      }
      .dot.on { background: #4caf50; box-shadow: 0 0 6px #4caf50aa; }
      .dot.off { background: #9e9e9e; }

      /* Sensor name */
      .sensor-name { font-weight: 500; }
      .sensor-id {
        font-size: 0.75em; color: var(--secondary-text-color);
        margin-top: 2px;
      }

      /* Target */
      .target-badge {
        display: inline-block; padding: 4px 10px;
        border-radius: 6px; font-size: 0.85em;
      }
      .target-badge.area {
        background: var(--primary-color); color: white; opacity: 0.85;
      }
      .target-badge.entities {
        background: var(--accent-color, #ff9800); color: white; opacity: 0.85;
      }

      /* Group */
      .group-badge {
        display: inline-block; padding: 3px 8px;
        border-radius: 4px; font-size: 0.8em;
        background: var(--divider-color);
        color: var(--primary-text-color);
      }

      /* Actions */
      .actions { display: flex; gap: 6px; }
      .act-btn {
        background: none; border: 1px solid var(--divider-color);
        cursor: pointer; padding: 6px 10px; border-radius: 6px;
        color: var(--primary-text-color); font-size: 0.85em;
        transition: all 0.2s;
      }
      .act-btn:hover { background: var(--divider-color); }
      .act-btn.del { color: var(--error-color, #db4437); border-color: var(--error-color, #db4437); }
      .act-btn.del:hover { background: var(--error-color, #db4437); color: white; }

      /* Empty state */
      .empty {
        text-align: center; padding: 60px 24px;
        color: var(--secondary-text-color);
      }
      .empty-icon { font-size: 3em; margin-bottom: 12px; opacity: 0.4; }
      .empty-text { font-size: 1.1em; margin-bottom: 16px; }

      /* Modal */
      .overlay {
        display: none; position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.5); z-index: 999;
        justify-content: center; align-items: center;
      }
      .overlay.open { display: flex; }
      .modal {
        background: var(--ha-card-background, var(--card-background-color, #fff));
        border-radius: 16px; padding: 28px;
        min-width: 360px; max-width: 480px; width: 90%;
        box-shadow: 0 8px 32px rgba(0,0,0,0.3);
      }
      .modal h2 { margin: 0 0 20px; font-weight: 400; }
      .field { margin-bottom: 16px; }
      .field label {
        display: block; margin-bottom: 6px;
        font-size: 0.85em; color: var(--secondary-text-color);
        font-weight: 500;
      }
      .field select, .field input {
        width: 100%; padding: 10px 12px;
        border: 1px solid var(--divider-color);
        border-radius: 8px;
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color);
        font-size: 0.95em;
        box-sizing: border-box;
        transition: border-color 0.2s;
      }
      .field select:focus, .field input:focus {
        outline: none;
        border-color: var(--primary-color);
      }
      .field select[multiple] { height: 140px; }
      .field .hint {
        font-size: 0.75em; color: var(--secondary-text-color);
        margin-top: 4px;
      }
      .modal-btns {
        display: flex; justify-content: flex-end;
        gap: 10px; margin-top: 24px;
      }
      .modal-btns button {
        padding: 10px 20px; border-radius: 8px;
        border: none; cursor: pointer; font-size: 0.95em;
        font-weight: 500; transition: opacity 0.2s;
      }
      .btn-cancel {
        background: var(--divider-color);
        color: var(--primary-text-color);
      }
      .btn-save { background: var(--primary-color); color: white; }
      .btn-save:hover, .btn-cancel:hover { opacity: 0.85; }
    </style>

    <div class="header">
      <div>
        <h1>FP2 Zone Manager</h1>
        <div class="subtitle">Map FP2 presence zones to lights and areas</div>
      </div>
      <button class="add-btn" id="addBtn">+ Add Zone</button>
    </div>

    <div class="zones-table">
      <div id="content"></div>
    </div>

    <div class="overlay" id="overlay">
      <div class="modal">
        <h2 id="modalTitle">Add Zone</h2>
        <div class="field">
          <label>Presence Sensor</label>
          <select id="fSensor"></select>
        </div>
        <div class="field">
          <label>Target Type</label>
          <select id="fType">
            <option value="area">Area — all lights in a room</option>
            <option value="entities">Specific entities</option>
          </select>
        </div>
        <div class="field" id="fAreaWrap">
          <label>Area</label>
          <select id="fArea"></select>
        </div>
        <div class="field" id="fEntWrap" style="display:none">
          <label>Entities</label>
          <select id="fEnt" multiple></select>
          <div class="hint">Hold Ctrl/Cmd to select multiple</div>
        </div>
        <div class="field">
          <label>Group</label>
          <input id="fGroup" placeholder="e.g. basement_kitchen">
          <div class="hint">Link sensors together — lights off only when all sensors in group clear</div>
        </div>
        <div class="field">
          <label>Turn-off delay (seconds)</label>
          <input type="number" id="fDelay" value="300" min="1" max="3600">
        </div>
        <div class="modal-btns">
          <button class="btn-cancel" id="btnCancel">Cancel</button>
          <button class="btn-save" id="btnSave">Save</button>
        </div>
      </div>
    </div>`;

    const $ = id => this.shadowRoot.getElementById(id);
    this._$ = {
      content: $("content"), overlay: $("overlay"),
      modalTitle: $("modalTitle"),
      fSensor: $("fSensor"), fType: $("fType"),
      fAreaWrap: $("fAreaWrap"), fEntWrap: $("fEntWrap"),
      fArea: $("fArea"), fEnt: $("fEnt"),
      fGroup: $("fGroup"), fDelay: $("fDelay"),
    };

    $("addBtn").onclick = () => this._openModal();
    $("btnCancel").onclick = () => this._closeModal();
    $("btnSave").onclick = () => this._saveZone();
    this._$.fType.onchange = () => this._toggleTarget();
  }

  _toggleTarget() {
    const isArea = this._$.fType.value === "area";
    this._$.fAreaWrap.style.display = isArea ? "" : "none";
    this._$.fEntWrap.style.display = isArea ? "none" : "";
  }

  async _load() {
    try {
      const r = await this._hass.connection.sendMessagePromise(
        { type: "fp2_zone_manager/zones/get" }
      );
      this._zones = r.zones || [];
    } catch {
      this._zones = [];
    }
    this._render();
  }

  _render() {
    const z = this._zones;
    if (!z.length) {
      this._$.content.innerHTML = `
        <div class="empty">
          <div class="empty-icon">&#128269;</div>
          <div class="empty-text">No zones configured yet</div>
          <button class="add-btn" id="emptyAdd">+ Add Your First Zone</button>
        </div>`;
      this.shadowRoot.getElementById("emptyAdd").onclick =
        () => this._openModal();
      return;
    }

    let h = `<table>
      <thead><tr>
        <th style="width:40px"></th>
        <th>Sensor</th>
        <th>Target</th>
        <th>Group</th>
        <th>Delay</th>
        <th style="width:120px"></th>
      </tr></thead><tbody>`;

    z.forEach((zone, i) => {
      const st = this._hass.states[zone.sensor];
      const on = st?.state === "on";
      const name = st?.attributes?.friendly_name
        || zone.sensor.split(".").pop().replace(/_/g, " ");

      let target;
      if (zone.target_type === "area") {
        const aName = this._areaName(zone.target_area);
        target = `<span class="target-badge area">${aName}</span>`;
      } else {
        const n = (zone.target_entities || []).length;
        target = `<span class="target-badge entities">${n} entities</span>`;
      }

      const group = zone.group
        ? `<span class="group-badge">${zone.group}</span>`
        : "—";

      h += `<tr>
        <td><span class="dot ${on ? "on" : "off"}"></span></td>
        <td>
          <div class="sensor-name">${name}</div>
        </td>
        <td>${target}</td>
        <td>${group}</td>
        <td>${zone.delay || 300}s</td>
        <td class="actions">
          <button class="act-btn" data-a="e" data-i="${i}">Edit</button>
          <button class="act-btn del" data-a="d" data-i="${i}">Delete</button>
        </td>
      </tr>`;
    });

    h += "</tbody></table>";
    this._$.content.innerHTML = h;

    this._$.content.querySelectorAll(".act-btn").forEach(btn => {
      btn.onclick = () => {
        const i = +btn.dataset.i;
        btn.dataset.a === "e"
          ? this._openModal(i)
          : this._deleteZone(i);
      };
    });
  }

  _areaName(id) {
    const areas = this._hass.areas || {};
    const a = Object.values(areas).find(x => x.area_id === id);
    return a ? a.name : id;
  }

  _openModal(idx = null) {
    this._editIdx = idx;
    this._$.modalTitle.textContent =
      idx !== null ? "Edit Zone" : "Add Zone";

    const s = this._hass.states;

    // Sensors
    this._$.fSensor.innerHTML = "";
    Object.keys(s)
      .filter(e => e.startsWith("binary_sensor.")
        && e.includes("presence_sensor"))
      .sort()
      .forEach(e => {
        const o = new Option(
          s[e].attributes.friendly_name || e, e
        );
        this._$.fSensor.add(o);
      });

    // Areas
    this._$.fArea.innerHTML = "";
    Object.values(this._hass.areas || {})
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(a => {
        this._$.fArea.add(new Option(a.name, a.area_id));
      });

    // Entities
    this._$.fEnt.innerHTML = "";
    Object.keys(s)
      .filter(e => e.startsWith("light.")
        || e.startsWith("switch."))
      .sort()
      .forEach(e => {
        this._$.fEnt.add(new Option(
          s[e].attributes.friendly_name || e, e
        ));
      });

    // Pre-fill
    if (idx !== null && this._zones[idx]) {
      const z = this._zones[idx];
      this._$.fSensor.value = z.sensor;
      this._$.fType.value = z.target_type;
      this._$.fArea.value = z.target_area || "";
      Array.from(this._$.fEnt.options).forEach(o =>
        o.selected = (z.target_entities || []).includes(o.value)
      );
      this._$.fGroup.value = z.group || "";
      this._$.fDelay.value = z.delay || 300;
    } else {
      this._$.fGroup.value = "";
      this._$.fDelay.value = 300;
    }

    this._toggleTarget();
    this._$.overlay.classList.add("open");
  }

  _closeModal() {
    this._$.overlay.classList.remove("open");
    this._editIdx = null;
  }

  async _saveZone() {
    const tt = this._$.fType.value;
    const zone = {
      sensor: this._$.fSensor.value,
      target_type: tt,
      target_area: tt === "area" ? this._$.fArea.value : "",
      target_entities: tt === "entities"
        ? Array.from(this._$.fEnt.selectedOptions).map(o => o.value)
        : [],
      group: this._$.fGroup.value.trim(),
      delay: parseInt(this._$.fDelay.value) || 300,
    };

    const zones = [...this._zones];
    if (this._editIdx !== null) {
      zones[this._editIdx] = zone;
    } else {
      zones.push(zone);
    }

    await this._hass.connection.sendMessagePromise({
      type: "fp2_zone_manager/zones/set",
      zones,
    });

    this._zones = zones;
    this._render();
    this._closeModal();
  }

  async _deleteZone(i) {
    const zones = [...this._zones];
    zones.splice(i, 1);

    await this._hass.connection.sendMessagePromise({
      type: "fp2_zone_manager/zones/set",
      zones,
    });

    this._zones = zones;
    this._render();
  }
}

customElements.define("fp2-zone-manager-panel", FP2ZoneManagerPanel);
