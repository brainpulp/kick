import * as THREE from 'three';
import { createScene } from './scene.js';
import { createField, BALL_RADIUS } from './field.js';
import { loadCharacter } from './character.js';
import { KickAnimation, CONTACT_T, CLIP_END } from './kick/animation.js';
import { createPanel } from './ui/panel.js';
import { PoseEditor, buildEditorGUI, attachGizmo, KEY_DEFS } from './ui/editor.js';
import { createTimeline } from './ui/timeline.js';
import { createEnvTimeline } from './ui/envtimeline.js';
import { Annotations } from './ui/annotations.js';
import { params } from './kick/parameters.js';
import { timings, env } from './kick/timing.js';
import { BONES } from './character.js';
import { loadExternalClip, retargetClip, MocapPlayer, applyOverrides } from './kick/mocap.js';
import { scenarioStore, snapshot, applyScenario } from './scenarios.js';

const SECONDS_FULL = 2.4; // wall-clock seconds for the whole 0..CLIP_END clip
const GRAVITY = 9.81;
const DEG = Math.PI / 180;

// Build stamp (injected by Vite) so the live page shows which build is loaded.
const buildEl = document.getElementById('build');
if (buildEl) buildEl.textContent = `build ${__BUILD__}`;

const { renderer, labelRenderer, scene, camera, controls } = createScene();
const { ball } = createField(scene);

let kick = null, annotations = null, editor = null, gizmo = null, timeline = null, envtl = null;
let mocap = null, mocapModel = null, mocapAvailable = false, mocapBase = null;
let mocapAlign = { x: 0, z: 0 };  // shift so the strike foot meets the ball
let mocapContactT = 0.7;          // normalized clip time of ball contact
let mocapPlayT = 0;               // wall-clock for mocap playback (incl. delay)
let mocapBaseQuat = null;         // model's facing rotation (before tilt lean)
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
  mocapBaseQuat = model.quaternion.clone();

  kick = new KickAnimation({ model, bones, rest });
  annotations = new Annotations(scene, bones);
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
  envtl = createEnvTimeline({
    onChange: () => { if (!params.playing) applyFrame(params.scrub * CLIP_END); },
    getScrub: () => params.scrub,
  });
  envtl.setVisible(false);
  gui.add({ timing: false }, 'timing').name('⏱ Timing editor').onChange((v) => envtl.setVisible(v));
  gui.add(params, 'runupSteps', 0, 5, 1).name('Run-up steps');
  gui.add(params, 'runupAngle', 0, 90, 1).name('Run-up angle °');
  gui.add(params, 'delay', 0, 3, 0.05).name('Delay before kick (s)');
  const axF = gui.addFolder('Body axes');
  axF.close();
  axF.add(params, 'showAxes').name('Show axes');
  axF.add(params, 'axHips').name('Hips (L–R)');
  axF.add(params, 'axShoulders').name('Shoulders (L–R)');
  axF.add(params, 'axToes').name('Toes (pointing)');
  axF.add(params, 'axKnee').name('Knee (plumb)');
  axF.add(params, 'axGaze').name('Gaze');
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

  // Scenarios: save/load named configurations of every control (local for now;
  // the store is async so Supabase can drop in later). Will be populated with
  // real kicks (e.g. Caniggia vs River, 1992) once captured.
  const scF = gui.addFolder('Scenarios');
  scF.close();
  const scState = { name: 'My kick', selected: '' };
  let scDropdown = null;
  async function refreshScenarios() {
    const names = await scenarioStore.list();
    if (scDropdown) scDropdown.destroy();
    scDropdown = scF.add(scState, 'selected', names.length ? names : ['(none)']).name('Saved');
  }
  scF.add(scState, 'name').name('Name');
  scF.add({ save: async () => {
    if (!scState.name) return;
    await scenarioStore.save(scState.name, snapshot());
    await refreshScenarios(); scState.selected = scState.name; scDropdown.updateDisplay();
  } }, 'save').name('💾 Save current');
  scF.add({ load: async () => {
    const cfg = await scenarioStore.get(scState.selected);
    if (!cfg) return;
    applyScenario(cfg);
    buildSourceCtrl();
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    if (!params.playing) applyFrame(params.scrub * CLIP_END);
  } }, 'load').name('▶ Load selected');
  scF.add({ del: async () => {
    if (!scState.selected) return;
    await scenarioStore.remove(scState.selected);
    await refreshScenarios();
  } }, 'del').name('🗑 Delete selected');
  refreshScenarios();

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
    applyRecoil(tn);                      // cock-back (pre-contact)
    applyWhip(tn);                        // strike: femur+knee drive, pelvis un-wind
    applyTorso(tn);                       // trunk counter-strike over the ball
    applyArms(tn);                        // counter-arm swing
    applyFollowUp(tn);                     // follow-through sweep (post-contact)
    // Root motion: model faces -Z (rotation.y = PI) so negate clip X/Z; align
    // shift makes the strike foot meet the ball.
    const o = params.rootMotion ? mocap.rootOffset(tn) : null;
    mocapModel.position.set(
      mocapBase.x - (o ? o.x : 0) + mocapAlign.x,
      mocapBase.y + (o ? Math.max(0, o.y) : 0),
      mocapBase.z - (o ? o.z : 0) + mocapAlign.z,
    );
    groundModel();
    applyTilt(tn); // whole-body lean about the plant foot
    // Hop: a small forward skip onto the plant foot during the recoil, gone by
    // contact (so it never shifts the strike). Applied last so it isn't grounded.
    const he = env(tn, timings.hop);
    if (he > 0.001) { mocapModel.position.z -= he * 0.05; mocapModel.position.y += he * 0.025; }
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
  annotations.update(params, mocapModel ? mocapModel.position : null);
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

