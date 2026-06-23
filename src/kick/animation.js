import * as THREE from 'three';

const DEG = Math.PI / 180;
const lerp = THREE.MathUtils.lerp;
export const CONTACT_T = 1.0;   // normalized time of ball contact
export const CLIP_END = 1.45;   // 3-step run-up + strike + held-gaze follow-through

// Smoothstep-interpolated keyframe sampler. frames: [[t, value], ...] sorted.
function sample(frames, t) {
  if (t <= frames[0][0]) return frames[0][1];
  const last = frames[frames.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 0; i < frames.length - 1; i++) {
    const [t0, v0] = frames[i], [t1, v1] = frames[i + 1];
    if (t >= t0 && t <= t1) {
      const u = (t - t0) / (t1 - t0);
      const s = u * u * (3 - 2 * u);
      return v0 + (v1 - v0) * s;
    }
  }
  return last[1];
}

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// Procedural instep-drive kick. Drives the rig bones from a keyframe timeline
// modulated by the live parameters, and derives a ball launch at contact.
//
// Bone-local rotation axes were verified empirically against this rig:
//   Legs  : local X = sagittal swing (+forward/flex/plantarflex, -back/extend)
//           local Z = lateral (abduction / foot roll)
//   Hips  : local Y = yaw (turn toward target)
//   Spine : local X = forward lean, Y = axial twist, Z = lateral tilt
//   Arm   : local Z = abduction (raise to side), X = fwd/back swing
// `mir` flips lateral/axial signs for left-footers.
export class KickAnimation {
  constructor({ model, bones, rest }) {
    this.model = model;
    this.bones = bones;
    this.rest = rest;
    this.base = model.position.clone(); // grounded stance position
  }

