import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
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
    this._fatMats = []; // LineMaterials whose pixel resolution we refresh each frame
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
    this.followRef = this.fatLine(0x6f8fb0);
    this.followDir = this.fatLine(0xffa23f);
    scene.add(this.followRef, this.followDir);

    // Body-axis lines (toggleable) that extend from key body parts.
    this.axes = {
      hips: this.fatLine(0xff5d5d),
      shoulders: this.fatLine(0x5db4ff),
      trunk: this.fatLine(0xf2f2f2),      // hips → scapula (trunk lean) — neutral white
      toes: this.fatLine(0xffd23f),
      knee: this.fatLine(0xb47dff),
      gazeL: this.fatLine(0x33e6c0),      // one line per eye, converging on the ball
      gazeR: this.fatLine(0x33e6c0),
    };
    for (const k in this.axes) scene.add(this.axes[k]);
  }

  // A fat (2px) polyline whose per-vertex colour fades toward its far end(s), so
  // the axis reads brightest at the body and dims into the distance. Kept in
  // `_fatMats` so update() can refresh the pixel resolution each frame.
  fatLine(color) {
    const geo = new LineGeometry();
    geo.setPositions([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    geo.setColors([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const mat = new LineMaterial({ linewidth: 2, vertexColors: true, transparent: true, depthTest: true });
    mat.worldUnits = false;
    const line = new Line2(geo, mat);
    line.visible = false; line._baseColor = new THREE.Color(color); line._n = 0;
    this._fatMats.push(mat);
    return line;
  }

  // center: the player's world position (x,z used). contactT: normalized clip
  // time of ball contact, so the gaze can RELEASE after the strike.
  update(params, center, contactT) {
    this._contactT = (typeof contactT === 'number') ? contactT : null;
    const w = (typeof window !== 'undefined') ? window.innerWidth : 1920;
    const h = (typeof window !== 'undefined') ? window.innerHeight : 1080;
    for (const m of this._fatMats) m.resolution.set(w, h);
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

    // Trunk — a straight line from the hips up to the centre of the scapulae
    // (upper back). The torso can curve, but this shows overall trunk lean.
    const hipsB = wp('Hips'); const scap = wp('Spine2') || wp('Spine1');
    if (hipsB && scap) {
      const tdir = scap.clone().sub(hipsB); const tlen = tdir.length() * 1.15; tdir.normalize();
      setLine(this.axes.trunk, on && params.axTrunk, hipsB, tdir, tlen, false);
    } else setLine(this.axes.trunk, false);

    // Toes — where the kicking foot points (horizontal forward).
    const toe = wp(`${K}ToeBase`); const foot = wp(`${K}Foot`);
    const toeDir = (toe && foot) ? toe.clone().sub(foot).setY(0).normalize() : null;
    setLine(this.axes.toes, on && params.axToes && toe && toeDir, toe, toeDir, 1.5, false);

    // Knee plumb — straight down to the pitch from the FRONT of the knee (the
    // joint sits behind the kneecap; shift forward so the plumb reads "knee over
    // ball" correctly). Forward = where the foot points.
    const knee = wp(`${K}Leg`);
    let kneeO = knee;
    if (knee) {
      const f = toeDir ? toeDir.clone() : new THREE.Vector3(0, 0, -1);
      kneeO = knee.clone().addScaledVector(f, 0.07);
    }
    setLine(this.axes.knee, on && params.axKnee && kneeO, kneeO, new THREE.Vector3(0, -1, 0), kneeO ? kneeO.y : 0, false);

    // Gaze — ONE line per eye, from the eye toward the ball so the two lines
    // converge on it (the coaching cue: eyes on the ball at the strike). AFTER
    // contact the gaze RELEASES — the head comes up and the eyes track the flight
    // (up & toward the goal), no longer pinned to the ball. That release is itself
    // an important teaching point.
    const head = wp('Head'); const neck = wp('Neck');
    const released = this._contactT != null && (params.scrub || 0) > this._contactT + 0.02;
    let eyeL = null, eyeR = null, dL = null, dR = null, lL = 0, lR = 0;
    if (head) {
      const up = neck ? head.clone().sub(neck).normalize() : new THREE.Vector3(0, 1, 0);
      let lat = lateral('LeftArm', 'RightArm') || new THREE.Vector3(1, 0, 0);
      let fwd = new THREE.Vector3().crossVectors(lat, up); fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1); fwd.normalize();
      if (fwd.z > 0) fwd.negate();                       // face toward the goal (−Z)
      const mid = head.clone().addScaledVector(up, -0.06).addScaledVector(fwd, 0.09); // down to eyes, onto the face
      eyeL = mid.clone().addScaledVector(lat, 0.032);
      eyeR = mid.clone().addScaledVector(lat, -0.032);
      if (released) {
        const rel = new THREE.Vector3(0, 0.30, -1).normalize(); // up & down-field, following the ball
        dL = rel.clone(); dR = rel.clone(); lL = lR = 1.6;
      } else {
        dL = BALL_POINT.clone().sub(eyeL); lL = dL.length(); dL.normalize();
        dR = BALL_POINT.clone().sub(eyeR); lR = dR.length(); dR.normalize();
      }
    }
    setLine(this.axes.gazeL, on && params.axGaze && eyeL, eyeL, dL, lL, false);
    setLine(this.axes.gazeR, on && params.axGaze && eyeR, eyeR, dR, lR, false);
  }
}

// Restretch a fat line each frame. `both` extends both ways from `origin`
// (bright centre, dim ends); otherwise it runs from origin (bright) out to `len`
// (dim). The far-end dim factor gives the "fading into the distance" gradient.
const DIM = 0.16;
function setLine(line, visible, origin, dir, len, both) {
  line.visible = !!visible;
  if (!visible || !origin || !dir) return;
  const c = line._baseColor;
  const bright = [c.r, c.g, c.b];
  const dim = [c.r * DIM, c.g * DIM, c.b * DIM];
  let pos, col;
  if (both) {
    const a = origin.clone().addScaledVector(dir, -len);
    const b = origin.clone().addScaledVector(dir, len);
    pos = [a.x, a.y, a.z, origin.x, origin.y, origin.z, b.x, b.y, b.z];
    col = [...dim, ...bright, ...dim];
  } else {
    const b = origin.clone().addScaledVector(dir, len);
    pos = [origin.x, origin.y, origin.z, b.x, b.y, b.z];
    col = [...bright, ...dim];
  }
  line.geometry.setPositions(pos);
  line.geometry.setColors(col);
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
