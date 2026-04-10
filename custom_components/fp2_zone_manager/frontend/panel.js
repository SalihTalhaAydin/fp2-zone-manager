class FP2ZoneManagerPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._zones = [];
    this._globalCfg = {};
    this._editIdx = null;
  }
  set hass(h) { this._hass = h; if (!this._b) { this._build(); this._b = 1; this._load(); } }
  set panel(p) { this._p = p; }

  /* ── Chip selector component ── */
  _makeChipSelect(id, container, options, label) {
    container.innerHTML = `
      <div class="cs" id="${id}">
        <div class="cs-chips" id="${id}_chips"></div>
        <select class="cs-add" id="${id}_add">
          <option value="">+ Add ${label}...</option>
        </select>
      </div>`;
    const chipsEl = container.querySelector(`#${id}_chips`);
    const addEl = container.querySelector(`#${id}_add`);
    addEl.innerHTML = `<option value="">+ Add ${label}...</option>`;
    options.forEach(o => addEl.add(new Option(o.label, o.value)));
    addEl.onchange = () => {
      if (!addEl.value) return;
      this._addChip(id, addEl.value, options.find(o => o.value === addEl.value)?.label || addEl.value);
      addEl.value = "";
    };
  }

  _addChip(id, value, label) {
    const chipsEl = this.shadowRoot.querySelector(`#${id}_chips`);
    if (chipsEl.querySelector(`[data-val="${CSS.escape(value)}"]`)) return;
    const chip = document.createElement("span");
    chip.className = "cs-chip";
    chip.dataset.val = value;
    chip.innerHTML = `${label} <span class="cs-x">&times;</span>`;
    chip.querySelector(".cs-x").onclick = () => chip.remove();
    chipsEl.appendChild(chip);
  }

  _getChipValues(id) {
    return Array.from(this.shadowRoot.querySelectorAll(`#${id}_chips .cs-chip`))
      .map(c => c.dataset.val);
  }

  _setChipValues(id, values, options) {
    const chipsEl = this.shadowRoot.querySelector(`#${id}_chips`);
    chipsEl.innerHTML = "";
    (values || []).forEach(v => {
      const opt = options.find(o => o.value === v);
      this._addChip(id, v, opt?.label || v);
    });
  }

  /* ── Time picker ── */
  _makeTimePicker(prefix, container) {
    container.innerHTML = `
      <select id="${prefix}Type" class="tp-sel">
        <option value="">Not set</option>
        <option value="fixed">Fixed time</option>
        <option value="sunrise">Sunrise</option>
        <option value="sunset">Sunset</option>
      </select>
      <div id="${prefix}Fixed" class="tp-row" style="display:none">
        <input type="time" id="${prefix}Time" class="tp-time">
      </div>
      <div id="${prefix}Sun" class="tp-row" style="display:none">
        <select id="${prefix}Dir" class="tp-dir"><option value="+">After (+)</option><option value="-">Before (-)</option></select>
        <input type="number" id="${prefix}H" value="0" min="0" max="12" class="tp-num" placeholder="h">
        <span class="tp-label">h</span>
        <input type="number" id="${prefix}M" value="0" min="0" max="59" class="tp-num" placeholder="m">
        <span class="tp-label">m</span>
      </div>`;
    const typeEl = container.querySelector(`#${prefix}Type`);
    typeEl.onchange = () => {
      container.querySelector(`#${prefix}Fixed`).style.display = typeEl.value === "fixed" ? "flex" : "none";
      container.querySelector(`#${prefix}Sun`).style.display = (typeEl.value === "sunrise" || typeEl.value === "sunset") ? "flex" : "none";
    };
  }

  _setTimePicker(prefix, value) {
    const $ = id => this.shadowRoot.getElementById(id);
    if (!value) { $(`${prefix}Type`).value = ""; $(`${prefix}Fixed`).style.display = "none"; $(`${prefix}Sun`).style.display = "none"; return; }
    const v = value.trim().toLowerCase();
    if (v.startsWith("sunrise") || v.startsWith("sunset")) {
      const kind = v.startsWith("sunrise") ? "sunrise" : "sunset";
      $(`${prefix}Type`).value = kind;
      $(`${prefix}Fixed`).style.display = "none";
      $(`${prefix}Sun`).style.display = "flex";
      const rest = v.slice(kind.length);
      let dir = "+", hrs = 0, mins = 0;
      if (rest.startsWith("-")) dir = "-";
      const n = rest.replace(/^[+-]/, "");
      const hM = n.match(/(\d+)h/); const mM = n.match(/(\d+)m?$/);
      if (hM) hrs = parseInt(hM[1]);
      if (mM && !n.endsWith("h")) mins = parseInt(mM[1]);
      if (!hM && !n.includes("m") && n) mins = parseInt(n) || 0;
      $(`${prefix}Dir`).value = dir; $(`${prefix}H`).value = hrs; $(`${prefix}M`).value = mins;
    } else {
      $(`${prefix}Type`).value = "fixed"; $(`${prefix}Fixed`).style.display = "flex"; $(`${prefix}Sun`).style.display = "none"; $(`${prefix}Time`).value = v;
    }
  }

  _getTimePicker(prefix) {
    const $ = id => this.shadowRoot.getElementById(id);
    const type = $(`${prefix}Type`).value;
    if (!type) return "";
    if (type === "fixed") return $(`${prefix}Time`).value || "";
    const dir = $(`${prefix}Dir`).value;
    const h = parseInt($(`${prefix}H`).value) || 0;
    const m = parseInt($(`${prefix}M`).value) || 0;
    if (!h && !m) return type;
    let off = dir;
    if (h) off += h + "h";
    if (m) off += m + "m";
    return type + off;
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
      tr.disabled td { opacity:.4; }
      .dots { display:flex; gap:4px; align-items:center; }
      .dot { width:9px; height:9px; border-radius:50%; }
      .dot.on { background:#4caf50; box-shadow:0 0 5px #4caf50aa; }
      .dot.off { background:#9e9e9e; }
      .chips { display:flex; flex-wrap:wrap; gap:4px; }
      .chip { display:inline-block; padding:3px 9px; border-radius:6px; font-size:.82em; font-weight:500; }
      .chip.area { background:var(--primary-color); color:#fff; opacity:.85; }
      .chip.ent { background:var(--accent-color,#ff9800); color:#fff; opacity:.85; }
      .chip.sensor { background:var(--divider-color); color:var(--primary-text-color); }
      .acts { display:flex; gap:6px; align-items:center; }
      .abtn { background:none; border:1px solid var(--divider-color); cursor:pointer;
        padding:5px 10px; border-radius:6px; color:var(--primary-text-color); font-size:.83em; }
      .abtn:hover { background:var(--divider-color); }
      .abtn.del { color:var(--error-color,#db4437); border-color:currentColor; }
      .abtn.del:hover { background:var(--error-color); color:#fff; }
      .toggle { position:relative; width:40px; height:22px; cursor:pointer; }
      .toggle input { opacity:0; width:0; height:0; }
      .toggle .slider { position:absolute; inset:0; background:#ccc; border-radius:22px; transition:.3s; }
      .toggle .slider:before { content:""; position:absolute; height:16px; width:16px; left:3px; bottom:3px;
        background:#fff; border-radius:50%; transition:.3s; }
      .toggle input:checked + .slider { background:var(--primary-color); }
      .toggle input:checked + .slider:before { transform:translateX(18px); }
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
      .hint { font-size:.73em; color:var(--secondary-text-color); margin-top:4px; }
      .mbtns { display:flex; justify-content:flex-end; gap:10px; margin-top:24px; }
      .mbtns button { padding:10px 20px; border-radius:8px; border:none; cursor:pointer; font-size:.93em; font-weight:500; }
      .bc { background:var(--divider-color); color:var(--primary-text-color); }
      .bs { background:var(--primary-color); color:#fff; }
      .bs:hover,.bc:hover { opacity:.85; }
      .section-label { font-size:.75em; text-transform:uppercase; letter-spacing:.5px; color:var(--secondary-text-color);
        margin:20px 0 8px; font-weight:600; border-top:1px solid var(--divider-color); padding-top:16px; }
      .adv-toggle { display:flex; align-items:center; gap:6px; cursor:pointer; padding:12px 0;
        color:var(--secondary-text-color); font-size:.85em; font-weight:500; border-top:1px solid var(--divider-color);
        margin-top:12px; user-select:none; }
      .adv-toggle:hover { color:var(--primary-color); }
      .adv-toggle .arrow { display:inline-block; transition:transform .2s; }
      .adv-toggle.open .arrow { transform:rotate(90deg); }
      .adv-sec { display:none; padding-top:4px; }
      .adv-sec.open { display:block; }
      .global-info { font-size:.8em; color:var(--secondary-text-color); background:var(--divider-color);
        padding:8px 12px; border-radius:8px; margin-bottom:16px; }
      /* Chip selector */
      .cs { margin-top:4px; }
      .cs-chips { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:6px; min-height:24px; }
      .cs-chip { display:inline-flex; align-items:center; gap:4px; padding:4px 10px; border-radius:8px;
        font-size:.85em; background:var(--primary-color); color:#fff; }
      .cs-x { cursor:pointer; font-size:1.1em; opacity:.7; margin-left:2px; }
      .cs-x:hover { opacity:1; }
      .cs-add { width:100%; padding:8px; border:1px solid var(--divider-color); border-radius:8px;
        background:var(--card-background-color); color:var(--primary-text-color); font-size:.9em; }
      /* Time picker */
      .tp-sel { width:100%; padding:8px; border:1px solid var(--divider-color); border-radius:8px;
        background:var(--card-background-color); color:var(--primary-text-color); margin-bottom:8px; }
      .tp-row { display:flex; gap:6px; align-items:center; margin-top:4px; }
      .tp-time { flex:1; padding:8px; border:1px solid var(--divider-color); border-radius:8px;
        background:var(--card-background-color); color:var(--primary-text-color); }
      .tp-dir { padding:8px; border:1px solid var(--divider-color); border-radius:8px;
        background:var(--card-background-color); color:var(--primary-text-color); }
      .tp-num { width:55px; padding:8px; border:1px solid var(--divider-color); border-radius:8px;
        background:var(--card-background-color); color:var(--primary-text-color); }
      .tp-label { color:var(--secondary-text-color); font-size:.85em; }
    </style>

    <div class="hdr">
      <div><h1>FP2 Zone Manager</h1><div class="sub">Map presence zones to lights, areas, and entities</div></div>
      <div style="display:flex;gap:10px;">
        <button class="btn-settings" id="settingsBtn">Settings</button>
        <button class="btn-add" id="addBtn">+ Add Zone</button>
      </div>
    </div>
    <div id="globalBar"></div>
    <div class="card"><div id="ct"></div></div>

    <!-- Global Settings -->
    <div class="ov" id="gov">
      <div class="modal">
        <h2>Global Defaults</h2>
        <div class="hint" style="margin-bottom:16px;">Applied to all zones without their own values.</div>
        <div class="f"><label>Default active from</label><div id="gStartP"></div></div>
        <div class="f"><label>Default active until</label><div id="gEndP"></div></div>
        <div class="f"><label>Default turn-off delay (seconds)</label><input type="number" id="gD" value="300" min="1" max="3600"></div>
        <div class="mbtns"><button class="bc" id="gcn">Cancel</button><button class="bs" id="gsv">Save</button></div>
      </div>
    </div>

    <!-- Zone Edit -->
    <div class="ov" id="ov">
      <div class="modal">
        <h2 id="mt">Add Zone Mapping</h2>
        <div class="f"><label>Presence Sensors</label><div id="csSensors"></div></div>
        <div class="section-label">Targets</div>
        <div class="f"><label>Areas</label><div id="csAreas"></div></div>
        <div class="f"><label>Entities</label><div id="csEntities"></div></div>
        <div class="adv-toggle" id="advT"><span class="arrow">&#9656;</span><span>Advanced options</span></div>
        <div class="adv-sec" id="advS">
          <div class="f"><label>Turn-off delay (seconds)</label><input type="number" id="fD" value="" min="1" max="3600" placeholder="Use global default"></div>
          <div class="f"><label>Active from</label><div id="zStartP"></div></div>
          <div class="f"><label>Active until</label><div id="zEndP"></div></div>
        </div>
        <div class="mbtns"><button class="bc" id="cn">Cancel</button><button class="bs" id="sv">Save</button></div>
      </div>
    </div>`;

    const $ = id => this.shadowRoot.getElementById(id);
    this._el = { ct:$("ct"), ov:$("ov"), mt:$("mt"), fD:$("fD"), gov:$("gov"), gD:$("gD"), globalBar:$("globalBar") };

    this._makeTimePicker("gStart", $("gStartP"));
    this._makeTimePicker("gEnd", $("gEndP"));
    this._makeTimePicker("zStart", $("zStartP"));
    this._makeTimePicker("zEnd", $("zEndP"));

    $("addBtn").onclick = () => this._open();
    $("cn").onclick = () => this._close();
    $("sv").onclick = () => this._save();
    $("settingsBtn").onclick = () => this._openGlobal();
    $("gcn").onclick = () => this._closeGlobal();
    $("gsv").onclick = () => this._saveGlobal();

    const at = $("advT"), as = $("advS");
    at.onclick = () => { at.classList.toggle("open"); as.classList.toggle("open"); };
    this._el.advT = at; this._el.advS = as;
  }

  /* ── Data ── */
  async _load() {
    try {
      const r = await this._hass.connection.sendMessagePromise({ type: "fp2_zone_manager/zones/get" });
      this._zones = r.zones || []; this._globalCfg = r.global || {};
    } catch { this._zones = []; this._globalCfg = {}; }
    this._render();
  }

  _sensorOpts() {
    return Object.keys(this._hass.states)
      .filter(e => e.startsWith("binary_sensor.") && e.includes("presence_sensor"))
      .sort().map(e => ({ value: e, label: this._hass.states[e].attributes.friendly_name || e }));
  }
  _areaOpts() {
    return Object.values(this._hass.areas || {})
      .sort((a,b) => a.name.localeCompare(b.name))
      .map(a => ({ value: a.area_id, label: a.name }));
  }
  _entityOpts() {
    return Object.keys(this._hass.states)
      .filter(e => e.startsWith("light.") || e.startsWith("switch.") || e.startsWith("fan."))
      .sort().map(e => ({ value: e, label: this._hass.states[e].attributes.friendly_name || e }));
  }

  /* ── Render ── */
  _render() {
    const g = this._globalCfg;
    if (g.global_start || g.global_end) {
      this._el.globalBar.innerHTML = `<div class="global-info">Defaults: Active ${g.global_start||"—"} → ${g.global_end||"—"}, delay ${g.global_delay||300}s</div>`;
    } else { this._el.globalBar.innerHTML = ""; }

    const z = this._zones;
    if (!z.length) {
      this._el.ct.innerHTML = `<div class="empty"><div class="empty-icon">&#9881;</div><div class="empty-text">No zone mappings yet</div><button class="btn-add" id="ea">+ Add Your First Zone</button></div>`;
      this.shadowRoot.getElementById("ea").onclick = () => this._open();
      return;
    }

    let h = `<table><thead><tr><th style="width:40px"></th><th style="width:50px">Status</th><th>Sensors</th><th>Targets</th><th>Window</th><th>Delay</th><th style="width:150px"></th></tr></thead><tbody>`;
    z.forEach((zone, i) => {
      const enabled = zone.enabled !== false;
      const sensors = zone.sensors || [];
      const dots = sensors.map(s => { const st = this._hass.states[s]; return `<span class="dot ${st?.state==="on"?"on":"off"}" title="${s}"></span>`; }).join("");
      const sChips = sensors.map(s => { const st = this._hass.states[s]; return `<span class="chip sensor">${st?.attributes?.friendly_name||s.split(".").pop().replace(/_/g," ")}</span>`; }).join("");
      const aChips = (zone.target_areas||[]).map(a => `<span class="chip area">${this._areaName(a)}</span>`).join("");
      const eChips = (zone.target_entities||[]).map(e => { const st = this._hass.states[e]; return `<span class="chip ent">${st?.attributes?.friendly_name||e.split(".").pop()}</span>`; }).join("");
      const st2 = (zone.start_time||"").trim(), et2 = (zone.end_time||"").trim();
      const win = (st2||et2) ? `${st2||"—"} → ${et2||"—"}` : "Global";
      const delay = zone.delay ? `${zone.delay}s` : "Global";

      h += `<tr class="${enabled?"":"disabled"}">
        <td><label class="toggle"><input type="checkbox" ${enabled?"checked":""} data-i="${i}" data-a="toggle"><span class="slider"></span></label></td>
        <td><div class="dots">${dots}</div></td>
        <td><div class="chips">${sChips}</div></td>
        <td><div class="chips">${aChips}${eChips}</div></td>
        <td>${win}</td><td>${delay}</td>
        <td class="acts">
          <button class="abtn" data-a="e" data-i="${i}">Edit</button>
          <button class="abtn del" data-a="d" data-i="${i}">Delete</button>
        </td></tr>`;
    });
    h += "</tbody></table>";
    this._el.ct.innerHTML = h;

    this._el.ct.querySelectorAll("[data-a]").forEach(el => {
      const i = +el.dataset.i, a = el.dataset.a;
      if (a === "e") el.onclick = () => this._open(i);
      else if (a === "d") el.onclick = () => this._del(i);
      else if (a === "toggle") el.onchange = () => this._toggle(i, el.checked);
    });
  }

  _areaName(id) { const a = Object.values(this._hass.areas||{}).find(x=>x.area_id===id); return a?a.name:id; }

  async _toggle(i, enabled) {
    const zones = [...this._zones];
    zones[i] = { ...zones[i], enabled };
    await this._hass.connection.sendMessagePromise({ type:"fp2_zone_manager/zones/set", zones });
    this._zones = zones;
    this._render();
  }

  /* ── Global ── */
  _openGlobal() {
    const g = this._globalCfg||{};
    this._setTimePicker("gStart", g.global_start||"");
    this._setTimePicker("gEnd", g.global_end||"");
    this._el.gD.value = g.global_delay||300;
    this._el.gov.classList.add("open");
  }
  _closeGlobal() { this._el.gov.classList.remove("open"); }
  async _saveGlobal() {
    const ng = { global_start:this._getTimePicker("gStart"), global_end:this._getTimePicker("gEnd"), global_delay:parseInt(this._el.gD.value)||300 };
    await this._hass.connection.sendMessagePromise({ type:"fp2_zone_manager/global/set", global:ng });
    this._globalCfg = ng; this._closeGlobal(); this._render();
  }

  /* ── Zone edit ── */
  _open(idx=null) {
    this._editIdx = idx;
    this._el.mt.textContent = idx!==null ? "Edit Zone Mapping" : "Add Zone Mapping";

    const sOpts = this._sensorOpts(), aOpts = this._areaOpts(), eOpts = this._entityOpts();
    this._makeChipSelect("csSensors", this.shadowRoot.getElementById("csSensors"), sOpts, "sensor");
    this._makeChipSelect("csAreas", this.shadowRoot.getElementById("csAreas"), aOpts, "area");
    this._makeChipSelect("csEntities", this.shadowRoot.getElementById("csEntities"), eOpts, "entity");

    let hasAdv = false;
    if (idx!==null && this._zones[idx]) {
      const z = this._zones[idx];
      this._setChipValues("csSensors", z.sensors, sOpts);
      this._setChipValues("csAreas", z.target_areas, aOpts);
      this._setChipValues("csEntities", z.target_entities, eOpts);
      this._el.fD.value = z.delay||"";
      this._setTimePicker("zStart", z.start_time||"");
      this._setTimePicker("zEnd", z.end_time||"");
      hasAdv = !!(z.delay||z.start_time||z.end_time);
    } else {
      this._el.fD.value = "";
      this._setTimePicker("zStart","");
      this._setTimePicker("zEnd","");
    }
    if (hasAdv) { this._el.advT.classList.add("open"); this._el.advS.classList.add("open"); }
    else { this._el.advT.classList.remove("open"); this._el.advS.classList.remove("open"); }
    this._el.ov.classList.add("open");
  }

  _close() { this._el.ov.classList.remove("open"); this._editIdx=null; }

  async _save() {
    const sensors = this._getChipValues("csSensors");
    const areas = this._getChipValues("csAreas");
    const ents = this._getChipValues("csEntities");
    if (!sensors.length) { alert("Select at least one sensor."); return; }
    if (!areas.length && !ents.length) { alert("Select at least one area or entity."); return; }

    const zone = {
      enabled: true, sensors, target_areas:areas, target_entities:ents,
      delay: parseInt(this._el.fD.value)||0,
      start_time: this._getTimePicker("zStart"),
      end_time: this._getTimePicker("zEnd"),
    };
    if (this._editIdx!==null) zone.enabled = this._zones[this._editIdx].enabled !== false;

    const zones = [...this._zones];
    if (this._editIdx!==null) zones[this._editIdx] = zone;
    else zones.push(zone);
    await this._hass.connection.sendMessagePromise({ type:"fp2_zone_manager/zones/set", zones });
    this._zones = zones; this._render(); this._close();
  }

  async _del(i) {
    const zones = [...this._zones]; zones.splice(i,1);
    await this._hass.connection.sendMessagePromise({ type:"fp2_zone_manager/zones/set", zones });
    this._zones = zones; this._render();
  }
}
customElements.define("fp2-zone-manager-panel", FP2ZoneManagerPanel);
