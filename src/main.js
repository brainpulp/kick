import * as THREE from 'three';
import { createScene } from './scene.js';
import { createField, BALL_RADIUS } from './field.js';
import { loadCharacter } from './character.js';
import { KickAnimation, CONTACT_T, CLIP_END } from './kick/animation.js';
import { createPanel } from './ui/panel.js';
import { PoseEditor, buildEditorGUI, attachGizmo, KEY_DEFS } from './ui/editor.js';
import { createTimeline } from './ui/timeline.js';
import { createEnvTimeline } from './ui/envtimeline.js';
import { createContactEditor } from './ui/contact.js';
import { createCheckpoints } from './ui/checkpoints.js';
import { createHandles } from './ui/handles.js';
import { FOOT_ZONES, BALL_ZONES, meta } from './kick/parameters.js';
import { Annotations } from './ui/annotations.js';
import { params, DEFAULTS } from './kick/parameters.js';
import { timings, env } from './kick/timing.js';
import { BONES } from './character.js';
import { loadExternalClip, retargetClip, MocapPlayer, applyOverrides } from './kick/mocap.js';
import { scenarioStore, snapshot, applyScenario } from './scenarios.js';
import { loadState, startAutosave } from './persist.js';
import { solveLeg, solveFoot, solveTrunkLean, solveHipYaw } from './kick/ik.js';

const SECONDS_FULL = 2.4; // wall-clock seconds for the whole 0..CLIP_END clip
const GRAVITY = 9.81;
const DEG = Math.PI / 180;

// Build stamp (injected by Vite) so the live page shows which build is loaded.
const buildEl = document.getElementById('build');
if (buildEl) buildEl.textContent = `build ${__BUILD__}`;

const { renderer, labelRenderer, scene, camera, controls } = createScene();
const { ball } = createField(scene);

let kick = null, annotations = null, editor = null, gizmo = null, timeline = null, envtl = null, contact = null, cptbl = null, handles = null;
let mocap = null, mocapModel = null, mocapAvailable = false, mocapBase = null;
let mocapAlign = { x: 0, z: 0 };  // shift so the strike foot meets the ball
let mocapPlantLock = { x: 0, z: 0 }; // plant-foot world spot (slippage lock)
let mocapPlantStart = 0.3;            // clip time the plant foot goes down
let mocapPlantLift = 0.72;            // clip time the plant foot lifts for the step-through
let mocapSlideEnd = { x: 0, z: 0 };   // the clip's total baked plant slide (vector)
let mocapBakedSlide = 0;              // |mocapSlideEnd| (m); the natural slide amount
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

