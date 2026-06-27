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
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  app.appendChild(renderer.domElement);

  // CSS2D overlay renderer for annotation labels.
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.style.position = 'fixed';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.left = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  app.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  // Sky: vertical gradient (blue up high, pale at the horizon) instead of a
  // flat dark background, so the player reads as outdoors rather than in a cave.
  scene.background = makeSkyTexture();
  scene.fog = new THREE.Fog(0xd6e7f2, 26, 75);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  camera.position.set(3.2, 1.9, 4.4);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0.9, 0);
  controls.minDistance = 1.5;
  controls.maxDistance = 18;
  controls.maxPolarAngle = Math.PI * 0.495; // don't go under the pitch

  // Lighting: bright outdoor sky/ground hemisphere + a key sun with shadows.
  scene.add(new THREE.HemisphereLight(0xbfe0ff, 0x6f8a63, 1.5));
  const sun = new THREE.DirectionalLight(0xfff6e8, 3.0);
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
    new THREE.MeshStandardMaterial({ color: 0x4a9d57, roughness: 1 })
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

// Vertical sky gradient as a background texture (blue → pale horizon).
function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0, '#6ea8db');   // high sky
  g.addColorStop(0.55, '#a9cfea');
  g.addColorStop(1.0, '#e6f0f6');   // horizon haze
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
