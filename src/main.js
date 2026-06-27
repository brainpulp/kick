import * as THREE from 'three';
import { createScene } from './scene.js';
import { createField, BALL_RADIUS } from './field.js';
import { loadCharacter } from './character.js';
import { KickAnimation, CONTACT_T, CLIP_END } from './kick/animation.js';
import { createPanel } from './ui/panel.js';
import { PoseEditor, buildEditorGUI, attachGizmo, KEY_DEFS } from './ui/editor.js';
import { createTimeline } from './ui/timeline.js';
import { Annotations } from './ui/annotations.js';
import { params } from './kick/parameters.js';
import { BONES } from './character.js';
import { loadExternalClip, retargetClip, MocapPlayer, applyOverrides } from './kick/mocap.js';

const SECONDS_FULL = 2.4; // wall-clock seconds for the whole 0..CLIP_END clip
const GRAVITY = 9.81;

// Build stamp (injected by Vite) so the live page shows which build is loaded.
const buildEl = document.getElementById('build');
if (buildEl) buildEl.textContent = `build ${__BUILD__}`;

const { renderer, labelRenderer, scene, camera, controls } = createScene();
const { ball } = createField(scene);

let kick = null, annotations = null, editor = null, gizmo = null, timeline = null;
let mocap = null, mocapModel = null, mocapAvailable = false, mocapBase = null;
let mocapAlign = { x: 0, z: 0 };  // shift so the strike foot meets the ball
let mocapContactT = 0.7;          // normalized clip time of ball contact
let mocapPlayT = 0;               // wall-clock for mocap playback (incl. delay)
let bonesRef = null, restRef = null, sourceCtrl = null;
const sourceOptions = () => (mocapAvailable
  ? { 'Imported clip': 'mocap', 'Authored clip': 'authored', Procedural: 'procedural' }
  : { 'Authored clip': 'authored', Procedural: 'procedural' });
let t = 0;                 // normalized clip time 0..CLIP_END
let launched = false;      // has the ball been struck this cycle
const ballVel = new THREE.Vector3();
let ballSpin = 0;
const ballHome = ball.position.clone();

function resetBall() {
  ball.position.copy(ballHome);
  ballVel.set(0, 0, 0);
  ballSpin = 0;
  launched = false;
}

function launchBall() {
  const L = kick.computeLaunch(params);
  const elev = L.elevation * Math.PI / 180;
  const azim = L.azimuth * Math.PI / 180;
  const horiz = L.speed * Math.cos(elev);
  ballVel.set(
    horiz * Math.sin(azim),
    L.speed * Math.sin(elev),
    -horiz * Math.cos(azim) // down the target line toward the goal (-Z)
  );
  ballSpin = L.spin;
  launched = true;
}

function stepBall(dt) {
  if (!launched) return;
  ballVel.y -= GRAVITY * dt;
  ballVel.x += ballSpin * 3.0 * dt; // crude Magnus curl
  ball.position.addScaledVector(ballVel, dt);
  if (ball.position.y <= BALL_RADIUS) {
    ball.position.y = BALL_RADIUS;
    ballVel.y *= -0.35;            // small bounce
    ballVel.x *= 0.8; ballVel.z *= 0.8;
    if (Math.abs(ballVel.y) < 0.5) ballVel.y = 0;
  }
}

