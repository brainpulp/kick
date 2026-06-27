import * as THREE from 'three';

const DEG = Math.PI / 180;

// In-scene 3D annotation gizmos (no floating text):
//  - a rotation disc/wedge perpendicular to a 1-DOF axis (faint full range +
//    bright current value + a needle), e.g. Hip Turn about the vertical axis;
//  - a distance line with end ticks for a displacement, e.g. Aim-Support depth.
// They follow the player each frame.
export class Annotations {
  constructor(scene) {
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
  }
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