// Predicted ball-flight line: simulates the launch (speed/elevation/azimuth/spin
// from computeLaunch) so editing aim params — follow-up direction, loft, spin —
// updates the path live, even while paused. Shown with the body axes.
const TRAJ_N = 64;
const trajGeom = new THREE.BufferGeometry();
trajGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAJ_N * 3), 3));
const trajLine = new THREE.Line(trajGeom, new THREE.LineBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85 }));
trajLine.frustumCulled = false;
scene.add(trajLine);
function updateTrajectory() {
  if (!kick) return;
  trajLine.visible = !!params.showAxes;
  if (!trajLine.visible) return;
  const L = kick.computeLaunch(params);
  const elev = L.elevation * DEG, az = L.azimuth * DEG, horiz = L.speed * Math.cos(elev);
  let vx = horiz * Math.sin(az), vy = L.speed * Math.sin(elev), vz = -horiz * Math.cos(az);
  let px = ballHome.x, py = ballHome.y, pz = ballHome.z;
  const pos = trajGeom.attributes.position; const dt = 0.035; let n = 0;
  for (let i = 0; i < TRAJ_N; i++) {
    pos.setXYZ(i, px, py, pz); n = i + 1;
    vy -= GRAVITY * dt; vx += L.spin * 3.0 * dt; px += vx * dt; py += vy * dt; pz += vz * dt;
    if (py <= BALL_RADIUS) { pos.setXYZ(n, px, BALL_RADIUS, pz); n += 1; break; }
  }
  pos.needsUpdate = true;
  trajGeom.setDrawRange(0, n);
}

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
  hadSave = loadState();      // restore saved parameter + timing adjustments
  startAutosave();            // and keep saving them across reloads
  const gui = createPanel({
    onChange: () => { if (!params.playing) applyFrame(params.scrub * CLIP_END); },
    onReplay: () => { t = 0; mocapPlayT = 0; resetBall(); params.playing = true; },
    // Editing a parameter pauses and jumps to the frame where that parameter
    // acts, so you see exactly the position you're editing.
    onParam: (key) => {
      const tt = paramMoment(key);
      if (tt == null) { if (!params.playing) applyFrame(params.scrub * CLIP_END); return; }
      params.playing = false;
      params.scrub = tt;
      applyFrame(tt * CLIP_END);
    },
  });
  function buildSourceCtrl() {
    if (sourceCtrl) sourceCtrl.destroy();
    sourceCtrl = gui.add(params, 'source', sourceOptions()).name('Animation source')
      .onChange(() => { if (!params.playing) applyFrame(params.scrub * CLIP_END); });
  }
  buildSourceCtrl();

  // Camera preset views (the model faces -Z, toward the goal; the ball is at
  // origin) — as on-screen buttons (top-left), outside the side panel.
  const setView = (px, py, pz, tx, ty, tz) => {
    camera.position.set(px, py, pz); controls.target.set(tx, ty, tz); controls.update();
  };
  contact = createContactEditor({
    scene, camera, controls, renderer, bones, params, ballRadius: BALL_RADIUS,
    onEnter: () => { params.playing = false; params.scrub = mocapContactT; applyFrame(mocapContactT * CLIP_END); },
    onChange: () => { if (!params.playing) applyFrame(params.scrub * CLIP_END); },
  });
  buildViewButtons(setView, () => contact.toggle());

  gui.add(params, 'rootMotion').name('Root motion (locomotion)')
    .onChange(() => { if (!params.playing) applyFrame(params.scrub * CLIP_END); });
  envtl = createEnvTimeline({
    onChange: () => { if (!params.playing) applyFrame(params.scrub * CLIP_END); },
    onScrub: (f) => { params.playing = false; params.scrub = f; applyFrame(f * CLIP_END); },
    getScrub: () => params.scrub,
    getContact: () => (mocapAvailable ? mocapContactT : null),
  });
  cptbl = createCheckpoints({
    params, meta, checkpoints: CHECKPOINTS, enums: { footZone: FOOT_ZONES, ballZone: BALL_ZONES },
    onEdit: (k, v) => { params[k] = v; gui.controllersRecursive().forEach((c) => c.updateDisplay()); if (!params.playing) applyFrame(params.scrub * CLIP_END); },
    onJump: (t) => { params.playing = false; params.scrub = t; applyFrame(t * CLIP_END); },
    measure: measureConstraint,
    getScrub: () => params.scrub,
    getContactT: () => (mocapAvailable ? mocapContactT : 0.375),
  });
  handles = createHandles({
    scene, camera, renderer, controls, params, meta,
    onEdit: (k, v) => { params[k] = v; gui.controllersRecursive().forEach((c) => c.updateDisplay()); if (!params.playing) applyFrame(params.scrub * CLIP_END); },
    getScrub: () => params.scrub,
    getContactT: () => (mocapAvailable ? mocapContactT : 0.375),
    isActive: () => mocapAvailable && !params.playing,
  });
  // Single consolidated timeline: the dopesheet is shown by default and the old
  // keyframe-editor bar stays hidden (authoring uses the editor directly).
  envtl.setVisible(true);
  gui.add({ timing: true }, 'timing').name('⏱ Timing editor').onChange((v) => envtl.setVisible(v));
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
  // Consolidated into the dopesheet timeline; keep the keyframe bar hidden.
  const kfBar = document.getElementById('timeline'); if (kfBar) kfBar.style.display = 'none';

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
      get contactT() { return mocapContactT; },
      measure: measureConstraint,
      view(px, py, pz, tx, ty, tz) {
        camera.position.set(px, py, pz); controls.target.set(tx, ty, tz); controls.update();
      },
    };
  }

  document.getElementById('loading').style.opacity = '0';
});

// The clip-time (0..1) where a given rig handle has its main visible effect, so
// editing it jumps the scrub there. null = leave the scrub where it is.
function paramMoment(key) {
  const c = mocapContactT;
  const mid = Math.min(0.99, (c + 1) / 2); // mid follow-through
  switch (key) {
    case 'recoil': return timings.recoil.peak;
    case 'whip': return timings.whip.peak;
    case 'torsoBend': return timings.torso.peak;
    case 'tilt': return timings.tilt.peak;
    case 'armSwing': return timings.arm.peak;
    case 'followDir': case 'slippage': return mid;
    case 'lockAnkle': case 'kneeAim': case 'hipTurn': case 'footZone': case 'ballZone': return c;
    case 'aimSupportDepth': case 'supportLateral': case 'supportPoint': return Math.max(0, c * 0.85); // the plant
    case 'runupAngle': case 'runupSteps': return Math.min(0.25, c * 0.5); // mid run-up
    default: return null; // footedness etc. — don't move the playhead
  }
}

