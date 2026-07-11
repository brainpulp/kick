import * as THREE from 'three';
import { solveLeg, solveFoot } from './ik.js';

// Procedural clean run-up. The imported clip is a KICK clip — its baked approach
// is skate-y and only carries ~1.5 clean strides. This synthesizes a proper
// N-step run that drives the rig over the approach window [0, P) and crossfades
// into the clip at the plant (P), so the run-in reads as real, planted steps.
//
// No-skate by construction: each footfall is a FIXED spot on the ground; the
// stance foot is IK-locked to its spot every frame while the pelvis travels
// forward past it (exactly how a real stance works). The swing foot arcs to the
// next spot. The last footfall is the PLANT foot, landed on the clip's own
// plant-lock so the hand-off to the strike is seamless.

const DEG = Math.PI / 180;
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _tgt = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _hip = new THREE.Vector3();
const _toe = new THREE.Vector3();
const GROUND_CLEAR = 0.045; // lowest stance toe rests this far above the pitch (matches main.js)
const smooth = (u) => { const x = Math.min(1, Math.max(0, u)); return x * x * (3 - 2 * x); };

// Full-body jog seed from REST (T-pose): dropped, swinging arms, a forward trunk
// lean and a head kept up. The LEGS are only a bent seed here — the IK below
// overrides them to the planted/​swinging foot spots, so leg angles set here just
// establish a well-defined knee-bend axis.
export function poseJog(bones, rest, ph, lean) {
  const set = (name, x, y, z) => {
    const b = bones[name], r = rest[name]; if (!b || !r) return;
    _e.set(x * DEG, y * DEG, z * DEG, 'XYZ');
    b.quaternion.copy(r).multiply(_q.setFromEuler(_e));
  };
  // Bent-knee seed (both legs flexed so the IK bend axis is unambiguous).
  set('RightUpLeg', 12 * Math.sin(ph), 0, 0); set('RightLeg', -40, 0, 0);
  set('LeftUpLeg', 12 * Math.sin(ph + Math.PI), 0, 0); set('LeftLeg', -40, 0, 0);

  // Arms: drop from the T-pose to the sides (Z), swing fore/aft counter to the
  // legs (X) with a slight back bias so the carriage pumps instead of reaching.
  set('RightArm', 36 * Math.sin(ph), 0, 82); set('RightForeArm', 28, 0, 0);
  set('LeftArm', 36 * Math.sin(ph + Math.PI), 0, -82); set('LeftForeArm', 28, 0, 0);

  // Trunk: a slight forward lean into the run + a touch of counter-rotation.
  set('Spine', lean * 0.4, 6 * Math.sin(ph), 0);
  set('Spine1', lean * 0.35, 0, 0);
  set('Spine2', lean * 0.25, -4 * Math.sin(ph), 0);
  set('Neck', -lean * 0.35, 0, 0); // keep the head up / eyes forward
}

// Build the approach geometry ONCE (at calibration). Returns a plan consumed by
// driveRunup. `opts`:
//   plantLock {x,z}   — the plant-foot world spot (the LAST footfall)
//   plantSide 'Left'|'Right' — the support (plant) side
//   dir {x,z}         — unit forward (travel) direction on the ground
//   nStrides          — number of footfalls (steps) in the run-up
//   stepLen           — ground distance between consecutive footfalls (m)
//   stanceHalf        — half the lateral stance width (m)
export function buildRunupPlan(opts) {
  const { plantLock, plantSide, dir, nStrides = 3, stepLen = 0.48, stanceHalf = 0.085 } = opts;
  const d = new THREE.Vector2(dir.x, dir.z); if (d.lengthSq() < 1e-6) d.set(0, -1); d.normalize();
  const lat = new THREE.Vector2(-d.y, d.x); // right of travel
  const sideSign = (s) => (s === plantSide ? -1 : 1); // plant sits to one side; kick foot the other
  // Centreline point under the LAST footfall (plant), derived from plantLock.
  const c1x = plantLock.x - lat.x * sideSign(plantSide) * stanceHalf;
  const c1z = plantLock.z - lat.y * sideSign(plantSide) * stanceHalf;
  const totalLen = stepLen * nStrides;
  // pathCentre(u): straight line, u in [0,1], ending under the plant at u=1.
  const centre = (u) => ({ x: c1x - d.x * totalLen * (1 - u), z: c1z - d.y * totalLen * (1 - u) });
  // Footfalls k = -1 .. nStrides+1 (virtuals give the first/last swings a source),
  // alternating side so k = nStrides lands the plant side.
  const spots = { Left: [], Right: [] };
  for (let k = -1; k <= nStrides + 1; k++) {
    const side = ((nStrides - k) % 2 === 0) ? plantSide : (plantSide === 'Left' ? 'Right' : 'Left');
    const u = k / nStrides;
    const cc = centre(u);
    const x = cc.x + lat.x * sideSign(side) * stanceHalf;
    const z = cc.z + lat.y * sideSign(side) * stanceHalf;
    spots[side].push({ k, u, x, z });
  }
  spots.Left.sort((a, b) => a.u - b.u); spots.Right.sort((a, b) => a.u - b.u);
  return { spots, centre, nStrides, dir: { x: d.x, z: d.y } };
}

