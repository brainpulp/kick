// Premiere-style timing editor (dopesheet), docked full-width along the bottom.
// One row per effect; each row shows its envelope window as a bar with three
// draggable handles — start, peak, end — to retime WHEN each parameter acts.
// A draggable ruler/playhead scrubs the clip, so this doubles as the timeline.
import { timings, TIMING_DEFAULTS } from '../kick/timing.js';

const css = `
#envtl{position:fixed;left:0;right:262px;bottom:0;background:rgba(18,22,20,.93);
  border-top:1px solid #2c3a32;border-right:1px solid #2c3a32;padding:6px 16px 10px;
  font:11px system-ui,sans-serif;color:#cfe;z-index:30;user-select:none;backdrop-filter:blur(3px)}
#envtl h4{margin:0 0 6px;font-size:11px;font-weight:600;color:#9fe6bf;letter-spacing:.3px;
  display:flex;justify-content:space-between}
#envtl .row{display:flex;align-items:center;height:18px;margin:2px 0}
#envtl .lbl{width:90px;flex:0 0 90px;color:#bcd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#envtl .trk{position:relative;flex:1;height:13px;background:#1d2722;border-radius:3px}
#envtl .ruler{position:relative;flex:1;height:12px;background:#161d19;border-radius:3px;cursor:ew-resize}
#envtl .fill{position:absolute;top:3px;height:7px;background:#2f6b3a;border-radius:2px;opacity:.55}
#envtl .h{position:absolute;top:-1px;width:8px;height:15px;margin-left:-4px;border-radius:2px;
  background:#8ff0b6;cursor:ew-resize;border:1px solid #0c140f}
#envtl .h.peak{background:#eafff0}
#envtl .ph{position:absolute;top:0;bottom:0;width:2px;background:#ffd23f;pointer-events:none;left:0}
#envtl .peg{position:absolute;top:0;bottom:0;width:2px;background:#ff5d5d;opacity:.8;pointer-events:none;left:0}
#envtl .rst{cursor:pointer;color:#9fb;opacity:.7;font-size:10px}
#envtl .rst:hover{opacity:1}`;

export function createEnvTimeline({ onChange, onScrub, getScrub, getContact }) {
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const el = document.createElement('div'); el.id = 'envtl';
  el.innerHTML = `<h4><span>Timing — drag anywhere to scrub · red line = contact (pegged)</span><span class="rst" data-all>↺ reset all</span></h4>`;
  document.body.appendChild(el);

  const ph = document.createElement('div'); ph.className = 'ph'; // playhead overlay (spans rows)
  const peg = document.createElement('div'); peg.className = 'peg'; // fixed contact marker
  const rows = {};
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  // Scrub ruler row at the top of the track column.
  const rulerRow = document.createElement('div'); rulerRow.className = 'row';
  rulerRow.innerHTML = `<span class="lbl">⏱ scrub</span>`;
  const ruler = document.createElement('div'); ruler.className = 'ruler';
  rulerRow.append(ruler); el.append(rulerRow);
  const scrubFrom = (ev) => { const r = ruler.getBoundingClientRect(); onScrub && onScrub(clamp01((ev.clientX - r.left) / r.width)); };
  // Scrub by dragging ANYWHERE on the timeline (ruler or any track row), as long
  // as you're not grabbing an envelope handle (those stopPropagation).
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest && e.target.closest('.h')) return;     // handle drag
    if (e.target.closest && e.target.closest('.rst')) return;   // reset link
    const r = ruler.getBoundingClientRect();
    if (e.clientX < r.left - 2) return;                          // label column → ignore
    e.preventDefault(); scrubFrom(e);
    const move = (ev) => scrubFrom(ev);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  });

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
  el.append(ph); el.append(peg);

  function mkHandle(cls) { const d = document.createElement('div'); d.className = `h ${cls}`.trim(); return d; }

  function bindDrag(key, field, handle, trk) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation(); handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const r = trk.getBoundingClientRect();
        let v = clamp01((ev.clientX - r.left) / r.width);
        const t = timings[key];
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

  // Playhead spans from the ruler down through the last track, over the column.
  function update() {
    const s = getScrub ? getScrub() : 0;
    const r = ruler.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    const top = (r.top - er.top) - 2;
    const height = (rows[keys[keys.length - 1]].trk.getBoundingClientRect().bottom - r.top) + 4;
    ph.style.left = `${(r.left - er.left) + s * r.width}px`; ph.style.top = `${top}px`; ph.style.height = `${height}px`;
    const c = getContact ? getContact() : null;
    if (c == null) { peg.style.display = 'none'; } else {
      peg.style.display = 'block';
      peg.style.left = `${(r.left - er.left) + c * r.width}px`; peg.style.top = `${top}px`; peg.style.height = `${height}px`;
    }
  }

  return { update, setVisible(v) { el.style.display = v ? 'block' : 'none'; } };
}
