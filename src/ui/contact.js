import * as THREE from 'three';
import { FOOT_ZONES } from '../kick/parameters.js';

// Contact editor: a close-up mode where you click marked zones directly on the
// 3D foot and ball to set where the foot strikes the ball. Foot markers ride the
// kicking foot; ball markers sit on the player-facing hemisphere (center + two
// rings × 8 compass points). Toggled by a "Contact" button.
const BALL_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function createContactEditor({ scene, camera, controls, renderer, bones, params, ballRadius, onEnter, onChange }) {
  const group = new THREE.Group(); group.visible = false; scene.add(group);
  const ballC = new THREE.Vector3(0, ballRadius, 0); // ball center (ball sits at origin)

  const baseMat = () => new THREE.MeshBasicMaterial({ color: 0x9fb0c0, transparent: true, opacity: 0.7, depthTest: false });
  const selMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, depthTest: false });
  const markerGeom = new THREE.SphereGeometry(0.012, 12, 12);

  // ---- ball markers (center + inner/outer rings × 8) on the +Z hemisphere ----
  const ballMarkers = [];
  const dirVec = (d) => { let x = 0, y = 0; if (d.includes('N')) y = 1; if (d.includes('S')) y = -1; if (d.includes('E')) x = 1; if (d.includes('W')) x = -1; const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  const addBall = (zone, phiDeg, dx, dy) => {
    const phi = phiDeg * Math.PI / 180; const R = ballRadius * 1.02;
    const m = new THREE.Mesh(markerGeom, baseMat());
    m.position.set(ballC.x + Math.sin(phi) * dx * R, ballC.y + Math.sin(phi) * dy * R, ballC.z + Math.cos(phi) * R);
    m.userData = { kind: 'ball', zone }; group.add(m); ballMarkers.push(m);
  };
  addBall('center', 0, 0, 0);
  for (const d of BALL_DIRS) { const [dx, dy] = dirVec(d); addBall(`in-${d}`, 27, dx, dy); }
  for (const d of BALL_DIRS) { const [dx, dy] = dirVec(d); addBall(`out-${d}`, 52, dx, dy); }

  // ---- foot markers (positioned each frame from the kicking foot bones) ----
  const footMarkers = FOOT_ZONES.map((zone) => {
    const m = new THREE.Mesh(markerGeom, baseMat()); m.userData = { kind: 'foot', zone }; group.add(m); return m;
  });
  const _ank = new THREE.Vector3(), _toe = new THREE.Vector3(), _fwd = new THREE.Vector3(), _side = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  function placeFoot() {
    const K = params.footedness === 'right' ? 'Right' : 'Left';
    const foot = bones[`${K}Foot`], toe = bones[`${K}ToeBase`]; if (!foot || !toe) return;
    foot.getWorldPosition(_ank); toe.getWorldPosition(_toe);
    _fwd.copy(_toe).sub(_ank); const L = _fwd.length() || 0.15; _fwd.normalize();
    _side.crossVectors(_fwd, _up).normalize(); // lateral across the foot
    const mid = _ank.clone().addScaledVector(_fwd, L * 0.5);
    const set = (i, p) => footMarkers[i].position.copy(p);
    // FOOT_ZONES = ['laces','inside','outside-bony','toe','inside-instep']
    set(0, mid.clone().addScaledVector(_up, 0.04));                       // laces (instep top)
    set(1, mid.clone().addScaledVector(_side, -0.04));                    // inside (medial)
    set(2, mid.clone().addScaledVector(_side, 0.04));                     // outside (bony)
    set(3, _toe.clone().addScaledVector(_fwd, 0.03).addScaledVector(_up, 0.01)); // toe
    set(4, mid.clone().addScaledVector(_side, -0.025).addScaledVector(_up, 0.03)); // inside-instep
  }

  function refresh() {
    for (const m of ballMarkers) m.material = (m.userData.zone === params.ballZone) ? selMat : (m.material === selMat ? baseMat() : m.material), m.material.needsUpdate = true;
    for (const m of footMarkers) m.material = (m.userData.zone === params.footZone) ? selMat : (m.material === selMat ? baseMat() : m.material);
  }

  // ---- click handling (raycast against the markers) ----
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  function onClick(ev) {
    if (!group.visible) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects([...ballMarkers, ...footMarkers], false)[0];
    if (!hit) return;
    ev.stopPropagation();
    const { kind, zone } = hit.object.userData;
    if (kind === 'ball') params.ballZone = zone; else params.footZone = zone;
    refresh(); onChange && onChange();
  }
  renderer.domElement.addEventListener('pointerdown', onClick, true);

  let active = false;
  return {
    update() { if (group.visible) { placeFoot(); } },
    toggle() { this.setActive(!active); },
    setActive(v) {
      active = v; group.visible = v;
      if (v) {
        if (onEnter) onEnter();           // pause at contact + frame the pose
        placeFoot(); refresh();
        // close-up camera on the ball/foot
        camera.position.set(0.9, 0.5, 1.1); controls.target.set(0, 0.12, 0); controls.update();
      }
    },
    isActive() { return active; },
  };
}
