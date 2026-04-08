class FP2ZoneManagerCard extends HTMLElement {
  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) {
      this._initialize();
      this._initialized = true;
    }
    this._updateCard();
  }

  setConfig(config) {
    this._config = config;
  }

  _initialize() {
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 16px; }
        .header {
          display: flex; justify-content: space-between;
          align-items: center; margin-bottom: 16px;
        }
        .title { font-size: 1.2em; font-weight: 500; }
        .add-btn {
          background: var(--primary-color); color: white;
          border: none; border-radius: 8px; padding: 8px 16px;
          cursor: pointer; font-weight: 500;
        }
        .add-btn:hover { opacity: 0.9; }
        table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
        th {
          text-align: left; padding: 8px 6px;
          border-bottom: 2px solid var(--divider-color);
          color: var(--secondary-text-color); font-weight: 500;
          font-size: 0.8em; text-transform: uppercase;
        }
        td {
          padding: 10px 6px;
          border-bottom: 1px solid var(--divider-color);
        }
        tr:last-child td { border-bottom: none; }
        .actions { display: flex; gap: 4px; }
        .icon-btn {
          background: none; border: none; cursor: pointer;
          padding: 6px; border-radius: 4px;
          color: var(--secondary-text-color); font-size: 1em;
        }
        .icon-btn:hover { background: var(--divider-color); }
        .icon-btn.del:hover { color: var(--error-color, #db4437); }
        .empty {
          text-align: center; padding: 32px;
          color: var(--secondary-text-color);
        }
        .dot {
          display: inline-block; width: 8px; height: 8px;
          border-radius: 50%; margin-right: 6px;
        }
        .dot.on { background: #4caf50; }
        .dot.off { background: #bdbdbd; }
        .overlay {
          display: none; position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.5); z-index: 999;
          justify-content: center; align-items: center;
        }
        .overlay.open { display: flex; }
        .modal {
          background: var(--card-background-color, #fff);
          border-radius: 12px; padding: 24px;
          min-width: 320px; max-width: 420px; width: 90%;
          box-shadow: 0 4px 24px rgba(0,0,0,0.3);
        }
        .modal h3 { margin: 0 0 16px; }
        .f { margin-bottom: 12px; }
        .f label {
          display: block; margin-bottom: 4px;
          font-size: 0.85em; color: var(--secondary-text-color);
        }
        .f select, .f input {
          width: 100%; padding: 8px;
          border: 1px solid var(--divider-color);
          border-radius: 6px;
          background: var(--card-background-color);
          color: var(--primary-text-color);
          box-sizing: border-box;
        }
        .f select[multiple] { height: 120px; }
        .btns {
          display: flex; justify-content: flex-end;
          gap: 8px; margin-top: 16px;
        }
        .btns button {
          padding: 8px 16px; border-radius: 6px;
          border: none; cursor: pointer;
        }
        .bc { background: var(--divider-color); color: var(--primary-text-color); }
        .bs { background: var(--primary-color); color: white; }
      </style>
      <ha-card>
        <div class="header">
          <span class="title">FP2 Zone Manager</span>
          <button class="add-btn" id="add">+ Add Zone</button>
        </div>
        <div id="ct"></div>
      </ha-card>
      <div class="overlay" id="ov">
        <div class="modal">
          <h3 id="mt">Add Zone</h3>
          <div class="f"><label>Presence Sensor</label><select id="ss"></select></div>
          <div class="f"><label>Target Type</label>
            <select id="tt">
              <option value="area">Area (all lights)</option>
              <option value="entities">Specific entities</option>
            </select>
          </div>
          <div class="f" id="af"><label>Area</label><select id="as"></select></div>
          <div class="f" id="ef" style="display:none">
            <label>Entities (Ctrl+click for multiple)</label>
            <select id="es" multiple></select>
          </div>
          <div class="f"><label>Group (optional)</label>
            <input id="gi" placeholder="e.g. basement_kitchen">
          </div>
          <div class="f"><label>Turn-off delay (seconds)</label>
            <input type="number" id="di" value="300" min="1" max="3600">
          </div>
          <div class="btns">
            <button class="bc" id="cn">Cancel</button>
            <button class="bs" id="sv">Save</button>
          </div>
        </div>
      </div>`;

    const $ = (id) => this.shadowRoot.getElementById(id);
    this._el = { ct: $("ct"), ov: $("ov"), mt: $("mt"),
      ss: $("ss"), tt: $("tt"), af: $("af"), ef: $("ef"),
      as: $("as"), es: $("es"), gi: $("gi"), di: $("di") };
    this._editIdx = null;
    this._zones = [];

    $("add").onclick = () => this._open();
    $("cn").onclick = () => this._close();
    $("sv").onclick = () => this._save();
    this._el.tt.onchange = () => {
      const a = this._el.tt.value === "area";
      this._el.af.style.display = a ? "" : "none";
      this._el.ef.style.display = a ? "none" : "";
    };
  }

  async _load() {
    try {
      const r = await this._hass.connection.sendMessagePromise(
        { type: "fp2_zone_manager/zones/get" }
      );
      this._zones = r.zones || [];
      this._entryId = r.entry_id;
    } catch (e) {
      this._zones = [];
    }
  }

  async _saveZones(zones) {
    await this._hass.connection.sendMessagePromise({
      type: "fp2_zone_manager/zones/set",
      zones: zones,
    });
    this._zones = zones;
    this._render();
  }

  async _updateCard() {
    await this._load();
    this._render();
  }

  _render() {
    const z = this._zones;
    if (!z.length) {
      this._el.ct.innerHTML = '<div class="empty">No zones configured. Click + Add Zone.</div>';
      return;
    }
    let h = `<table><thead><tr>
      <th></th><th>Sensor</th><th>Target</th>
      <th>Group</th><th>Delay</th><th></th>
    </tr></thead><tbody>`;
    z.forEach((zone, i) => {
      const st = this._hass.states[zone.sensor];
      const on = st?.state === "on";
      const name = st?.attributes?.friendly_name
        || zone.sensor.split(".").pop();
      const tgt = zone.target_type === "area"
        ? this._areaName(zone.target_area)
        : `${(zone.target_entities||[]).length} entities`;
      h += `<tr>
        <td><span class="dot ${on?"on":"off"}"></span></td>
        <td>${name}</td><td>${tgt}</td>
        <td>${zone.group||"—"}</td><td>${zone.delay||300}s</td>
        <td class="actions">
          <button class="icon-btn" data-i="${i}" data-a="e">&#9998;</button>
          <button class="icon-btn del" data-i="${i}" data-a="d">&#10005;</button>
        </td></tr>`;
    });
    h += "</tbody></table>";
    this._el.ct.innerHTML = h;
    this._el.ct.querySelectorAll(".icon-btn").forEach(b => {
      b.onclick = () => {
        const i = +b.dataset.i;
        b.dataset.a === "e" ? this._open(i) : this._del(i);
      };
    });
  }

  _areaName(id) {
    const areas = this._hass.areas || {};
    const area = Object.values(areas).find(a => a.area_id === id);
    return area ? area.name : id;
  }

  _open(idx = null) {
    this._editIdx = idx;
    this._el.mt.textContent = idx !== null ? "Edit Zone" : "Add Zone";
    const s = this._hass.states;

    // Sensors
    this._el.ss.innerHTML = "";
    Object.keys(s).filter(e =>
      e.startsWith("binary_sensor.") &&
      e.includes("presence_sensor") &&
      e.includes("fp2")
    ).sort().forEach(e => {
      const o = document.createElement("option");
      o.value = e;
      o.textContent = s[e].attributes.friendly_name || e;
      this._el.ss.appendChild(o);
    });

    // Areas
    this._el.as.innerHTML = "";
    Object.values(this._hass.areas || {})
      .sort((a,b) => a.name.localeCompare(b.name))
      .forEach(a => {
        const o = document.createElement("option");
        o.value = a.area_id; o.textContent = a.name;
        this._el.as.appendChild(o);
      });

    // Entities
    this._el.es.innerHTML = "";
    Object.keys(s).filter(e =>
      e.startsWith("light.") || e.startsWith("switch.")
    ).sort().forEach(e => {
      const o = document.createElement("option");
      o.value = e;
      o.textContent = s[e].attributes.friendly_name || e;
      this._el.es.appendChild(o);
    });

    // Pre-fill
    if (idx !== null && this._zones[idx]) {
      const z = this._zones[idx];
      this._el.ss.value = z.sensor;
      this._el.tt.value = z.target_type;
      this._el.as.value = z.target_area || "";
      Array.from(this._el.es.options).forEach(o =>
        o.selected = (z.target_entities||[]).includes(o.value)
      );
      this._el.gi.value = z.group || "";
      this._el.di.value = z.delay || 300;
    } else {
      this._el.gi.value = "";
      this._el.di.value = 300;
    }

    const a = this._el.tt.value === "area";
    this._el.af.style.display = a ? "" : "none";
    this._el.ef.style.display = a ? "none" : "";
    this._el.ov.classList.add("open");
  }

  _close() {
    this._el.ov.classList.remove("open");
    this._editIdx = null;
  }

  async _save() {
    const tt = this._el.tt.value;
    const zone = {
      sensor: this._el.ss.value,
      target_type: tt,
      target_area: tt === "area" ? this._el.as.value : "",
      target_entities: tt === "entities"
        ? Array.from(this._el.es.selectedOptions).map(o => o.value)
        : [],
      group: this._el.gi.value.trim(),
      delay: parseInt(this._el.di.value) || 300,
    };
    const zones = [...this._zones];
    if (this._editIdx !== null) zones[this._editIdx] = zone;
    else zones.push(zone);
    await this._saveZones(zones);
    this._close();
  }

  async _del(i) {
    const zones = [...this._zones];
    zones.splice(i, 1);
    await this._saveZones(zones);
  }

  getCardSize() { return 3; }
  static getStubConfig() { return {}; }
}

customElements.define("fp2-zone-manager-card", FP2ZoneManagerCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "fp2-zone-manager-card",
  name: "FP2 Zone Manager",
  description: "Manage FP2 presence zone-to-light mappings",
});
