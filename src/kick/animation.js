import * as THREE from 'three';

const DEG = Math.PI / 180;
const lerp = THREE.MathUtils.lerp;
export const CONTACT_T = 1.0;   // normalized time of ball contact
export const CLIP_END = 1.3;    // includes follow-through / recovery

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
    const power = p.followThrough === 'power';

    // ---- parameter-derived shaping (this is what makes the sliders bite) ----
    const whip = p.whip;                                   // 0..1
    // Knee bend at contact: whip straightens it; Knee-Aim ahead(+) bends it
    // (knee over ball = low drive), behind(-) straightens it (loft).
    const contactKnee = clamp(lerp(34, 2, whip) + p.kneeAim * 1.2, 0, 70);
    const backDepth = 1 + p.aimSupportDepth / 25;          // 1..2 backswing scale
    const loft = p.ballZone === 'below-center';
    const off = p.ballZone === 'off-center';
    // Foot roll for inside/outside contact surface (deg, local Z).
    const footRoll = p.footZone === 'inside' ? 20 : p.footZone === 'outside' ? -20 : 0;

    // ---- kicking leg: load back, then explosive whip through the ball ----
    const hipFollow = power ? 70 : 42;
    const kickHip = sample([
      [0, 4], [0.5, 6], [0.65, -14 * backDepth], [0.80, -34 * backDepth],
      [0.92, 6], [1.0, 30], [1.12, hipFollow], [1.3, 26],
    ], t);
    const kickKnee = sample([            // applied as -X (flexion: heel toward seat)
      [0, 18], [0.6, 28], [0.80, 122], [0.93, contactKnee + 14], [1.0, contactKnee],
      [1.12, power ? 4 : 46], [1.3, 24],
    ], t);
    const kickAnkle = sample([           // +X plantarflexion, locked windup -> contact
      [0, 8], [0.75, p.lockAnkle], [1.05, p.lockAnkle], [1.3, 12],
    ], t);
    const ankleRoll = sample([[0, 0], [0.82, footRoll], [1.05, footRoll], [1.3, 0]], t);

    // ---- support / plant leg: bends to absorb load, stays put ----
    const supportKnee = sample([[0, 10], [0.7, 14], [0.85, 30], [1.0, 30], [1.15, 22], [1.3, 14]], t);
    const supportHip = sample([[0, 8], [0.85, 18], [1.0, 16], [1.3, 10]], t);

    // ---- pelvis + spine ----
    const hipTurn = p.hipTurn;
    // Pelvis stays almost fixed (keeps the plant foot grounded); the "hip turn"
    // reads through the trunk separation below.
    const pelvisYaw = sample([[0, 0], [0.8, -4], [1.0, 4], [1.3, 2]], t);
    const lean = sample([[0, 6], [0.7, 12], [1.0, 14], [1.3, 9]], t)
      + (loft ? sample([[0, 0], [0.9, -18], [1.05, -18], [1.3, -8]], t) : 0); // lean back to get under the ball
    const tilt = sample([[0, 0], [0.7, 0], [0.9, p.tilt], [1.05, p.tilt], [1.3, p.tilt * 0.5]], t);
    // Trunk separation: wind up against the target, snap through at contact.
    const twist = sample([[0, 0], [0.80, -(10 + hipTurn * 0.6)], [1.0, (8 + hipTurn * 0.5)], [1.3, hipTurn * 0.2]], t);
    const neck = sample([[0, 6], [0.8, 22], [1.05, 20], [1.3, 12]], t);

    // ---- arms (counter-swing scales with hip turn + whip) ----
    const swing = 0.7 + 0.4 * whip + hipTurn / 150;
    const cArmAbd = sample([[0, 18], [0.7, 34], [0.9, 64], [1.05, 54], [1.3, 30]], t) * swing; // support side
    const cArmFwd = sample([[0, 4], [0.9, 30], [1.3, 12]], t) * swing;
    const cElbow = sample([[0, 18], [0.9, 50], [1.3, 30]], t);
    const kArmBack = sample([[0, 10], [0.8, 46], [1.0, 34], [1.3, 16]], t) * swing; // kicking-side arm back/up
    const kElbow = sample([[0, 16], [0.8, 40], [1.3, 26]], t);

    // ---- apply to bones ----
    this.applyBone(`${K}UpLeg`, kickHip * DEG, 0, (off ? 8 * mir : 0) * DEG);
    this.applyBone(`${K}Leg`, -kickKnee * DEG, 0, 0);
    this.applyBone(`${K}Foot`, kickAnkle * DEG, 0, ankleRoll * mir * DEG);
    this.applyBone(`${S}UpLeg`, supportHip * DEG, 0, -5 * mir * DEG);
    this.applyBone(`${S}Leg`, -supportKnee * DEG, 0, 0);

    this.applyBone('Hips', 0, pelvisYaw * mir * DEG, 0);
    for (const seg of ['Spine', 'Spine1', 'Spine2']) {
      this.applyBone(seg, (lean / 3) * DEG, (twist / 3) * mir * DEG, (tilt / 3) * mir * DEG);
    }
    this.applyBone('Neck', neck * 0.6 * DEG, 0, 0);
    this.applyBone('Head', neck * 0.4 * DEG, 0, 0);

    // Counter arm = support side (abduction is +Z on the right arm, -Z on the
    // left, hence the -mir); kicking-side arm swings back as counterweight.
    this.applyBone(`${S}Arm`, cArmFwd * DEG, 0, cArmAbd * -mir * DEG);
    this.applyBone(`${S}ForeArm`, 0, cElbow * -mir * DEG, 0);
    this.applyBone(`${K}Arm`, -kArmBack * DEG, 0, 22 * mir * DEG);
    this.applyBone(`${K}ForeArm`, 0, kElbow * mir * DEG, 0);

    // ---- root: stays planted; only a small weight shift on follow-through ----
    const comFwd = sample([[0, 0], [1.0, 0], [1.15, power ? 0.10 : 0.04], [1.3, power ? 0.08 : 0.03]], t);
    this.model.position.set(this.base.x, this.base.y, this.base.z - comFwd);
  }

  phaseLabel(t) {
    if (t < 0.55) return 'Runup';
    if (t < 0.7) return 'Hop';
    if (t < 0.8) return 'Plant';
    if (t < 0.88) return 'Pre-Load';
    if (t < 0.95) return 'Hip Turn';
    if (t < 1.0) return 'Whip';
    if (t < 1.04) return 'Contact';
    return 'Follow-Through';
  }
}
