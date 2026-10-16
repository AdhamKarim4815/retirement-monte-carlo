import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, normalizeParams, simulate } from '../src/sim.js';
import { encodeState, decodeState } from '../src/state.js';
import { PRESETS } from '../src/presets.js';
import { fmtMoney, niceTicks } from '../src/charts.js';
import { buildBundle } from '../scripts/bundle.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('URL hash: round trip preserves every parameter', () => {
  const p = normalizeParams({ ...DEFAULTS, currentAge: 41, glide: true, strategy: 'guardrails', withdrawalRate: 0.0475, returnBasis: 'nominal', seed: 987654321, sims: 8000, correlation: -0.25 });
  assert.deepEqual(decodeState('#' + encodeState(p)), p);
});

test('URL hash: empty or unrelated hashes yield null, junk values fall back safely', () => {
  assert.equal(decodeState(''), null);
  assert.equal(decodeState('#section-2'), null);
  const p = decodeState('#a=abc&r=70&st=hax&n=99999999');
  assert.equal(p.currentAge, DEFAULTS.currentAge);
  assert.equal(p.strategy, 'fixed');
  assert.equal(p.sims, 10000);
});

test('presets: unique ids, valid parameters, and each one runs', () => {
  assert.equal(new Set(PRESETS.map((x) => x.id)).size, PRESETS.length);
  assert.ok(PRESETS.length >= 5);
  for (const preset of PRESETS) {
    const p = normalizeParams(preset.params);
    for (const k of Object.keys(preset.params)) assert.equal(p[k], preset.params[k], `${preset.id}.${k} was altered by normalization`);
    const r = simulate({ ...preset.params, sims: 200 });
    assert.ok(r.successRate >= 0 && r.successRate <= 1);
  }
});

test('charts helpers: money formatting and axis ticks', () => {
  assert.equal(fmtMoney(0), '$0');
  assert.equal(fmtMoney(850000), '$850k');
  assert.equal(fmtMoney(1200000), '$1.2M');
  assert.equal(fmtMoney(999700), '$1M');
  assert.equal(fmtMoney(12500000), '$12.5M');
  const t = niceTicks(1730000, 5);
  assert.equal(t[0], 0);
  assert.ok(t[t.length - 1] >= 1730000);
  assert.deepEqual(niceTicks(0), [0, 1]);
});

test('dist/rmc.bundle.js is in sync with src/ (run: node scripts/bundle.mjs)', () => {
  assert.equal(readFileSync(join(root, 'dist', 'rmc.bundle.js'), 'utf8'), buildBundle());
});

test('index.html loads only local resources (no network, no CDN)', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  for (const ref of refs) assert.ok(!/^(https?:)?\/\//.test(ref) || ref.startsWith('https://github.com/adhamkarim4815/'), `external reference: ${ref}`);
  for (const file of ['src/styles.css', 'dist/rmc.bundle.js']) assert.ok(refs.includes(file), `${file} is referenced`);
});

test('source tree contains no em dashes or en dashes', () => {
  const bad = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (['.git', 'node_modules', 'screenshot.png'].includes(name) || name.endsWith('.png')) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (new RegExp('[\u2013\u2014]').test(readFileSync(full, 'utf8'))) bad.push(full);
    }
  })(root);
  assert.deepEqual(bad, []);
});