// Where a foot is at approach-fraction u: its fixed stance spot (grounded) or an
// arced interpolation to the next spot (swing). Returns { x, z, lift, grounded }.
function footAt(list, u, duty, arc) {
  let i = 0;
  for (let j = 0; j < list.length; j++) { if (list[j].u <= u + 1e-6) i = j; }
  const prev = list[i], next = list[Math.min(i + 1, list.length - 1)];
  if (next === prev) return { x: prev.x, z: prev.z, lift: 0, grounded: true };
  const t = (u - prev.u) / (next.u - prev.u);
  if (t < duty) return { x: prev.x, z: prev.z, lift: 0, grounded: true };
  const s = smooth((t - duty) / (1 - duty));
  return {
    x: prev.x + (next.x - prev.x) * s,
    z: prev.z + (next.z - prev.z) * s,
    lift: arc * Math.sin(Math.PI * s),
    grounded: false,
  };
}

// Drive the approach [0, P). `ctx`:
//   bones, rest, model, base {x,y,z}, baseQuat, plan, P
//   clipPose(tn)   — poses the clip exactly as it plays at tn (for the crossfade)
// Returns true if it handled the frame, false if tn is past the approach.
const ANKLE_H = 0.11;   // stance ankle height above the ground spot (toe/​sole drops below)
const SWING_ARC = 0.13; // peak swing-foot lift (m)
const DUTY = 0.52;      // fraction of each foot's cycle spent grounded (>0.5 keeps ≥1 foot down)
const HIP_LAG = 0.20;   // pelvis lags the footfall line at the start (m), eased to 0 by the plant,
                        // so each stance foot starts AHEAD of the hip and ends behind — within leg reach
export function driveRunup(tn, ctx) {
  const { bones, rest, model, base, baseQuat, plan, P, clipPose } = ctx;
  if (tn >= P) return false;
  const u = tn / P;                                   // 0..1 over the approach
  const nS = plan.nStrides;
  const ph = u * Math.PI * nS + Math.PI * 0.5;        // arm/​gait phase (one arm cycle / 2 steps)

  // Pelvis travels straight down the approach line, lagging the footfall line at
  // the start (eased to 0 by the plant) so stance feet stay within reach.
  const cc = plan.centre(u);
  const lag = HIP_LAG * (1 - u);
  model.position.set(cc.x - plan.dir.x * lag, base.y, cc.z - plan.dir.z * lag);
  if (baseQuat) model.quaternion.copy(baseQuat);
  poseJog(bones, rest, ph, 12);
  model.updateMatrixWorld(true);

  // Plant each leg: stance foot IK-locked to its fixed spot, swing foot arced.
  const fwd = plan.dir;
  let groundY = Infinity;      // lowest GROUNDED (stance) toe — the grounding reference
  let anyY = Infinity;         // lowest toe of any foot (fallback if neither is grounded)
  for (const side of ['Left', 'Right']) {
    const hipB = bones[`${side}UpLeg`], kneeB = bones[`${side}Leg`];
    const ankB = bones[`${side}Foot`], toeB = bones[`${side}ToeBase`];
    if (!hipB || !kneeB || !ankB || !toeB) continue;
    const f = footAt(plan.spots[side], u, DUTY, SWING_ARC);
    _tgt.set(f.x, base.y + ANKLE_H + f.lift, f.z);
    // Knee points forward + down: pole a bit ahead of and above the ankle target.
    hipB.getWorldPosition(_hip);
    _pole.set(f.x + fwd.x * 0.5, _hip.y + 0.05, f.z + fwd.z * 0.5);
    solveLeg({ model, hip: hipB, knee: kneeB, ankle: ankB, target: _tgt, pole: _pole, weight: 1 });
    // Foot orientation: heading down the run; sole flatter in stance, toe-down in swing.
    solveFoot({ model, foot: ankB, toe: toeB, yawDeg: 0, pitchDeg: f.grounded ? 12 : 26, weight: 1 });
    toeB.getWorldPosition(_toe);
    if (_toe.y < anyY) anyY = _toe.y;
    if (f.grounded && _toe.y < groundY) groundY = _toe.y;
  }
  // Ground by the STANCE foot (not the lowest foot): a rigid vertical shift so the
  // planted toe rests on the pitch, leaving the swing foot's lift intact. Using
  // the lowest foot (as the default grounder does) would pin the descending swing
  // foot to the ground and re-introduce skate.
  const ref = (groundY === Infinity ? anyY : groundY);
  if (ref !== Infinity) model.position.y -= (ref - GROUND_CLEAR);

  // Crossfade into the clip over the last slice of the approach so the plant and
  // pose hand off seamlessly to the strike pipeline.
  const BLEND = Math.min(0.10, P * 0.30);
  if (clipPose && tn > P - BLEND) {
    const bf = smooth((tn - (P - BLEND)) / BLEND); // 0 → 1 toward the clip
    if (bf > 0.001) {
      const synth = {}; for (const n in rest) if (bones[n]) synth[n] = bones[n].quaternion.clone();
      const synthPos = model.position.clone();
      clipPose(tn);                                   // bones + model now hold the clip pose
      for (const n in synth) bones[n].quaternion.slerp(synth[n], 1 - bf); // clip → synth by (1-bf)
      model.position.lerpVectors(synthPos, model.position, bf);
    }
  }
  return true;
}