const _smooth = (u) => { const x = Math.min(1, Math.max(0, u)); return x * x * (3 - 2 * x); };

// Timing envelopes now live in kick/timing.js (editable from the dopesheet).
function tiltEnvelope(scrubN) { return env(scrubN, timings.tilt); }

// Whole-body rigid lean toward the plant foot, pivoting at the plant-foot point
// on the ground (rotation about the world forward axis). Applied after posing.
const _tiltPivot = new THREE.Vector3();
const _tiltQuat = new THREE.Quaternion();
const _tiltAxis = new THREE.Vector3(0, 0, 1);
function applyTilt(scrubN) {
  if (mocapBaseQuat) mocapModel.quaternion.copy(mocapBaseQuat); // reset (no accumulation)
  const deg = params.tilt * tiltEnvelope(scrubN);
  if (deg < 0.02) return;
  const S = params.footedness === 'right' ? 'Left' : 'Right';
  const foot = bonesRef[`${S}ToeBase`] || bonesRef[`${S}Foot`];
  if (!foot) return;
  mocapModel.updateMatrixWorld(true);
  foot.getWorldPosition(_tiltPivot); _tiltPivot.y = 0; // pivot on the pitch
  const sign = params.footedness === 'right' ? 1 : -1;  // lean head toward plant (support) side
  _tiltQuat.setFromAxisAngle(_tiltAxis, sign * deg * DEG);
  mocapModel.position.sub(_tiltPivot).applyQuaternion(_tiltQuat).add(_tiltPivot);
  mocapModel.quaternion.premultiply(_tiltQuat);
}

function followEnvelope(scrubN) { return env(scrubN, timings.follow); }

// Body expression of the follow-up angle: after contact the hips keep turning
// and the kicking leg sweeps across toward the non-kicking foot, in the same
// direction the ball was sent (set in computeLaunch). Layered on the baked pose.
const _fuQuat = new THREE.Quaternion();
const _fuEuler = new THREE.Euler();
function applyFollowUp(scrubN) {
  const amt = (params.followStrength || 0) / 90 * followEnvelope(scrubN); // 0..1
  if (amt < 0.01) return;
  const mir = params.footedness === 'right' ? 1 : -1;
  const K = params.footedness === 'right' ? 'Right' : 'Left';
  const add = (name, x, y, z) => {
    const b = bonesRef[name]; if (!b) return;
    _fuEuler.set(x * DEG, y * DEG, z * DEG, 'XYZ');
    b.quaternion.multiply(_fuQuat.setFromEuler(_fuEuler));
  };
  add('Hips', 0, amt * 25 * mir, 0);          // pelvis keeps rotating toward target
  add(`${K}UpLeg`, 0, 0, -amt * 35 * mir);    // kicking leg sweeps across the body
}

// Recoil timing envelope (0..1): the cock-back winds up through the recoil stage
// (0.78c→0.92c), peaks at the top of the backswing, then releases by contact as
// the whip fires. Zero everywhere else.
function recoilEnvelope(scrubN) { return env(scrubN, timings.recoil); }

