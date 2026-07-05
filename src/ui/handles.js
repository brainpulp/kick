import * as THREE from 'three';

// Phase 3b: in-scene drag-handles for the spatial checkpoint targets. Grab a
// handle in the viewport and the underlying constraint value updates live (and
// the leg IK re-solves to it). Only the handles relevant to the current
// checkpoint are shown, so the scene stays clean. Angular constraints (yaw,
// ankle, hip, trunk) stay in the numeric table — dragging a plane is the right
// affordance only for positions.
//
// - PLANT handle: a puck on the pitch. Drag in X/Z → supportLateral / aimSupportDepth.
// - KNEE handle: a bead at the kicking knee. Drag in Z (fore/aft) → kneeAim.
export function createHandles({ scene, camera, renderer, controls, params, meta, onEdit, getScrub, getContactT, isActive }) {
  const clamp = (v, m) => Math.max(m.min, Math.min(m.max, v));
  const mir = () => (params.footedness === 'right' ? 1 : -1);

  const ring = (color, r) => {
    const g = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 28),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthTest: false, side: THREE.DoubleSide }));
    disc.rotation.x = -Math.PI / 2; disc.renderOrder = 998;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.09, 8, 28),
      new THREE.MeshBasicMaterial({ color, depthTest: false }));
    rim.rotation.x = -Math.PI / 2; rim.renderOrder = 999;
    g.add(disc, rim); return g;
  };
  const bead = (color, r) => new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12),
    new THREE.MeshBasicMaterial({ color, depthTest: false }));

  const plant = ring(0x38e0a0, 0.07); plant.renderOrder = 999;
  const knee = bead(0xffd23f, 0.035); knee.renderOrder = 999;
  const kneeLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.6, depthTest: false }));
  kneeLine.renderOrder = 998;
  const group = new THREE.Group(); group.add(plant, knee, kneeLine); scene.add(group);

  const HANDLES = {
    plant: { obj: plant, cp: 'plant', planeN: new THREE.Vector3(0, 1, 0), planeY: 0.03 },
    knee: { obj: knee, cp: 'contact', planeN: null }, // vertical plane through the knee, set at grab
  };

  const ray = new THREE.Raycaster(); ray.params.Line = { threshold: 0.05 };
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane();
  const hit = new THREE.Vector3();
  let drag = null; // { key }

  const kneeWorld = new THREE.Vector3();
  function setNdc(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
  }

  function onDown(ev) {
    if (!group.visible) return;
    setNdc(ev);
    const targets = [];
    if (plant.visible) { targets.push(plant.children[0], plant.children[1]); } // disc + rim
    if (knee.visible) targets.push(knee);
    const h = ray.intersectObjects(targets, false)[0];
    if (!h) return;
    ev.stopPropagation();
    const key = (h.object === knee) ? 'knee' : 'plant';
    drag = { key };
    controls.enabled = false;
    if (key === 'knee') { knee.getWorldPosition(kneeWorld); }
  }
  function onMove(ev) {
    if (!drag) return;
    setNdc(ev);
    if (drag.key === 'plant') {
      plane.setFromNormalAndCoplanarPoint(HANDLES.plant.planeN, new THREE.Vector3(0, HANDLES.plant.planeY, 0));
      if (!ray.ray.intersectPlane(plane, hit)) return;
      onEdit('aimSupportDepth', Math.round(clamp(hit.z * 100, meta.aimSupportDepth)));
      onEdit('supportLateral', Math.round(clamp(-mir() * hit.x * 100, meta.supportLateral)));
    } else {
      // vertical plane facing the camera-ish, through the knee's X — read Z (fore/aft).
      plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(1, 0, 0), kneeWorld);
      if (!ray.ray.intersectPlane(plane, hit)) return;
      onEdit('kneeAim', Math.round(clamp(-hit.z * 100, meta.kneeAim)));
    }
  }
  function onUp() { if (drag) { drag = null; controls.enabled = true; } }
  renderer.domElement.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);

  function update(bones) {
    const s = getScrub(), c = getContactT();
    const show = isActive();
    group.visible = show;
    if (!show) return;
    const near = (cp) => Math.abs(s - (cp === 'plant' ? 0.80 * c : c)) < 0.06;
    // PLANT puck at the exact target spot on the pitch.
    plant.visible = near('plant');
    if (plant.visible) {
      plant.position.set(-mir() * (params.supportLateral || 0) / 100, HANDLES.plant.planeY, (params.aimSupportDepth || 0) / 100);
    }
    // KNEE bead at the kicking knee; a plumb line drops to its ground shadow.
    knee.visible = near('contact');
    if (knee.visible && bones) {
      const K = params.footedness === 'right' ? 'Right' : 'Left';
      const kb = bones[`${K}Leg`];
      if (kb) {
        kb.getWorldPosition(kneeWorld); knee.position.copy(kneeWorld);
        const p = kneeLine.geometry.attributes.position;
        p.setXYZ(0, kneeWorld.x, kneeWorld.y, kneeWorld.z);
        p.setXYZ(1, kneeWorld.x, 0.01, kneeWorld.z); p.needsUpdate = true;
      }
    }
    kneeLine.visible = knee.visible;
  }

  return { update, setVisible(v) { group.visible = v; } };
}