loadCharacter(scene).then(({ model, bones, rest }) => {
  // Stance: stand just behind/beside the ball, facing the goal (-Z).
  model.position.x = 0.12;
  model.position.z = 0.34;
  model.rotation.y = Math.PI; // face -Z (tune if the model faces the other way)

  kick = new KickAnimation({ model, bones, rest });
  annotations = new Annotations(scene, ball);
  bonesRef = bones; restRef = rest; mocapModel = model; mocapBase = model.position.clone();
  editor = new PoseEditor({ bones, rest, boneNames: BONES, build: __BUILD__ });

  // Optional external mocap/Blender clip: if assets/kick-mocap.glb is present it
  // is retargeted onto our rig and offered as an animation source.
  mocap = new MocapPlayer(model);
  (async () => {
    for (const url of ['assets/kick-mocap.glb', 'assets/kick-mocap.fbx']) {
      try {
        const { clip, mapped, dropped, rootTrack } = await loadExternalClip(url, bones, { keepRootPosition: false });
        if (!mapped) continue;
        mocap.setClip(clip, rootTrack);
        calibrateMocap();
        mocapAvailable = true;
        params.source = 'mocap'; // show the imported clip by default once present
        buildSourceCtrl();
        // eslint-disable-next-line no-console
        console.log(`[mocap] ${url}: ${mapped} tracks mapped, ${dropped} dropped, ${clip.duration.toFixed(2)}s`);
        break;
      } catch { /* try next / none present */ }
    }
  })();
  gizmo = attachGizmo({
    editor, scene, camera, renderer, controls,
    onChange: () => { if (editor.onPoseChange) editor.onPoseChange(); },
  });

  // Shared source of truth: load the published clip file. If this browser has
  // local edits made against THIS build, keep them; otherwise the published clip
  // wins (so my deploys supersede stale local edits — no clobbering).
  const hadLocal = editor.keys.length > 0;
  async function loadPublished(after) {
    try {
      const r = await fetch('assets/kick-clip.json', { cache: 'no-store' });
      if (r.ok) { const j = await r.json(); if (j.keys && j.keys.length) { editor.setKeys(j.keys); if (after) after(); return true; } }
    } catch { /* ignore */ }
    return false;
  }
  if (!hadLocal) {
    loadPublished().then((ok) => { if (!ok && !editor.keys.length) editor.seedKeys(kick, params, KEY_DEFS); });
  }

  params.source = 'authored'; // default to the shared keyframe clip (until an import loads)
  const gui = createPanel({
    onChange: () => { if (!params.playing) applyFrame(params.scrub * CLIP_END); },
    onReplay: () => { t = 0; mocapPlayT = 0; resetBall(); params.playing = true; },
  });
  function buildSourceCtrl() {
    if (sourceCtrl) sourceCtrl.destroy();
    sourceCtrl = gui.add(params, 'source', sourceOptions()).name('Animation source')
      .onChange(() => { if (!params.playing) applyFrame(params.scrub * CLIP_END); });
  }
  buildSourceCtrl();
  gui.add(params, 'rootMotion').name('Root motion (locomotion)')
    .onChange(() => { if (!params.playing) applyFrame(params.scrub * CLIP_END); });
  gui.add(params, 'delay', 0, 3, 0.05).name('Delay before kick (s)');
  const stageF = gui.addFolder('Stage speeds (imported clip)');
  stageF.close();
  stageF.add(params, 'spdPreRunup', 0.2, 3, 0.05).name('Pre-run-up');
  stageF.add(params, 'spdRunup', 0.2, 3, 0.05).name('Run-up');
  stageF.add(params, 'spdRecoil', 0.2, 3, 0.05).name('Recoil');
  stageF.add(params, 'spdWhip', 0.2, 3, 0.05).name('Whip');
  stageF.add(params, 'spdFollow', 0.2, 3, 0.05).name('Follow-up');

  function jumpToKey(i) {
    const k = editor.keys[i]; if (!k) return;
    params.playing = false;
    editor.enabled = true;
    gizmo.setEnabled(true);
    editor.activeIndex = i;
    params.scrub = k.t;
    applyFrame(k.t * CLIP_END);
    timeline.setActive(i);
  }

  timeline = createTimeline({
    defs: KEY_DEFS,
    onJump: jumpToKey,
    onPrev: () => jumpToKey(Math.max(0, (editor.activeIndex < 0 ? 1 : editor.activeIndex) - 1)),
    onNext: () => jumpToKey(Math.min(editor.keys.length - 1, editor.activeIndex + 1)),
    onPlay: () => { params.playing = !params.playing; if (params.playing) { t = params.scrub * CLIP_END; resetBall(); } },
  });

  buildEditorGUI(gui, editor, {
    kick, params, gizmo,
    onEnabledChange: () => { if (!params.playing) applyFrame(params.scrub * CLIP_END); },
    onSeed: () => { editor.activeIndex = -1; timeline.setActive(-1); },
    onRevert: (after) => { loadPublished(() => { editor.activeIndex = -1; timeline.setActive(-1); if (after) after(); }); },
  });

  // Dev-only inspection hook (stripped from production builds) for headless
  // screenshot/clip tooling: freeze, scrub to a frame, and move the camera.
  if (import.meta.env.DEV) {
    window.__dbg = {
      bones, rest, camera, controls, params, editor, kick, gizmo, scene, THREE, mocap,
      mocapLib: { retargetClip, MocapPlayer, applyOverrides },
      frame(s) { params.playing = false; params.scrub = s; applyFrame(s * CLIP_END); },
      view(px, py, pz, tx, ty, tz) {
        camera.position.set(px, py, pz); controls.target.set(tx, ty, tz); controls.update();
      },
    };
  }

  document.getElementById('loading').style.opacity = '0';
});

