// Shareable state: parameters <-> URL hash (for example "#a=35&r=65&...").

import { DEFAULTS, normalizeParams } from './sim.js';

// Parameter key -> short hash key.
const HASH_KEYS = {
  currentAge: 'a', retireAge: 'r', horizonAge: 'h', savings: 's', contribution: 'c', contributionGrowth: 'cg',
  returnBasis: 'rb', inflation: 'i', stockReturn: 'sr', stockVol: 'sv', bondReturn: 'br', bondVol: 'bv',
  correlation: 'co', glide: 'gl', stockNow: 'w0', stockRetire: 'w1', stockEnd: 'w2', strategy: 'st',
  withdrawal: 'w', withdrawalRate: 'wr', floor: 'fl', guardBand: 'gb', guardAdjust: 'ga', sims: 'n', seed: 'sd',
};

const roundTo = (v) => String(Math.round(v * 1e6) / 1e6);

export function encodeState(params) {
  const p = normalizeParams(params);
  const parts = [];
  for (const [key, short] of Object.entries(HASH_KEYS)) {
    const v = p[key];
    parts.push(`${short}=${typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'number' ? roundTo(v) : encodeURIComponent(v)}`);
  }
  return parts.join('&');
}

// Returns normalized params, or null when the hash carries no recognisable state.
export function decodeState(hash) {
  const query = String(hash || '').replace(/^#/, '');
  if (!query) return null;
  const search = new URLSearchParams(query);
  const raw = {};
  let found = 0;
  for (const [key, short] of Object.entries(HASH_KEYS)) {
    if (!search.has(short)) continue;
    const v = search.get(short);
    found++;
    if (key === 'glide') raw[key] = v === '1';
    else if (key === 'returnBasis' || key === 'strategy') raw[key] = v;
    else raw[key] = v.trim() === '' ? DEFAULTS[key] : Number(v);
  }
  if (!found) return null;
  const p = normalizeParams(raw);
  p.sims = Math.min(10000, Math.max(2000, p.sims));
  return p;
}
