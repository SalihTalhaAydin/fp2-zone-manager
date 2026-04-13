class FP2ZoneManagerPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._groups = [];
    this._collapsed = {};
    this._editZone = null; // { gi, zi } or { gi, zi: -1 } for new
    this._editGroup = null; // group index or -1 for new
    this._chipOpts = {};
    this._chipColorClass = {};
    this._built = false;
  }

  set hass(h) {
    this._hass = h;
    if (!this._built) { this._built = true; this._buildShell(); this._load(); }
  }
  set panel(p) { this._panel = p; }

  /* ══════════════════════════════════════════
     WebSocket helpers
     ══════════════════════════════════════════ */
  async _load() {
    try {
      const r = await this._hass.callWS({ type: "fp2_zone_manager/data/get" });
      this._groups = r.groups || [];
      this._render();
    } catch (e) { console.error("ZM4 load error", e); }
  }

  async _save() {
    try {
      await this._hass.callWS({ type: "fp2_zone_manager/data/set", groups: this._groups });
      this._render();
    } catch (e) { console.error("ZM4 save error", e); }
  }

  /* ══════════════════════════════════════════
     Entity / Area helpers
     ══════════════════════════════════════════ */
  _sensorOptions() {
    if (!this._hass) return [];
    return Object.keys(this._hass.states)
      .filter(e => e.startsWith("binary_sensor.") && (e.includes("presence") || e.includes("fp2")))
      .sort()
      .map(e => ({ value: e, label: this._hass.states[e]?.attributes?.friendly_name || e }));
  }

  _areaOptions() {
    if (!this._hass?.areas) return [];
    return Object.values(this._hass.areas)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .map(a => ({ value: a.area_id, label: a.name }));
  }

  _entityOptions() {
    if (!this._hass) return [];
    const FILTER = /led_indicator|motion_detection|ambient_light|do_not_disturb|child_lock|adguard|safe_search|safe_browsing|filtering|query_log|parental_control|protection|p1s_01p09c|image_sensor|camera|identify|reboot|refresh_state/;
    return Object.keys(this._hass.states)
      .filter(e => !e.startsWith("binary_sensor.") && !FILTER.test(e))
      .sort()
      .map(e => ({ value: e, label: this._hass.states[e]?.attributes?.friendly_name || e }));
  }

  /* ══════════════════════════════════════════
     Time picker component
     ══════════════════════════════════════════ */
  _createTimePicker(prefix, container) {
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
    const type = $(`${prefix}Type`)?.value;
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

  /* ══════════════════════════════════════════
     Chip selector component
     ══════════════════════════════════════════ */
  _makeChipSelect(id, container, options, label, colorClass) {
    container.innerHTML = `
      <div class="cs" id="${id}">
        <div class="cs-chips" id="${id}_chips"></div>
        <select class="cs-add" id="${id}_add">
          <option value="">+ Add ${label}...</option>
        </select>
      </div>`;
    const addEl = container.querySelector(`#${id}_add`);
    addEl.innerHTML = `<option value="">+ Add ${label}...</option>`;
    options.forEach(o => addEl.add(new Option(o.label, o.value)));
    this._chipColorClass[id] = colorClass || "chip-default";
    this._chipOpts[id] = { options, addEl, label };
    addEl.onchange = () => {
      if (!addEl.value) return;
      this._addChip(id, addEl.value, options.find(o => o.value === addEl.value)?.label || addEl.value);
      addEl.value = "";
      this._refreshDropdown(id);
    };
  }

  _refreshDropdown(id) {
    const info = this._chipOpts[id];
    if (!info) return;
    const { options, addEl, label } = info;
    const current = this._getChipValues(id);
    addEl.innerHTML = `<option value="">+ Add ${label}...</option>`;
    options.filter(o => !current.includes(o.value)).forEach(o => addEl.add(new Option(o.label, o.value)));
  }

  _addChip(id, value, label) {
    const chipsEl = this.shadowRoot.querySelector(`#${id}_chips`);
    if (!chipsEl || chipsEl.querySelector(`[data-val="${CSS.escape(value)}"]`)) return;
    const chip = document.createElement("span");
    const cc = this._chipColorClass[id] || "chip-default";
    chip.className = `cs-chip ${cc}`;
    chip.dataset.val = value;
    chip.innerHTML = `${label} <span class="cs-x">&times;</span>`;
    chip.querySelector(".cs-x").onclick = () => { chip.remove(); this._refreshDropdown(id); };
    chipsEl.appendChild(chip);
  }

  _getChipValues(id) {
    return Array.from(this.shadowRoot.querySelectorAll(`#${id}_chips .cs-chip`)).map(c => c.dataset.val);
  }

  _setChipValues(id, values, options) {
    const chipsEl = this.shadowRoot.querySelector(`#${id}_chips`);
    if (!chipsEl) return;
    chipsEl.innerHTML = "";
    (values || []).forEach(v => {
      const opt = options.find(o => o.value === v);
      this._addChip(id, v, opt?.label || v);
    });
    this._refreshDropdown(id);
  }

  /* ══════════════════════════════════════════
     Format helpers
     ══════════════════════════════════════════ */
  _fmtTime(v) {
    if (!v) return "";
    return v;
  }

  _sensorName(id) {
    return this._hass?.states[id]?.attributes?.friendly_name || id;
  }

  _areaName(id) {
    if (!this._hass?.areas) return id;
    const a = Object.values(this._hass.areas).find(a => a.area_id === id);
    return a?.name || id;
  }

  _entityName(id) {
    return this._hass?.states[id]?.attributes?.friendly_name || id;
  }

  _isPresent(sensorId) {
    return this._hass?.states[sensorId]?.state === "on";
  }

  /* ══════════════════════════════════════════
     Shell (styles + layout)
     ══════════════════════════════════════════ */
  _buildShell() {
    this.shadowRoot.innerHTML = `
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

      :host {
        display: block;
        padding: 32px 32px 80px;
        max-width: 1060px;
        margin: 0 auto;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: var(--primary-text-color, #e1e1e1);
        -webkit-font-smoothing: antialiased;
      }

      /* ── Header ── */
      .hdr { display: flex; justify-content: space-between; align-items: center; margin-bottom: 28px; }
      h1 {
        margin: 0; font-size: 1.65em; font-weight: 700; letter-spacing: -0.02em;
        background: linear-gradient(135deg, #60a5fa, #a78bfa);
        -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
      }
      .sub { color: var(--secondary-text-color, #9ca3af); font-size: 0.85em; margin-top: 4px; font-weight: 400; }

      /* ── Buttons ── */
      .btn-primary {
        background: linear-gradient(135deg, #3b82f6, #6366f1); color: #fff; border: none; border-radius: 12px;
        padding: 10px 22px; cursor: pointer; font-size: 0.9em; font-weight: 600; font-family: inherit;
        transition: all 0.2s ease; box-shadow: 0 2px 8px rgba(59,130,246,0.3);
      }
      .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(59,130,246,0.4); }
      .btn-primary:active { transform: translateY(0); }

      .btn-glass {
        background: rgba(255,255,255,0.06); color: var(--primary-text-color, #e1e1e1);
        border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 10px 22px;
        cursor: pointer; font-size: 0.9em; font-weight: 500; font-family: inherit;
        transition: all 0.2s ease; backdrop-filter: blur(8px);
      }
      .btn-glass:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.18); transform: translateY(-1px); }

      .btn-sm {
        padding: 5px 12px; font-size: 0.78em; border-radius: 8px;
      }

      .btn-icon {
        background: none; border: none; color: var(--secondary-text-color, #9ca3af);
        cursor: pointer; padding: 6px; border-radius: 8px; font-size: 1.1em; transition: all 0.15s;
        display: inline-flex; align-items: center; justify-content: center;
      }
      .btn-icon:hover { background: rgba(255,255,255,0.08); color: var(--primary-text-color, #e1e1e1); }
      .btn-icon.danger:hover { color: #ef4444; background: rgba(239,68,68,0.1); }

      /* ── Group card ── */
      .group-card {
        background: var(--ha-card-background, var(--card-background-color, #1e1e2e));
        border: 1px solid var(--divider-color, rgba(255,255,255,0.08));
        border-radius: 16px; margin-bottom: 16px;
        box-shadow: 0 2px 12px rgba(0,0,0,0.15);
        overflow: hidden; transition: box-shadow 0.2s;
      }
      .group-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.25); }
      .group-card.disabled { opacity: 0.55; }

      .group-header {
        display: flex; align-items: center; gap: 10px; padding: 14px 18px;
        cursor: pointer; user-select: none;
        background: linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01));
        border-bottom: 1px solid transparent; transition: border-color 0.2s;
      }
      .group-header.expanded { border-bottom-color: var(--divider-color, rgba(255,255,255,0.08)); }

      .group-arrow {
        font-size: 0.7em; transition: transform 0.25s ease; color: var(--secondary-text-color, #9ca3af);
        flex-shrink: 0;
      }
      .group-arrow.open { transform: rotate(90deg); }

      .group-name {
        font-size: 1.05em; font-weight: 600; flex: 1; min-width: 0;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }

      .badge {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 3px 10px; border-radius: 8px; font-size: 0.72em; font-weight: 500;
        white-space: nowrap;
      }
      .badge-time {
        background: rgba(99,102,241,0.12); color: #a5b4fc;
        border: 1px solid rgba(99,102,241,0.2);
      }
      .badge-delay {
        background: rgba(59,130,246,0.12); color: #93c5fd;
        border: 1px solid rgba(59,130,246,0.2);
      }

      .group-actions {
        display: flex; align-items: center; gap: 4px; flex-shrink: 0;
      }

      .group-body {
        padding: 0; max-height: 0; overflow: hidden; transition: max-height 0.35s ease, padding 0.35s ease;
      }
      .group-body.open { max-height: 5000px; padding: 16px 18px; }

      /* ── Toggle switch ── */
      .toggle {
        position: relative; width: 40px; height: 22px; flex-shrink: 0;
      }
      .toggle input { opacity: 0; width: 0; height: 0; }
      .toggle .slider {
        position: absolute; inset: 0; background: rgba(255,255,255,0.1);
        border-radius: 22px; cursor: pointer; transition: 0.25s;
      }
      .toggle .slider::before {
        content: ""; position: absolute; left: 3px; top: 3px;
        width: 16px; height: 16px; background: #fff; border-radius: 50%;
        transition: 0.25s; box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      }
      .toggle input:checked + .slider {
        background: linear-gradient(135deg, #3b82f6, #6366f1);
      }
      .toggle input:checked + .slider::before { transform: translateX(18px); }

      /* ── Zone table ── */
      .zone-table { width: 100%; border-collapse: collapse; }
      .zone-table th {
        text-align: left; font-size: 0.7em; font-weight: 600;
        text-transform: uppercase; letter-spacing: 0.08em;
        color: var(--secondary-text-color, #9ca3af);
        padding: 0 8px 10px; border-bottom: 1px solid var(--divider-color, rgba(255,255,255,0.06));
      }
      .zone-table td {
        padding: 10px 8px; border-bottom: 1px solid var(--divider-color, rgba(255,255,255,0.04));
        font-size: 0.85em; vertical-align: middle;
      }
      .zone-table tr:last-child td { border-bottom: none; }
      .zone-table tr.zone-disabled td { opacity: 0.45; }

      .status-dots { display: flex; gap: 4px; align-items: center; }
      .dot {
        width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,0.15);
        transition: all 0.3s;
      }
      .dot.on {
        background: #22c55e;
        box-shadow: 0 0 6px rgba(34,197,94,0.6), 0 0 12px rgba(34,197,94,0.3);
      }

      .chip-list { display: flex; flex-wrap: wrap; gap: 4px; }
      .chip-sm {
        display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 6px;
        font-size: 0.75em; font-weight: 500; white-space: nowrap;
      }
      .chip-sensor { background: rgba(99,102,241,0.15); color: #a5b4fc; border: 1px solid rgba(99,102,241,0.25); }
      .chip-area { background: rgba(59,130,246,0.15); color: #93c5fd; border: 1px solid rgba(59,130,246,0.25); }
      .chip-entity { background: rgba(245,158,11,0.15); color: #fcd34d; border: 1px solid rgba(245,158,11,0.25); }

      .inherit-label {
        font-size: 0.78em; font-style: italic; color: var(--secondary-text-color, #9ca3af); opacity: 0.7;
      }

      /* ── Empty state ── */
      .empty {
        text-align: center; padding: 60px 20px;
        color: var(--secondary-text-color, #9ca3af);
      }
      .empty-icon { font-size: 3em; margin-bottom: 16px; opacity: 0.4; }
      .empty h3 { margin: 0 0 8px; font-weight: 600; color: var(--primary-text-color, #e1e1e1); }
      .empty p { margin: 0 0 20px; font-size: 0.9em; }

      .empty-zone {
        text-align: center; padding: 24px; color: var(--secondary-text-color, #9ca3af);
        font-size: 0.85em;
      }

      /* ── Modal overlay ── */
      .modal-overlay {
        position: fixed; inset: 0; z-index: 999;
        background: rgba(0,0,0,0.6); backdrop-filter: blur(6px);
        display: flex; align-items: center; justify-content: center;
        animation: fadeIn 0.2s ease;
      }
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

      .modal {
        background: var(--ha-card-background, var(--card-background-color, #1e1e2e));
        border: 1px solid var(--divider-color, rgba(255,255,255,0.1));
        border-radius: 16px; padding: 28px; width: 92%; max-width: 560px;
        max-height: 85vh; overflow-y: auto;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        animation: slideUp 0.25s ease;
      }
      @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

      .modal h2 {
        margin: 0 0 20px; font-size: 1.2em; font-weight: 700;
        background: linear-gradient(135deg, #60a5fa, #a78bfa);
        -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
      }

      .modal-footer {
        display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px;
        padding-top: 16px; border-top: 1px solid var(--divider-color, rgba(255,255,255,0.08));
      }

      /* ── Form fields ── */
      .field { margin-bottom: 16px; }
      .field label {
        display: block; font-size: 0.78em; font-weight: 600;
        text-transform: uppercase; letter-spacing: 0.06em;
        color: var(--secondary-text-color, #9ca3af); margin-bottom: 6px;
      }
      .field input[type="text"], .field input[type="number"] {
        width: 100%; box-sizing: border-box; padding: 10px 14px;
        background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
        border-radius: 10px; color: var(--primary-text-color, #e1e1e1);
        font-size: 0.9em; font-family: inherit; outline: none; transition: border-color 0.2s;
      }
      .field input:focus { border-color: rgba(99,102,241,0.5); }

      /* ── Collapsible advanced ── */
      .adv-toggle {
        display: flex; align-items: center; gap: 6px;
        font-size: 0.82em; font-weight: 500; color: var(--secondary-text-color, #9ca3af);
        cursor: pointer; margin: 16px 0 8px; user-select: none;
      }
      .adv-toggle:hover { color: var(--primary-text-color, #e1e1e1); }
      .adv-arrow { font-size: 0.7em; transition: transform 0.2s; }
      .adv-arrow.open { transform: rotate(90deg); }
      .adv-body { max-height: 0; overflow: hidden; transition: max-height 0.3s ease; }
      .adv-body.open { max-height: 600px; }

      /* ── Chip selector ── */
      .cs { display: flex; flex-direction: column; gap: 6px; }
      .cs-chips { display: flex; flex-wrap: wrap; gap: 5px; min-height: 0; }
      .cs-add {
        padding: 8px 12px; border-radius: 10px;
        background: var(--card-background-color, #1e1e2e); color: var(--primary-text-color, #e1e1e1);
        border: 1px solid rgba(255,255,255,0.1); font-size: 0.82em; font-family: inherit;
        cursor: pointer; outline: none;
      }
      .cs-add option { background: var(--card-background-color, #1e1e2e); color: var(--primary-text-color, #e1e1e1); }
      .cs-chip {
        display: inline-flex; align-items: center; gap: 5px;
        padding: 4px 10px; border-radius: 8px; font-size: 0.8em; font-weight: 500;
        animation: chipIn 0.15s ease;
      }
      @keyframes chipIn { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      .cs-x { cursor: pointer; opacity: 0.6; font-size: 1.1em; margin-left: 2px; }
      .cs-x:hover { opacity: 1; }
      .chip-sensor { background: rgba(99,102,241,0.18); color: #a5b4fc; border: 1px solid rgba(99,102,241,0.3); }
      .chip-area { background: rgba(59,130,246,0.18); color: #93c5fd; border: 1px solid rgba(59,130,246,0.3); }
      .chip-entity { background: rgba(245,158,11,0.18); color: #fcd34d; border: 1px solid rgba(245,158,11,0.3); }

      /* ── Time picker ── */
      .tp-sel, .tp-dir {
        padding: 8px 12px; border-radius: 10px;
        background: var(--card-background-color, #1e1e2e); color: var(--primary-text-color, #e1e1e1);
        border: 1px solid rgba(255,255,255,0.1); font-size: 0.82em; font-family: inherit;
        cursor: pointer; outline: none;
      }
      .tp-sel option, .tp-dir option {
        background: var(--card-background-color, #1e1e2e); color: var(--primary-text-color, #e1e1e1);
      }
      .tp-row { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
      .tp-time {
        padding: 8px 12px; border-radius: 10px;
        background: var(--card-background-color, #1e1e2e); color: var(--primary-text-color, #e1e1e1);
        border: 1px solid rgba(255,255,255,0.1); font-size: 0.82em; font-family: inherit; outline: none;
      }
      .tp-time::-webkit-calendar-picker-indicator { filter: invert(0.8); }
      .tp-num {
        width: 52px; padding: 8px 10px; border-radius: 10px;
        background: var(--card-background-color, #1e1e2e); color: var(--primary-text-color, #e1e1e1);
        border: 1px solid rgba(255,255,255,0.1); font-size: 0.82em; font-family: inherit;
        text-align: center; outline: none;
      }
      .tp-label { font-size: 0.8em; color: var(--secondary-text-color, #9ca3af); }

      /* ── Inline toggle row ── */
      .toggle-row {
        display: flex; align-items: center; justify-content: space-between;
        padding: 8px 0;
      }
      .toggle-row-label { font-size: 0.88em; }

      /* ── Responsive ── */
      @media (max-width: 640px) {
        :host { padding: 16px 12px 60px; }
        .group-header { padding: 12px 14px; gap: 8px; flex-wrap: wrap; }
        .badge { font-size: 0.65em; }
        .modal { padding: 20px; width: 96%; }
        .zone-table { font-size: 0.8em; }
        .zone-table th, .zone-table td { padding: 8px 4px; }
      }
    </style>
    <div id="root"></div>`;
  }

  /* ══════════════════════════════════════════
     Render
     ══════════════════════════════════════════ */
  _render() {
    const root = this.shadowRoot.getElementById("root");
    if (!root) return;

    if (this._groups.length === 0) {
      root.innerHTML = `
        <div class="hdr">
          <div><h1>FP2 Zone Manager</h1><div class="sub">Group-based presence zone control</div></div>
        </div>
        <div class="empty">
          <div class="empty-icon">&#128204;</div>
          <h3>No groups yet</h3>
          <p>Create a group to organize your presence zones and targets.</p>
          <button class="btn-primary" id="emptyAddGroup">+ Add Your First Group</button>
        </div>`;
      root.querySelector("#emptyAddGroup").onclick = () => this._openGroupModal(-1);
      return;
    }

    let html = `
      <div class="hdr">
        <div><h1>FP2 Zone Manager</h1><div class="sub">Group-based presence zone control</div></div>
        <button class="btn-primary" id="addGroupBtn">+ Add Group</button>
      </div>`;

    this._groups.forEach((g, gi) => {
      const collapsed = this._collapsed[gi];
      const timeBadge = (g.start_time || g.end_time)
        ? `<span class="badge badge-time">${this._fmtTime(g.start_time) || "always"} &rarr; ${this._fmtTime(g.end_time) || "always"}</span>` : "";
      const delayBadge = g.delay ? `<span class="badge badge-delay">${g.delay}s</span>` : "";

      html += `
        <div class="group-card${g.enabled === false ? " disabled" : ""}" data-gi="${gi}">
          <div class="group-header${collapsed ? "" : " expanded"}" data-gi="${gi}">
            <span class="group-arrow${collapsed ? "" : " open"}">&#9654;</span>
            <span class="group-name">${this._esc(g.name || "Unnamed Group")}</span>
            ${timeBadge}${delayBadge}
            <div class="group-actions">
              <label class="toggle" title="Enable/disable group" onclick="event.stopPropagation()">
                <input type="checkbox" data-action="toggleGroup" data-gi="${gi}" ${g.enabled !== false ? "checked" : ""}>
                <span class="slider"></span>
              </label>
              <button class="btn-icon" data-action="editGroup" data-gi="${gi}" title="Group settings" onclick="event.stopPropagation()">&#9881;</button>
              <button class="btn-icon danger" data-action="deleteGroup" data-gi="${gi}" title="Delete group" onclick="event.stopPropagation()">&#128465;</button>
            </div>
          </div>
          <div class="group-body${collapsed ? "" : " open"}" data-gi="${gi}">`;

      const zones = g.zones || [];
      if (zones.length === 0) {
        html += `
            <div class="empty-zone">
              <button class="btn-primary btn-sm" data-action="addZone" data-gi="${gi}">+ Add Zone</button>
            </div>`;
      } else {
        html += `
            <table class="zone-table">
              <thead><tr>
                <th></th><th>Status</th><th>Sensors</th><th>Targets</th><th>Window</th><th>Delay</th><th></th>
              </tr></thead>
              <tbody>`;

        zones.forEach((z, zi) => {
          const dots = (z.sensors || []).map(s =>
            `<span class="dot${this._isPresent(s) ? " on" : ""}" title="${this._esc(this._sensorName(s))}"></span>`
          ).join("");

          const sensorChips = (z.sensors || []).map(s =>
            `<span class="chip-sm chip-sensor">${this._esc(this._sensorName(s))}</span>`
          ).join("");

          const targetChips = [
            ...(z.target_areas || []).map(a => `<span class="chip-sm chip-area">${this._esc(this._areaName(a))}</span>`),
            ...(z.target_entities || []).map(e => `<span class="chip-sm chip-entity">${this._esc(this._entityName(e))}</span>`)
          ].join("");

          const windowStr = (z.start_time || z.end_time)
            ? `${this._fmtTime(z.start_time) || "*"} &rarr; ${this._fmtTime(z.end_time) || "*"}`
            : `<span class="inherit-label">Group</span>`;

          const delayStr = (z.delay !== undefined && z.delay !== null && z.delay !== "")
            ? `${z.delay}s`
            : `<span class="inherit-label">Group</span>`;

          html += `
                <tr class="${z.enabled === false ? "zone-disabled" : ""}">
                  <td>
                    <label class="toggle" title="Enable/disable zone">
                      <input type="checkbox" data-action="toggleZone" data-gi="${gi}" data-zi="${zi}" ${z.enabled !== false ? "checked" : ""}>
                      <span class="slider"></span>
                    </label>
                  </td>
                  <td><div class="status-dots">${dots}</div></td>
                  <td><div class="chip-list">${sensorChips || "<span class='inherit-label'>None</span>"}</div></td>
                  <td><div class="chip-list">${targetChips || "<span class='inherit-label'>None</span>"}</div></td>
                  <td>${windowStr}</td>
                  <td>${delayStr}</td>
                  <td>
                    <button class="btn-icon" data-action="editZone" data-gi="${gi}" data-zi="${zi}" title="Edit zone">&#9998;</button>
                    <button class="btn-icon danger" data-action="deleteZone" data-gi="${gi}" data-zi="${zi}" title="Delete zone">&#128465;</button>
                  </td>
                </tr>`;
        });

        html += `
              </tbody>
            </table>
            <div style="padding-top: 12px; text-align: right;">
              <button class="btn-primary btn-sm" data-action="addZone" data-gi="${gi}">+ Add Zone</button>
            </div>`;
      }

      html += `
          </div>
        </div>`;
    });

    root.innerHTML = html;
    this._bindEvents(root);
  }

  /* ══════════════════════════════════════════
     Event binding
     ══════════════════════════════════════════ */
  _bindEvents(root) {
    // Add group button
    root.querySelector("#addGroupBtn")?.addEventListener("click", () => this._openGroupModal(-1));

    // Group headers (collapse toggle)
    root.querySelectorAll(".group-header").forEach(h => {
      h.addEventListener("click", (e) => {
        const gi = parseInt(h.dataset.gi);
        this._collapsed[gi] = !this._collapsed[gi];
        this._render();
      });
    });

    // Delegated actions
    root.querySelectorAll("[data-action]").forEach(el => {
      const action = el.dataset.action;
      const gi = parseInt(el.dataset.gi);
      const zi = el.dataset.zi !== undefined ? parseInt(el.dataset.zi) : undefined;

      if (action === "toggleGroup") {
        el.addEventListener("change", () => {
          this._groups[gi].enabled = el.checked;
          this._save();
        });
      } else if (action === "toggleZone") {
        el.addEventListener("change", () => {
          this._groups[gi].zones[zi].enabled = el.checked;
          this._save();
        });
      } else if (action === "editGroup") {
        el.addEventListener("click", () => this._openGroupModal(gi));
      } else if (action === "deleteGroup") {
        el.addEventListener("click", () => {
          if (confirm(`Delete group "${this._groups[gi].name}"?`)) {
            this._groups.splice(gi, 1);
            this._save();
          }
        });
      } else if (action === "addZone") {
        el.addEventListener("click", () => this._openZoneModal(gi, -1));
      } else if (action === "editZone") {
        el.addEventListener("click", () => this._openZoneModal(gi, zi));
      } else if (action === "deleteZone") {
        el.addEventListener("click", () => {
          if (confirm("Delete this zone?")) {
            this._groups[gi].zones.splice(zi, 1);
            this._save();
          }
        });
      }
    });
  }

  /* ══════════════════════════════════════════
     Group modal
     ══════════════════════════════════════════ */
  _openGroupModal(gi) {
    const isNew = gi === -1;
    const g = isNew ? { name: "", start_time: "", end_time: "", delay: 60, enabled: true, zones: [] } : { ...this._groups[gi] };

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal">
        <h2>${isNew ? "New Group" : "Group Settings"}</h2>
        <div class="field">
          <label>Group Name</label>
          <input type="text" id="gName" value="${this._esc(g.name)}" placeholder="e.g., Basement, Upstairs">
        </div>
        <div class="field">
          <label>Active From</label>
          <div id="gStartTime"></div>
        </div>
        <div class="field">
          <label>Active Until</label>
          <div id="gEndTime"></div>
        </div>
        <div class="field">
          <label>Default Turn-off Delay (seconds)</label>
          <input type="number" id="gDelay" value="${g.delay || 0}" min="0" placeholder="60">
        </div>
        <div class="modal-footer">
          <button class="btn-glass" id="gCancel">Cancel</button>
          <button class="btn-primary" id="gSave">${isNew ? "Create Group" : "Save"}</button>
        </div>
      </div>`;

    this.shadowRoot.appendChild(overlay);

    this._createTimePicker("gStart", this.shadowRoot.getElementById("gStartTime"));
    this._createTimePicker("gEnd", this.shadowRoot.getElementById("gEndTime"));
    this._setTimePicker("gStart", g.start_time || "");
    this._setTimePicker("gEnd", g.end_time || "");

    overlay.querySelector("#gCancel").onclick = () => overlay.remove();
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector("#gSave").onclick = () => {
      const name = this.shadowRoot.getElementById("gName").value.trim() || "Unnamed Group";
      const start_time = this._getTimePicker("gStart");
      const end_time = this._getTimePicker("gEnd");
      const delay = parseInt(this.shadowRoot.getElementById("gDelay").value) || 0;

      if (isNew) {
        this._groups.push({ name, start_time, end_time, delay, enabled: true, zones: [] });
      } else {
        this._groups[gi] = { ...this._groups[gi], name, start_time, end_time, delay };
      }
      overlay.remove();
      this._save();
    };
  }

  /* ══════════════════════════════════════════
     Zone modal
     ══════════════════════════════════════════ */
  _openZoneModal(gi, zi) {
    const isNew = zi === -1;
    const z = isNew
      ? { enabled: true, sensors: [], target_areas: [], target_entities: [], delay: "", always_off: true, start_time: "", end_time: "" }
      : { ...this._groups[gi].zones[zi] };

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal">
        <h2>${isNew ? "Add Zone" : "Edit Zone"}</h2>
        <div class="field">
          <label>Presence Sensors</label>
          <div id="zSensors"></div>
        </div>
        <div class="field">
          <label>Target Areas</label>
          <div id="zAreas"></div>
        </div>
        <div class="field">
          <label>Target Entities</label>
          <div id="zEntities"></div>
        </div>

        <div class="adv-toggle" id="advToggle">
          <span class="adv-arrow" id="advArrow">&#9654;</span>
          Advanced options
        </div>
        <div class="adv-body" id="advBody">
          <div class="field">
            <label>Turn-off Delay (seconds)</label>
            <input type="number" id="zDelay" value="${z.delay !== undefined && z.delay !== null && z.delay !== "" ? z.delay : ""}" min="0" placeholder="Use group default">
          </div>
          <div class="toggle-row">
            <span class="toggle-row-label">Always turn off when unoccupied</span>
            <label class="toggle">
              <input type="checkbox" id="zAlwaysOff" ${z.always_off !== false ? "checked" : ""}>
              <span class="slider"></span>
            </label>
          </div>
          <div class="field" style="margin-top: 12px;">
            <label>Active From (zone override)</label>
            <div id="zStartTime"></div>
          </div>
          <div class="field">
            <label>Active Until (zone override)</label>
            <div id="zEndTime"></div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-glass" id="zCancel">Cancel</button>
          <button class="btn-primary" id="zSave">${isNew ? "Add Zone" : "Save"}</button>
        </div>
      </div>`;

    this.shadowRoot.appendChild(overlay);

    // Chip selectors
    this._makeChipSelect("zSens", this.shadowRoot.getElementById("zSensors"), this._sensorOptions(), "sensor", "chip-sensor");
    this._makeChipSelect("zArea", this.shadowRoot.getElementById("zAreas"), this._areaOptions(), "area", "chip-area");
    this._makeChipSelect("zEnt", this.shadowRoot.getElementById("zEntities"), this._entityOptions(), "entity", "chip-entity");

    this._setChipValues("zSens", z.sensors || [], this._sensorOptions());
    this._setChipValues("zArea", z.target_areas || [], this._areaOptions());
    this._setChipValues("zEnt", z.target_entities || [], this._entityOptions());

    // Time pickers
    this._createTimePicker("zStart", this.shadowRoot.getElementById("zStartTime"));
    this._createTimePicker("zEnd", this.shadowRoot.getElementById("zEndTime"));
    this._setTimePicker("zStart", z.start_time || "");
    this._setTimePicker("zEnd", z.end_time || "");

    // Advanced toggle
    const advToggle = overlay.querySelector("#advToggle");
    const advArrow = overlay.querySelector("#advArrow");
    const advBody = overlay.querySelector("#advBody");
    advToggle.onclick = () => {
      advArrow.classList.toggle("open");
      advBody.classList.toggle("open");
    };

    // Cancel/close
    overlay.querySelector("#zCancel").onclick = () => overlay.remove();
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    // Save
    overlay.querySelector("#zSave").onclick = () => {
      const sensors = this._getChipValues("zSens");
      const target_areas = this._getChipValues("zArea");
      const target_entities = this._getChipValues("zEnt");
      const delayVal = this.shadowRoot.getElementById("zDelay").value;
      const delay = delayVal !== "" ? parseInt(delayVal) : "";
      const always_off = this.shadowRoot.getElementById("zAlwaysOff").checked;
      const start_time = this._getTimePicker("zStart");
      const end_time = this._getTimePicker("zEnd");

      const zone = {
        enabled: z.enabled !== false,
        sensors, target_areas, target_entities,
        delay, always_off, start_time, end_time
      };

      if (!this._groups[gi].zones) this._groups[gi].zones = [];
      if (isNew) {
        this._groups[gi].zones.push(zone);
      } else {
        this._groups[gi].zones[zi] = zone;
      }
      overlay.remove();
      this._save();
    };
  }

  /* ══════════════════════════════════════════
     Util
     ══════════════════════════════════════════ */
  _esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
}

customElements.define("fp2-zone-manager-panel", FP2ZoneManagerPanel);
