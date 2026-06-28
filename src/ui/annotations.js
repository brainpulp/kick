import * as THREE from 'three';
import { BALL_RADIUS } from '../field.js';

const DEG = Math.PI / 180;
// The ball sits at the origin; gaze/aim lines converge on its center.
const BALL_POINT = new THREE.Vector3(0, BALL_RADIUS, 0);

// In-scene 3D annotation gizmos (no floating text):
//  - a rotation disc/wedge perpendicular to a 1-DOF axis (faint full range +
//    bright current value + a needle), e.g. Hip Turn about the vertical axis;
//  - a distance line with end ticks for a displacement, e.g. Aim-Support depth.
// They follow the player each frame.
export class Annotations {
  constructor(scene, bones) {
    this.bones = bones || {};
    // Hip-turn disc: lies flat (perpendicular to the vertical hip-yaw axis).
    this.hip = new THREE.Group();
    this.hipRange = sectorMesh(0x2f6b3a, 0.22);   // full allowed range (faint)
    this.hipValue = sectorMesh(0x8ff0b6, 0.55);   // current value (bright)
    this.hipValue.position.z = 0.001;
    this.needle = new THREE.Group();
    const needle = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.006, 0.014),
      new THREE.MeshBasicMaterial({ color: 0xeafff0 }),
    );
    needle.position.x = 0.3;
    this.needle.add(needle);
    this.hip.add(this.hipRange, this.hipValue, this.needle);
    this.hip.rotation.x = -Math.PI / 2;
    scene.add(this.hip);

    // Distance line (displacement) — Aim-Support depth behind the plant.
    this.dist = makeDistanceLine(0x8fd0ff);
    scene.add(this.dist.group);

    // Follow-up direction: a faint straight-on reference and a bright line from
    // the ball showing where the follow-through sends it (the launch azimuth).
    this.followRef = axisLine(0x6f8fb0);
    this.followDir = axisLine(0xffa23f);
    scene.add(this.followRef, this.followDir);

    // Body-axis lines (toggleable) that extend from key body parts.
    this.axes = {
      hips: axisLine(0xff5d5d),
      shoulders: axisLine(0x5db4ff),
      toes: axisLine(0xffd23f),
      knee: axisLine(0xb47dff),
      gaze: axisLine(0x33e6c0),
    };
    for (const k in this.axes) scene.add(this.axes[k]);
  }

  // center: the player's world position (x,z used).
  update(params, center) {
    if (!center) return;
    this.hip.position.set(center.x, 0.03, center.z);
    setSector(this.hipRange, 0.62, 60);                 // Hip Turn range 0–60°
    setSector(this.hipValue, 0.62, Math.max(0, params.hipTurn));
    this.needle.rotation.z = -(Math.max(0, params.hipTurn) - 30) * DEG;

    const d = params.aimSupportDepth * 0.01; // cm → m
    this.dist.set(
      new THREE.Vector3(center.x + 0.25, 0.03, center.z),
      new THREE.Vector3(center.x + 0.25, 0.03, center.z + d),
    );

    // Follow-up direction from the ball's launch point (origin). Straight-on is
    // -Z; the follow-up line deflects toward the non-kicking foot by `followUp`.
    const mir = params.footedness === 'right' ? 1 : -1;
    const ballPos = new THREE.Vector3(0, 0.04, 0);
    const straight = new THREE.Vector3(0, 0, -1);
    const fdir = straight.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (params.followDir || 0) * DEG * mir);
    setLine(this.followRef, !!params.showAxes, ballPos, straight, 5, false);
    setLine(this.followDir, (params.followDir || 0) > 0.5, ballPos, fdir, 5, false);

    this.updateAxes(params);
  }

  // Infinite-axis lines from body parts. Directions are derived from bone-pair
  // vectors (robust, no per-bone axis guessing).
  updateAxes(params) {
    const B = this.bones;
    const on = !!params.showAxes;
    const wp = (n) => (B[n] ? B[n].getWorldPosition(new THREE.Vector3()) : null);
    const K = params.footedness === 'right' ? 'Right' : 'Left';
    const L = 4;

    const lateral = (a, b) => { const va = wp(a), vb = wp(b); return (va && vb) ? va.clone().sub(vb).setY(0).normalize() : null; };

    // Hips side-to-side.
    const hipC = wp('Hips'); const hipLat = lateral('LeftUpLeg', 'RightUpLeg');
    setLine(this.axes.hips, on && params.axHips && hipC && hipLat, hipC, hipLat, L, true);

    // Shoulders side-to-side.
    const shC = wp('LeftArm') && wp('RightArm') ? wp('LeftArm').add(wp('RightArm')).multiplyScalar(0.5) : wp('Spine2');
    const shLat = lateral('LeftArm', 'RightArm');
    setLine(this.axes.shoulders, on && params.axShoulders && shC && shLat, shC, shLat, L, true);

    // Toes — where the kicking foot points (horizontal forward).
    const toe = wp(`${K}ToeBase`); const foot = wp(`${K}Foot`);
    const toeDir = (toe && foot) ? toe.clone().sub(foot).setY(0).normalize() : null;
    setLine(this.axes.toes, on && params.axToes && toe && toeDir, toe, toeDir, 1.5, false);

    // Knee plumb — straight down to the pitch (shows knee position vs the ball).
    const knee = wp(`${K}Leg`);
    setLine(this.axes.knee, on && params.axKnee && knee, knee, new THREE.Vector3(0, -1, 0), knee ? knee.y : 0, false);

    // Gaze — from the skull (between the eyes) straight to the ball: the player
    // keeps eyes locked on the ball through the strike. Start a little forward of
    // the Head joint so the line departs from the face, and run it to the ball.
    const head = wp('Head'); const neck = wp('Neck');
    let eye = null, gazeDir = null, gazeLen = 0;
    if (head) {
      const fwd = (neck ? head.clone().sub(neck).normalize() : new THREE.Vector3(0, 1, 0));
      // bias the start toward the ball so it reads as leaving the eyes
      const toBall = BALL_POINT.clone().sub(head);
      eye = head.clone().addScaledVector(toBall.clone().normalize(), 0.08);
      gazeDir = BALL_POINT.clone().sub(eye);
      gazeLen = gazeDir.length();
      gazeDir.normalize();
      void fwd;
    }
    setLine(this.axes.gaze, on && params.axGaze && eye && gazeDir, eye, gazeDir, gazeLen, false);
  }
}

