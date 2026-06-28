import GUI from 'lil-gui';
import { params, meta, DEFAULTS, FOOT_ZONES, BALL_ZONES, FOLLOW_VARIANTS, FOOTEDNESS } from '../kick/parameters.js';

// Build the slider/dropdown panel. `onChange` fires whenever a kick parameter
// changes so the caller can replay/refresh. `onReplay` is the Replay button.
export function createPanel({ onChange, onReplay }) {
  const gui = new GUI({ title: 'Kick parameters' });

  const change = () => onChange && onChange();

  const handles = gui.addFolder('Rig handles (MOTION.md §15)');

  // Add a control plus a small "↺" reset-to-default button on its own line.
  const withReset = (ctrl, key) => {
    ctrl.onChange(change);
    handles.add({ reset: () => { params[key] = DEFAULTS[key]; ctrl.updateDisplay(); change(); } }, 'reset')
      .name(`↺ reset ${typeof DEFAULTS[key] === 'number' ? DEFAULTS[key] : ''}`.trim());
    return ctrl;
  };
  const slider = (key) => {
    const m = meta[key];
    withReset(handles.add(params, key, m.min, m.max, m.step).name(`${m.label} ${m.unit}`.trim()), key);
  };
  slider('aimSupportDepth');
  slider('tilt');
  slider('hipTurn');
  slider('kneeAim');
  slider('lockAnkle');
  slider('whip');
  slider('followUp');
  withReset(handles.add(params, 'footZone', FOOT_ZONES).name('Points: foot zone'), 'footZone');
  withReset(handles.add(params, 'ballZone', BALL_ZONES).name('Points: ball zone'), 'ballZone');
  withReset(handles.add(params, 'followThrough', FOLLOW_VARIANTS).name('Follow-Through'), 'followThrough');
  withReset(handles.add(params, 'footedness', FOOTEDNESS).name('Footedness'), 'footedness');

  // Reset every rig handle at once.
  handles.add({
    resetAll: () => {
      for (const k of ['aimSupportDepth', 'tilt', 'hipTurn', 'kneeAim', 'lockAnkle', 'whip', 'followUp', 'footZone', 'ballZone', 'followThrough', 'footedness']) {
        params[k] = DEFAULTS[k];
      }
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      change();
    },
  }, 'resetAll').name('↺↺ Reset all rig handles');

  const playback = gui.addFolder('Playback');
  playback.add(params, 'playing').name('Play (loop)');
  playback.add(params, 'speed', 0.1, 2, 0.1).name('Speed');
  playback.add(params, 'scrub', 0, 1, 0.001).name('Scrub (paused)').listen();
  playback.add({ replay: () => onReplay && onReplay() }, 'replay').name('▶ Replay');

  return gui;
}
