import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

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
  scene.fog = new THREE.Fog(0xd6e7f2, 30, 80);

  // Image-based lighting: a neutral studio environment so PBR materials are lit
  // from all directions (fills the shaded front, hides Draco normal blotches).
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  camera.position.set(3.2, 1.9, 4.4);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0.9, 0);
  controls.minDistance = 1.5;
  controls.maxDistance = 18;
  controls.maxPolarAngle = Math.PI * 0.495; // don't go under the pitch

  // Lighting: IBL (above) + sky/ground hemisphere + a key sun and a soft front
  // fill so the player's front isn't in shadow.
  scene.add(new THREE.HemisphereLight(0xbfe0ff, 0x6f8a63, 0.9));
  const fill = new THREE.DirectionalLight(0xe6f0ff, 1.1);
  fill.position.set(-4, 4, -7); // from the goal side, onto his front
  scene.add(fill);
  const sun = new THREE.DirectionalLight(0xfff6e8, 2.3);
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

  // Pitch with mown-stripe turf texture.
  const turf = makeTurfTexture();
  turf.wrapS = turf.wrapT = THREE.RepeatWrapping;
  turf.repeat.set(10, 10);
  turf.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ map: turf, roughness: 0.95 })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  scene.add(grass);

  // Keep the subtle grid for scale reference.
  const grid = new THREE.GridHelper(60, 60, 0x4f9a5d, 0x3f7d4a);
  grid.position.y = 0.002;
  grid.material.opacity = 0.12;
  grid.material.transparent = true;
  scene.add(grid);

  // Soccer pitch line markings (white), anchored to the goal/strike area.
  scene.add(makePitchLines());

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

// Mown-stripe turf as a tiling canvas texture.
function makeTurfTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const x = c.getContext('2d');
  for (let i = 0; i < 8; i++) {
    x.fillStyle = i % 2 ? '#3f8f4d' : '#47a258';
    x.fillRect(i * 32, 0, 32, 256);
  }
  for (let i = 0; i < 2200; i++) { // subtle speckle
    x.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
    x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Soccer pitch markings (white) anchored to the goal at z = -16 and a centre
// circle around the strike area at the origin.
function makePitchLines() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false });
  const Y = 0.012;
  const bar = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, Y, z); g.add(m); };
  const ring = (r, x, z) => { const m = new THREE.Mesh(new THREE.RingGeometry(r - 0.07, r + 0.07, 72), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, Y, z); g.add(m); };
  const spot = (x, z) => { const m = new THREE.Mesh(new THREE.CircleGeometry(0.12, 20), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, Y, z); g.add(m); };
  const W = 0.12;
  // Halfway line + centre circle (player strikes near here).
  bar(40, W, 0, 0); ring(3, 0, 0); spot(0, 0);
  // Penalty area (≈16×5.5 m) and goal area (≈9×2 m) in front of the goal (z=-16).
  bar(16, W, 0, -10.5); bar(W, 5.5, -8, -13.25); bar(W, 5.5, 8, -13.25);
  bar(9, W, 0, -14); bar(W, 2, -4.5, -15); bar(W, 2, 4.5, -15);
  spot(0, -12);
  return g;
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
