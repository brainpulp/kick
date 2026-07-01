import GUI from 'lil-gui';
import { params, meta, DEFAULTS, FOOT_ZONES, BALL_ZONES, FOOTEDNESS } from '../kick/parameters.js';

// Build the slider/dropdown panel. `onChange` fires whenever a kick parameter
// changes so the caller can replay/refresh. `onReplay` is the Replay button.
export function createPanel({ onChange, onReplay, onParam }) {
  const gui = new GUI({ title: 'Kick parameters' });

  // A parameter edit: refresh the pose AND jump the scrub to the moment that
  // parameter acts, so you see exactly the frame you're editing.
  const edited = (key) => { if (onParam) onParam(key); else if (onChange) onChange(); };

  const handles = gui.addFolder('Rig handles (by stage)');

  // Add a control to a folder plus a small "↺" reset-to-default button.
  const withReset = (f, ctrl, key) => {
    ctrl.onChange(() => edited(key));
    f.add({ reset: () => { params[key] = DEFAULTS[key]; ctrl.updateDisplay(); edited(key); } }, 'reset')
      .name(`↺ reset ${typeof DEFAULTS[key] === 'number' ? DEFAULTS[key] : ''}`.trim());
    return ctrl;
  };
  const slider = (f, key) => {
    const m = meta[key];
    withReset(f, f.add(params, key, m.min, m.max, m.step).name(`${m.label} ${m.unit}`.trim()), key);
  };
  // Stage groups (chronological).
  const fRun = handles.addFolder('Run-up');
  slider(fRun, 'runupAngle'); slider(fRun, 'runupSteps');
  const fPlant = handles.addFolder('Plant / support foot');
  slider(fPlant, 'aimSupportDepth'); slider(fPlant, 'supportLateral'); slider(fPlant, 'supportPoint');
  const fLean = handles.addFolder('Body lean (sustained)');
  slider(fLean, 'tilt');
  const fRecoil = handles.addFolder('Recoil');
  slider(fRecoil, 'recoil');
  const fKick = handles.addFolder('Kick (strike)');
  slider(fKick, 'hipTurn'); slider(fKick, 'kneeAim'); slider(fKick, 'lockAnkle');
  slider(fKick, 'whip'); slider(fKick, 'torsoBend'); slider(fKick, 'armSwing');
  const fContact = handles.addFolder('Contact');
  withReset(fContact, fContact.add(params, 'footZone', FOOT_ZONES).name('Foot zone'), 'footZone');
  withReset(fContact, fContact.add(params, 'ballZone', BALL_ZONES).name('Ball zone'), 'ballZone');
  const fFollow = handles.addFolder('Follow-up');
  slider(fFollow, 'followDir'); slider(fFollow, 'slippage');
  fKick.add(params, 'lockGaze').name('Lock gaze on ball').onChange(() => edited('lockGaze'));
  withReset(handles, handles.add(params, 'footedness', FOOTEDNESS).name('Footedness'), 'footedness');

  // Reset every rig handle at once.
  handles.add({
    resetAll: () => {
      for (const k of ['runupAngle', 'runupSteps', 'aimSupportDepth', 'supportLateral', 'supportPoint', 'tilt', 'hipTurn', 'kneeAim', 'lockAnkle', 'recoil', 'torsoBend', 'armSwing', 'whip', 'followDir', 'slippage', 'footZone', 'ballZone', 'footedness']) {
        params[k] = DEFAULTS[k];
      }
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      onChange && onChange();
    },
  }, 'resetAll').name('↺↺ Reset all rig handles');

  const playback = gui.addFolder('Playback');
  playback.add(params, 'playing').name('Play (loop)');
  playback.add(params, 'speed', 0.1, 2, 0.1).name('Speed');
  playback.add(params, 'scrub', 0, 1, 0.001).name('Scrub (paused)').listen();
  playback.add({ replay: () => onReplay && onReplay() }, 'replay').name('▶ Replay');

  return gui;
}
