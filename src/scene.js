import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

// Build renderer, scene, camera, controls, lights, ground and the CSS2D overlay
// used for pinned HTML annotation labels.
export function createScene() {
  const app = document.getElementById('app');

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  app.appendChild(renderer.domElement);

  // CSS2D overlay renderer for annotation labels.
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.style.position = 'fixed';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.left = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  app.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1b12);
  scene.fog = new THREE.Fog(0x0d1b12, 14, 40);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  camera.position.set(3.2, 1.9, 4.4);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0.9, 0);
  controls.minDistance = 1.5;
  controls.maxDistance = 18;
  controls.maxPolarAngle = Math.PI * 0.495; // don't go under the pitch

  // Lighting: soft sky/ground hemisphere + a key sun with shadows.
  scene.add(new THREE.HemisphereLight(0xcfe8d6, 0x2a3b2f, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 2.1);
  sun.position.set(4, 8, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 30;
  sun.shadow.camera.left = -8;
  sun.shadow.camera.right = 8;
  sun.shadow.camera.top = 8;
  sun.shadow.camera.bottom = -8;
  sun.shadow.bias = -0.0002;
  scene.add(sun);

  // Pitch.
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: 0x2f6b3a, roughness: 1 })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  scene.add(grass);

  // Subtle yard lines for scale reference.
  const grid = new THREE.GridHelper(60, 60, 0x3c7a47, 0x356d40);
  grid.position.y = 0.001;
  grid.material.opacity = 0.25;
  grid.material.transparent = true;
  scene.add(grid);

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  return { renderer, labelRenderer, scene, camera, controls };
}
