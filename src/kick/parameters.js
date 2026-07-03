// Adjustable kick parameters — the "rig handles" from MOTION.md §15.
// Each entry: value (default), min, max, step, unit, and a short description of
// what it affects. Ranges come from the biomechanical spec (first-pass values).

// Foot contact zones (where on the boot meets the ball).
export const FOOT_ZONES = ['laces', 'inside', 'outside-bony', 'toe', 'inside-instep'];
// Ball contact zones: center + two concentric rings, each N/NE/E/SE/S/SW/W/NW.
const BALL_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const BALL_ZONES = ['center', ...BALL_DIRS.map((d) => `in-${d}`), ...BALL_DIRS.map((d) => `out-${d}`)];
export const FOOTEDNESS = ['right', 'left'];

// Live values the rest of the app reads/writes (bound to the GUI).
export const params = {
  footedness: 'right',

  // Plant (support) foot placement — 3 DOF, relative to the ball:
  //  depth   = how far BEHIND the ball (cm); more = more hip room → loft/power,
  //  lateral = how far to the SIDE of the ball (cm), + = wider toward plant side,
  //  point   = toe yaw (deg); point off the goal to add effect/curl.
  aimSupportDepth: 12,
  supportLateral: 0,
  supportPoint: 0,

  // NOTE: the base animation is a full, natural mocap kick. Every slider below is a
  // DEVIATION layered on top of it — 0/neutral = the natural clip untouched; turn a
  // slider up to exaggerate that aspect. So the default state is the natural base.

  // §3 Tilt — lateral trunk lean away from the kicking leg (deg) → clearance/lift.
  // 0 = the clip's own natural lean.
  tilt: 0,

  // §5 Hip Turn — pelvic axial rotation toward target (deg) → core power.
  hipTurn: 38,

  // §8 Knee Aim — knee horizontal offset vs ball center (cm). + ahead = low,
  // - behind = lofted.
  kneeAim: 0,

  // §7 Lock Ankle — plantarflexion of the kicking ankle (deg) → contact surface.
  lockAnkle: 25,

  // §10 Points — contact geometry.
  footZone: 'laces',
  ballZone: 'center',

  // Recoil — the cock-back just before the strike. Pelvis winds toward the
  // kicking foot (rotating about the plant hip) and the kicking femur pulls back
  // with the knee flexing. Degrees of femoral backswing (knee + pelvis scale off
  // it). Peaks at the top of the backswing, released by contact. 0 = the clip's
  // own natural cock-back (extra recoil is layered ON TOP of it).
  recoil: 0,

  // Torso counter-strike — as the knee drives forward the trunk bends forward
  // over the ball (deg of spine flexion). Keeps the ball down, adds power. Peaks
  // at contact, eases through the follow-up. 0 = the clip's own natural lean.
  torsoBend: 0,

  // Counter arm — the arm opposite the kicking leg. When > 0 it REPLACES the
  // clip's natural arm swing with a synthetic one (stretched back&up in the run-up
  // → down&forward at the end). 0 = keep the clip's own natural arms.
  armSwing: 0,

  // §12 Whip — extra knee-extension drive (0..1) layered on the clip's own strike.
  // 0 = the clip's natural whip; turn up for a snappier/harder strike.
  whip: 0,

  // Follow-up DIRECTION — where the ball goes (deg from straight-on toward the
  // NON-kicking foot). 0 = straight down the goal line; 90 = fully sideways. Sets
  // the ball's launch azimuth.
  followDir: 0,

  // Slippage — how far the plant foot slides forward through the follow-up
  // (metres). The clip's natural baked slide is ~0.9 m, so 0.9 = the untouched
  // natural motion; 0 pins the foot (the ending covers less ground).
  slippage: 0.9,

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
  runupSteps: 2,    // procedural jog strides prepended before an imported clip (0–5)
  runupAngle: 0,    // approach angle (deg from straight-on, toward plant side); 0 = the clip's straight run
  lockGaze: false,  // when on, force the head to stay aimed at the ball until landing; off = the clip's natural head

  // Body-axis annotation lines (master toggle + per-axis).
  showAxes: true,
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
  runupAngle: { min: 0, max: 90, step: 1, unit: '°', label: 'Approach angle' },
  runupSteps: { min: 0, max: 5, step: 1, unit: '', label: 'Steps (needs run clip)' },
  aimSupportDepth: { min: 0, max: 25, step: 1, unit: 'cm', label: 'Depth behind ball' },
  supportLateral: { min: -15, max: 15, step: 1, unit: 'cm', label: 'Lateral from ball' },
  supportPoint: { min: -30, max: 30, step: 1, unit: '°', label: 'Point (toe yaw)' },
  tilt: { min: 0, max: 30, step: 1, unit: '°', label: 'Tilt (lean)' },
  hipTurn: { min: 0, max: 60, step: 1, unit: '°', label: 'Hip Turn' },
  kneeAim: { min: -20, max: 10, step: 1, unit: 'cm', label: 'Knee plumb (− behind / + ahead of ball)' },
  lockAnkle: { min: 0, max: 90, step: 1, unit: '°', label: 'Lock Ankle' },
  recoil: { min: 0, max: 60, step: 1, unit: '°', label: 'Recoil (cock-back)' },
  torsoBend: { min: 0, max: 40, step: 1, unit: '°', label: 'Torso counter-strike' },
  armSwing: { min: 0, max: 1, step: 0.05, unit: '', label: 'Counter arm' },
  whip: { min: 0, max: 1, step: 0.01, unit: '', label: 'Whip (power)' },
  followDir: { min: 0, max: 90, step: 1, unit: '°', label: 'Follow-up direction (ball)' },
  slippage: { min: 0, max: 1, step: 0.05, unit: 'm', label: 'Slippage (plant slide fwd)' },
};
