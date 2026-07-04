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
  let mapped = 0, dropped = 0, rootTrack = null;
  for (const track of clip.tracks) {
    const prop = track.name.slice(track.name.lastIndexOf('.') + 1); // quaternion|position|scale
    const hit = resolve(track.name);
    if (!hit) { dropped++; continue; }
    // Capture the Hips position separately as the root-motion track (applied to
    // the model root, not the bone, so locomotion is preserved at the right scale).
    if (prop === 'position' && hit.short === 'Hips') {
      rootTrack = track.clone();
      if (!keepRootPosition) { dropped++; continue; }
    }
    if (prop === 'position' && hit.short !== 'Hips') { dropped++; continue; }
    if (prop === 'scale') { dropped++; continue; }
    track.name = `${hit.name}.${prop}`;
    tracks.push(track);
    mapped++;
  }
  return { clip: new THREE.AnimationClip(clip.name || 'mocap', clip.duration, tracks), mapped, dropped, rootTrack };
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
  constructor(model) {
    this.model = model; this.mixer = null; this.action = null; this.duration = 0;
    // Root travel scale. Tuned so the planted foot stays put (measured: the body
    // was over-travelling ~12%, dragging the stance foot — the run-up "skate").
    this.rootInterp = null; this.root0 = null; this.rootScale = 0.0088;
  }
  setClip(clip, rootTrack, rootScale) {
    if (this.action) this.action.stop();
    this.mixer = new THREE.AnimationMixer(this.model);
    this.action = this.mixer.clipAction(clip);
    this.action.play();
    this.duration = clip.duration || 1;
    if (typeof rootScale === 'number') this.rootScale = rootScale;
    if (rootTrack) {
      this.rootInterp = rootTrack.createInterpolant();
      this.root0 = Array.from(rootTrack.values.slice(0, 3)); // first keyframe (x,y,z)
    } else { this.rootInterp = null; this.root0 = null; }
  }
  seek(t01) { if (this.mixer) { this.mixer.setTime(0); this.mixer.update(t01 * this.duration); } }
  update(dt) { if (this.mixer) this.mixer.update(dt); }
  // Planar root displacement (metres) from the clip's start, or null if no root.
  rootOffset(t01) {
    if (!this.rootInterp) return null;
    const v = this.rootInterp.evaluate(t01 * this.duration);
    return {
      x: (v[0] - this.root0[0]) * this.rootScale,
      y: (v[1] - this.root0[1]) * this.rootScale,
      z: (v[2] - this.root0[2]) * this.rootScale,
    };
  }
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
  // (Hip turn is now an ABSOLUTE pelvis-yaw constraint solved at contact in
  //  main.js applyConstraints — no longer a constant nudge here.)
  // (Lock-ankle is now an ABSOLUTE constraint solved in main.js applyConstraints;
  //  tilt is a whole-body rigid lean about the plant foot — also in main.)
}
