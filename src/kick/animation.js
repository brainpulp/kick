import * as THREE from 'three';

const DEG = Math.PI / 180;
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

// Procedural instep-drive kick. Drives the rig bones from the MOTION.md timeline,
// modulated by the live parameters, and derives a ball launch at contact.
//
// NOTE: bone-local rotation axes/signs below are first-pass guesses for this
// Mixamo-style rig. They are isolated in applyBone(...) calls so they can be
// tuned against the rendered result without changing the timeline logic.
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
  update(t, p) {
    this.resetPose();

    // Sides: K = kicking, S = support, C = counter arm (= support side).
    const right = p.footedness === 'right';
    const K = right ? 'Right' : 'Left';
    const S = right ? 'Left' : 'Right';
    const C = S;
    const mir = right ? 1 : -1; // flips lateral/axial signs for left-footers

    // ---- scalar timelines (degrees) ----
    const hipTurn = p.hipTurn;
    const power = p.followThrough === 'power';

    // Kicking knee: extend to ~100° preload, whip down to a contact angle that
    // depends on Whip (more whip = straighter), then follow-through variant.
    const contactKnee = THREE.MathUtils.lerp(40, 12, p.whip);
    const kneeFollow = power ? 4 : 36;
    const kickKnee = sample([
      [0, 12], [0.7, 20], [0.85, 100], [0.95, contactKnee + 8],
      [1.0, contactKnee], [1.12, kneeFollow], [1.3, 18],
    ], t);

    // Kicking hip: extend back (preload), then flex through to follow-through.
    const hipFollow = power ? 52 : 28;
    const kickHip = sample([
      [0, 0], [0.78, -8], [0.85, -25], [0.95, 18],
      [1.0, 30], [1.15, hipFollow], [1.3, 30],
    ], t);

    // Ankle plantarflexion locked from windup through contact.
    const kickAnkle = sample([
      [0, 5], [0.8, p.lockAnkle], [1.05, p.lockAnkle], [1.3, 12],
    ], t);

    // Support leg loads at plant.
    const supportKnee = sample([
      [0, 6], [0.7, 8], [0.8, 20], [1.0, 22], [1.3, 14],
    ], t);

    // Pelvis: counter-rotate (windup) then drive toward target ~hipTurn.
    const pelvisYaw = sample([
      [0, 0], [0.8, -Math.min(15, hipTurn * 0.4)], [0.95, hipTurn],
      [1.0, hipTurn], [1.3, hipTurn * 0.7],
    ], t);

    // Spine: forward lean (sustained), lateral Tilt in at plant, axial release.
    const lean = sample([[0, 4], [0.7, 8], [1.0, 9], [1.3, 7]], t);
    const tilt = sample([[0, 0], [0.7, 0], [0.82, p.tilt], [1.05, p.tilt], [1.3, p.tilt * 0.5]], t);
    const axial = sample([[0, 0], [0.85, -10], [1.0, 8], [1.3, 4]], t);

    // Neck flexion (Lock Gaze) sustained.
    const neck = sample([[0, 4], [0.78, 22], [1.05, 22], [1.3, 10]], t);

    // Counter arm swings out (abduction) peaking ~0.9.
    const armAbduct = sample([[0, 8], [0.7, 20], [0.9, 70], [1.05, 60], [1.3, 25]], t);
    const armExtend = sample([[0, 0], [0.9, 22], [1.3, 8]], t);
    const elbow = sample([[0, 12], [0.9, 45], [1.3, 25]], t);

    // ---- apply to bones (axes are tunable guesses) ----
    // Legs: flexion negative-X for knees, hip flexion +X / extension -X.
    this.applyBone(`${K}UpLeg`, kickHip * DEG, 0, 0);
    this.applyBone(`${K}Leg`, -kickKnee * DEG, 0, 0);
    this.applyBone(`${K}Foot`, kickAnkle * DEG, 0, 0);
    this.applyBone(`${S}Leg`, -supportKnee * DEG, 0, 0);
    this.applyBone(`${S}UpLeg`, 12 * DEG, 0, 0);

    // Spine distributed over the three segments.
    for (const seg of ['Spine', 'Spine1', 'Spine2']) {
      this.applyBone(seg, (lean / 3) * DEG, (axial / 3) * mir * DEG, (-tilt / 3) * mir * DEG);
    }
    this.applyBone('Hips', 0, pelvisYaw * mir * DEG, 0);
    this.applyBone('Neck', neck * 0.6 * DEG, 0, 0);
    this.applyBone('Head', neck * 0.4 * DEG, 0, 0);

    // Counter arm: abduction around Z (sign by side), extension around X; elbow.
    this.applyBone(`${C}Arm`, armExtend * DEG, 0, -armAbduct * mir * DEG);
    this.applyBone(`${C}ForeArm`, 0, -elbow * mir * DEG, 0);
    // Kicking-side arm tucks back as counterweight.
    this.applyBone(`${K}Arm`, -10 * DEG, 0, 15 * mir * DEG);

    // ---- root: hop rise before plant + CoM travel on power follow-through ----
    const hop = sample([[0, 0], [0.55, 0], [0.62, 0.05], [0.72, 0], [1.3, 0]], t);
    const comFwd = power ? sample([[0, 0], [1.0, 0], [1.3, 0.32]], t) : 0;
    this.model.position.set(this.base.x, this.base.y + hop, this.base.z - comFwd);
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
