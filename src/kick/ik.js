// Analytic constraint solvers for the technique checkpoints (TECHNIQUE.md).
// All solves work in WORLD space and write corrections onto the bones with the
// parent-conjugate pattern (corr = P⁻¹ · R · P), so they compose with any pose
// underneath (mocap, editor, procedural). Every solve takes a weight 0..1.
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _t = new THREE.Vector3(), _u = new THREE.Vector3(), _w = new THREE.Vector3();
const _axis = new THREE.Vector3(), _n1 = new THREE.Vector3(), _n2 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _corr = new THREE.Quaternion();
const _id = new THREE.Quaternion();
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Apply a world-space rotation (axis, radians, scaled by weight) to a bone.
function rotBoneWorld(bone, axis, angle, weight = 1) {
  if (Math.abs(angle) < 1e-5 || weight <= 0) return;
  _q.setFromAxisAngle(axis, angle);
  if (weight < 1) _q.copy(_id.identity().slerp(_q, weight));
  bone.parent.getWorldQuaternion(_pq);
  _corr.copy(_pq).invert().multiply(_q).multiply(_pq);
  bone.quaternion.premultiply(_corr);
}

const wpos = (bone, out) => bone.getWorldPosition(out);
const interior = (A, B, C) => { // interior angle at B (radians)
  _n1.copy(A).sub(B).normalize(); _n2.copy(C).sub(B).normalize();
  return Math.acos(clamp(_n1.dot(_n2), -1, 1));
};

// Two-bone leg IK: place the ANKLE at `target`, knee bending toward `pole`
// (a world point the knee should plumb toward). Root chain: hip→knee→ankle.
// The model's world matrices must be current before calling; each step
// re-updates the sub-chain it moved.
export function solveLeg({ model, hip, knee, ankle, target, pole = null, weight = 1 }) {
  if (weight <= 0) return;
  wpos(hip, _a); wpos(knee, _b); wpos(ankle, _c);
  const L1 = _a.distanceTo(_b), L2 = _b.distanceTo(_c);
  _t.copy(target);
  const d = clamp(_a.distanceTo(_t), Math.abs(L1 - L2) * 1.02 + 1e-4, (L1 + L2) * 0.995);

  // 1) Set the knee's interior angle (law of cosines) about the current bend axis.
  const want = Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
  const cur = interior(_a, _b, _c);
  _axis.crossVectors(_u.copy(_a).sub(_b), _w.copy(_c).sub(_b));
  if (_axis.lengthSq() < 1e-8) _axis.set(1, 0, 0).applyQuaternion(knee.getWorldQuaternion(_pq)); // straight leg: local X
  _axis.normalize();
  rotBoneWorld(knee, _axis, want - cur, weight);
  model.updateMatrixWorld(true);
  wpos(knee, _b); wpos(ankle, _c);
  if (Math.abs(interior(_a, _b, _c) - (cur + (want - cur) * weight)) > Math.abs(want - cur) * 0.5 + 0.02) {
    // sign was wrong for this rig frame — flip
    rotBoneWorld(knee, _axis, -2 * (want - cur), weight);
    model.updateMatrixWorld(true);
    wpos(ankle, _c);
  }

  // 2) Swing the whole chain (rotate the hip bone) so hip→ankle points at hip→target.
  _u.copy(_c).sub(_a).normalize(); _w.copy(_t).sub(_a).normalize();
  _q.setFromUnitVectors(_u, _w);
  _axis.copy(_u).cross(_w);
  if (_axis.lengthSq() > 1e-10) {
    const ang = Math.acos(clamp(_u.dot(_w), -1, 1));
    rotBoneWorld(hip, _axis.normalize(), ang, weight);
    model.updateMatrixWorld(true);
  }

  // 3) Pole: spin the chain about the hip→target axis so the knee plumbs toward `pole`.
  if (pole) {
    wpos(knee, _b);
    _axis.copy(_t).sub(_a).normalize();
    _n1.copy(_b).sub(_a).addScaledVector(_axis, -_b.clone().sub(_a).dot(_axis)).normalize();  // knee dir ⊥ axis
    _n2.copy(pole).sub(_a).addScaledVector(_axis, -_u.copy(pole).sub(_a).dot(_axis)).normalize(); // pole dir ⊥ axis
    if (_n1.lengthSq() > 1e-8 && _n2.lengthSq() > 1e-8) {
      let ang = Math.acos(clamp(_n1.dot(_n2), -1, 1));
      if (_w.crossVectors(_n1, _n2).dot(_axis) < 0) ang = -ang;
      rotBoneWorld(hip, _axis, ang, weight);
      model.updateMatrixWorld(true);
    }
  }
}

// Absolute foot orientation: world yaw of the ankle→toe heading (0 = facing -Z,
// the goal; + = toward +X) and/or pitch (plantarflexion: + = toe pointed DOWN
// below the ankle — the "locked" instep).
const _Y = new THREE.Vector3(0, 1, 0);
export function solveFoot({ model, foot, toe, yawDeg = null, pitchDeg = null, weight = 1 }) {
  if (weight <= 0 || !foot || !toe) return;
  if (yawDeg != null) {
    wpos(foot, _a); wpos(toe, _b);
    const heading = Math.atan2(_b.x - _a.x, -(_b.z - _a.z));
    // A +rotation about world Y DECREASES this heading measure, hence the sign.
    rotBoneWorld(foot, _Y, heading - (yawDeg * Math.PI / 180), weight);
    model.updateMatrixWorld(true);
  }
  if (pitchDeg != null) {
    wpos(foot, _a); wpos(toe, _b);
    _u.copy(_b).sub(_a);
    const flat = Math.hypot(_u.x, _u.z);
    const pitch = Math.atan2(-_u.y, flat); // + = toe below ankle
    _axis.set(_u.x, 0, _u.z).normalize().cross(_Y).negate(); // lateral axis (right of heading)
    if (_axis.lengthSq() > 1e-8) {
      rotBoneWorld(foot, _axis.normalize(), (pitchDeg * Math.PI / 180) - pitch, weight);
      model.updateMatrixWorld(true);
    }
  }
}
