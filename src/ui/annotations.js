import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { BALL_RADIUS } from '../field.js';

const DEG = Math.PI / 180;
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const _smoothA = (u) => { const x = Math.min(1, Math.max(0, u)); return x * x * (3 - 2 * x); };
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
      toes: this.fatLine(0xffd23f),       // kicking foot pointing
      plant: this.fatLine(0x5bd75b),      // planted foot pointing (indicates ball direction)
      knee: this.fatLine(0xb47dff),
      shPlumb: this.fatLine(0x5db4ff),    // vertical drop from the shoulders to the pitch
      hipPlumb: this.fatLine(0xff5d5d),   // vertical drop from the pelvis to the pitch
      gazeL: this.fatLine(0x33e6c0),      // one line per eye, converging on the ball
      gazeR: this.fatLine(0x33e6c0),
    };
    for (const k in this.axes) scene.add(this.axes[k]);

    // Knee hinge overlay: a ring lying in the knee's flexing plane + an axis
    // piercing the knee along the hinge (perpendicular to the knee plumb).
    this.kneeRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.13, 0.007, 10, 44),
      new THREE.MeshBasicMaterial({ color: 0xff5db4, depthTest: true }),
    );
    this.kneeRing.visible = false; scene.add(this.kneeRing);
    this.kneeHingeAxis = this.fatLine(0xff5db4); scene.add(this.kneeHingeAxis);

    // Femur (thigh) motion disc — SAGITTAL only (front/back swing), to read the
    // cock-back / spring-forward. Ring in the sagittal plane at the hip + an axis
    // along the medial-lateral hinge (like the knee, but 1-DOF by construction).
    this.femurRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.007, 10, 48),
      new THREE.MeshBasicMaterial({ color: 0x2fd8d8, depthTest: true }),
    );
    this.femurRing.visible = false; scene.add(this.femurRing);
    this.femurAxis = this.fatLine(0x2fd8d8); scene.add(this.femurAxis);

    // Plant-KNEE hinge disc (the other leg), same as the kicking knee's.
    this.plantKneeRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.13, 0.007, 10, 44),
      new THREE.MeshBasicMaterial({ color: 0xff9838, depthTest: true }),
    );
    this.plantKneeRing.visible = false; scene.add(this.plantKneeRing);
    this.plantKneeAxis = this.fatLine(0xff9838); scene.add(this.plantKneeAxis);

    // Graphical ground rulers with NOTCHES (every 10 cm, taller at 50 cm) drawn on
    // the pitch, plus a cm label. knee/shoulder/hip plumb → ball, and the plant
    // foot's fore/aft (Z) and left/right (X) offsets from the ball.
    this.kneeRuler = this.makeRuler(0xb47dff, scene);
    this.shRuler = this.makeRuler(0x5db4ff, scene);
    this.hipRuler = this.makeRuler(0xff5d5d, scene);
    this.plantFA = this.makeRuler(0x5bd75b, scene);   // fore/aft (toes vs front of ball)
    this.plantLR = this.makeRuler(0x5bd75b, scene);   // left/right (inner foot vs side of ball)
  }

  // A notched ground ruler: fat LineSegments2 (baseline + tick marks) + cm label.
  makeRuler(color, scene) {
    const geo = new LineSegmentsGeometry(); geo.setPositions([0, 0, 0, 0, 0, 0]);
    const mat = new LineMaterial({ linewidth: 2, color, transparent: true }); mat.worldUnits = false;
    this._fatMats.push(mat);
    const seg = new LineSegments2(geo, mat); seg.visible = false; seg.frustumCulled = false; scene.add(seg);
    const el = document.createElement('div');
    el.style.cssText = 'color:#eaffff;background:rgba(12,16,14,.72);border:1px solid rgba(255,255,255,.25);'
      + 'border-radius:4px;padding:1px 5px;font:11px system-ui,sans-serif;white-space:nowrap;pointer-events:none';
    const label = new CSS2DObject(el); label.visible = false; scene.add(label);
    return { seg, label, el };
  }
  // a → b on the pitch; baseline + notch marks every BALL RADIUS (11 cm), taller
  // every ball diameter (2 radii). Label reads in ball-radii (the coaching unit —
  // e.g. "half a ball") plus cm.
  updateRuler(r, a, b) {
    const vis = !!(a && b);
    r.seg.visible = vis; r.label.visible = vis;
    if (!vis) return;
    const A = new THREE.Vector3(a.x, 0.013, a.z), B = new THREE.Vector3(b.x, 0.013, b.z);
    const dir = B.clone().sub(A); const len = dir.length();
    if (len < 1e-3) { r.seg.visible = false; r.label.visible = false; return; }
    dir.normalize();
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    const pts = [A.x, A.y, A.z, B.x, B.y, B.z];
    let i = 0;
    for (let d = BALL_RADIUS; d <= len + 1e-6; d += BALL_RADIUS) {
      i += 1;
      const p = A.clone().addScaledVector(dir, Math.min(d, len));
      const h = (i % 2 === 0) ? 0.05 : 0.028; // taller every ball diameter
      pts.push(p.x - perp.x * h, 0.013, p.z - perp.z * h, p.x + perp.x * h, 0.013, p.z + perp.z * h);
    }
    r.seg.geometry.setPositions(pts);
    const mid = A.clone().add(B).multiplyScalar(0.5); mid.y = 0.06;
    r.label.position.copy(mid);
    r.el.textContent = `${(len / BALL_RADIUS).toFixed(1)} r · ${Math.round(len * 100)} cm`;
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

    // Toes — where the kicking foot points, aligned to the SOLE (3D ankle→toe,
    // so it follows the foot's plantarflexion, not a flattened horizontal).
    const toe = wp(`${K}ToeBase`); const foot = wp(`${K}Foot`);
    const soleDir = (toe && foot) ? toe.clone().sub(foot).normalize() : null;
    const toeDir = soleDir ? soleDir.clone().setY(0).normalize() : null; // horizontal, for the knee-plumb offset
    setLine(this.axes.toes, on && params.axToes && toe && soleDir, toe, soleDir, 1.5, false);

    // Planted foot — its pointing direction (horizontal), a strong indicator of
    // where the ball will go. Drawn flat along the pitch from the plant toe.
    const S = K === 'Right' ? 'Left' : 'Right';
    const pToe = wp(`${S}ToeBase`); const pFoot = wp(`${S}Foot`);
    const pDir = (pToe && pFoot) ? pToe.clone().sub(pFoot).setY(0).normalize() : null;
    const pOrigin = pToe ? pToe.clone().setY(0.02) : null; // ride the floor
    setLine(this.axes.plant, on && params.axPlant && pOrigin && pDir, pOrigin, pDir, 3, false);

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

    // Knee hinge — a ring in the knee's FLEXING plane and an axis piercing the
    // knee along the hinge. The hinge is perpendicular to both leg segments
    // (= normal of the flex plane); when the leg is straight it degenerates, so
    // fall back to the leg's lateral axis.
    const kneeHip = wp(`${K}UpLeg`); const kneeAnk = wp(`${K}Foot`);
    const showHinge = on && params.axKneeHinge && knee && kneeHip && kneeAnk;
    this.kneeRing.visible = !!showHinge;
    if (showHinge) {
      const thigh = knee.clone().sub(kneeHip);
      const shin = kneeAnk.clone().sub(knee);
      let hinge = new THREE.Vector3().crossVectors(thigh, shin);
      if (hinge.lengthSq() < 1e-6) hinge = (lateral(`${K}UpLeg`, `${K}Leg`) || new THREE.Vector3(1, 0, 0));
      hinge.normalize();
      this.kneeRing.position.copy(knee);
      this.kneeRing.quaternion.setFromUnitVectors(Z_AXIS, hinge); // torus axis (+Z) → hinge
      setLine(this.kneeHingeAxis, true, knee, hinge, 0.20, true);  // pierce both ways
    } else {
      setLine(this.kneeHingeAxis, false);
    }

    // Shoulder plumb — vertical drop from the shoulder centre to the pitch, to
    // check the shoulders are over the ball at contact (and read the hip-hinge).
    setLine(this.axes.shPlumb, on && params.axShoulderPlumb && shC, shC, new THREE.Vector3(0, -1, 0), shC ? shC.y : 0, false);

    // Femur disc — SAGITTAL (front/back) motion of the kicking thigh, for the
    // cock-back / spring-forward. Ring in the sagittal plane at the hip; axis
    // along the medial-lateral hinge (horizontal, ⟂ the forward swing).
    const showFemur = on && params.axFemurHinge && kneeHip && knee;
    this.femurRing.visible = !!showFemur;
    if (showFemur) {
      const lat = lateral('LeftUpLeg', 'RightUpLeg') || new THREE.Vector3(1, 0, 0);
      this.femurRing.position.copy(kneeHip);
      this.femurRing.quaternion.setFromUnitVectors(Z_AXIS, lat); // ring normal = lateral → sagittal plane
      setLine(this.femurAxis, true, kneeHip, lat, 0.22, true);
    } else setLine(this.femurAxis, false);

    // Plant-knee hinge disc (other leg) + plant-knee plumb is the plant leg's flex.
    const pKnee = wp(`${S}Leg`); const pHip = wp(`${S}UpLeg`); const pAnk2 = wp(`${S}Foot`);
    const showPK = on && params.axKneeHinge && pKnee && pHip && pAnk2;
    this.plantKneeRing.visible = !!showPK;
    if (showPK) {
      const th = pKnee.clone().sub(pHip); const sh = pAnk2.clone().sub(pKnee);
      let hg = new THREE.Vector3().crossVectors(th, sh);
      if (hg.lengthSq() < 1e-6) hg = (lateral(`${S}UpLeg`, `${S}Leg`) || new THREE.Vector3(1, 0, 0));
      hg.normalize();
      this.plantKneeRing.position.copy(pKnee);
      this.plantKneeRing.quaternion.setFromUnitVectors(Z_AXIS, hg);
      setLine(this.plantKneeAxis, true, pKnee, hg, 0.20, true);
    } else setLine(this.plantKneeAxis, false);

    // Hip plumb — vertical drop from the pelvis to the pitch (read where the CoG
    // is vs the ball; it should come forward toward the ball at contact).
    const hipCp = wp('Hips');
    setLine(this.axes.hipPlumb, on && params.axHipPlumb && hipCp, hipCp, new THREE.Vector3(0, -1, 0), hipCp ? hipCp.y : 0, false);

    // Notched ground rulers from the BALL CENTRE (origin). knee/shoulder/hip plumb
    // → ball (straight), and the plant foot split into fore/aft (Z) + left/right (X).
    const rulersOn = on && params.axRulers;
    const O = new THREE.Vector3(0, 0, 0);
    this.updateRuler(this.kneeRuler, rulersOn && kneeO ? O : null, kneeO ? new THREE.Vector3(kneeO.x, 0, kneeO.z) : null);
    this.updateRuler(this.shRuler, rulersOn && shC ? O : null, shC ? new THREE.Vector3(shC.x, 0, shC.z) : null);
    this.updateRuler(this.hipRuler, rulersOn && hipCp ? O : null, hipCp ? new THREE.Vector3(hipCp.x, 0, hipCp.z) : null);
    // Plant foot: fore/aft along Z (at the toe's x) and left/right along X (at the toe's z).
    if (rulersOn && pToe) {
      this.updateRuler(this.plantFA, new THREE.Vector3(pToe.x, 0, 0), new THREE.Vector3(pToe.x, 0, pToe.z));
      this.updateRuler(this.plantLR, new THREE.Vector3(0, 0, pToe.z), new THREE.Vector3(pToe.x, 0, pToe.z));
    } else { this.updateRuler(this.plantFA, null, null); this.updateRuler(this.plantLR, null, null); }

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
      // The Head joint sits at jaw/ear level; eyes are up toward the brow and
      // forward onto the face.
      const mid = head.clone().addScaledVector(up, 0.09).addScaledVector(fwd, 0.075);
      eyeL = mid.clone().addScaledVector(lat, 0.032);
      eyeR = mid.clone().addScaledVector(lat, -0.032);
      // Before contact: each eye line runs to the ball (they converge on it).
      // After: RELEASE smoothly toward where the head faces (a touch up), following
      // the head — never a hard jump to a fixed vertical vector (which shot to the
      // sky). Blend over a short window so there's no snap.
      const c = this._contactT;
      const rf = (c != null) ? _smoothA(((params.scrub || 0) - (c + 0.01)) / 0.10) : 0;
      const relDir = fwd.clone(); relDir.y = 0.05; relDir.normalize(); // head facing, nearly level (not skyward)
      const dist = BALL_POINT.distanceTo(eyeL);
      dL = BALL_POINT.clone().sub(eyeL).normalize().lerp(relDir, rf).normalize();
      dR = BALL_POINT.clone().sub(eyeR).normalize().lerp(relDir, rf).normalize();
      lL = lR = dist * (1 - rf) + 1.1 * rf;
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
