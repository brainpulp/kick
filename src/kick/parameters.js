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

  // Plant (support) foot placement — 3 DOF, ABSOLUTE and ball-relative,
  // enforced exactly by leg IK during the stance (TECHNIQUE.md Phase 1):
  //  depth   = plant TOE distance behind the ball centre (cm); 0 = level, − = ahead,
  //  lateral = plant TOE distance to the side of the ball (cm, toward plant side),
  //  point   = toe yaw (deg); 0 = pointing at the goal.
  // Default: planted beside the ball, toe level with it, ~15 cm to the side.
  aimSupportDepth: 0,
  supportLateral: 15,
  supportPoint: 0,

  // NOTE: the base animation is a full, natural mocap kick. Every slider below is a
  // DEVIATION layered on top of it — 0/neutral = the natural clip untouched; turn a
  // slider up to exaggerate that aspect. So the default state is the natural base.

  // §3 Tilt — lateral trunk lean away from the kicking leg (deg) → clearance/lift.
  // 0 = the clip's own natural lean.
  tilt: 0,

  // §5 Hip Turn — ABSOLUTE pelvis (hip-line) yaw at contact (deg; 0 = hips square
  // to the goal, + = opened toward the kicking side). Enforced by the pelvis solve
  // with hip/leg separation. Default overwritten with the value measured from the clip.
  hipTurn: 20,

  // §8 Knee Aim — knee plumb vs ball centre at contact (cm), enforced via the
  // IK pole. + ahead of the ball = drives it low, − behind = lofted.
  kneeAim: 0,

  // §7 Lock Ankle — ABSOLUTE plantarflexion of the kicking ankle at contact
  // (deg; + = toe pointed down). Enforced exactly in the strike window.
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

  // Trunk lean — ABSOLUTE forward flexion of the trunk at contact (deg from
  // vertical; + = hinged FORWARD over the ball, − = leaned back). The trunk snaps
  // forward at the hip through contact (the hip-hinge that adds power), so the
  // default is a forward hinge rather than the clip's natural slight lean-back.
  torsoBend: 18,

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
  axShoulderPlumb: true,
  axHipPlumb: true,
  axTrunk: true,
  axToes: true,
  axPlant: true,
  axKnee: true,
  axKneeHinge: true,
  axFemurHinge: true,
  axRulers: true,
  axGaze: true,
};

// Snapshot of the original defaults (for per-control "reset to default").
export const DEFAULTS = { ...params };

// GUI metadata: ranges + units, keyed by param name.
export const meta = {
  runupAngle: { min: 0, max: 90, step: 1, unit: '°', label: 'Approach angle' },
  runupSteps: { min: 0, max: 5, step: 1, unit: '', label: 'Steps (needs run clip)' },
  aimSupportDepth: { min: -10, max: 45, step: 1, unit: 'cm', label: 'Plant toe depth behind ball' },
  supportLateral: { min: 0, max: 45, step: 1, unit: 'cm', label: 'Plant toe lateral from ball' },
  supportPoint: { min: -45, max: 45, step: 1, unit: '°', label: 'Point (toe yaw, 0 = goal)' },
  tilt: { min: 0, max: 30, step: 1, unit: '°', label: 'Tilt (lean)' },
  hipTurn: { min: -10, max: 70, step: 1, unit: '°', label: 'Hip line (open at contact)' },
  kneeAim: { min: -20, max: 10, step: 1, unit: 'cm', label: 'Knee plumb (− behind / + ahead of ball)' },
  lockAnkle: { min: 0, max: 90, step: 1, unit: '°', label: 'Lock Ankle' },
  recoil: { min: 0, max: 60, step: 1, unit: '°', label: 'Recoil (cock-back)' },
  torsoBend: { min: -5, max: 45, step: 1, unit: '°', label: 'Trunk lean at contact' },
  armSwing: { min: 0, max: 1, step: 0.05, unit: '', label: 'Counter arm' },
  whip: { min: 0, max: 1, step: 0.01, unit: '', label: 'Whip (power)' },
  followDir: { min: 0, max: 90, step: 1, unit: '°', label: 'Follow-up direction (ball)' },
  slippage: { min: 0, max: 1, step: 0.05, unit: 'm', label: 'Slippage (plant slide fwd)' },
};