// The cock-back, layered on the baked pose during the recoil stage:
//  1. the pelvis winds toward the kicking foot (rotating about the plant hip);
//  2. the kicking femur pulls back (hip extension) with the knee flexing.
const _rcQuat = new THREE.Quaternion();
const _rcEuler = new THREE.Euler();
function applyRecoil(scrubN) {
  const env = recoilEnvelope(scrubN);
  const deg = (params.recoil || 0) * env;
  if (deg < 0.05) return;
  const mir = params.footedness === 'right' ? 1 : -1;
  const K = params.footedness === 'right' ? 'Right' : 'Left';
  const add = (name, x, y, z) => {
    const b = bonesRef[name]; if (!b) return;
    _rcEuler.set(x * DEG, y * DEG, z * DEG, 'XYZ');
    b.quaternion.multiply(_rcQuat.setFromEuler(_rcEuler));
  };
  add('Hips', 0, deg * 0.5 * mir, 0);     // pelvis winds toward the kicking foot
  add(`${K}UpLeg`, -deg, 0, 0);           // kicking femur pulls back (hip extension)
  add(`${K}Leg`, -deg * 1.2, 0, 0);       // knee flexes (cocks the lower leg)
}

// The whip (strike): femur drives forward AND the knee extends forward together,
// while the pelvis un-winds back toward the non-kicking/plant foot (the power
// source). Layered on the baked pose over the whip window. Scaled by `whip`.
const _wpQuat = new THREE.Quaternion();
const _wpEuler = new THREE.Euler();
function applyWhip(scrubN) {
  const e = env(scrubN, timings.whip);
  const drive = (params.whip || 0) * e;
  if (drive < 0.01) return;
  const mir = params.footedness === 'right' ? 1 : -1;
  const K = params.footedness === 'right' ? 'Right' : 'Left';
  const add = (name, x, y, z) => {
    const b = bonesRef[name]; if (!b) return;
    _wpEuler.set(x * DEG, y * DEG, z * DEG, 'XYZ');
    b.quaternion.multiply(_wpQuat.setFromEuler(_wpEuler));
  };
  add(`${K}UpLeg`, drive * 15, 0, 0);     // femur drives forward (hip flexion)
  add(`${K}Leg`, drive * 22, 0, 0);       // knee extends forward (snaps through)
  add('Hips', 0, -drive * 18 * mir, 0);   // pelvis un-winds toward the plant foot
}

// Torso counter-strike envelope (0..1): the trunk bends forward as the knee
// drives in — ramps through the whip to peak at contact, then eases through the
// follow-up (the player stays folded over the ball, recovering by the end).
function torsoEnvelope(scrubN) { return env(scrubN, timings.torso); }

// Forward trunk flexion over the ball, distributed across the spine chain.
const _tbQuat = new THREE.Quaternion();
const _tbEuler = new THREE.Euler();
function applyTorso(scrubN) {
  const deg = (params.torsoBend || 0) * torsoEnvelope(scrubN);
  if (deg < 0.05) return;
  const per = deg / 3; // spread over the 3 spine joints
  for (const s of ['Spine', 'Spine1', 'Spine2']) {
    const b = bonesRef[s]; if (!b) continue;
    _tbEuler.set(per * DEG, 0, 0, 'XYZ');
    b.quaternion.multiply(_tbQuat.setFromEuler(_tbEuler));
  }
}

// Counter arm (opposite the kicking leg). Driven off the REST pose and blended
// in by `armSwing` — NOT added to the baked swing — so the motion is clean and
// predictable (no compounding with the mocap arm). Stretched back & up early,
// swinging down & forward through the strike.
const _armEuler = new THREE.Euler();
const _armOff = new THREE.Quaternion();
const _armTarget = new THREE.Quaternion();
function poseArm(name, xDeg, zDeg, amt) {
  const b = bonesRef[name]; const r = restRef[name]; if (!b || !r) return;
  _armEuler.set(xDeg * DEG, 0, zDeg * DEG, 'XYZ');
  _armTarget.copy(r).multiply(_armOff.setFromEuler(_armEuler)); // rest ∘ offset
  b.quaternion.slerp(_armTarget, amt);                          // mocap → target by amt
}
function applyArms(scrubN) {
  const amt = params.armSwing || 0;
  if (amt < 0.001) return;
  const p = env(scrubN, timings.arm); // 0 early (back&up) → 1 end (down&forward)
  const S = params.footedness === 'right' ? 'Left' : 'Right'; // arm opposite the kicking leg
  const sgn = S === 'Left' ? -1 : 1;                          // abduction sign for that side
  poseArm(`${S}Arm`, -35 + 80 * p, sgn * (75 - 80 * p), amt); // back&up → forward&down
  poseArm(`${S}ForeArm`, 15 + 25 * p, 0, amt);                // slight elbow flex into the finish
}

