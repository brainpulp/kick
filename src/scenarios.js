// Scenarios = named configurations of every control. Persisted locally for now;
// the store is a small async interface so it can be swapped for Supabase later
// (e.g. a `scenarios` table keyed by name) without touching the UI.
import { params } from './kick/parameters.js';

const STORE = 'kick.scenarios.v1';

// The full set of control fields a scenario captures.
export const SCENARIO_FIELDS = [
  'aimSupportDepth', 'supportLateral', 'supportPoint', 'tilt', 'hipTurn', 'kneeAim', 'lockAnkle', 'recoil', 'torsoBend', 'armSwing', 'whip', 'followDir', 'followStrength', 'slippage',
  'footZone', 'ballZone', 'footedness',
  'source', 'rootMotion', 'speed', 'delay', 'runupSteps', 'runupAngle',
  'spdPreRunup', 'spdRunup', 'spdRecoil', 'spdWhip', 'spdFollow',
];

export function snapshot() {
  const o = {};
  for (const f of SCENARIO_FIELDS) o[f] = params[f];
  return o;
}

export function applyScenario(cfg) {
  if (!cfg) return;
  for (const f of SCENARIO_FIELDS) if (f in cfg) params[f] = cfg[f];
}

// localStorage-backed store. All methods async so a Supabase impl can drop in.
export const scenarioStore = {
  async all() {
    try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; }
  },
  async list() { return Object.keys(await this.all()).sort(); },
  async get(name) { return (await this.all())[name]; },
  async save(name, cfg) {
    const a = await this.all();
    a[name] = { ...cfg, _savedAt: Date.now() };
    localStorage.setItem(STORE, JSON.stringify(a));
  },
  async remove(name) {
    const a = await this.all();
    delete a[name];
    localStorage.setItem(STORE, JSON.stringify(a));
  },
};
