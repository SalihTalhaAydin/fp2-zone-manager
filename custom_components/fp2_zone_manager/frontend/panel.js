class FP2ZoneManagerPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._zones = [];
    this._globalCfg = {};
    this._editIdx = null;
  }

  set hass(h) {
    this._hass = h;
    if (!this._b) { this._build(); this._b = 1; this._load(); }
  }
  set panel(p) { this._p = p; }

  /* ── Time picker component (reusable) ── */
  _makeTimePicker(prefix, container) {
    container.innerHTML = `
      <select id="${prefix}Type" style="width:100%;padding:8px;border:1px solid var(--divider-color);border-radius:8px;background:var(--card-background-color);color:var(--primary-text-color);margin-bottom:8px;">
        <option value="">Not set (use global default)</option>
        <option value="fixed">Fixed time</option>
        <option value="sunrise">Sunrise</option>
        <option value="sunset">Sunset</option>
      </select>
      <div id="${prefix}Fixed" style="display:none;">
        <input type="time" id="${prefix}Time" style="width:100%;padding:8px;border:1px solid var(--divider-color);border-radius:8px;background:var(--card-background-color);color:var(--primary-text-color);">
      </div>
      <div id="${prefix}Sun" style="display:none;display:none;gap:8px;align-items:center;">
        <select id="${prefix}Dir" style="padding:8px;border:1px solid var(--divider-color);border-radius:8px;background:var(--card-background-color);color:var(--primary-text-color);">
          <option value="+">After (+)</option>
          <option value="-">Before (-)</option>
        </select>
        <input type="number" id="${prefix}H" value="0" min="0" max="12" style="width:60px;padding:8px;border:1px solid var(--divider-color);border-radius:8px;background:var(--card-background-color);color:var(--primary-text-color);" placeholder="h">
        <span style="color:var(--secondary-text-color);">h</span>
        <input type="number" id="${prefix}M" value="0" min="0" max="59" style="width:60px;padding:8px;border:1px solid var(--divider-color);border-radius:8px;background:var(--card-background-color);color:var(--primary-text-color);" placeholder="m">
        <span style="color:var(--secondary-text-color);">m</span>
      </div>`;

    const typeEl = container.querySelector(`#${prefix}Type`);
    const fixedEl = container.querySelector(`#${prefix}Fixed`);
    const sunEl = container.querySelector(`#${prefix}Sun`);

    typeEl.onchange = () => {
      fixedEl.style.display = typeEl.value === "fixed" ? "" : "none";
      sunEl.style.display = (typeEl.value === "sunrise" || typeEl.value === "sunset") ? "flex" : "none";
    };
  }

  _setTimePicker(prefix, value) {
    const $ = id => this.shadowRoot.getElementById(id);
    const typeEl = $(`${prefix}Type`);
    const fixedEl = $(`${prefix}Fixed`);
    const sunEl = $(`${prefix}Sun`);

    if (!value) {
      typeEl.value = "";
      fixedEl.style.display = "none";
      sunEl.style.display = "none";
      return;
    }

    const v = value.trim().toLowerCase();
    if (v.startsWith("sunrise") || v.startsWith("sunset")) {
      const kind = v.startsWith("sunrise") ? "sunrise" : "sunset";
      typeEl.value = kind;
      fixedEl.style.display = "none";
      sunEl.style.display = "flex";
      const rest = v.slice(kind.length);
      let dir = "+", hrs = 0, mins = 0;
      if (rest.startsWith("-")) { dir = "-"; }
      const numStr = rest.replace(/^[+-]/, "");
      const hMatch = numStr.match(/(\d+)h/);
      const mMatch = numStr.match(/(\d+)m?$/);
      if (hMatch) hrs = parseInt(hMatch[1]);
      if (mMatch && !numStr.endsWith("h")) mins = parseInt(mMatch[1]);
      if (!hMatch && !numStr.includes("m") && numStr) mins = parseInt(numStr) || 0;
      $(`${prefix}Dir`).value = dir;
      $(`${prefix}H`).value = hrs;
      $(`${prefix}M`).value = mins;
    } else {
      typeEl.value = "fixed";
      fixedEl.style.display = "";
      sunEl.style.display = "none";
      $(`${prefix}Time`).value = v;
    }
  }

  _getTimePicker(prefix) {
    const $ = id => this.shadowRoot.getElementById(id);
    const type = $(`${prefix}Type`).value;
    if (!type) return "";
    if (type === "fixed") return $(`${prefix}Time`).value || "";
    // sunrise/sunset
    const dir = $(`${prefix}Dir`).value;
    const h = parseInt($(`${prefix}H`).value) || 0;
    const m = parseInt($(`${prefix}M`).value) || 0;
    if (!h && !m) return type;
    let offset = dir;
    if (h) offset += h + "h";
    if (m) offset += m + "m";
    return type + offset;
  }

  /* ── Build ── */
  _build() {
    this.shadowRoot.innerHTML = `
    <style>
      :host { display:block; padding:24px 24px 60px; max-width:960px; margin:0 auto;
        font-family:var(--ha-card-font-family,Roboto,sans-serif); color:var(--primary-text-color); }
      .hdr { display:flex; justify-content:space-between; align-items:center; margin-bottom:24px; }
      h1 { margin:0; font-size:1.5em; font-weight:400; }
      .sub { color:var(--secondary-text-color); font-size:.85em; margin-top:4px; }
      .btn-add { background:var(--primary-color); color:#fff; border:none; border-radius:10px;
        padding:10px 20px; cursor:pointer; font-size:.95em; font-weight:500; }
      .btn-add:hover { opacity:.85; }
      .btn-settings { background:var(--divider-color); color:var(--primary-text-color); border:none;
        border-radius:10px; padding:10px 20px; cursor:pointer; font-size:.95em; font-weight:500; }
      .btn-settings:hover { opacity:.85; }
      .card { background:var(--ha-card-background,var(--card-background-color)); border-radius:12px;
        overflow:hidden; box-shadow:var(--ha-card-box-shadow,0 2px 6px rgba(0,0,0,.1)); }
      table { width:100%; border-collapse:collapse; }
      th { text-align:left; padding:14px 16px; background:var(--table-header-background-color,rgba(0,0,0,.04));
        color:var(--secondary-text-color); font-size:.78em; font-weight:600; text-transform:uppercase; letter-spacing:.8px; }
      td { padding:14px 16px; border-top:1px solid var(--divider-color); vertical-align:middle; }
      tr:first-child td { border-top:none; }
      tr:hover td { background:rgba(0,0,0,.02); }
      .dots { display:flex; gap:4px; align-items:center; }
      .dot { width:9px; height:9px; border-radius:50%; }
      .dot.on { background:#4caf50; box-shadow:0 0 5px #4caf50aa; }
      .dot.off { background:#9e9e9e; }
      .chips { display:flex; flex-wrap:wrap; gap:4px; }
      .chip { display:inline-block; padding:3px 9px; border-radius:6px; font-size:.82em; font-weight:500; }
      .chip.area { background:var(--primary-color); color:#fff; opacity:.85; }
      .chip.ent { background:var(--accent-color,#ff9800); color:#fff; opacity:.85; }
      .chip.sensor { background:var(--divider-color); color:var(--primary-text-color); }
      .acts { display:flex; gap:6px; }
      .abtn { background:none; border:1px solid var(--divider-color); cursor:pointer;
        padding:5px 10px; border-radius:6px; color:var(--primary-text-color); font-size:.83em; }
      .abtn:hover { background:var(--divider-color); }
      .abtn.del { color:var(--error-color,#db4437); border-color:currentColor; }
      .abtn.del:hover { background:var(--error-color); color:#fff; }
      .empty { text-align:center; padding:60px 24px; color:var(--secondary-text-color); }
      .empty-icon { font-size:3em; margin-bottom:12px; opacity:.35; }
      .empty-text { font-size:1.1em; margin-bottom:16px; }
      .ov { display:none; position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:999;
        justify-content:center; align-items:center; }
      .ov.open { display:flex; }
      .modal { background:var(--ha-card-background,var(--card-background-color,#fff)); border-radius:16px;
        padding:28px; width:90%; min-width:360px; max-width:520px; box-shadow:0 8px 32px rgba(0,0,0,.3);
        max-height:85vh; overflow-y:auto; }
      .modal h2 { margin:0 0 20px; font-weight:400; font-size:1.3em; }
      .f { margin-bottom:16px; }
      .f label { display:block; margin-bottom:6px; font-size:.83em; color:var(--secondary-text-color); font-weight:500; }
      .f select, .f input { width:100%; padding:10px 12px; border:1px solid var(--divider-color);
        border-radius:8px; background:var(--card-background-color,#fff); color:var(--primary-text-color);
        font-size:.93em; box-sizing:border-box; }
      .f select:focus, .f input:focus { outline:none; border-color:var(--primary-color); }
      .f select[multiple] { height:150px; }
      .hint { font-size:.73em; color:var(--secondary-text-color); margin-top:4px; }
      .mbtns { display:flex; justify-content:flex-end; gap:10px; margin-top:24px; }
      .mbtns button { padding:10px 20px; border-radius:8px; border:none; cursor:pointer; font-size:.93em; font-weight:500; }
      .bc { background:var(--divider-color); color:var(--primary-text-color); }
      .bs { background:var(--primary-color); color:#fff; }
      .bs:hover,.bc:hover { opacity:.85; }
      .section-label { font-size:.75em; text-transform:uppercase; letter-spacing:.5px; color:var(--secondary-text-color);
        margin:20px 0 8px; font-weight:600; border-top:1px solid var(--divider-color); padding-top:16px; }
      .advanced-toggle { display:flex; align-items:center; gap:6px; cursor:pointer; padding:12px 0;
        color:var(--secondary-text-color); font-size:.85em; font-weight:500; border-top:1px solid var(--divider-color);
        margin-top:12px; user-select:none; }
      .advanced-toggle:hover { color:var(--primary-color); }
      .advanced-toggle .arrow { display:inline-block; transition:transform .2s; }
      .advanced-toggle.open .arrow { transform:rotate(90deg); }
      .advanced-section { display:none; padding-top:4px; }
      .advanced-section.open { display:block; }
      .global-info { font-size:.8em; color:var(--secondary-text-color); background:var(--divider-color);
        padding:8px 12px; border-radius:8px; margin-bottom:16px; }
    </style>

    <div class="hdr">
      <div>
        <h1>FP2 Zone Manager</h1>
        <div class="sub">Map presence zones to lights, areas, and entities</div>
      </div>
      <div style="display:flex;gap:10px;">
        <button class="btn-settings" id="settingsBtn">Settings</button>
        <button class="btn-add" id="addBtn">+ Add Zone</button>
      </div>
    </div>
    <div id="globalBar"></div>
    <div class="card"><div id="ct"></div></div>

    <!-- Global Settings Modal -->
    <div class="ov" id="gov">
      <div class="modal">
        <h2>Global Defaults</h2>
        <div class="hint" style="margin-bottom:16px;">
          Applied to all zones that don't override these values.
        </div>
        <div class="f">
          <label>Default active from</label>
          <div id="gStartPicker"></div>
        </div>
        <div class="f">
          <label>Default active until</label>
          <div id="gEndPicker"></div>
        </div>
        <div class="f">
          <label>Default turn-off delay (seconds)</label>
          <input type="number" id="gD" value="300" min="1" max="3600">
        </div>
        <div class="mbtns">
          <button class="bc" id="gcn">Cancel</button>
          <button class="bs" id="gsv">Save</button>
        </div>
      </div>
    </div>

    <!-- Zone Edit Modal -->
    <div class="ov" id="ov">
      <div class="modal">
        <h2 id="mt">Add Zone Mapping</h2>
        <div class="f">
          <label>Presence Sensors</label>
          <select id="fS" multiple></select>
          <div class="hint">Hold Ctrl/Cmd to select multiple zones.</div>
        </div>
        <div class="section-label">Targets</div>
        <div class="f">
          <label>Areas</label>
          <select id="fA" multiple></select>
          <div class="hint">All lights in selected areas. Hold Ctrl/Cmd for multiple.</div>
        </div>
        <div class="f">
          <label>Entities</label>
          <select id="fE" multiple></select>
          <div class="hint">Specific lights/switches/fans. Hold Ctrl/Cmd for multiple.</div>
        </div>

        <div class="advanced-toggle" id="advToggle">
          <span class="arrow">&#9656;</span>
          <span>Advanced options</span>
        </div>
        <div class="advanced-section" id="advSec">
          <div class="f">
            <label>Turn-off delay (seconds)</label>
            <input type="number" id="fD" value="" min="1" max="3600" placeholder="Use global default">
          </div>
          <div class="f">
            <label>Active from</label>
            <div id="zStartPicker"></div>
          </div>
          <div class="f">
            <label>Active until</label>
            <div id="zEndPicker"></div>
          </div>
        </div>

        <div class="mbtns">
          <button class="bc" id="cn">Cancel</button>
          <button class="bs" id="sv">Save</button>
        </div>
      </div>
    </div>`;

    const $ = id => this.shadowRoot.getElementById(id);
    this._el = {
      ct: $("ct"), ov: $("ov"), mt: $("mt"),
      fS: $("fS"), fA: $("fA"), fE: $("fE"), fD: $("fD"),
      gov: $("gov"), gD: $("gD"),
      globalBar: $("globalBar"),
    };

    // Build time pickers
    this._makeTimePicker("gStart", $("gStartPicker"));
    this._makeTimePicker("gEnd", $("gEndPicker"));
    this._makeTimePicker("zStart", $("zStartPicker"));
    this._makeTimePicker("zEnd", $("zEndPicker"));

    $("addBtn").onclick = () => this._open();
    $("cn").onclick = () => this._close();
    $("sv").onclick = () => this._save();
    $("settingsBtn").onclick = () => this._openGlobal();
    $("gcn").onclick = () => this._closeGlobal();
    $("gsv").onclick = () => this._saveGlobal();

    const advToggle = $("advToggle");
    const advSec = $("advSec");
    advToggle.onclick = () => {
      advToggle.classList.toggle("open");
      advSec.classList.toggle("open");
    };
    this._el.advToggle = advToggle;
    this._el.advSec = advSec;
  }

  /* ── Data ── */
  async _load() {
    try {
      const r = await this._hass.connection.sendMessagePromise(
        { type: "fp2_zone_manager/zones/get" }
      );
      this._zones = r.zones || [];
      this._globalCfg = r.global || {};
    } catch {
      this._zones = [];
      this._globalCfg = {};
    }
    this._render();
  }

  /* ── Render ── */
  _render() {
    // Global info bar
    const g = this._globalCfg;
    const gStart = g.global_start || "";
    const gEnd = g.global_end || "";
    const gDelay = g.global_delay || 300;
    if (gStart || gEnd) {
      this._el.globalBar.innerHTML = `<div class="global-info">
        Global defaults: Active ${gStart || "—"} → ${gEnd || "—"}, delay ${gDelay}s
      </div>`;
    } else {
      this._el.globalBar.innerHTML = "";
    }

    const z = this._zones;
    if (!z.length) {
      this._el.ct.innerHTML = `<div class="empty">
        <div class="empty-icon">&#9881;</div>
        <div class="empty-text">No zone mappings yet</div>
        <button class="btn-add" id="ea">+ Add Your First Zone</button>
      </div>`;
      this.shadowRoot.getElementById("ea").onclick = () => this._open();
      return;
    }

    let h = `<table><thead><tr>
      <th style="width:50px">Status</th>
      <th>Sensors</th><th>Targets</th>
      <th>Window</th><th>Delay</th><th style="width:130px"></th>
    </tr></thead><tbody>`;

    z.forEach((zone, i) => {
      const sensors = zone.sensors || [];
      const dots = sensors.map(s => {
        const st = this._hass.states[s];
        return `<span class="dot ${st?.state==="on"?"on":"off"}" title="${s}"></span>`;
      }).join("");
      const sensorChips = sensors.map(s => {
        const st = this._hass.states[s];
        const nm = st?.attributes?.friendly_name || s.split(".").pop().replace(/_/g," ");
        return `<span class="chip sensor">${nm}</span>`;
      }).join("");
      const areas = zone.target_areas || [];
      const ents = zone.target_entities || [];
      const aChips = areas.map(a => `<span class="chip area">${this._areaName(a)}</span>`).join("");
      const eChips = ents.map(e => {
        const st = this._hass.states[e];
        return `<span class="chip ent">${st?.attributes?.friendly_name || e.split(".").pop()}</span>`;
      }).join("");

      const st = (zone.start_time||"").trim();
      const et = (zone.end_time||"").trim();
      const window = (st||et) ? `${st||"—"} → ${et||"—"}` : "Global";
      const delay = zone.delay ? `${zone.delay}s` : "Global";

      h += `<tr>
        <td><div class="dots">${dots}</div></td>
        <td><div class="chips">${sensorChips}</div></td>
        <td><div class="chips">${aChips}${eChips}</div></td>
        <td>${window}</td><td>${delay}</td>
        <td class="acts">
          <button class="abtn" data-a="e" data-i="${i}">Edit</button>
          <button class="abtn del" data-a="d" data-i="${i}">Delete</button>
        </td></tr>`;
    });
    h += "</tbody></table>";
    this._el.ct.innerHTML = h;
    this._el.ct.querySelectorAll(".abtn").forEach(b => {
      b.onclick = () => {
        const i = +b.dataset.i;
        b.dataset.a === "e" ? this._open(i) : this._del(i);
      };
    });
  }

  _areaName(id) {
    const a = Object.values(this._hass.areas || {}).find(x => x.area_id === id);
    return a ? a.name : id;
  }

  /* ── Global Settings ── */
  _openGlobal() {
    const g = this._globalCfg || {};
    this._setTimePicker("gStart", g.global_start || "");
    this._setTimePicker("gEnd", g.global_end || "");
    this._el.gD.value = g.global_delay || 300;
    this._el.gov.classList.add("open");
  }
  _closeGlobal() { this._el.gov.classList.remove("open"); }
  async _saveGlobal() {
    const newG = {
      global_start: this._getTimePicker("gStart"),
      global_end: this._getTimePicker("gEnd"),
      global_delay: parseInt(this._el.gD.value) || 300,
    };
    await this._hass.connection.sendMessagePromise({
      type: "fp2_zone_manager/global/set", global: newG,
    });
    this._globalCfg = newG;
    this._closeGlobal();
    this._render();
  }

  /* ── Zone Edit ── */
  _open(idx = null) {
    this._editIdx = idx;
    this._el.mt.textContent = idx !== null ? "Edit Zone Mapping" : "Add Zone Mapping";
    const s = this._hass.states;

    this._el.fS.innerHTML = "";
    Object.keys(s).filter(e => e.startsWith("binary_sensor.") && e.includes("presence_sensor")).sort()
      .forEach(e => this._el.fS.add(new Option(s[e].attributes.friendly_name || e, e)));

    this._el.fA.innerHTML = "";
    Object.values(this._hass.areas || {}).sort((a,b) => a.name.localeCompare(b.name))
      .forEach(a => this._el.fA.add(new Option(a.name, a.area_id)));

    this._el.fE.innerHTML = "";
    Object.keys(s).filter(e => e.startsWith("light.") || e.startsWith("switch.") || e.startsWith("fan.")).sort()
      .forEach(e => this._el.fE.add(new Option(s[e].attributes.friendly_name || e, e)));

    let hasAdv = false;
    if (idx !== null && this._zones[idx]) {
      const z = this._zones[idx];
      Array.from(this._el.fS.options).forEach(o => o.selected = (z.sensors||[]).includes(o.value));
      Array.from(this._el.fA.options).forEach(o => o.selected = (z.target_areas||[]).includes(o.value));
      Array.from(this._el.fE.options).forEach(o => o.selected = (z.target_entities||[]).includes(o.value));
      this._el.fD.value = z.delay || "";
      this._setTimePicker("zStart", z.start_time || "");
      this._setTimePicker("zEnd", z.end_time || "");
      hasAdv = !!(z.delay || z.start_time || z.end_time);
    } else {
      Array.from(this._el.fS.options).forEach(o => o.selected = false);
      Array.from(this._el.fA.options).forEach(o => o.selected = false);
      Array.from(this._el.fE.options).forEach(o => o.selected = false);
      this._el.fD.value = "";
      this._setTimePicker("zStart", "");
      this._setTimePicker("zEnd", "");
    }

    if (hasAdv) {
      this._el.advToggle.classList.add("open");
      this._el.advSec.classList.add("open");
    } else {
      this._el.advToggle.classList.remove("open");
      this._el.advSec.classList.remove("open");
    }
    this._el.ov.classList.add("open");
  }

  _close() { this._el.ov.classList.remove("open"); this._editIdx = null; }

  async _save() {
    const sel = el => Array.from(el.selectedOptions).map(o => o.value);
    const sensors = sel(this._el.fS);
    const areas = sel(this._el.fA);
    const ents = sel(this._el.fE);
    if (!sensors.length) { alert("Select at least one sensor."); return; }
    if (!areas.length && !ents.length) { alert("Select at least one area or entity."); return; }

    const zone = {
      sensors, target_areas: areas, target_entities: ents,
      delay: parseInt(this._el.fD.value) || 0,
      start_time: this._getTimePicker("zStart"),
      end_time: this._getTimePicker("zEnd"),
    };
    const zones = [...this._zones];
    if (this._editIdx !== null) zones[this._editIdx] = zone;
    else zones.push(zone);

    await this._hass.connection.sendMessagePromise({ type: "fp2_zone_manager/zones/set", zones });
    this._zones = zones;
    this._render();
    this._close();
  }

  async _del(i) {
    const zones = [...this._zones];
    zones.splice(i, 1);
    await this._hass.connection.sendMessagePromise({ type: "fp2_zone_manager/zones/set", zones });
    this._zones = zones;
    this._render();
  }
}

customElements.define("fp2-zone-manager-panel", FP2ZoneManagerPanel);
