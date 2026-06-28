// Premiere-style timing editor (dopesheet). One row per effect; each row shows
// its envelope window as a bar with three draggable handles — start, peak, end —
// so you can retime WHEN each parameter acts. A playhead tracks the clip time.
import { timings, TIMING_DEFAULTS } from '../kick/timing.js';

const css = `
#envtl{position:fixed;left:12px;top:64px;width:340px;background:rgba(18,22,20,.86);
  border:1px solid #2c3a32;border-radius:8px;padding:8px 10px;font:11px system-ui,sans-serif;
  color:#cfe;z-index:30;user-select:none;backdrop-filter:blur(3px)}
#envtl h4{margin:0 0 6px;font-size:11px;font-weight:600;color:#9fe6bf;letter-spacing:.3px;
  display:flex;justify-content:space-between}
#envtl .row{display:flex;align-items:center;height:20px;margin:2px 0}
#envtl .lbl{width:74px;flex:0 0 74px;color:#bcd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#envtl .trk{position:relative;flex:1;height:14px;background:#1d2722;border-radius:3px;overflow:visible}
#envtl .fill{position:absolute;top:3px;height:8px;background:#2f6b3a;border-radius:2px;opacity:.55}
#envtl .h{position:absolute;top:-1px;width:9px;height:16px;margin-left:-5px;border-radius:2px;
  background:#8ff0b6;cursor:ew-resize;border:1px solid #0c140f}
#envtl .h.peak{background:#eafff0}
#envtl .ph{position:absolute;top:0;bottom:0;width:2px;background:#ffd23f;pointer-events:none;left:0}
#envtl .rst{cursor:pointer;color:#9fb;opacity:.7;font-size:10px}
#envtl .rst:hover{opacity:1}`;

export function createEnvTimeline({ onChange, getScrub }) {
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const el = document.createElement('div'); el.id = 'envtl';
  el.innerHTML = `<h4><span>Timing (when each acts)</span><span class="rst" data-all>↺ reset all</span></h4>`;
  document.body.appendChild(el);

  const ph = document.createElement('div'); ph.className = 'ph'; // shared playhead overlay
  const rows = {};

  const keys = Object.keys(timings);
  for (const key of keys) {
    const t = timings[key];
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<span class="lbl">${t.label}</span>`;
    const trk = document.createElement('div'); trk.className = 'trk';
    const fill = document.createElement('div'); fill.className = 'fill';
    const hS = mkHandle(''); const hP = mkHandle('peak'); const hE = mkHandle('');
    trk.append(fill, hS, hP, hE);
    row.append(trk);
    el.append(row);
    rows[key] = { trk, fill, hS, hP, hE };
    bindDrag(key, 'start', hS, trk);
    bindDrag(key, 'peak', hP, trk);
    bindDrag(key, 'end', hE, trk);
  }
  // playhead spans the track column: append into the first track's parent area
  el.append(ph);

  function mkHandle(cls) { const d = document.createElement('div'); d.className = `h ${cls}`.trim(); return d; }

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  function bindDrag(key, field, handle, trk) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault(); handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const r = trk.getBoundingClientRect();
        let v = clamp01((ev.clientX - r.left) / r.width);
        const t = timings[key];
        // keep start <= peak <= end
        if (field === 'start') v = Math.min(v, t.peak);
        if (field === 'peak') v = Math.max(t.start, Math.min(v, t.end));
        if (field === 'end') v = Math.max(v, t.peak);
        t[field] = v;
        layout(key);
        onChange && onChange();
      };
      const up = (ev) => { handle.releasePointerCapture(ev.pointerId); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
  }

  function layout(key) {
    const t = timings[key]; const r = rows[key];
    const pct = (v) => `${v * 100}%`;
    r.hS.style.left = pct(t.start); r.hP.style.left = pct(t.peak); r.hE.style.left = pct(t.end);
    r.fill.style.left = pct(t.start); r.fill.style.width = pct(Math.max(0, t.end - t.start));
  }
  for (const k of keys) layout(k);

  el.querySelector('[data-all]').addEventListener('click', () => {
    for (const k of keys) Object.assign(timings[k], TIMING_DEFAULTS[k]);
    for (const k of keys) layout(k);
    onChange && onChange();
  });

  // position the playhead over the track column (tracks start after the 74px label + gaps)
  function update() {
    const s = getScrub ? getScrub() : 0;
    const anyTrk = rows[keys[0]].trk; const r = anyTrk.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    ph.style.left = `${(r.left - er.left) + s * r.width}px`;
    ph.style.top = `${(r.top - er.top) - 2}px`;
    ph.style.height = `${(rows[keys[keys.length - 1]].trk.getBoundingClientRect().bottom - r.top) + 4}px`;
  }

  return { update, setVisible(v) { el.style.display = v ? 'block' : 'none'; } };
}
