// Auto-save: persist all parameter values and the timing windows to localStorage
// so adjustments survive a reload. Transient playback state is not saved.
import { params } from './kick/parameters.js';
import { timings } from './kick/timing.js';

const KEY = 'kick.autosave.v3'; // v3: slippage default = the clip's natural slide (0.9)
const SKIP = new Set(['playing', 'scrub', 'source']); // transient / set at runtime

export function saveState() {
  try {
    const p = {};
    for (const k in params) if (!SKIP.has(k)) p[k] = params[k];
    localStorage.setItem(KEY, JSON.stringify({ p, t: timings }));
  } catch { /* storage unavailable / quota — ignore */ }
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const { p, t } = JSON.parse(raw);
    if (p) for (const k in p) if (k in params && !SKIP.has(k)) params[k] = p[k];
    if (t) for (const k in t) if (timings[k]) Object.assign(timings[k], t[k]);
    return true;
  } catch { return false; }
}

// Save periodically (covers every control without per-widget hooks) and on exit.
export function startAutosave() {
  setInterval(saveState, 1500);
  window.addEventListener('beforeunload', saveState);
  window.addEventListener('visibilitychange', () => { if (document.hidden) saveState(); });
}
