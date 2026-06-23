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

const SECONDS_FULL = 2.4; // wall-clock seconds for the whole 0..CLIP_END clip
const GRAVITY = 9.81;

// Build stamp (injected by Vite) so the live page shows which build is loaded.
const buildEl = document.getElementById('build');
if (buildEl) buildEl.textContent = `build ${__BUILD__}`;

const { renderer, labelRenderer, scene, camera, controls } = createScene();
const { ball } = createField(scene);

let kick = null, annotations = null, editor = null, gizmo = null, timeline = null;
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
  editor = new PoseEditor({ bones, rest, boneNames: BONES, build: __BUILD__ });
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

  const gui = createPanel({
    onChange: () => { if (!params.playing) applyFrame(params.scrub * CLIP_END); },
    onReplay: () => { t = 0; resetBall(); params.playing = true; },
  });

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
      bones, rest, camera, controls, params, editor, kick, gizmo, scene,
      frame(s) { params.playing = false; params.scrub = s; applyFrame(s * CLIP_END); },
      view(px, py, pz, tx, ty, tz) {
        camera.position.set(px, py, pz); controls.target.set(tx, ty, tz); controls.update();
      },
    };
  }

  document.getElementById('loading').style.opacity = '0';
});

function applyFrame(tt) {
  // Pose source: editor (while authoring) or the authored clip (playback), else
  // the procedural kick.
  const useEditorPose = editor && (editor.enabled || (params.useClip && editor.keys.length));
  if (useEditorPose) {
    editor.applyAt(Math.min(Math.max(tt / CLIP_END, 0), 1));
  } else {
    kick.update(tt, params);
  }
  // Strike the ball as we cross contact (skipped while actively authoring).
  if (!editor.enabled) {
    if (!launched && tt >= CONTACT_T) launchBall();
    if (launched && tt < CONTACT_T) resetBall();
  }
  const phase = kick.phaseLabel(tt);
  annotations.update(phase, kick.computeLaunch(params), params);
}

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (kick) {
    if (params.playing) {
      t += dt * params.speed * (CLIP_END / SECONDS_FULL);
      if (t >= CLIP_END) { t = 0; resetBall(); }
      params.scrub = t / CLIP_END;
      applyFrame(t);
      stepBall(dt);
    } else {
      // paused: scrub controls the pose; ball follows up to contact only
      applyFrame(params.scrub * CLIP_END);
    }
  }

  if (gizmo) gizmo.update();
  if (timeline) timeline.update(params.scrub);
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
animate();
