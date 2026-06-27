// Adjustable kick parameters — the "rig handles" from MOTION.md §15.
// Each entry: value (default), min, max, step, unit, and a short description of
// what it affects. Ranges come from the biomechanical spec (first-pass values).

export const FOOT_ZONES = ['instep/laces', 'inside', 'outside'];
export const BALL_ZONES = ['center', 'below-center', 'off-center'];
export const FOLLOW_VARIANTS = ['power', 'control'];
export const FOOTEDNESS = ['right', 'left'];

// Live values the rest of the app reads/writes (bound to the GUI).
export const params = {
  footedness: 'right',

  // §2 Aim Support — support-foot depth behind the ball (cm). Higher = more hip
  // room = more power and loft; 0 = level with ball = compact/low.
  aimSupportDepth: 12,

  // §3 Tilt — lateral trunk lean away from the kicking leg (deg) → clearance/lift.
  tilt: 15,

  // §5 Hip Turn — pelvic axial rotation toward target (deg) → core power.
  hipTurn: 38,

  // §8 Knee Aim — knee horizontal offset vs ball center (cm). + ahead = low,
  // - behind = lofted.
  kneeAim: 0,

  // §7 Lock Ankle — plantarflexion of the kicking ankle (deg) → contact surface.
  lockAnkle: 25,

  // §10 Points — contact geometry.
  footZone: 'instep/laces',
  ballZone: 'center',

  // §12 Whip — knee-extension drive (0..1) → strike power/velocity.
  whip: 0.75,

  // §13 Follow-Through — power vs control variant.
  followThrough: 'power',

  // playback
  playing: true,
  speed: 1.0,   // overall playback rate ("fasten"): >1 faster; 1 = natural
  delay: 0.6,   // seconds held on the first frame before each loop
  scrub: 0.0, // 0..1 of the full clip (incl. follow-through), set while paused
  // Per-stage speed multipliers for an imported clip (1 = natural). Stages are
  // anchored to the calibrated contact moment.
  spdPreRunup: 1.0,
  spdRunup: 1.0,
  spdRecoil: 1.0,
  spdWhip: 1.0,
  spdFollow: 1.0,
  useClip: true, // play the authored keyframe clip (vs the procedural kick)
  source: 'procedural', // 'procedural' | 'authored' | 'mocap' (set at runtime)
  rootMotion: true, // apply an imported clip's root translation (locomotion)

  // Body-axis annotation lines (master toggle + per-axis).
  showAxes: false,
  axHips: true,
  axShoulders: true,
  axToes: true,
  axKnee: true,
  axGaze: true,
};

// Snapshot of the original defaults (for per-control "reset to default").
export const DEFAULTS = { ...params };

// GUI metadata: ranges + units, keyed by param name.
export const meta = {
  aimSupportDepth: { min: 0, max: 25, step: 1, unit: 'cm', label: 'Aim Support (depth)' },
  tilt: { min: 0, max: 30, step: 1, unit: '°', label: 'Tilt (lean)' },
  hipTurn: { min: 0, max: 60, step: 1, unit: '°', label: 'Hip Turn' },
  kneeAim: { min: -15, max: 15, step: 1, unit: 'cm', label: 'Knee Aim (over ball)' },
  lockAnkle: { min: 0, max: 40, step: 1, unit: '°', label: 'Lock Ankle' },
  whip: { min: 0, max: 1, step: 0.01, unit: '', label: 'Whip (power)' },
};
