import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

// First-pass 3D annotation layer (the third "graphical meat" pillar): pinned
// HTML labels plus an in-scene arc visualizing the Hip Turn range. Demonstrates
// the pattern; more callouts get added as the parameter UI matures.
export class Annotations {
  constructor(scene, ball) {
    this.scene = scene;

    // Floating label over the ball: current phase + launch readout.
    this.ballLabel = makeLabel();
    const ballAnchor = new THREE.Object3D();
    ballAnchor.position.copy(ball.position).add(new THREE.Vector3(0, 0.5, 0));
    ballAnchor.add(this.ballLabel);
    scene.add(ballAnchor);

    // Hip Turn arc on the ground around the player, showing the allowed range.
    this.hipArc = makeArc(0x8ff0b6);
    this.hipArc.position.set(0, 0.02, 0.25);
    scene.add(this.hipArc);
    this.hipLabel = makeLabel();
    const hipAnchor = new THREE.Object3D();
    hipAnchor.position.set(0.9, 0.05, 0.25);
    hipAnchor.add(this.hipLabel);
    scene.add(hipAnchor);
  }

  update(phase, launch, params) {
    this.ballLabel.element.innerHTML =
      `${phase} &nbsp;·&nbsp; <span class="val">${launch.speed.toFixed(0)} m/s</span> @ ` +
      `<span class="val">${launch.elevation.toFixed(0)}°</span>`;
    this.hipLabel.element.innerHTML =
      `Hip Turn: <span class="val">${params.hipTurn.toFixed(0)}°</span> (0–60)`;

    // Redraw the arc to span the current hip-turn angle.
    setArcAngle(this.hipArc, params.hipTurn);
  }
}

function makeLabel() {
  const el = document.createElement('div');
  el.className = 'annotation';
  return new CSS2DObject(el);
}

const ARC_RADIUS = 0.8;
function makeArc(color) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color }));
  line.rotation.x = -Math.PI / 2;
  setArcAngle(line, 38);
  return line;
}

function setArcAngle(line, degrees) {
  const n = 64;
  const pos = line.geometry.attributes.position;
  const span = degrees * Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const a = -span / 2 + span * (i / (n - 1));
    pos.setXYZ(i, Math.sin(a) * ARC_RADIUS, Math.cos(a) * ARC_RADIUS, 0);
  }
  pos.needsUpdate = true;
}