  // Rotate a bone by Euler delta (radians) on top of its rest pose, local space.
  applyBone(name, ex = 0, ey = 0, ez = 0) {
    const b = this.bones[name];
    if (!b) return;
    b.quaternion.copy(this.rest[name]).multiply(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(ex, ey, ez, 'XYZ'))
    );
  }

  resetPose() {
    for (const name in this.rest) this.applyBone(name, 0, 0, 0);
  }

  // Returns { speed, elevation, azimuth, spin } describing the launch, derived
  // from the parameters at contact. Used by main.js to fly the ball.
  computeLaunch(p) {
    const power = clamp(0.3 + 0.5 * p.whip + 0.35 * (p.hipTurn / 60), 0, 1);
    const speed = 8 + power * 24; // 8..32 m/s

    let elevation = 12 - p.kneeAim * 0.9 + p.tilt * 0.25; // deg
    if (p.ballZone === 'below-center') elevation += 14;
    if (p.aimSupportDepth > 12) elevation += (p.aimSupportDepth - 12) * 0.4;
    elevation = clamp(elevation, 2, 48);

    // Curl: inside foot curls one way, outside the other; mirror for left foot.
    const mir = p.footedness === 'right' ? 1 : -1;
    let azimuth = 0, spin = 0;
    if (p.footZone === 'inside') { azimuth = -7 * mir; spin = -1 * mir; }
    else if (p.footZone === 'outside') { azimuth = 7 * mir; spin = 1 * mir; }
    if (p.ballZone === 'off-center') spin += 0.6 * mir;

    return { speed, elevation, azimuth, spin };
  }

  // Drive the whole rig + root for normalized time t in [0, CLIP_END].
  //
  // Design notes (learned from frame-by-frame review):
  //  - The pelvis is the skeleton root, so yawing it slides/spins the planted
  //    foot. We keep it nearly still and express rotation as upper-body
  //    separation through the spine instead.
  //  - Timing is asymmetric on purpose: a slow load/backswing, then an
  //    explosive snap of the knee through contact, then a long follow-through.
  //  - The root barely translates so the support foot stays planted.
  update(t, p) {
    this.resetPose();

    const right = p.footedness === 'right';
    const K = right ? 'Right' : 'Left';   // kicking side
    const S = right ? 'Left' : 'Right';   // support / plant side
    const mir = right ? 1 : -1;

    const whip = p.whip;
    // Knee bend at contact (knee over the ball); whip straightens it a little.
    const contactKnee = clamp(lerp(30, 8, whip) + p.kneeAim * 1.2, 0, 60);
    const backDepth = 1 + p.aimSupportDepth / 25;          // backswing scale
    const loft = p.ballZone === 'below-center';
    const footRoll = p.footZone === 'inside' ? 18 : p.footZone === 'outside' ? -18 : 0;

    // ---- 3-step run-up gait (blends out by the plant at ~0.62) ----
    const gait = clamp((0.62 - t) / 0.12, 0, 1);
    const ph = (t / 0.62) * Math.PI * 3;     // three strides
    const s = Math.sin(ph);
    const liftK = Math.max(0, s) * gait;     // kicking leg swing phase
    const liftS = Math.max(0, -s) * gait;    // support leg swing phase
    const armGait = s * 22 * gait;
    const bob = Math.abs(s) * 0.015 * gait;

    // ---- kicking leg: run -> cock back/out -> whip through (knee over ball) ----
    const hipFollow = p.followThrough === 'power' ? 72 : 50;
    const kickHip = sample([
      [0, 2], [0.62, -6], [0.74, -18 * backDepth], [0.88, -44 * backDepth],
      [0.96, 4], [1.0, 26], [1.12, hipFollow], [1.25, 56], [1.45, 40],
    ], t) + liftK * 30;
    const kickAcross = sample([[0, 0], [0.74, -16], [0.88, -30], [1.0, 6], [1.18, 22], [1.45, 12]], t);
    const kickKnee = sample([            // applied as -X (flexion)
      [0, 16], [0.62, 26], [0.88, 120], [0.95, contactKnee + 12], [1.0, contactKnee],
      [1.12, 8], [1.25, 34], [1.45, 24],
    ], t) + liftK * 64;
    // Ankle "opens" (dorsiflexes) on the cock-back, then locks plantarflexed from
    // just before contact through the whole follow-through.
    const kickAnkle = sample([
      [0, 4], [0.74, -12], [0.86, -12], [0.94, p.lockAnkle], [1.05, p.lockAnkle], [1.45, p.lockAnkle * 0.7],
    ], t);
    const ankleRoll = sample([[0, 0], [0.86, footRoll], [1.05, footRoll], [1.45, 0]], t);

    // ---- support / plant leg: plants ~10deg bent, then pushes off the ground ----
    const supportKnee = sample([
      [0, 12], [0.62, 16], [0.74, 10], [0.9, 14], [1.0, 16], [1.1, 6], [1.25, 8], [1.45, 14],
    ], t) + liftS * 64;
    const supportHip = sample([[0, 8], [0.62, 12], [0.74, 14], [1.0, 16], [1.12, 6], [1.45, 10]], t) + liftS * 30;

    // ---- pelvis + spine ----
    // Hip opens ~30deg as the ball is struck (plant foot has left the ground).
    const pelvisYaw = sample([[0, 0], [0.74, -6], [0.9, -8], [1.0, 30], [1.15, 34], [1.45, 24]], t);
    // Trunk bends ~25deg forward over the ball at contact.
    const lean = sample([[0, 6], [0.5, 8], [0.74, 12], [0.9, 18], [1.0, 25], [1.15, 24], [1.3, 19], [1.45, 14]], t)
      + (loft ? sample([[0, 0], [0.95, -16], [1.1, -16], [1.45, -8]], t) : 0);
    // Whole body tilted toward the kicking (right) side: -Z lean for a right-footer.
    const tiltRight = sample([[0, 0], [0.62, 8], [0.74, 16], [1.0, 18], [1.25, 12], [1.45, 8]], t);
    const twist = sample([[0, 0], [0.88, -12], [1.0, 10], [1.25, 16], [1.45, 8]], t);
    // Gaze locked on the ball — held through contact and ~1s of follow-through.
    const gaze = sample([[0, 8], [0.5, 16], [0.74, 24], [1.0, 27], [1.28, 27], [1.45, 20]], t);

    // ---- arms ----
    // Contact: opposite (support-side) arm flies up & away ~45deg; kicking-side
    // arm stays down (not back). Plus an alternating swing during the run-up.
    const cArmAbd = sample([[0, 16], [0.62, 26], [0.85, 42], [1.0, 78], [1.15, 70], [1.45, 34]], t);
    const cArmFwd = sample([[0, 6], [1.0, 12], [1.45, 6]], t) + armGait;
    const cElbow = sample([[0, 18], [0.9, 40], [1.45, 28]], t);
    const kArmAbd = sample([[0, 14], [0.85, 22], [1.0, 12], [1.45, 16]], t);
    const kArmSwing = sample([[0, 0], [0.85, 8], [1.0, 2], [1.45, 4]], t) - armGait;
    const kElbow = sample([[0, 16], [0.9, 30], [1.45, 24]], t);

    // ---- apply to bones ----
    this.applyBone(`${K}UpLeg`, kickHip * DEG, 0, kickAcross * mir * DEG);
    this.applyBone(`${K}Leg`, -kickKnee * DEG, 0, 0);
    this.applyBone(`${K}Foot`, kickAnkle * DEG, 0, ankleRoll * mir * DEG);
    this.applyBone(`${S}UpLeg`, supportHip * DEG, 0, -5 * mir * DEG);
    this.applyBone(`${S}Leg`, -supportKnee * DEG, 0, 0);

    this.applyBone('Hips', 0, pelvisYaw * mir * DEG, 0);
    for (const seg of ['Spine', 'Spine1', 'Spine2']) {
      this.applyBone(seg, (lean / 3) * DEG, (twist / 3) * mir * DEG, (-tiltRight / 3) * mir * DEG);
    }
    this.applyBone('Neck', gaze * 0.6 * DEG, 0, 0);
    this.applyBone('Head', gaze * 0.4 * DEG, 0, 0);

    // Abduction is +Z on the right arm, -Z on the left (hence the -mir on the
    // support side). X swings the arm fore/aft.
    this.applyBone(`${S}Arm`, cArmFwd * DEG, 0, cArmAbd * -mir * DEG);
    this.applyBone(`${S}ForeArm`, 0, cElbow * -mir * DEG, 0);
    this.applyBone(`${K}Arm`, kArmSwing * DEG, 0, kArmAbd * mir * DEG);
    this.applyBone(`${K}ForeArm`, 0, kElbow * mir * DEG, 0);

    // ---- root: 3-step approach in, then spring/step through; plant foot lifts ----
    const bz = this.base.z;
    const posZ = sample([[0, bz + 1.5], [0.6, bz], [0.74, bz], [1.0, bz - 0.06], [1.25, bz - 0.42], [1.45, bz - 0.44]], t);
    const posY = this.base.y + bob
      + sample([[0, 0], [1.0, 0], [1.08, 0.05], [1.2, 0.12], [1.45, 0.06]], t); // push off after contact
    this.model.position.set(this.base.x, posY, posZ);
  }

  phaseLabel(t) {
    if (t < 0.55) return 'Run-up';
    if (t < 0.74) return 'Plant';
    if (t < 0.9) return 'Cock-back';
    if (t < 1.0) return 'Strike';
    if (t < 1.06) return 'Contact';
    if (t < 1.3) return 'Follow-through';
    return 'Hold gaze';
  }
}
