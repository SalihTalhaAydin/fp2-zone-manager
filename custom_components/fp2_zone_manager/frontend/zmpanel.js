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
  _makeChipSelect(id, container, options, label, colorClass) {
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
    this._chipColorClass = this._chipColorClass || {};
    this._chipColorClass[id] = colorClass || "chip-default";
    this._chipOpts = this._chipOpts || {};
    this._chipOpts[id] = { options, addEl, label };
    addEl.onchange = () => {
      if (!addEl.value) return;
      this._addChip(id, addEl.value, options.find(o => o.value === addEl.value)?.label || addEl.value);
      addEl.value = "";
      this._refreshDropdown(id);
    };
  }

  _refreshDropdown(id) {
    const info = this._chipOpts?.[id];
    if (!info) return;
    const { options, addEl, label } = info;
    const current = this._getChipValues(id);
    addEl.innerHTML = `<option value="">+ Add ${label}...</option>`;
    options.filter(o => !current.includes(o.value))
      .forEach(o => addEl.add(new Option(o.label, o.value)));
  }

  _addChip(id, value, label) {
    const chipsEl = this.shadowRoot.querySelector(`#${id}_chips`);
    if (chipsEl.querySelector(`[data-val="${CSS.escape(value)}"]`)) return;
    const chip = document.createElement("span");
    const cc = (this._chipColorClass && this._chipColorClass[id]) || "chip-default";
    chip.className = `cs-chip ${cc}`;
    chip.dataset.val = value;
    chip.innerHTML = `${label} <span class="cs-x">&times;</span>`;
    chip.querySelector(".cs-x").onclick = () => {
      chip.remove();
      this._refreshDropdown(id);
    };
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
      .hdr {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 28px;
      }
      h1 {
        margin: 0;
        font-size: 1.65em;
        font-weight: 700;
        letter-spacing: -0.02em;
        background: linear-gradient(135deg, #60a5fa, #a78bfa);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }
      .sub {
        color: var(--secondary-text-color, #9ca3af);
        font-size: 0.85em;
        margin-top: 4px;
        font-weight: 400;
        letter-spacing: 0.01em;
      }
      .hdr-actions {
        display: flex;
        gap: 10px;
      }

      /* ── Buttons ── */
      .btn-add {
        background: linear-gradient(135deg, #3b82f6, #6366f1);
        color: #fff;
        border: none;
        border-radius: 12px;
        padding: 10px 22px;
        cursor: pointer;
        font-size: 0.9em;
        font-weight: 600;
        font-family: inherit;
        letter-spacing: 0.01em;
        transition: all 0.2s ease;
        box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
      }
      .btn-add:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 16px rgba(59, 130, 246, 0.4);
      }
      .btn-add:active { transform: translateY(0); }

      .btn-settings {
        background: rgba(255,255,255,0.06);
        color: var(--primary-text-color, #e1e1e1);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 12px;
        padding: 10px 22px;
        cursor: pointer;
        font-size: 0.9em;
        font-weight: 500;
        font-family: inherit;
        letter-spacing: 0.01em;
        transition: all 0.2s ease;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
      .btn-settings:hover {
        background: rgba(255,255,255,0.1);
        border-color: rgba(255,255,255,0.18);
        transform: translateY(-1px);
      }

      /* ── Global defaults bar ── */
      .global-info {
        font-size: 0.82em;
        color: var(--secondary-text-color, #9ca3af);
        background: linear-gradient(135deg, rgba(59,130,246,0.08), rgba(99,102,241,0.08));
        border: 1px solid rgba(99,102,241,0.15);
        padding: 12px 18px;
        border-radius: 12px;
        margin-bottom: 20px;
        display: flex;
        align-items: center;
        gap: 8px;
        letter-spacing: 0.01em;
      }
      .global-info::before {
        content: "\\2699";
        font-size: 1.1em;
        opacity: 0.6;
      }

      /* ── Main card ── */
      .card {
        background: var(--ha-card-background, var(--card-background-color, #1e1e2e));
        border-radius: 16px;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,0.06);
        box-shadow: 0 4px 24px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.1);
      }

      /* ── Table ── */
      table { width: 100%; border-collapse: collapse; }
      th {
        text-align: left;
        padding: 14px 18px;
        background: rgba(255,255,255,0.02);
        color: var(--secondary-text-color, #9ca3af);
        font-size: 0.72em;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      td {
        padding: 16px 18px;
        border-top: 1px solid rgba(255,255,255,0.04);
        vertical-align: middle;
      }
      tr:first-child td { border-top: none; }
      tr:hover td { background: rgba(255,255,255,0.02); }
      tr.disabled td { opacity: 0.35; filter: saturate(0.3); }
      tr { transition: opacity 0.3s ease; }

      /* ── Status dots ── */
      .dots { display: flex; gap: 6px; align-items: center; }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        transition: all 0.3s ease;
      }
      .dot.on {
        background: #22c55e;
        box-shadow: 0 0 8px rgba(34,197,94,0.6), 0 0 20px rgba(34,197,94,0.2);
        animation: pulse-glow 2s ease-in-out infinite;
      }
      .dot.off { background: #4b5563; }
      @keyframes pulse-glow {
        0%, 100% { box-shadow: 0 0 8px rgba(34,197,94,0.6), 0 0 20px rgba(34,197,94,0.2); }
        50% { box-shadow: 0 0 12px rgba(34,197,94,0.8), 0 0 28px rgba(34,197,94,0.3); }
      }

      /* ── Table chips ── */
      .chips { display: flex; flex-wrap: wrap; gap: 5px; }
      .chip {
        display: inline-block;
        padding: 4px 10px;
        border-radius: 8px;
        font-size: 0.78em;
        font-weight: 500;
        letter-spacing: 0.01em;
      }
      .chip.sensor {
        background: linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.15));
        color: #a78bfa;
        border: 1px solid rgba(139,92,246,0.2);
      }
      .chip.area {
        background: linear-gradient(135deg, rgba(59,130,246,0.15), rgba(96,165,250,0.15));
        color: #60a5fa;
        border: 1px solid rgba(96,165,250,0.2);
      }
      .chip.ent {
        background: linear-gradient(135deg, rgba(245,158,11,0.12), rgba(251,191,36,0.12));
        color: #fbbf24;
        border: 1px solid rgba(251,191,36,0.2);
      }

      /* ── Action buttons ── */
      .acts { display: flex; gap: 8px; align-items: center; }
      .abtn {
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.08);
        cursor: pointer;
        padding: 6px 14px;
        border-radius: 8px;
        color: var(--primary-text-color, #e1e1e1);
        font-size: 0.8em;
        font-weight: 500;
        font-family: inherit;
        transition: all 0.2s ease;
      }
      .abtn:hover {
        background: rgba(255,255,255,0.08);
        border-color: rgba(255,255,255,0.15);
      }
      .abtn.del {
        color: #f87171;
        border-color: rgba(248,113,113,0.2);
      }
      .abtn.del:hover {
        background: rgba(239,68,68,0.15);
        border-color: rgba(248,113,113,0.4);
        color: #fca5a5;
      }

      /* ── Toggle switch ── */
      .toggle { position: relative; width: 44px; height: 24px; cursor: pointer; display: inline-block; }
      .toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
      .toggle .slider {
        position: absolute;
        inset: 0;
        background: rgba(255,255,255,0.1);
        border-radius: 24px;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .toggle .slider:before {
        content: "";
        position: absolute;
        height: 18px;
        width: 18px;
        left: 3px;
        bottom: 3px;
        background: #fff;
        border-radius: 50%;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 1px 4px rgba(0,0,0,0.2);
      }
      .toggle input:checked + .slider {
        background: linear-gradient(135deg, #3b82f6, #6366f1);
        box-shadow: 0 0 12px rgba(59,130,246,0.3);
      }
      .toggle input:checked + .slider:before { transform: translateX(20px); }

      /* ── Empty state ── */
      .empty {
        text-align: center;
        padding: 80px 24px;
        color: var(--secondary-text-color, #9ca3af);
      }
      .empty-icon {
        font-size: 3.5em;
        margin-bottom: 16px;
        opacity: 0.25;
        filter: grayscale(0.5);
      }
      .empty-text {
        font-size: 1.15em;
        margin-bottom: 8px;
        font-weight: 500;
        color: var(--primary-text-color, #e1e1e1);
        letter-spacing: -0.01em;
      }
      .empty-sub {
        font-size: 0.85em;
        margin-bottom: 24px;
        opacity: 0.7;
      }

      /* ── Modal overlay ── */
      .ov {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.6);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        z-index: 999;
        justify-content: center;
        align-items: center;
        animation: fade-in 0.2s ease;
      }
      .ov.open { display: flex; }
      @keyframes fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .modal {
        background: var(--ha-card-background, var(--card-background-color, #1e1e2e));
        border-radius: 20px;
        padding: 32px;
        width: 90%;
        min-width: 360px;
        max-width: 540px;
        border: 1px solid rgba(255,255,255,0.08);
        box-shadow: 0 24px 64px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.2);
        max-height: 85vh;
        overflow-y: auto;
        animation: modal-slide 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      }
      @keyframes modal-slide {
        from { opacity: 0; transform: translateY(16px) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .modal::-webkit-scrollbar { width: 6px; }
      .modal::-webkit-scrollbar-track { background: transparent; }
      .modal::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }

      .modal h2 {
        margin: 0 0 24px;
        font-weight: 600;
        font-size: 1.3em;
        letter-spacing: -0.02em;
      }

      /* ── Form fields ── */
      .f { margin-bottom: 18px; }
      .f label {
        display: block;
        margin-bottom: 8px;
        font-size: 0.8em;
        color: var(--secondary-text-color, #9ca3af);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .f select, .f input {
        width: 100%;
        padding: 11px 14px;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 10px;
        background: var(--card-background-color, #1e1e2e);
        color: var(--primary-text-color, #e1e1e1);
        font-size: 0.9em;
        font-family: inherit;
        box-sizing: border-box;
        transition: all 0.2s ease;
      }
      .f select option, .tp-sel option {
        background: var(--card-background-color, #1e1e2e);
        color: var(--primary-text-color, #e1e1e1);
      }
      .f select:focus, .f input:focus {
        outline: none;
        border-color: rgba(99,102,241,0.5);
        box-shadow: 0 0 0 3px rgba(99,102,241,0.1);
      }
      .f select:hover, .f input:hover {
        border-color: rgba(255,255,255,0.15);
      }

      .hint {
        font-size: 0.75em;
        color: var(--secondary-text-color, #9ca3af);
        margin-top: 4px;
        opacity: 0.8;
      }

      /* ── Modal buttons ── */
      .mbtns {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 28px;
      }
      .mbtns button {
        padding: 10px 24px;
        border-radius: 10px;
        border: none;
        cursor: pointer;
        font-size: 0.9em;
        font-weight: 600;
        font-family: inherit;
        transition: all 0.2s ease;
        letter-spacing: 0.01em;
      }
      .bc {
        background: rgba(255,255,255,0.06);
        color: var(--primary-text-color, #e1e1e1);
        border: 1px solid rgba(255,255,255,0.08);
      }
      .bc:hover {
        background: rgba(255,255,255,0.1);
      }
      .bs {
        background: linear-gradient(135deg, #3b82f6, #6366f1);
        color: #fff;
        box-shadow: 0 2px 8px rgba(59,130,246,0.3);
      }
      .bs:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 16px rgba(59,130,246,0.4);
      }

      /* ── Section labels ── */
      .section-label {
        font-size: 0.7em;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--secondary-text-color, #9ca3af);
        margin: 24px 0 10px;
        font-weight: 600;
        border-top: 1px solid rgba(255,255,255,0.06);
        padding-top: 20px;
      }

      /* ── Advanced toggle ── */
      .adv-toggle {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        padding: 14px 0;
        color: var(--secondary-text-color, #9ca3af);
        font-size: 0.85em;
        font-weight: 500;
        border-top: 1px solid rgba(255,255,255,0.06);
        margin-top: 16px;
        user-select: none;
        transition: color 0.2s ease;
      }
      .adv-toggle:hover { color: #60a5fa; }
      .adv-toggle .arrow {
        display: inline-block;
        transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        font-size: 0.9em;
      }
      .adv-toggle.open .arrow { transform: rotate(90deg); }
      .adv-sec {
        display: none;
        padding-top: 4px;
        animation: slide-down 0.25s ease;
      }
      .adv-sec.open { display: block; }
      @keyframes slide-down {
        from { opacity: 0; transform: translateY(-8px); }
        to { opacity: 1; transform: translateY(0); }
      }

      /* ── Chip selector (modal) ── */
      .cs { margin-top: 6px; }
      .cs-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 8px;
        min-height: 28px;
      }
      .cs-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 12px;
        border-radius: 10px;
        font-size: 0.82em;
        font-weight: 500;
        transition: all 0.15s ease;
        animation: chip-in 0.2s ease;
      }
      @keyframes chip-in {
        from { opacity: 0; transform: scale(0.9); }
        to { opacity: 1; transform: scale(1); }
      }
      .cs-chip.chip-sensor {
        background: linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.2));
        color: #c4b5fd;
        border: 1px solid rgba(139,92,246,0.25);
      }
      .cs-chip.chip-area {
        background: linear-gradient(135deg, rgba(59,130,246,0.2), rgba(96,165,250,0.2));
        color: #93c5fd;
        border: 1px solid rgba(96,165,250,0.25);
      }
      .cs-chip.chip-entity {
        background: linear-gradient(135deg, rgba(245,158,11,0.15), rgba(251,191,36,0.15));
        color: #fcd34d;
        border: 1px solid rgba(251,191,36,0.25);
      }
      .cs-chip.chip-default {
        background: rgba(255,255,255,0.08);
        color: var(--primary-text-color, #e1e1e1);
        border: 1px solid rgba(255,255,255,0.1);
      }
      .cs-x {
        cursor: pointer;
        font-size: 1.15em;
        opacity: 0.6;
        margin-left: 2px;
        transition: opacity 0.15s;
      }
      .cs-x:hover { opacity: 1; }
      .cs-add {
        width: 100%;
        padding: 10px 14px;
        border: 1px dashed rgba(255,255,255,0.1);
        border-radius: 10px;
        background: var(--card-background-color, #1e1e2e);
        color: var(--primary-text-color, #e1e1e1);
        font-size: 0.87em;
        font-family: inherit;
        transition: all 0.2s ease;
        cursor: pointer;
      }
      .cs-add option {
        background: var(--card-background-color, #1e1e2e);
        color: var(--primary-text-color, #e1e1e1);
        padding: 8px;
      }
      .cs-add:hover {
        border-color: rgba(255,255,255,0.2);
        background: rgba(255,255,255,0.04);
      }
      .cs-add:focus {
        outline: none;
        border-color: rgba(99,102,241,0.4);
        border-style: solid;
      }

      /* ── Time picker ── */
      .tp-sel {
        width: 100%;
        padding: 10px 14px;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 10px;
        background: rgba(255,255,255,0.04);
        color: var(--primary-text-color, #e1e1e1);
        margin-bottom: 8px;
        font-family: inherit;
        font-size: 0.9em;
        transition: all 0.2s ease;
      }
      .tp-sel:focus { outline: none; border-color: rgba(99,102,241,0.5); }
      .tp-row {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-top: 6px;
      }
      .tp-time {
        flex: 1;
        padding: 10px 14px;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 10px;
        background: rgba(255,255,255,0.04);
        color: var(--primary-text-color, #e1e1e1);
        font-family: inherit;
        font-size: 0.9em;
      }
      .tp-time:focus { outline: none; border-color: rgba(99,102,241,0.5); }
      .tp-dir {
        padding: 10px 12px;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 10px;
        background: rgba(255,255,255,0.04);
        color: var(--primary-text-color, #e1e1e1);
        font-family: inherit;
        font-size: 0.9em;
      }
      .tp-num {
        width: 60px;
        padding: 10px 12px;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 10px;
        background: rgba(255,255,255,0.04);
        color: var(--primary-text-color, #e1e1e1);
        font-family: inherit;
        font-size: 0.9em;
        text-align: center;
      }
      .tp-num:focus, .tp-dir:focus { outline: none; border-color: rgba(99,102,241,0.5); }
      .tp-label {
        color: var(--secondary-text-color, #9ca3af);
        font-size: 0.85em;
        font-weight: 500;
      }

      /* ── Window / Delay column ── */
      .win-text {
        font-size: 0.82em;
        color: var(--secondary-text-color, #9ca3af);
        font-weight: 400;
      }
      .win-text.has-val { color: var(--primary-text-color, #e1e1e1); }
      .delay-text {
        font-size: 0.82em;
        color: var(--secondary-text-color, #9ca3af);
        font-weight: 400;
      }
      .delay-text.has-val { color: var(--primary-text-color, #e1e1e1); }

      /* ── Responsive ── */
      @media (max-width: 768px) {
        :host { padding: 16px 16px 60px; }
        .hdr { flex-direction: column; align-items: flex-start; gap: 16px; }
        .hdr-actions { width: 100%; }
        .hdr-actions .btn-add, .hdr-actions .btn-settings { flex: 1; text-align: center; }
        th, td { padding: 10px 12px; }
        .modal { min-width: unset; padding: 24px; }
      }
    </style>

    <div class="hdr">
      <div><h1>FP2 Zone Manager</h1><div class="sub">Map presence zones to lights, areas, and entities</div></div>
      <div class="hdr-actions">
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
        <div class="hint" style="margin-bottom:20px;">Applied to all zones that don't have their own values set.</div>
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

    const at = $("advT"), as2 = $("advS");
    at.onclick = () => { at.classList.toggle("open"); as2.classList.toggle("open"); };
    this._el.advT = at; this._el.advS = as2;
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
    const skip = [
      "led_indicator", "motion_detection", "ambient_light",
      "do_not_disturb", "child_lock", "adguard",
      "safe_search", "safe_browsing", "filtering",
      "query_log", "parental_control", "protection",
      "p1s_01p09c", "image_sensor", "camera",
      "identify", "reboot", "refresh_state",
    ];
    return Object.keys(this._hass.states)
      .filter(e => {
        if (!e.startsWith("light.") && !e.startsWith("switch.") && !e.startsWith("fan.")) return false;
        const lo = e.toLowerCase();
        return !skip.some(s => lo.includes(s));
      })
      .sort().map(e => ({ value: e, label: this._hass.states[e].attributes.friendly_name || e }));
  }

  /* ── Render ── */
  _render() {
    const g = this._globalCfg;
    if (g.global_start || g.global_end) {
      this._el.globalBar.innerHTML = `<div class="global-info">Defaults: Active ${g.global_start||"\u2014"} \u2192 ${g.global_end||"\u2014"}, delay ${g.global_delay||300}s</div>`;
    } else { this._el.globalBar.innerHTML = ""; }

    const z = this._zones;
    if (!z.length) {
      this._el.ct.innerHTML = `<div class="empty"><div class="empty-icon">&#9881;</div><div class="empty-text">No zone mappings yet</div><div class="empty-sub">Create your first zone to start automating lights with presence detection</div><button class="btn-add" id="ea">+ Add Your First Zone</button></div>`;
      this.shadowRoot.getElementById("ea").onclick = () => this._open();
      return;
    }

    let h = `<table><thead><tr><th style="width:44px"></th><th style="width:54px">Status</th><th>Sensors</th><th>Targets</th><th>Window</th><th>Delay</th><th style="width:160px"></th></tr></thead><tbody>`;
    z.forEach((zone, i) => {
      const enabled = zone.enabled !== false;
      const sensors = zone.sensors || [];
      const dots = sensors.map(s => { const st = this._hass.states[s]; return `<span class="dot ${st?.state==="on"?"on":"off"}" title="${s}"></span>`; }).join("");
      const sChips = sensors.map(s => { const st = this._hass.states[s]; return `<span class="chip sensor">${st?.attributes?.friendly_name||s.split(".").pop().replace(/_/g," ")}</span>`; }).join("");
      const aChips = (zone.target_areas||[]).map(a => `<span class="chip area">${this._areaName(a)}</span>`).join("");
      const eChips = (zone.target_entities||[]).map(e => { const st = this._hass.states[e]; return `<span class="chip ent">${st?.attributes?.friendly_name||e.split(".").pop()}</span>`; }).join("");
      const st2 = (zone.start_time||"").trim(), et2 = (zone.end_time||"").trim();
      const win = (st2||et2) ? `${st2||"\u2014"} \u2192 ${et2||"\u2014"}` : "Global";
      const winClass = (st2||et2) ? "win-text has-val" : "win-text";
      const delay = zone.delay ? `${zone.delay}s` : "Global";
      const delayClass = zone.delay ? "delay-text has-val" : "delay-text";

      h += `<tr class="${enabled?"":"disabled"}">
        <td><label class="toggle"><input type="checkbox" ${enabled?"checked":""} data-i="${i}" data-a="toggle"><span class="slider"></span></label></td>
        <td><div class="dots">${dots}</div></td>
        <td><div class="chips">${sChips}</div></td>
        <td><div class="chips">${aChips}${eChips}</div></td>
        <td><span class="${winClass}">${win}</span></td>
        <td><span class="${delayClass}">${delay}</span></td>
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
    this._makeChipSelect("csSensors", this.shadowRoot.getElementById("csSensors"), sOpts, "sensor", "chip-sensor");
    this._makeChipSelect("csAreas", this.shadowRoot.getElementById("csAreas"), aOpts, "area", "chip-area");
    this._makeChipSelect("csEntities", this.shadowRoot.getElementById("csEntities"), eOpts, "entity", "chip-entity");

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