// On-screen camera-view buttons (outside the side panel), top-left under the title.
function buildViewButtons(setView, onContact) {
  const css = `#views{position:fixed;left:12px;top:54px;display:flex;gap:6px;z-index:25}
    #views button{font:600 11px system-ui,sans-serif;color:#cfe;background:rgba(18,22,20,.8);
      border:1px solid #2c3a32;border-radius:6px;padding:5px 9px;cursor:pointer}
    #views button:hover{background:rgba(40,60,48,.95)}
    #views button.contact{border-color:#caa23f;color:#ffe9a8}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const wrap = document.createElement('div'); wrap.id = 'views';
  const defs = [
    ['Front', [0, 1.5, -5.5, 0, 0.9, 0]],
    ['Side', [5.5, 1.5, 0, 0, 0.9, 0]],
    ['Top', [0, 9, 0.01, 0, 0, 0]],
    ['3/4', [3.6, 1.8, 4.2, 0, 0.9, -0.3]],
  ];
  for (const [name, v] of defs) {
    const btn = document.createElement('button'); btn.textContent = name;
    btn.addEventListener('click', () => setView(...v));
    wrap.appendChild(btn);
  }
  const cb = document.createElement('button'); cb.textContent = '◎ Contact'; cb.className = 'contact';
  cb.addEventListener('click', () => { onContact && onContact(); cb.classList.toggle('active'); });
  wrap.appendChild(cb);
  document.body.appendChild(wrap);
}

function applyFrame(tt) {
  const tn = Math.min(Math.max(tt / CLIP_END, 0), 1);
  // While actively authoring, the editor always drives the rig.
  if (editor && editor.enabled) {
    editor.applyAt(tn);
  } else if (params.source === 'mocap' && mocapAvailable) {
    mocap.seek(tn);                       // baked clip...
    if (!params.rawClip) {
    applyOverrides(bonesRef, restRef, params); // ...+ live parameter overrides
    applyRecoil(tn);                      // cock-back (pre-contact)
    applyWhip(tn);                        // strike: femur+knee drive, pelvis un-wind
    applyArms(tn);                        // counter-arm swing
    applyFollowBody(tn);                   // follow-through: cross-over + shoulders turn to plant
    }
    // Root motion: model faces -Z (rotation.y = PI) so negate clip X/Z; align
    // shift makes the strike foot meet the ball.
    const o = params.rootMotion ? mocap.rootOffset(tn) : null;
    mocapModel.position.set(
      mocapBase.x - (o ? o.x : 0) + mocapAlign.x,
      mocapBase.y + (o ? Math.max(0, o.y) : 0),
      mocapBase.z - (o ? o.z : 0) + mocapAlign.z,
    );
    groundModel();
    if (!params.rawClip) {
    applyTilt(tn); // whole-body lean about the plant foot
    applyRunupAngle(tn); // angle the approach (rotate the run about the ball)
    applySlippage(tn);   // lock/scale the plant-foot forward slide (0 = no slide)
    applyConstraints(tn); // TECHNIQUE checkpoints: exact leg constraints — last
    applyGaze(tn);       // keep the head locked on the ball until landing
    }
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

// Slippage: SCALE the clip's baked plant-foot slide. The actor naturally slides
// the planted foot ~0.9 m forward through the follow-through; the slider sets how
// much of that happens (0 = foot pinned, default = the clip untouched, i.e. the
// natural slide). Below-natural values shift the whole ending back by the removed
// slide — a real "covered less ground" — with no release snap, since the offset
// persists once the foot lifts (it resets with the loop).
const _slPlant = new THREE.Vector3();
function applySlippage(tn) {
  if (tn < mocapPlantStart || !mocapBakedSlide) return;
  const k = (params.slippage ?? DEFAULTS.slippage) / (DEFAULTS.slippage || 1); // 1 = natural
  if (Math.abs(1 - k) < 0.02) return;
  let sx, sz; // the baked slide vector accumulated so far
  if (tn <= mocapPlantLift) {
    const S = params.footedness === 'right' ? 'Left' : 'Right'; // plant foot
    const plant = bonesRef[`${S}ToeBase`] || bonesRef[`${S}Foot`]; if (!plant) return;
    mocapModel.updateMatrixWorld(true);
    plant.getWorldPosition(_slPlant);
    sx = _slPlant.x - mocapPlantLock.x; sz = _slPlant.z - mocapPlantLock.z;
  } else { // foot is airborne (step-through): hold the final offset, no snap-back
    sx = mocapSlideEnd.x; sz = mocapSlideEnd.z;
  }
  mocapModel.position.x -= (1 - k) * sx;
  mocapModel.position.z -= (1 - k) * sz;
}

// ---- TECHNIQUE checkpoints, Phase 1 (see TECHNIQUE.md): exact leg constraints.
// Sliders are ABSOLUTE ball-relative measurements, enforced by IK every frame —
// not nudges on the clip. Natural values are measured from the clip at
// calibration and become the defaults, so the untouched state still looks like
// the real kick while every number is now exact and independently adjustable.
let plantNat = null;   // measured natural plant: { toeY }
let hadSave = false;   // did a saved parameter set exist (skip default seeding)
const _ctToe = new THREE.Vector3(), _ctAnk = new THREE.Vector3();
const _ctTarget = new THREE.Vector3(), _ctPole = new THREE.Vector3();

// Plant-foot hold: from the plant landing through just past contact. After that
// the clip's slide / step-through takes over (slippage governs the slide).
function plantEnv(tn) {
  const a = 0.26, c = mocapContactT;
  if (tn < a || tn > c + 0.10) return 0;
  if (tn < a + 0.08) return _smooth((tn - a) / 0.08);
  if (tn > c + 0.04) return 1 - _smooth((tn - (c + 0.04)) / 0.06);
  return 1;
}
// Strike-leg constraints peak EXACTLY at contact and blend around it — a
// triangle, not a hold: knee plumb / ankle lock are contact-instant teaching
// measurements, and holding them over a window would brake the natural whip.
function strikeEnv(tn) {
  const c = mocapContactT, w = 0.045;
  if (tn < c - w || tn > c + w) return 0;
  return _smooth(1 - Math.abs(tn - c) / w);
}
// Knee-plumb enforcement is a BODY shift (see applyConstraints). The exact
// shift is solved iteratively at the peak frame and cached (with its gain) so
// the ramp frames feather the same shift instead of chasing a fixed plumb
// through the swing (which would drag the pelvis unnaturally).
let kneeNatZ = 0;      // the clip's natural knee plumb z at contact (m)
let kneeGain = 2.0;    // solved body-shift per metre of requested deviation
let trunkNat = 0;      // clip's natural forward trunk lean at contact (deg)
let hipNatDeg = 0;     // clip's natural pelvis (hip-line) yaw at contact (deg)

// Trunk/hip constraints: a fold that ramps in over the strike and recovers
// through the early follow-through — peaks at contact (the taught moment).
function trunkEnv(tn) {
  const c = mocapContactT;
  if (tn < c - 0.12 || tn > c + 0.18) return 0;
  if (tn < c) return _smooth((tn - (c - 0.12)) / 0.12);
  return 1 - _smooth((tn - c) / 0.18);
}

// The teaching checkpoints (TECHNIQUE.md) and which exact constraints each owns.
// tAt(c) resolves the moment from the calibrated contact time c.
const CHECKPOINTS = [
  { key: 'approach', label: '1 · Approach', tAt: () => 0.15, fields: ['runupAngle'] },
  { key: 'plant', label: '2 · Plant', tAt: (c) => 0.80 * c, fields: ['aimSupportDepth', 'supportLateral', 'supportPoint'] },
  { key: 'backswing', label: '3 · Backswing top', tAt: (c) => Math.max(0, c - 0.04), fields: ['recoil'] },
  { key: 'contact', label: '4 · Contact', tAt: (c) => c, fields: ['hipTurn', 'torsoBend', 'kneeAim', 'lockAnkle', 'tilt', 'whip', 'footZone', 'ballZone'] },
  { key: 'follow', label: '5 · Follow-through', tAt: (c) => Math.min(1, c + 0.18), fields: ['followDir'] },
  { key: 'landing', label: '6 · Landing', tAt: (c) => Math.min(1, c + 0.34), fields: ['slippage'] },
];

// Live measurement of a constraint's ACHIEVED value at the current posed frame —
// the teaching HUD's "actual" column (proves the number is enforced, not nominal).
// Returns null for non-geometric params (enums, dynamics). Reads world positions,
// so call after the frame is posed.
function measureConstraint(key) {
  if (!bonesRef || !mocapModel) return null;
  mocapModel.updateMatrixWorld(true);
  const mir = params.footedness === 'right' ? 1 : -1;
  const K = params.footedness === 'right' ? 'Right' : 'Left';
  const S = K === 'Right' ? 'Left' : 'Right';
  const g = (n) => { const b = bonesRef[n]; return b ? b.getWorldPosition(new THREE.Vector3()) : null; };
  switch (key) {
    case 'aimSupportDepth': { const t = g(`${S}ToeBase`); return t ? t.z * 100 : null; }
    case 'supportLateral': { const t = g(`${S}ToeBase`); return t ? -mir * t.x * 100 : null; }
    case 'supportPoint': { const a = g(`${S}Foot`), t = g(`${S}ToeBase`); return (a && t) ? Math.atan2(t.x - a.x, -(t.z - a.z)) / DEG * mir : null; }
    case 'lockAnkle': { const a = g(`${K}Foot`), t = g(`${K}ToeBase`); return (a && t) ? Math.atan2(-(t.y - a.y), Math.hypot(t.x - a.x, t.z - a.z)) / DEG : null; }
    case 'kneeAim': { const k = g(`${K}Leg`); return k ? -k.z * 100 : null; }
    case 'hipTurn': { const l = g('LeftUpLeg'), r = g('RightUpLeg'); return (l && r) ? Math.atan2(-(r.z - l.z) * mir, (r.x - l.x) * mir) / DEG : null; }
    case 'torsoBend': { const h = g('Hips'), n = g('Neck'); return (h && n) ? Math.atan2(-(n.z - h.z), n.y - h.y) / DEG : null; }
    default: return null;
  }
}

function applyConstraints(tn) {
  if (!plantNat || !bonesRef) return;
  const mir = params.footedness === 'right' ? 1 : -1;
  const K = params.footedness === 'right' ? 'Right' : 'Left';
  const S = K === 'Right' ? 'Left' : 'Right';
  mocapModel.updateMatrixWorld(true);

  // Trunk + pelvis, before the legs (hip yaw counter-rotates the thighs to keep
  // the feet put; the leg IK then fine-tunes). Absolute angles, peaking at contact.
  const wT = trunkEnv(tn);
  if (wT > 0.001) {
    // Hip yaw FIRST — it rotates the pelvis (and with it the whole spine), so the
    // trunk lean is solved AFTER, on the already-yawed spine, and stays exact.
    const upLegs = [bonesRef.LeftUpLeg, bonesRef.RightUpLeg].filter(Boolean);
    if (bonesRef.Hips && bonesRef.LeftUpLeg && bonesRef.RightUpLeg) {
      solveHipYaw({ model: mocapModel, hips: bonesRef.Hips, upLegs, leftHip: bonesRef.LeftUpLeg, rightHip: bonesRef.RightUpLeg, yawDeg: params.hipTurn ?? hipNatDeg, mir, weight: wT });
    }
    const spine = ['Spine', 'Spine1', 'Spine2'].map((n) => { const b = bonesRef[n]; if (b) b.w = 1; return b; }).filter(Boolean);
    if (spine.length && bonesRef.Neck) {
      solveTrunkLean({ model: mocapModel, hips: bonesRef.Hips, chain: spine, tip: bonesRef.Neck, pitchDeg: params.torsoBend ?? trunkNat, weight: wT });
    }
  }

  // Strike leg at contact — FIRST, because knee plumb is a BODY constraint:
  // with the ankle anchored on the ball, "knee over/behind the ball" is decided
  // by where the pelvis is, so we shift the model fore/aft until the knee plumb
  // lands at kneeAim, re-solving the ankle back onto the ball each step.
  const wK = strikeEnv(tn);
  const hipK = bonesRef[`${K}UpLeg`], kneeK = bonesRef[`${K}Leg`], ankK = bonesRef[`${K}Foot`], toeK = bonesRef[`${K}ToeBase`];
  if (wK > 0.001 && hipK && kneeK && ankK) {
    const desiredZ = -(params.kneeAim || 0) / 100;   // + ahead of the ball = -Z
    const dev = desiredZ - kneeNatZ;                 // requested deviation from the clip
    if (Math.abs(dev) > 0.002) {
      ankK.getWorldPosition(_ctAnk);                 // the ball-anchored ankle path (fixed)
      if (wK > 0.995) {                              // peak frame: solve exactly, learn the gain
        let total = 0;
        for (let it = 0; it < 4; it++) {
          kneeK.getWorldPosition(_ctPole);
          const err = desiredZ - _ctPole.z;
          if (Math.abs(err) < 0.003) break;
          mocapModel.position.z += err; total += err;
          mocapModel.updateMatrixWorld(true);
          solveLeg({ model: mocapModel, hip: hipK, knee: kneeK, ankle: ankK, target: _ctTarget.copy(_ctAnk), weight: 1 });
        }
        if (Math.abs(dev) > 0.01) kneeGain = total / dev;
      } else {                                       // ramp frames: feather the solved shift
        mocapModel.position.z += kneeGain * dev * wK;
        mocapModel.updateMatrixWorld(true);
        solveLeg({ model: mocapModel, hip: hipK, knee: kneeK, ankle: ankK, target: _ctTarget.copy(_ctAnk), weight: 1 });
      }
    }
    solveFoot({ model: mocapModel, foot: ankK, toe: toeK, pitchDeg: params.lockAnkle ?? 25, weight: wK });
  }

  // Plant (support) leg AFTER the body shift: toe held at the exact
  // ball-relative point; foot yaw absolute (0° = pointing at the goal).
  const wP = plantEnv(tn);
  const hipS = bonesRef[`${S}UpLeg`], kneeS = bonesRef[`${S}Leg`], ankS = bonesRef[`${S}Foot`], toeS = bonesRef[`${S}ToeBase`];
  if (wP > 0.001 && hipS && kneeS && ankS && toeS) {
    const depth = (params.aimSupportDepth ?? 20) / 100;  // + = behind the ball (+Z)
    const lat = (params.supportLateral ?? 12) / 100;     // + = toward the plant side
    for (let it = 0; it < 2; it++) {
      toeS.getWorldPosition(_ctToe); ankS.getWorldPosition(_ctAnk);
      _ctTarget.set(
        -mir * lat - (_ctToe.x - _ctAnk.x),
        plantNat.toeY - (_ctToe.y - _ctAnk.y),
        depth - (_ctToe.z - _ctAnk.z),
      );
      solveLeg({ model: mocapModel, hip: hipS, knee: kneeS, ankle: ankS, target: _ctTarget, weight: wP });
      solveFoot({ model: mocapModel, foot: ankS, toe: toeS, yawDeg: (params.supportPoint || 0) * mir, weight: wP });
    }
  }
}

// Lock gaze: the head stays aimed at the ball from the run-up through landing,
// then releases toward the goal. The head's "face" axis is solved once as a fixed
// LOCAL axis (rigid to the head bone) so the look-at converges exactly.
const _gzHead = new THREE.Vector3(), _gzNeck = new THREE.Vector3(), _gzLA = new THREE.Vector3(), _gzRA = new THREE.Vector3();
const _gzFace = new THREE.Vector3(), _gzDes = new THREE.Vector3(), _gzUp = new THREE.Vector3(), _gzLat = new THREE.Vector3();
const _gzQ = new THREE.Quaternion(), _gzPQ = new THREE.Quaternion(), _gzCorr = new THREE.Quaternion(), _gzId = new THREE.Quaternion();
const _gzHeadQ = new THREE.Quaternion();
const _gzBall = new THREE.Vector3(0, BALL_RADIUS, 0);
let _gzLocalFace = null; // face direction in the head bone's local frame (cached)
function gazeEnv(scrubN) {
  if (scrubN < 0.90) return 1;            // locked on the ball through landing
  return 1 - _smooth((scrubN - 0.90) / 0.10); // release toward the goal after landing
}
function applyGaze(scrubN) {
  if (!params.lockGaze) return; // off by default → the clip's own natural head motion
  const e = gazeEnv(scrubN);
  if (e < 0.01) return;
  const head = bonesRef.Head, neck = bonesRef.Neck; if (!head) return;
  mocapModel.updateMatrixWorld(true);
  head.getWorldPosition(_gzHead);
  head.getWorldQuaternion(_gzHeadQ);
  if (!_gzLocalFace) {
    // Solve the head's face axis once from an anatomical estimate (up × shoulders).
    _gzUp.copy(neck ? _gzHead.clone().sub(neck.getWorldPosition(_gzNeck)) : new THREE.Vector3(0, 1, 0)).normalize();
    if (bonesRef.LeftArm && bonesRef.RightArm) _gzLat.copy(bonesRef.LeftArm.getWorldPosition(_gzLA)).sub(bonesRef.RightArm.getWorldPosition(_gzRA)).setY(0).normalize();
    else _gzLat.set(1, 0, 0);
    const f = _gzUp.clone().cross(_gzLat).normalize(); if (f.z > 0) f.negate();
    _gzLocalFace = f.applyQuaternion(_gzHeadQ.clone().invert()).normalize(); // → local
  }
  _gzFace.copy(_gzLocalFace).applyQuaternion(_gzHeadQ).normalize(); // rigid current facing
  _gzDes.copy(_gzBall).sub(_gzHead).normalize();                    // head → ball
  _gzQ.setFromUnitVectors(_gzFace, _gzDes);
  _gzQ.copy(_gzId).slerp(_gzQ, e);                                  // blend by gaze envelope
  head.parent.getWorldQuaternion(_gzPQ);
  _gzCorr.copy(_gzPQ).invert().multiply(_gzQ).multiply(_gzPQ);
  head.quaternion.premultiply(_gzCorr);
}

// Angle the run-up: rotate the whole (clean mocap) approach about the ball so the
// player comes in diagonally from the plant side, then squares up to the goal by
// contact. Constant angle through most of the run (no skate — just a rotated
// frame), turning to 0 over the last stretch before the plant.
const _ruQuat = new THREE.Quaternion();
const _ruAxis = new THREE.Vector3(0, 1, 0);
const _ruPivot = new THREE.Vector3();
function applyRunupAngle(tn) {
  const deg = params.runupAngle || 0;
  const c = mocapContactT;
  if (deg < 0.5 || tn >= c) return;          // squared up by contact
  const tTurn = 0.7 * c;
  const a = tn <= tTurn ? deg : deg * (1 - _smooth((tn - tTurn) / Math.max(1e-3, c - tTurn)));
  if (a < 0.05) return;
  const mir = params.footedness === 'right' ? 1 : -1; // approach from the plant side
  _ruPivot.set(0, 0, 0);                      // pivot at the ball (contact point)
  _ruQuat.setFromAxisAngle(_ruAxis, -mir * a * DEG); // right-footer comes from the left
  mocapModel.position.sub(_ruPivot).applyQuaternion(_ruQuat).add(_ruPivot);
  mocapModel.quaternion.premultiply(_ruQuat);
}

function followEnvelope(scrubN) { return env(scrubN, timings.follow); }

// Follow-up BODY: an EXAGGERATED follow-through layered on the clip's natural one —
// after contact the whole body keeps turning toward the planting foot (shoulders/hips
// continue to rotate) and the kicking leg swings up and ACROSS the midline, crossing
// over the plant foot. Coupled to Hip Turn (as Maxi specified: follow-up couples to
// hip rotation): at the neutral hip turn (38°) it contributes nothing, so the base is
// the clip's own natural follow-through; more hip turn → more cross-over. Ramped by
// the follow envelope. The player stays rooted (upper-body/leg crossing, no step).
const _fbQuat = new THREE.Quaternion();
const _fbEuler = new THREE.Euler();
function applyFollowBody(scrubN) {
  const k = Math.max(0, (params.hipTurn - hipNatDeg)) / Math.max(8, 60 - hipNatDeg); // 0 at natural → grows with extra hip opening
  const amt = k * followEnvelope(scrubN);
  if (amt < 0.01) return;
  const mir = params.footedness === 'right' ? 1 : -1;
  const K = params.footedness === 'right' ? 'Right' : 'Left';
  const add = (name, x, y, z) => {
    const b = bonesRef[name]; if (!b) return;
    _fbEuler.set(x * DEG, y * DEG, z * DEG, 'XYZ');
    b.quaternion.multiply(_fbQuat.setFromEuler(_fbEuler));
  };
  // Continue the un-wind toward the plant foot (same sense as the whip's pelvis
  // un-wind), carrying the shoulders round — "shoulder axis keeps rotating".
  add('Hips', 0, -amt * 22 * mir, 0);
  add('Spine1', 0, -amt * 12 * mir, 0);
  add('Spine2', 0, -amt * 12 * mir, 0);
  // Kicking leg swings up and across the midline (cross-over over the plant foot):
  // continued hip flexion + adduction swing toward the plant side.
  add(`${K}UpLeg`, amt * 18, -amt * 28 * mir, 0);
  add(`${K}Leg`, -amt * 10, 0, 0); // knee softens as the leg comes down to land
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
  add(`${K}UpLeg`, -deg * 1.3, 0, 0);     // kicking femur pulls strongly back (hip extension)
  add(`${K}Leg`, -deg * 1.0, 0, 0);       // knee flexes (cocks the lower leg)
  add('Spine', -deg * 0.12, 0, 0);        // trunk arches back a little with the cock
  add('Spine1', -deg * 0.1, 0, 0);
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

// (Trunk lean is now an ABSOLUTE spine solve in applyConstraints — see ik.js.)

// Counter arm (opposite the kicking leg). Driven off the REST pose and blended
// in by `armSwing` — NOT added to the baked swing — so the motion is clean and
// predictable. Held forward & up during the run-up, then swings back & up from
// the end of the recoil (counter to the leg driving through).
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
  const p = env(scrubN, timings.arm); // 0 = forward&up (run-up) → 1 = back&up (after recoil)
  const S = params.footedness === 'right' ? 'Left' : 'Right'; // arm opposite the kicking leg
  const sgn = S === 'Left' ? -1 : 1;                          // abduction sign for that side
  poseArm(`${S}Arm`, 40 - 65 * p, sgn * (55 + 15 * p), amt);  // forward&up → back&up
  poseArm(`${S}ForeArm`, 20 + 15 * p, 0, amt);                // slight elbow flex
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
  const foot = bonesRef[`${K}Foot`] || bonesRef[`${K}ToeBase`]; // instep = strike surface
  if (!foot) return;
  const N = 120, fl = [];
  const wp = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const tn = i / N;
    mocap.seek(tn);
    mocapModel.position.copy(mocapBase);          // body space, no root
    mocapModel.updateMatrixWorld(true);
    foot.getWorldPosition(wp);
    fl.push({ tn, x: wp.x, y: wp.y, z: wp.z });
  }
  // Contact = fastest forward foot motion within the strike window (before the
  // follow-through strides), i.e. the moment the foot drives through the ball.
  let best = null;
  for (let i = 1; i <= N; i++) {
    if (fl[i].tn < 0.30 || fl[i].tn > 0.55) continue;
    const dz = fl[i].z - fl[i - 1].z;            // forward is -Z
    if (!best || dz < best.dz) best = { i, dz, tn: fl[i].tn };
  }
  const ci = best ? best.i : Math.round(N * 0.37);
  mocapContactT = fl[ci].tn;
  // Anchor the KICKING foot to the ball (origin) at contact so the foot actually
  // strikes it. The plant foot then lands wherever the clip places it — a
  // realistic plant-to-ball offset that comes straight from the mocap.
  const o = mocap.rootOffset(mocapContactT) || { x: 0, z: 0 };
  // Anchor slightly BEHIND the ball: the ankle sits back so the instep (mid-boot)
  // meets the ball's rear surface instead of the ankle passing through its centre.
  // A little residual overlap at the exact contact frame is right — a real strike
  // compresses the ball.
  const STRIKE_ANCHOR_Z = 0.06;
  mocapAlign = { x: o.x - fl[ci].x, z: o.z - fl[ci].z + STRIKE_ANCHOR_Z };
  // Plant (support) foot world position at contact, in the RUNTIME frame — the
  // "locked" spot the foot should hold — captured at the PLANT moment (before
  // contact) so the foot doesn't slip in the lead-up to the strike; held through
  // contact, then slippage takes over after it.
  const S = K === 'Right' ? 'Left' : 'Right';
  const plant = bonesRef[`${S}ToeBase`] || bonesRef[`${S}Foot`];
  mocapPlantStart = 0.80 * mocapContactT; // ~ when the plant foot is down
  const op = mocap.rootOffset(mocapPlantStart) || { x: 0, z: 0 };
  mocap.seek(mocapPlantStart);
  mocapModel.position.set(mocapBase.x - op.x + mocapAlign.x, mocapBase.y, mocapBase.z - op.z + mocapAlign.z);
  mocapModel.updateMatrixWorld(true);
  const pl = plant ? plant.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
  mocapPlantLock = { x: pl.x, z: pl.z };
  // Measure the clip's BAKED plant-foot slide: the actor slides the plant foot
  // forward through the follow-through (≈0.9 m in this clip) before lifting it
  // for the step-through. The slippage slider SCALES this natural slide, so at
  // the default the clip plays untouched. Track the plant toe from contact until
  // it rises clear of the ground.
  // (Calibration frames are NOT ground-corrected, so all heights below are taken
  // relative to the frame's own lowest foot bone — the same reference
  // groundModel uses at runtime.)
  const _fmy = new THREE.Vector3();
  const frameMinY = () => {
    let m = Infinity;
    for (const n of ['LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot']) {
      const b = bonesRef[n]; if (!b) continue;
      b.getWorldPosition(_fmy); if (_fmy.y < m) m = _fmy.y;
    }
    return m === Infinity ? 0 : m;
  };
  const plantRelY = pl.y - frameMinY(); // plant-toe height above the sole plane
  if (plant) {
    const wp2 = new THREE.Vector3();
    let last = null;
    for (let tn = mocapContactT; tn <= 0.95; tn += 0.01) {
      const ro = mocap.rootOffset(tn) || { x: 0, z: 0 };
      mocap.seek(tn);
      mocapModel.position.set(mocapBase.x - ro.x + mocapAlign.x, mocapBase.y, mocapBase.z - ro.z + mocapAlign.z);
      mocapModel.updateMatrixWorld(true);
      plant.getWorldPosition(wp2);
      mocapPlantLift = tn;
      if (wp2.y - frameMinY() > plantRelY + 0.06) break;
      last = { x: wp2.x, z: wp2.z };
    }
    if (last) {
      mocapSlideEnd = { x: last.x - mocapPlantLock.x, z: last.z - mocapPlantLock.z };
      mocapBakedSlide = Math.hypot(mocapSlideEnd.x, mocapSlideEnd.z);
    }
  }
  // Measure the clip's natural checkpoint values and seed them as the defaults
  // (fresh sessions only) — so the untouched state IS the natural kick, but every
  // number is now an exact, enforced, ball-relative measurement (TECHNIQUE.md).
  plantNat = { toeY: plantRelY + 0.02 }; // grounded height (groundModel rests soles at 0.02)
  {
    const mir2 = K === 'Right' ? 1 : -1;
    const ankS = bonesRef[`${S}Foot`];
    mocap.seek(mocapPlantStart);
    const op2 = mocap.rootOffset(mocapPlantStart) || { x: 0, z: 0 };
    mocapModel.position.set(mocapBase.x - op2.x + mocapAlign.x, mocapBase.y, mocapBase.z - op2.z + mocapAlign.z);
    mocapModel.updateMatrixWorld(true);
    const pa = ankS ? ankS.getWorldPosition(new THREE.Vector3()) : pl;
    const yawNat = Math.atan2(pl.x - pa.x, -(pl.z - pa.z)) / DEG * mir2; // 0 = at the goal
    const oc = mocap.rootOffset(mocapContactT) || { x: 0, z: 0 };
    mocap.seek(mocapContactT);
    mocapModel.position.set(mocapBase.x - oc.x + mocapAlign.x, mocapBase.y, mocapBase.z - oc.z + mocapAlign.z);
    mocapModel.updateMatrixWorld(true);
    const ankK = bonesRef[`${K}Foot`], toeK = bonesRef[`${K}ToeBase`], kneeK2 = bonesRef[`${K}Leg`];
    let pitchNat = 25, kneeNat = 0;
    if (ankK && toeK) {
      const a2 = ankK.getWorldPosition(new THREE.Vector3()), t2 = toeK.getWorldPosition(new THREE.Vector3());
      pitchNat = Math.atan2(-(t2.y - a2.y), Math.hypot(t2.x - a2.x, t2.z - a2.z)) / DEG;
    }
    if (kneeK2) kneeNat = -kneeK2.getWorldPosition(new THREE.Vector3()).z * 100; // + = ahead of the ball
    kneeNatZ = -kneeNat / 100; // world-z of the natural knee plumb at contact
    // Trunk forward lean + pelvis (hip-line) yaw at contact — from the raw pose.
    const hipsB = bonesRef.Hips, neckB = bonesRef.Neck, luB = bonesRef.LeftUpLeg, ruB = bonesRef.RightUpLeg;
    if (hipsB && neckB) {
      const h = hipsB.getWorldPosition(new THREE.Vector3()), nk = neckB.getWorldPosition(new THREE.Vector3());
      trunkNat = Math.atan2(-(nk.z - h.z), nk.y - h.y) / DEG;
    }
    if (luB && ruB) {
      const lu = luB.getWorldPosition(new THREE.Vector3()), ru = ruB.getWorldPosition(new THREE.Vector3());
      hipNatDeg = Math.atan2(-(ru.z - lu.z) * mir2, (ru.x - lu.x) * mir2) / DEG;
    }
    if (!hadSave) {
      const seed = {
        aimSupportDepth: Math.round(pl.z * 100),
        supportLateral: Math.round(-mir2 * pl.x * 100),
        supportPoint: Math.round(yawNat),
        lockAnkle: Math.round(pitchNat),
        kneeAim: Math.round(Math.min(10, Math.max(-20, kneeNat))),
        torsoBend: Math.round(trunkNat),
        hipTurn: Math.round(hipNatDeg),
      };
      Object.assign(params, seed);
      Object.assign(DEFAULTS, seed);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`[mocap] contactT=${mocapContactT.toFixed(3)} align=(${mocapAlign.x.toFixed(2)},${mocapAlign.z.toFixed(2)}) plantLock=(${mocapPlantLock.x.toFixed(2)},${mocapPlantLock.z.toFixed(2)}) bakedSlide=${mocapBakedSlide.toFixed(2)}m lift=${mocapPlantLift.toFixed(2)} natural: depth=${params.aimSupportDepth}cm lat=${params.supportLateral}cm yaw=${params.supportPoint}° lock=${params.lockAnkle}° kneeAim=${params.kneeAim}cm trunk=${params.torsoBend}° hip=${params.hipTurn}°`);
}

// Loop-wrap fade: the clip ends ~3.7 m downfield, so the reset back to the start
// is a hard teleport. Fade the player out over the last beat and back in at the
// start of the next loop so the jump happens while he's invisible.
const FADE_S = 0.22;
let fadeMats = null;
function setModelFade(f) {
  if (!mocapModel) return;
  if (!fadeMats) {
    fadeMats = [];
    mocapModel.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) fadeMats.push(m);
    });
  }
  const solid = f >= 0.999;
  for (const m of fadeMats) {
    m.transparent = !solid;
    m.opacity = solid ? 1 : f;
    m.depthWrite = true;
  }
}

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (kick) {
    if (!params.playing) {
      setModelFade(1);
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
      // Fade in at the top of the loop, out at the very end (covers the reset).
      setModelFade(Math.min(mocapPlayT / FADE_S, Math.max(0, (period - mocapPlayT) / FADE_S), 1));
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
  if (cptbl) cptbl.update();
  if (handles) handles.update(bonesRef);
  if (contact) contact.update();
  updateTrajectory();
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
animate();