// One leg of a jog cycle (phase 0..1): forward swing then planted sweep.
function legCycle(phase) {
  phase -= Math.floor(phase);
  if (phase < 0.5) { const u = phase / 0.5; return { hip: -18 + 46 * u, knee: 14 + 64 * Math.sin(Math.PI * u) }; }
  const u = (phase - 0.5) / 0.5; return { hip: 28 - 46 * u, knee: 12 };
}

// Pose the rig in a procedural jog at the given stride phase (used for the
// prepended run-up before an imported clip). Reuses the kick rig's rest pose.
function poseJog(phase) {
  kick.resetPose();
  const mir = params.footedness === 'right' ? 1 : -1;
  const r = legCycle(phase), l = legCycle(phase + 0.5);
  // Adduct both thighs inward so the feet track close to a single line (not a
  // wide waddle). Legs' local Z is the lateral axis.
  const add = 9;
  kick.applyBone('RightUpLeg', r.hip * DEG, 0, -add * DEG); kick.applyBone('RightLeg', -r.knee * DEG, 0, 0);
  kick.applyBone('LeftUpLeg', l.hip * DEG, 0, add * DEG); kick.applyBone('LeftLeg', -l.knee * DEG, 0, 0);
  kick.applyBone('RightFoot', 8 * DEG, 0, 0); kick.applyBone('LeftFoot', 8 * DEG, 0, 0);
  // arms swing opposite the same-side leg
  kick.applyBone('RightArm', (-r.hip * 0.5) * DEG, 0, 10 * mir * DEG);
  kick.applyBone('LeftArm', (-l.hip * 0.5) * DEG, 0, -10 * mir * DEG);
  kick.applyBone('RightForeArm', 0, 35 * mir * DEG, 0); kick.applyBone('LeftForeArm', 0, -35 * mir * DEG, 0);
  for (const s of ['Spine', 'Spine1', 'Spine2']) kick.applyBone(s, 7 * DEG, 0, 0); // forward lean
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
  // Place the PLANT (support) foot beside the ball: toes at the ball's front
  // edge, 20 cm to the side. Measure the support toe in body space at contact,
  // then solve for the shift (runtime world = local - rootOffset + align).
  const S = K === 'Right' ? 'Left' : 'Right';
  const supToe = bonesRef[`${S}ToeBase`] || bonesRef[`${S}Foot`] || foot;
  mocap.seek(mocapContactT);
  mocapModel.position.copy(mocapBase);
  mocapModel.updateMatrixWorld(true);
  const sp = supToe.getWorldPosition(new THREE.Vector3());
  const o = mocap.rootOffset(mocapContactT) || { x: 0, z: 0 };
  const sideX = (K === 'Right' ? 1 : -1) * 0.20; // plant foot to the player's plant side
  const frontZ = -BALL_RADIUS;                   // toes level with the ball's front edge
  mocapAlign = { x: sideX - sp.x + o.x, z: frontZ - sp.z + o.z };
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
      // Imported clip plays through directly: it is a seamless running loop with
      // the kick baked in, so its own approach strides are clean mocap (no
      // synthetic jog → no foot sliding, no seam). Procedural extra steps / the
      // angled approach need a dedicated run clip (see MOTION.md); paused for now.
      const rate = Math.max(0.05, params.speed);
      const segs = mocapStages();
      const warpLen = segs.reduce((a, s) => a + (s.t1 - s.t0) / s.sp, 0); // normalized
      const clipWall = warpLen * mocap.duration / rate;
      const period = params.delay + clipWall;
      mocapPlayT += dt;
      if (mocapPlayT >= period) { mocapPlayT -= period; resetBall(); }
      const w = mocapPlayT - params.delay;
      if (w < 0) {                               // delay: hold on the first frame
        params.scrub = 0;
        applyFrame(0);
      } else {                                   // play the clip through
        const wc = w * rate / mocap.duration;
        params.scrub = clipTimeFromWarp(wc, segs);
        applyFrame(params.scrub * CLIP_END);
        stepBall(dt);
      }
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
  if (envtl) envtl.update();
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
animate();
