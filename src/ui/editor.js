import * as THREE from 'three';
import { CLIP_END } from '../kick/animation.js';

const DEG = Math.PI / 180;
const smooth = (u) => u * u * (3 - 2 * u);
const STORE = 'kickClip.v1';

// In-browser pose/keyframe editor. The animation is a list of full-body pose
// keyframes at normalized times t in [0,1] (× CLIP_END = clip time). Each pose
// is a per-bone local-Euler delta (degrees) on top of the bind/rest pose, the
// same convention the procedural kick uses, so we can seed the editor from it.
export class PoseEditor {
  constructor({ bones, rest, boneNames }) {
    this.bones = bones;
    this.rest = rest;
    this.names = boneNames.filter((n) => bones[n]);
    this.enabled = false;
    this.keys = [];                 // [{ t, pose: { bone: [x,y,z] } }]
    this.working = this.zeroPose(); // live pose being shown/edited
    this.selected = this.names[0];
    this._lastT = -1;
    this.onPoseChange = null;       // GUI hook to refresh the axis sliders
    this.load();
  }

  zeroPose() { const p = {}; for (const n of this.names) p[n] = [0, 0, 0]; return p; }
  clonePose(p) { const o = {}; for (const n of this.names) o[n] = (p[n] || [0, 0, 0]).slice(); return o; }
  sort() { this.keys.sort((a, b) => a.t - b.t); }

  // Interpolated full pose at normalized time t.
  poseAt(t) {
    if (this.keys.length === 0) return this.zeroPose();
    if (t <= this.keys[0].t) return this.clonePose(this.keys[0].pose);
    const last = this.keys[this.keys.length - 1];
    if (t >= last.t) return this.clonePose(last.pose);
    for (let i = 0; i < this.keys.length - 1; i++) {
      const a = this.keys[i], b = this.keys[i + 1];
      if (t >= a.t && t <= b.t) {
        const u = smooth((t - a.t) / (b.t - a.t));
        const o = {};
        for (const n of this.names) {
          const va = a.pose[n] || [0, 0, 0], vb = b.pose[n] || [0, 0, 0];
          o[n] = [va[0] + (vb[0] - va[0]) * u, va[1] + (vb[1] - va[1]) * u, va[2] + (vb[2] - va[2]) * u];
        }
        return o;
      }
    }
    return this.clonePose(last.pose);
  }

  poseBones(pose) {
    for (const n of this.names) {
      const b = this.bones[n]; if (!b) continue;
      const e = pose[n] || [0, 0, 0];
      b.quaternion.copy(this.rest[n]).multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0] * DEG, e[1] * DEG, e[2] * DEG, 'XYZ')));
    }
  }

  // Drive the rig at normalized time t. While the time is unchanged we keep the
  // live `working` pose (so slider edits aren't overwritten each frame); when
  // the time moves we re-derive `working` from the keyframes.
  applyAt(t) {
    if (t !== this._lastT) {
      this.working = this.poseAt(t);
      this._lastT = t;
      if (this.onPoseChange) this.onPoseChange();
    }
    this.poseBones(this.working);
  }

  setEuler(axis, deg) { this.working[this.selected][axis] = deg; this.poseBones(this.working); }
  getEuler() { return this.working[this.selected]; }

  setKey(t) {
    const e = this.keys.find((k) => Math.abs(k.t - t) < 1e-3);
    if (e) e.pose = this.clonePose(this.working);
    else this.keys.push({ t, pose: this.clonePose(this.working) });
    this.sort(); this.save();
  }
  delKey(t) { this.keys = this.keys.filter((k) => Math.abs(k.t - t) >= 1e-3); this.save(); }
  clear() { this.keys = []; this._lastT = -1; this.save(); }
  keyTimes() { return this.keys.map((k) => +k.t.toFixed(3)); }

  // Build editable keyframes by sampling the procedural kick at the given times.
  seedFrom(kick, params, times = [0, 0.3, 0.5, 0.615, 0.7, 0.77, 0.85, 1.0]) {
    this.keys = [];
    const inv = new THREE.Quaternion();
    for (const t of times) {
      kick.update(t * CLIP_END, params); // poses the bones
      const pose = {};
      for (const n of this.names) {
        const b = this.bones[n];
        inv.copy(this.rest[n]).invert().multiply(b.quaternion);
        const e = new THREE.Euler().setFromQuaternion(inv, 'XYZ');
        pose[n] = [+(e.x / DEG).toFixed(2), +(e.y / DEG).toFixed(2), +(e.z / DEG).toFixed(2)];
      }
      this.keys.push({ t, pose });
    }
    this.sort(); this._lastT = -1; this.save();
  }

  save() { try { localStorage.setItem(STORE, JSON.stringify(this.keys)); } catch { /* ignore */ } }
  load() { try { const s = localStorage.getItem(STORE); if (s) this.keys = JSON.parse(s); } catch { /* ignore */ } }

  exportJSON() { return JSON.stringify({ clipEnd: CLIP_END, names: this.names, keys: this.keys }, null, 2); }
  importJSON(str) { const o = JSON.parse(str); this.keys = o.keys || []; this.sort(); this._lastT = -1; this.save(); }
}

