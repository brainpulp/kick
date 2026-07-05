// Checkpoint table editor (TECHNIQUE.md, decision B: always-visible spreadsheet).
// One section per checkpoint (the moments a coach teaches); each row is one exact,
// ball-relative constraint with its target value (editable), unit, valid range, and
// the LIVE measured value at the current frame with an in-range dot — the teaching
// HUD. Clicking a checkpoint header scrubs to that moment. Profiles save/load the
// whole set. Drag-handles in the scene are a later add; the numbers are the source.
const PKEY = 'kick.profiles.v1';

const css = `
#cptbl{position:fixed;left:8px;top:52px;bottom:150px;width:288px;z-index:25;
  background:rgba(16,20,18,.93);border:1px solid #2c3a32;border-radius:7px;
  font:11px system-ui,sans-serif;color:#cfe;display:flex;flex-direction:column;
  backdrop-filter:blur(3px);overflow:hidden}
#cptbl.min{bottom:auto;height:auto}
#cptbl h3{margin:0;padding:8px 10px;font-size:11.5px;font-weight:600;color:#9fe6bf;
  letter-spacing:.3px;display:flex;justify-content:space-between;align-items:center;
  border-bottom:1px solid #223029;cursor:default}
#cptbl h3 .tog{cursor:pointer;opacity:.7;font-size:12px}
#cptbl h3 .tog:hover{opacity:1}
#cptbl .prof{display:flex;gap:4px;padding:6px 8px;border-bottom:1px solid #223029;flex-wrap:wrap}
#cptbl .prof input,#cptbl .prof select{background:#0f1512;color:#cfe;border:1px solid #2c3a32;
  border-radius:4px;padding:2px 4px;font:11px system-ui;min-width:0}
#cptbl .prof input{flex:1}
#cptbl .prof button{background:#204a2c;color:#bff;border:1px solid #2c5a38;border-radius:4px;
  padding:2px 7px;cursor:pointer;font:11px system-ui}
#cptbl .prof button:hover{background:#2a6338}
#cptbl .body{overflow-y:auto;flex:1}
#cptbl.min .body{display:none}
#cptbl .cp{border-bottom:1px solid #1c2621}
#cptbl .cph{display:flex;justify-content:space-between;align-items:center;padding:5px 10px;
  cursor:pointer;background:#17201b;color:#8fd8ac;font-weight:600}
#cptbl .cph:hover{background:#1d2a22}
#cptbl .cph.active{background:#24402e;color:#bfffd6}
#cptbl .cph .tm{opacity:.6;font-weight:400;font-size:10px}
#cptbl .row{display:grid;grid-template-columns:1fr 58px 44px 14px;gap:4px;align-items:center;
  padding:2px 8px 2px 14px}
#cptbl .row:hover{background:#141b17}
#cptbl .row label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#bcd}
#cptbl .row input,#cptbl .row select{background:#0f1512;color:#eaffef;border:1px solid #2c3a32;
  border-radius:4px;padding:1px 3px;font:11px system-ui;width:100%;text-align:right}
#cptbl .row select{text-align:left}
#cptbl .row .meas{text-align:right;opacity:.75;font-variant-numeric:tabular-nums;font-size:10px}
#cptbl .row .dot{width:8px;height:8px;border-radius:50%;background:#3a4a40;justify-self:center}
#cptbl .row .dot.ok{background:#42d977}
#cptbl .row .dot.off{background:#e0a83a}
#cptbl .rng{grid-column:1 / -1;font-size:9.5px;opacity:.45;padding:0 8px 2px 14px;margin-top:-1px}`;

