// Adjustable kick parameters — the "rig handles" from MOTION.md §15.
// Each entry: value (default), min, max, step, unit, and a short description of
// what it affects. Ranges come from the biomechanical spec (first-pass values).

export const FOOT_ZONES = ['instep/laces', 'inside', 'outside'];
export const BALL_ZONES = ['center', 'below-center', 'off-center'];
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

  // Recoil — the cock-back just before the strike. Pelvis winds toward the
  // kicking foot (rotating about the plant hip) and the kicking femur pulls back
  // with the knee flexing. Degrees of femoral backswing (knee + pelvis scale off
  // it). Peaks at the top of the backswing, released by contact.
  recoil: 30,

  // Torso counter-strike — as the knee drives forward the trunk bends forward
  // over the ball (deg of spine flexion). Keeps the ball down, adds power. Peaks
  // at contact, eases through the follow-up.
  torsoBend: 20,

  // Counter arm — the arm opposite the kicking leg. Starts stretched back & up
  // during the run-up, swings with the shoulders/hips toward the kicking foot,
  // and finishes pointing down & forward. 0 = off, 1 = full.
  armSwing: 1.0,

  // §12 Whip — knee-extension drive (0..1) → strike power/velocity.
  whip: 0.75,

  // Follow-up DIRECTION — where the ball goes (deg from straight-on toward the
  // NON-kicking foot). 0 = straight down the goal line; 90 = fully sideways. Sets
  // the ball's launch azimuth.
  followDir: 0,

  // Follow-up STRENGTH — how big the body follow-through is (deg of hip rotation
  // toward the plant foot). 0 = stop the foot at the ball (no follow-up); up to
  // 90° = full follow-through: hips rotate, the kicking leg crosses over, weight
  // transfers onto the kicking foot. Acts from contact onward.
  followStrength: 0,

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
  runupAngle: 45,   // approach angle of the run-up (deg from straight-on, toward plant side)

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
  kneeAim: { min: -20, max: 10, step: 1, unit: 'cm', label: 'Knee plumb (− behind / + ahead of ball)' },
  lockAnkle: { min: 0, max: 40, step: 1, unit: '°', label: 'Lock Ankle' },
  recoil: { min: 0, max: 60, step: 1, unit: '°', label: 'Recoil (cock-back)' },
  torsoBend: { min: 0, max: 40, step: 1, unit: '°', label: 'Torso counter-strike' },
  armSwing: { min: 0, max: 1, step: 0.05, unit: '', label: 'Counter arm' },
  whip: { min: 0, max: 1, step: 0.01, unit: '', label: 'Whip (power)' },
  followDir: { min: 0, max: 90, step: 1, unit: '°', label: 'Follow-up direction (ball)' },
  followStrength: { min: 0, max: 90, step: 1, unit: '°', label: 'Follow-up strength (body)' },
};