// Build the lil-gui controls for the editor inside an existing GUI.
// hooks: { kick, params, onEnabledChange }
export function buildEditorGUI(gui, editor, hooks) {
  const f = gui.addFolder('Animation editor');
  f.close();

  const ax = { x: 0, y: 0, z: 0 };
  const refresh = () => {
    const e = editor.getEuler();
    ax.x = +e[0].toFixed(2); ax.y = +e[1].toFixed(2); ax.z = +e[2].toFixed(2);
    cx.updateDisplay(); cy.updateDisplay(); cz.updateDisplay();
  };
  editor.onPoseChange = refresh;

  f.add(editor, 'enabled').name('✏️ Edit mode').onChange((v) => {
    if (v) { hooks.params.playing = false; hooks.params.scrub = 0; editor._lastT = -1; }
    if (hooks.onEnabledChange) hooks.onEnabledChange(v);
    refresh();
  });

  f.add(editor, 'selected', editor.names).name('Bone').onChange(refresh);

  const cx = f.add(ax, 'x', -180, 180, 1).name('Rotate X°').onChange((v) => editor.setEuler(0, v));
  const cy = f.add(ax, 'y', -180, 180, 1).name('Rotate Y°').onChange((v) => editor.setEuler(1, v));
  const cz = f.add(ax, 'z', -180, 180, 1).name('Rotate Z°').onChange((v) => editor.setEuler(2, v));

  const info = { keys: '' };
  const refreshInfo = () => { info.keys = editor.keyTimes().join(', ') || '(none)'; ck.updateDisplay(); };

  const actions = {
    setKey() { editor.setKey(+hooks.params.scrub.toFixed(3)); refreshInfo(); },
    delKey() { editor.delKey(+hooks.params.scrub.toFixed(3)); refreshInfo(); },
    seed() { editor.seedFrom(hooks.kick, hooks.params); editor._lastT = -1; refreshInfo(); },
    clear() { editor.clear(); refreshInfo(); },
    export() {
      const blob = new Blob([editor.exportJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'kick-clip.json'; a.click();
      URL.revokeObjectURL(a.href);
      // eslint-disable-next-line no-console
      console.log(editor.exportJSON());
    },
    load() {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'application/json';
      input.onchange = () => {
        const file = input.files[0]; if (!file) return;
        const r = new FileReader();
        r.onload = () => { try { editor.importJSON(r.result); refreshInfo(); } catch (e) { alert('Bad clip JSON: ' + e.message); } };
        r.readAsText(file);
      };
      input.click();
    },
  };
  f.add(actions, 'setKey').name('◆ Set keyframe @ time');
  f.add(actions, 'delKey').name('✕ Delete keyframe @ time');
  f.add(actions, 'seed').name('↻ Seed from current kick');
  f.add(actions, 'clear').name('🗑 Clear all keys');
  f.add(actions, 'export').name('⬇ Export clip JSON');
  f.add(actions, 'load').name('⬆ Load clip JSON');
  const ck = f.add(info, 'keys').name('Keyframes (t)').disable();
  refreshInfo();

  return f;
}
