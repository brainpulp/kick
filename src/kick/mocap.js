import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const DEG = Math.PI / 180;

// Strip any "namespace:" prefix and whitespace from a node/track name.
// e.g. "mixamorig:RightLeg" / "rig:RightLeg" -> "RightLeg".
export function shortBone(name) {
  let s = String(name).split('.')[0];
  if (s.includes(':')) s = s.slice(s.lastIndexOf(':') + 1);
  return s.replace(/\s/g, '');
}

// Retarget a loaded AnimationClip onto our character by renaming each track to
// the matching bone's actual node name. Rotation-only by default: external mocap
// position tracks are in the source's units and would fight our scaled rig.
export function retargetClip(clip, bones, { keepRootPosition = false } = {}) {
  const shortToName = {};
  for (const k in bones) shortToName[k] = bones[k].name;

  // Resolve a track's bone by trying the plain suffix first, then prefix-stripped
  // variants (so "RightLeg" matches directly and we never chew "Rig" htLeg).
  const resolve = (raw) => {
    const s = shortBone(raw);
    const tries = [s, s.replace(/^mixamorig/i, ''), s.replace(/^rig/i, '')];
    for (const c of tries) if (shortToName[c]) return { name: shortToName[c], short: c };
    return null;
  };

  const tracks = [];
  let mapped = 0, dropped = 0;
  for (const track of clip.tracks) {
    const prop = track.name.slice(track.name.lastIndexOf('.') + 1); // quaternion|position|scale
    const hit = resolve(track.name);
    if (!hit) { dropped++; continue; }
    if (prop === 'position' && !(keepRootPosition && hit.short === 'Hips')) { dropped++; continue; }
    if (prop === 'scale') { dropped++; continue; }
    track.name = `${hit.name}.${prop}`;
    tracks.push(track);
    mapped++;
  }
  return { clip: new THREE.AnimationClip(clip.name || 'mocap', clip.duration, tracks), mapped, dropped };
}

// Load an external animation file and retarget its first clip onto our rig.
// Supports glTF/GLB (incl. Draco) and FBX (e.g. Mixamo downloads).
export async function loadExternalClip(url, bones, opts) {
  const isFbx = /\.fbx(\?|$)/i.test(url);
  let animations;
  if (isFbx) {
    const obj = await new FBXLoader().loadAsync(url);
    animations = obj.animations;
  } else {
    const draco = new DRACOLoader();
    draco.setDecoderPath('draco/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    const gltf = await loader.loadAsync(url);
    animations = gltf.animations;
  }
  if (!animations || !animations.length) throw new Error('No animation in file');
  return retargetClip(animations[0], bones, opts);
}

// Plays a retargeted clip on our character via AnimationMixer and exposes a
// scrub-friendly seek(). The parameter overrides are layered separately, after
// each update, so the sliders still modulate the baked motion.
export class MocapPlayer {
  constructor(model) { this.model = model; this.mixer = null; this.action = null; this.duration = 0; }
  setClip(clip) {
    if (this.action) this.action.stop();
    this.mixer = new THREE.AnimationMixer(this.model);
    this.action = this.mixer.clipAction(clip);
    this.action.play();
    this.duration = clip.duration || 1;
  }
  seek(t01) { if (this.mixer) { this.mixer.setTime(0); this.mixer.update(t01 * this.duration); } }
  update(dt) { if (this.mixer) this.mixer.update(dt); }
}

// Additive parameter overrides applied AFTER the baked pose, so the teaching
// sliders still bite on a mocap/Blender clip. Deltas are relative to the
// neutral default of each slider; axes use the rig's verified local frames.
export function applyOverrides(bones, rest, params) {
  const mir = params.footedness === 'right' ? 1 : -1;
  const add = (name, x, y, z) => {
    const b = bones[name]; if (!b) return;
    b.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x * DEG, y * DEG, z * DEG, 'XYZ')));
  };
  // Hip turn (Hips yaw) relative to the 38° default.
  add('Hips', 0, (params.hipTurn - 38) * 0.4 * mir, 0);
  // Lateral tilt (spine Z) relative to 15°, split over the three spine segments.
  const dTilt = (params.tilt - 15) / 3;
  for (const s of ['Spine', 'Spine1', 'Spine2']) add(s, 0, 0, -dTilt * mir);
  // Lock-ankle (foot plantarflexion, X) relative to 25°.
  const K = params.footedness === 'right' ? 'Right' : 'Left';
  add(`${K}Foot`, (params.lockAnkle - 25) * 0.6, 0, 0);
}
