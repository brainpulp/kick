// Per-effect timing envelopes in normalized clip time (0..1), editable from the
// dopesheet (the Premiere-style timeline). Each effect has {start, peak, end}:
//   start→peak  ramps the effect in (0→1),
//   peak →end   ramps it out (1→0); if end<=peak the effect HOLDS at 1.
// Defaults are anchored to the calibrated contact (~0.38) of the imported clip.
export const timings = {
  recoil: { start: 0.30, peak: 0.35, end: 0.38, label: 'Recoil' },
  hop:    { start: 0.14, peak: 0.21, end: 0.28, label: 'Hop (pre-plant)' },
  whip:   { start: 0.34, peak: 0.39, end: 0.46, label: 'Whip' },
  torso:  { start: 0.32, peak: 0.38, end: 1.00, label: 'Torso' },
  tilt:   { start: 0.30, peak: 0.38, end: 1.00, label: 'Tilt' },
  arm:    { start: 0.22, peak: 0.36, end: 0.36, label: 'Counter arm' }, // swings back through the recoil, holds
  follow: { start: 0.38, peak: 1.00, end: 1.00, label: 'Follow-up' },
};

// Deep-copied defaults so the dopesheet can offer a per-row reset.
export const TIMING_DEFAULTS = JSON.parse(JSON.stringify(timings));

const smooth = (u) => { const x = Math.min(1, Math.max(0, u)); return x * x * (3 - 2 * x); };

// Evaluate an effect's envelope at normalized clip time `s` → 0..1.
export function env(s, t) {
  if (!t || s <= t.start) return 0;
  if (s < t.peak) return smooth((s - t.start) / Math.max(1e-3, t.peak - t.start));
  if (t.end <= t.peak) return 1;                 // hold (no decay)
  if (s < t.end) return 1 - smooth((s - t.peak) / Math.max(1e-3, t.end - t.peak));
  return 0;
}
