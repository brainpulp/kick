import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// Bone names we drive (see MOTION.md rig mapping). Stored without the `rig:`
// prefix here; we resolve against the actual prefixed names at load.
export const BONES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
];

const TARGET_HEIGHT = 1.8; // metres — scale the (tiny-exported) model to human size

export async function loadCharacter(scene, manifestUrl = 'assets/manifest.json') {
  const manifest = await (await fetch(manifestUrl)).json();
  const url = manifest.character.replace(/^\//, ''); // make relative for base:'./'

  const draco = new DRACOLoader();
  // Bundled decoder (copied into public/draco/ at setup). Falls back gracefully
  // if absent; the asset uses Draco so this must resolve.
  draco.setDecoderPath('draco/');

  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);

  const gltf = await loader.loadAsync(url);
  const model = gltf.scene;

  // Collect bones and their rest (bind) local rotations.
  const bones = {};
  const rest = {};
  model.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; }
    if (o.isBone || o.type === 'Bone') {
      const short = o.name.replace(/^rig:/, '');
      if (BONES.includes(short)) {
        bones[short] = o;
        rest[short] = o.quaternion.clone();
      }
    }
  });

  // Normalize scale + ground the feet, using the world-space bounding box.
  model.updateWorldMatrix(true, true);
  let box = new THREE.Box3().setFromObject(model);
  const height = box.max.y - box.min.y || 1;
  const s = TARGET_HEIGHT / height;
  model.scale.setScalar(s);
  model.updateWorldMatrix(true, true);
  box = new THREE.Box3().setFromObject(model);
  model.position.y -= box.min.y; // feet on the pitch

  scene.add(model);
  return { model, bones, rest, draco };
}