// A 2-point line we restretch each frame.
function axisLine(color) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color }));
  line.visible = false;
  return line;
}
// origin + dir; `both` extends both ways, else from origin along dir by len.
function setLine(line, visible, origin, dir, len, both) {
  line.visible = !!visible;
  if (!visible || !origin || !dir) return;
  const a = both ? origin.clone().addScaledVector(dir, -len) : origin.clone();
  const b = origin.clone().addScaledVector(dir, len);
  const pos = line.geometry.attributes.position;
  pos.setXYZ(0, a.x, a.y, a.z); pos.setXYZ(1, b.x, b.y, b.z); pos.needsUpdate = true;
}

// A flat circular sector (wedge) centered on +Y (straight ahead), spanning `deg`.
function sectorMesh(color, opacity) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(0.6, 48, Math.PI / 2 - 0.3, 0.6),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }),
  );
  return m;
}
function setSector(mesh, radius, deg) {
  const span = Math.max(0.001, deg) * DEG;
  mesh.geometry.dispose();
  mesh.geometry = new THREE.CircleGeometry(radius, 48, Math.PI / 2 - span / 2, span);
}

// A ground distance line (thin bar) with two end ticks.
function makeDistanceLine(color) {
  const mat = new THREE.MeshBasicMaterial({ color });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.008, 0.02), mat);
  const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.12), mat);
  const t2 = t1.clone();
  const group = new THREE.Group();
  group.add(bar, t1, t2);
  return {
    group,
    set(a, b) {
      const len = Math.max(0.001, a.distanceTo(b));
      bar.scale.x = len;
      bar.position.copy(a).add(b).multiplyScalar(0.5);
      bar.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      t1.position.copy(a); t2.position.copy(b);
      const hide = len < 0.02;
      group.visible = !hide;
    },
  };
}