export function createCheckpoints({ params, meta, checkpoints, enums, onEdit, onJump, measure, getScrub, getContactT }) {
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const el = document.createElement('div'); el.id = 'cptbl';
  el.innerHTML = `<h3><span>◆ Checkpoints — technique</span><span class="tog" title="collapse">▾</span></h3>`;
  document.body.appendChild(el);
  el.querySelector('.tog').addEventListener('click', () => el.classList.toggle('min'));

  // ---- profiles bar ----
  const prof = document.createElement('div'); prof.className = 'prof';
  prof.innerHTML = `<input placeholder="profile name" /><button data-save>Save</button>
    <select data-list></select><button data-load>Load</button><button data-del>✕</button>`;
  el.appendChild(prof);
  const nameInp = prof.querySelector('input'), listSel = prof.querySelector('[data-list]');
  const readProfiles = () => { try { return JSON.parse(localStorage.getItem(PKEY)) || {}; } catch { return {}; } };
  const writeProfiles = (o) => { try { localStorage.setItem(PKEY, JSON.stringify(o)); } catch { /* quota */ } };
  const allFields = () => checkpoints.flatMap((c) => c.fields);
  function refreshList() {
    const p = readProfiles();
    listSel.innerHTML = `<option value="">— saved —</option>` + Object.keys(p).map((n) => `<option>${n}</option>`).join('');
  }
  prof.querySelector('[data-save]').addEventListener('click', () => {
    const n = (nameInp.value || '').trim(); if (!n) return;
    const p = readProfiles(); p[n] = {}; for (const k of allFields()) p[n][k] = params[k];
    writeProfiles(p); refreshList(); listSel.value = n;
  });
  prof.querySelector('[data-load]').addEventListener('click', () => {
    const n = listSel.value; if (!n) return; const p = readProfiles()[n]; if (!p) return;
    for (const k of allFields()) if (k in p) onEdit(k, p[k]);
    rebuildValues();
  });
  prof.querySelector('[data-del]').addEventListener('click', () => {
    const n = listSel.value; if (!n) return; const p = readProfiles(); delete p[n]; writeProfiles(p); refreshList();
  });
  refreshList();

  // ---- checkpoint sections ----
  const body = document.createElement('div'); body.className = 'body'; el.appendChild(body);
  const rowRefs = {}; // key -> { input, meas, dot }
  const headRefs = [];
  for (const cp of checkpoints) {
    const sec = document.createElement('div'); sec.className = 'cp';
    const head = document.createElement('div'); head.className = 'cph';
    head.innerHTML = `<span>${cp.label}</span><span class="tm"></span>`;
    head.addEventListener('click', () => onJump(cp.tAt(getContactT())));
    sec.appendChild(head); headRefs.push({ cp, head });
    for (const key of cp.fields) {
      const m = meta[key]; const isEnum = enums[key];
      const row = document.createElement('div'); row.className = 'row';
      const lbl = document.createElement('label'); lbl.textContent = (m && m.label) || key; row.appendChild(lbl);
      let input;
      if (isEnum) {
        input = document.createElement('select');
        input.innerHTML = enums[key].map((o) => `<option>${o}</option>`).join('');
        input.value = params[key];
        input.addEventListener('change', () => onEdit(key, input.value));
      } else {
        input = document.createElement('input'); input.type = 'number';
        if (m) { input.min = m.min; input.max = m.max; input.step = m.step; }
        input.value = params[key];
        const commit = () => { let v = parseFloat(input.value); if (Number.isNaN(v)) return; onEdit(key, v); };
        input.addEventListener('change', commit);
      }
      row.appendChild(input);
      const meas = document.createElement('span'); meas.className = 'meas';
      const dot = document.createElement('span'); dot.className = 'dot';
      // column layout: label | input | (unit stacked into meas col) | dot
      row.appendChild(meas); row.appendChild(dot);
      const rng = document.createElement('div'); rng.className = 'rng';
      rng.textContent = isEnum ? '' : (m ? `range ${m.min}…${m.max} ${m.unit}` : '');
      sec.appendChild(row); if (rng.textContent) sec.appendChild(rng);
      rowRefs[key] = { input, meas, dot, isEnum, cp };
    }
    body.appendChild(sec);
  }

  function rebuildValues() {
    for (const key in rowRefs) {
      const r = rowRefs[key];
      if (document.activeElement !== r.input) r.input.value = params[key];
    }
  }

  // Live update: measured values + which checkpoint is current.
  function update() {
    rebuildValues(); // reflect edits made elsewhere (lil-gui, profile load)
    const c = getContactT(); const s = getScrub();
    for (const { cp, head } of headRefs) {
      const t = cp.tAt(c);
      head.querySelector('.tm').textContent = `t=${t.toFixed(2)}`;
      head.classList.toggle('active', Math.abs(s - t) < 0.03);
    }
    for (const key in rowRefs) {
      const r = rowRefs[key]; if (r.isEnum) { r.meas.textContent = ''; r.dot.className = 'dot'; continue; }
      // Only read the achieved value while parked NEAR this row's checkpoint — the
      // constraint isn't enforced elsewhere, so a number there would just mislead.
      const active = Math.abs(s - r.cp.tAt(c)) < 0.04;
      const a = active && measure ? measure(key) : null;
      if (a == null || !Number.isFinite(a)) { r.meas.textContent = active ? '—' : '·'; r.dot.className = 'dot'; continue; }
      r.meas.textContent = a.toFixed(a >= 100 || a <= -100 ? 0 : 1);
      const tol = Math.max(1.5, Math.abs(params[key]) * 0.06);
      r.dot.className = 'dot ' + (Math.abs(a - params[key]) <= tol ? 'ok' : 'off');
    }
  }

  return { update, rebuildValues, setVisible(v) { el.style.display = v ? 'flex' : 'none'; } };
}
