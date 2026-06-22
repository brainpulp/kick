import GUI from 'lil-gui';
import { params, meta, FOOT_ZONES, BALL_ZONES, FOLLOW_VARIANTS, FOOTEDNESS } from '../kick/parameters.js';

// Build the slider/dropdown panel. `onChange` fires whenever a kick parameter
// changes so the caller can replay/refresh. `onReplay` is the Replay button.
export function createPanel({ onChange, onReplay }) {
  const gui = new GUI({ title: 'Kick parameters' });

  const change = () => onChange && onChange();

  const handles = gui.addFolder('Rig handles (MOTION.md §15)');
  const slider = (key) => {
    const m = meta[key];
    handles.add(params, key, m.min, m.max, m.step).name(`${m.label} ${m.unit}`.trim()).onChange(change);
  };
  slider('aimSupportDepth');
  slider('tilt');
  slider('hipTurn');
  slider('kneeAim');
  slider('lockAnkle');
  slider('whip');
  handles.add(params, 'footZone', FOOT_ZONES).name('Points: foot zone').onChange(change);
  handles.add(params, 'ballZone', BALL_ZONES).name('Points: ball zone').onChange(change);
  handles.add(params, 'followThrough', FOLLOW_VARIANTS).name('Follow-Through').onChange(change);
  handles.add(params, 'footedness', FOOTEDNESS).name('Footedness').onChange(change);

  const playback = gui.addFolder('Playback');
  playback.add(params, 'playing').name('Play (loop)');
  playback.add(params, 'speed', 0.1, 2, 0.1).name('Speed');
  playback.add(params, 'scrub', 0, 1, 0.001).name('Scrub (paused)').listen();
  playback.add({ replay: () => onReplay && onReplay() }, 'replay').name('▶ Replay');

  return gui;
}