function applyFrame(tt) {
  const tn = Math.min(Math.max(tt / CLIP_END, 0), 1);
  // While actively authoring, the editor always drives the rig.
  if (editor && editor.enabled) {
    editor.applyAt(tn);
  } else if (params.source === 'mocap' && mocapAvailable) {
    mocap.seek(tn);                       // baked clip...
    applyOverrides(bonesRef, restRef, params); // ...+ live parameter overrides
    // Root motion: model faces -Z (rotation.y = PI) so negate clip X/Z; align
    // shift makes the strike foot meet the ball.
    const o = params.rootMotion ? mocap.rootOffset(tn) : null;
    mocapModel.position.set(
      mocapBase.x - (o ? o.x : 0) + mocapAlign.x,
      mocapBase.y + (o ? Math.max(0, o.y) : 0),
      mocapBase.z - (o ? o.z : 0) + mocapAlign.z,
    );
    groundModel();
  } else if (params.source === 'authored' && editor && editor.keys.length) {
    editor.applyAt(tn);
  } else {
    kick.update(tt, params);
  }
  // Strike the ball as we cross contact (skipped while actively authoring).
  // For an imported clip, contact is the calibrated moment; otherwise CONTACT_T.
  if (!editor.enabled) {
    const crossed = (params.source === 'mocap' && mocapAvailable) ? (tn >= mocapContactT) : (tt >= CONTACT_T);
    if (!launched && crossed) launchBall();
    if (launched && !crossed) resetBall();
  }
  annotations.update(kick.phaseLabel(tt), kick.computeLaunch(params), params);
}

// Shift the model down so the lowest foot rests on the pitch (kills floating /
// sinking when an imported pose doesn't match the rest-pose grounding).
const _wp = new THREE.Vector3();
function groundModel() {
  if (!mocapModel || !bonesRef) return;
  mocapModel.updateMatrixWorld(true);
  let minY = Infinity;
  for (const n of ['LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot']) {
    const b = bonesRef[n]; if (!b) continue;
    b.getWorldPosition(_wp); if (_wp.y < minY) minY = _wp.y;
  }
  if (minY !== Infinity) mocapModel.position.y -= (minY - 0.02);
}

// The 5 stages as [t0,t1] spans (normalized clip time) anchored to the
// calibrated contact, each with its live speed multiplier.
function mocapStages() {
  const c = Math.min(0.98, Math.max(0.1, mocapContactT));
  const bounds = [0, 0.12 * c, 0.78 * c, 0.92 * c, c, 1];
  const sp = [params.spdPreRunup, params.spdRunup, params.spdRecoil, params.spdWhip, params.spdFollow];
  const segs = [];
  for (let i = 0; i < 5; i++) segs.push({ t0: bounds[i], t1: bounds[i + 1], sp: Math.max(0.1, sp[i]) });
  return segs;
}

// Map a warped position (0..sum of warped stage lengths) back to clip time 0..1.
function clipTimeFromWarp(w, segs) {
  let acc = 0;
  for (const s of segs) {
    const wl = (s.t1 - s.t0) / s.sp;
    if (w <= acc + wl || s === segs[segs.length - 1]) {
      const f = wl > 0 ? (w - acc) / wl : 1;
      return s.t0 + Math.min(1, Math.max(0, f)) * (s.t1 - s.t0);
    }
    acc += wl;
  }
  return 1;
}

// One-time calibration. Sample the kicking foot in BODY space (model parked at
// base, no root translation) so we can find contact by peak forward foot speed —
// immune to the whole-body run-up travel. Then place that foot on the ball.
function calibrateMocap() {
  const K = params.footedness === 'right' ? 'Right' : 'Left';
  const foot = bonesRef[`${K}ToeBase`] || bonesRef[`${K}Foot`];
  if (!foot) return;
  const N = 80, fl = [];
  const wp = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const tn = i / N;
    mocap.seek(tn);
    mocapModel.position.copy(mocapBase);          // body space, no root
    mocapModel.updateMatrixWorld(true);
    foot.getWorldPosition(wp);
    fl.push({ tn, x: wp.x, y: wp.y, z: wp.z });
  }
  // Contact = fastest forward foot motion (most negative dz) in the back half.
  let best = null;
  for (let i = 1; i <= N; i++) {
    if (fl[i].tn < 0.35 || fl[i].tn > 0.97) continue;
    const dz = fl[i].z - fl[i - 1].z;            // forward is -Z
    if (!best || dz < best.dz) best = { i, dz, tn: fl[i].tn };
  }
  const ci = best ? best.i : Math.round(N * 0.7);
  mocapContactT = fl[ci].tn;
  // Align: at contact, runtime foot.world = footLocal - rootOffset + align = 0.
  const o = mocap.rootOffset(mocapContactT) || { x: 0, z: 0 };
  mocapAlign = { x: o.x - fl[ci].x, z: o.z - fl[ci].z };
  // eslint-disable-next-line no-console
  console.log(`[mocap] contactT=${mocapContactT.toFixed(2)} align=(${mocapAlign.x.toFixed(2)},${mocapAlign.z.toFixed(2)})`);
}

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (kick) {
    if (!params.playing) {
      applyFrame(params.scrub * CLIP_END);            // paused: scrub the pose
    } else if (params.source === 'mocap' && mocapAvailable) {
      // Imported clip: time-warped playback. Each stage (pre-runup, run-up,
      // recoil, whip, follow-up) plays at its own speed; a "delay" holds the
      // first frame before each loop. Overall "speed" scales the whole thing.
      const segs = mocapStages();
      const warpLen = segs.reduce((a, s) => a + (s.t1 - s.t0) / s.sp, 0); // normalized
      const rate = Math.max(0.05, params.speed);
      const clipWall = warpLen * mocap.duration / rate;
      const period = params.delay + clipWall;
      mocapPlayT += dt;
      if (mocapPlayT >= period) { mocapPlayT -= period; resetBall(); }
      const w = Math.max(0, mocapPlayT - params.delay) * rate / mocap.duration; // 0..warpLen
      params.scrub = clipTimeFromWarp(w, segs);
      applyFrame(params.scrub * CLIP_END);
      stepBall(dt);
    } else {
      t += dt * params.speed * (CLIP_END / SECONDS_FULL);
      if (t >= CLIP_END) { t = 0; resetBall(); }
      params.scrub = t / CLIP_END;
      applyFrame(t);
      stepBall(dt);
    }
  }

  if (gizmo) gizmo.update();
  if (timeline) timeline.update(params.scrub);
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
animate();
