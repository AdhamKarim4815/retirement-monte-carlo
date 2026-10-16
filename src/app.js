// UI wiring: form, personas, URL hash, running the simulation, rendering results.

import { DEFAULTS, normalizeParams, checkParams, simulateAsync, sequenceRisk } from './sim.js';
import { PRESETS } from './presets.js';
import { encodeState, decodeState } from './state.js';
import { fmtMoney, drawFan, drawHistogram, drawFailures, drawSequence } from './charts.js';

const byId = (id) => document.getElementById(id);
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');

// ---------- Form definition ----------

const money = (key, label, extra = {}) => ({ key, label, kind: 'num', unit: '$', step: 1000, min: 0, ...extra });
const pct = (key, label, extra = {}) => ({ key, label, kind: 'num', unit: '%', pct: true, step: 0.1, min: 0, max: 100, ...extra });
const years = (key, label, extra = {}) => ({ key, label, kind: 'num', unit: 'yrs', step: 1, min: 18, max: 110, ...extra });
const isDynamic = (p) => p.strategy !== 'fixed';

const SECTIONS = [
  { title: 'You', fields: [
    years('currentAge', 'Current age'),
    years('retireAge', 'Retirement age'),
    years('horizonAge', 'Plan until age', { hint: 'The age your money has to last to.' }),
  ] },
  { title: 'Savings', fields: [
    money('savings', 'Current savings', { step: 5000 }),
    money('contribution', 'Annual contribution', { hint: 'Added at the end of each year, in today\'s dollars.' }),
    pct('contributionGrowth', 'Contribution growth per year', { step: 0.5, min: -10, max: 20, hint: 'Real growth, on top of inflation.' }),
  ] },
  { title: 'Markets', fields: [
    { key: 'returnBasis', label: 'Returns below are', kind: 'seg', options: [['real', 'Real'], ['nominal', 'Nominal']] },
    pct('inflation', 'Inflation', { show: (p) => p.returnBasis === 'nominal', min: -5, max: 25, hint: 'Converts nominal returns to real ones.' }),
    pct('stockReturn', 'Stocks: expected return', { min: -50, max: 50 }),
    pct('stockVol', 'Stocks: volatility'),
    pct('bondReturn', 'Bonds: expected return', { min: -50, max: 50 }),
    pct('bondVol', 'Bonds: volatility'),
    { key: 'correlation', label: 'Stock and bond correlation', kind: 'num', unit: '', step: 0.05, min: -1, max: 1 },
    { key: 'glide', label: 'Glide path: change my stock share as I age', kind: 'check' },
    pct('stockNow', (p) => (p.glide ? 'Stocks share today' : 'Stocks share'), { step: 5 }),
    pct('stockRetire', 'Stocks share at retirement', { show: (p) => p.glide, step: 5 }),
    pct('stockEnd', 'Stocks share at plan end', { show: (p) => p.glide, step: 5 }),
  ] },
  { title: 'Spending in retirement', fields: [
    { key: 'strategy', label: 'Withdrawal strategy', kind: 'seg', options: [['fixed', 'Fixed amount'], ['percent', '% of portfolio'], ['guardrails', 'Guardrails']] },
    money('withdrawal', 'Annual spending', { show: (p) => p.strategy === 'fixed', hint: 'Today\'s dollars, constant in real terms.' }),
    pct('withdrawalRate', (p) => (p.strategy === 'guardrails' ? 'Starting withdrawal rate' : 'Withdrawal rate'), { show: isDynamic, step: 0.25, max: 30,
      hint: 'Share of the portfolio taken in the first year (guardrails) or every year (% of portfolio).' }),
    money('floor', 'Minimum annual spending', { show: isDynamic, hint: 'If the portfolio cannot pay this, the plan has failed.' }),
    pct('guardBand', 'Guardrail band', { show: (p) => p.strategy === 'guardrails', max: 90, step: 1,
      hint: 'Cut when the live rate is this far (relative) above the starting rate, raise when this far below.' }),
    pct('guardAdjust', 'Adjustment size', { show: (p) => p.strategy === 'guardrails', max: 50, step: 1, hint: 'How much spending moves at a guardrail.' }),
  ] },
];

const FIELDS = {};
for (const s of SECTIONS) for (const f of s.fields) FIELDS[f.key] = f;

let params = normalizeParams(PRESETS[0].params);

function buildForm() {
  const form = byId('controls');
  SECTIONS.forEach((section, i) => {
    const details = document.createElement('details');
    details.open = true;
    details.className = 'group';
    details.innerHTML = `<summary><span class="num">0${i + 1}</span>${section.title}</summary>`;
    const body = document.createElement('div');
    body.className = 'fields';
    for (const f of section.fields) body.appendChild(buildField(f));
    details.appendChild(body);
    form.appendChild(details);
  });
}

function buildField(f) {
  const wrap = document.createElement('div');
  wrap.className = `field field-${f.kind}`;
  wrap.dataset.field = f.key;
  const hint = f.hint ? `<small id="h-${f.key}">${f.hint}</small>` : '';
  const describedBy = f.hint ? ` aria-describedby="h-${f.key}"` : '';
  if (f.kind === 'seg') {
    wrap.innerHTML = `<fieldset><legend>${f.label}</legend><div class="seg">` + f.options.map(([value, text]) =>
      `<label><input type="radio" name="${f.key}" value="${value}" data-key="${f.key}"><span>${text}</span></label>`).join('') + '</div></fieldset>';
  } else if (f.kind === 'check') {
    wrap.innerHTML = `<label class="check"><input type="checkbox" id="f-${f.key}" data-key="${f.key}"><span>${f.label}</span></label>`;
  } else {
    const bounds = `min="${f.min}" max="${f.max === undefined ? '' : f.max}" step="${f.step}"`;
    wrap.innerHTML = `<label for="f-${f.key}" data-label="${f.key}"></label><div class="input">` +
      (f.unit === '$' ? '<span class="unit">$</span>' : '') +
      `<input id="f-${f.key}" data-key="${f.key}" type="number" inputmode="decimal" ${bounds}${describedBy}>` +
      (f.unit && f.unit !== '$' ? `<span class="unit">${f.unit}</span>` : '') + `</div>${hint}`;
  }
  return wrap;
}

const toDisplay = (f, v) => (f.pct ? +(v * 100).toFixed(4) : v);

// Push the current params into the inputs, labels and visibility rules.
function syncInputs() {
  for (const f of Object.values(FIELDS)) {
    const wrap = document.querySelector(`[data-field="${f.key}"]`);
    wrap.hidden = f.show ? !f.show(params) : false;
    const v = params[f.key];
    if (f.kind === 'seg') {
      for (const r of wrap.querySelectorAll('input')) r.checked = r.value === v;
    } else if (f.kind === 'check') {
      wrap.querySelector('input').checked = !!v;
    } else {
      const input = wrap.querySelector('input');
      if (document.activeElement !== input) input.value = toDisplay(f, v);
      wrap.querySelector('label').textContent = typeof f.label === 'function' ? f.label(params) : f.label;
    }
  }
  byId('sims').value = String(params.sims);
  byId('seed').value = String(params.seed);
  document.querySelectorAll('.persona').forEach((b) => {
    const preset = PRESETS.find((x) => x.id === b.dataset.id);
    b.setAttribute('aria-pressed', String(encodeState({ ...preset.params, seed: params.seed, sims: params.sims }) === encodeState(params)));
  });
}

function buildPersonas() {
  const box = byId('personas');
  for (const preset of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'persona';
    b.dataset.id = preset.id;
    b.innerHTML = `<b>${preset.name}</b><span>${preset.note}</span>`;
    b.addEventListener('click', () => {
      params = normalizeParams({ ...preset.params, seed: params.seed, sims: params.sims });
      syncInputs();
      changed();
    });
    box.appendChild(b);
  }
}

// ---------- State, URL, running ----------

let timer = 0;
let runId = 0;
let last = null;

function writeHash() {
  const hash = '#' + encodeState(params);
  try { history.replaceState(null, '', hash); } catch (e) { location.hash = hash; }
  byId('share').value = location.href;
}

function changed() {
  syncInputs();
  byId('notice').textContent = checkParams(params).join(' ');
  writeHash();
  clearTimeout(timer);
  timer = setTimeout(run, 220);
}

async function run() {
  clearTimeout(timer);
  const id = ++runId;
  const status = byId('status');
  byId('results').classList.add('busy');
  const started = performance.now();
  const res = await simulateAsync(normalizeParams(params), {
    isCancelled: () => id !== runId,
    onProgress: (f) => { status.textContent = `Simulating ${Math.round(f * 100)}%`; },
  });
  if (!res) return;
  const ms = Math.round(performance.now() - started);
  status.textContent = `${fmtInt(res.sims)} paths in ${ms} ms`;
  byId('results').classList.remove('busy');
  last = { res, seq: sequenceRisk(res.params, res.retirementBalance.p50) };
  renderText(res);
  drawCharts();
}

// ---------- Rendering ----------

function successLabel(p) {
  if (p >= 0.85) return ['good', 'Comfortable'];
  if (p >= 0.7) return ['mid', 'Borderline'];
  return ['low', 'Fragile'];
}

function fmtPct(share) {
  const v = share * 100;
  return v === 0 || v === 100 ? `${v}` : (Math.floor(v * 10) / 10).toFixed(1);
}

function stat(name, value, note) {
  return `<div class="stat"><dt>${name}</dt><dd>${value}</dd>${note ? `<span>${note}</span>` : ''}</div>`;
}

function renderText(res) {
  const p = res.params;
  const [tone, verdict] = successLabel(res.successRate);
  const ok = res.sims - res.failures;
  const noRetirement = p.retireAge >= p.horizonAge;
  byId('hero').className = `hero tone-${tone}`;
  byId('hero').innerHTML =
    `<div class="hero-num">${fmtPct(res.successRate)}<span>%</span></div>` +
    `<div class="hero-body"><h2>chance the money lasts to age ${p.horizonAge} <em class="badge">${verdict}</em></h2>` +
    `<div class="meter" role="img" aria-label="${fmtPct(res.successRate)} percent of simulations succeeded"><i style="width:${res.successRate * 100}%"></i></div>` +
    `<p aria-live="polite">${noRetirement ? 'There are no retirement years in this plan, so nothing can run out.' :
      `${fmtInt(ok)} of ${fmtInt(res.sims)} simulated lifetimes funded every year of spending.`}</p></div>`;

  const peakShare = res.peakFailureAge === null ? 0 : res.failuresByAge[res.peakFailureAge - p.currentAge] / res.failures;
  const items = [
    stat('Plans that ran out', `${fmtPct(1 - res.successRate)}%`, `${fmtInt(res.failures)} of ${fmtInt(res.sims)} simulations`),
    stat('Median ending balance', fmtMoney(res.ending.median), `at age ${p.horizonAge}, today's dollars`),
    stat('Worst decile ending', fmtMoney(res.ending.p10), '10th percentile of ending balances'),
    stat('Average of worst 10%', fmtMoney(res.ending.worstDecileMean), 'mean of the bottom tenth'),
    stat('Median at retirement', fmtMoney(res.retirementBalance.p50), `age ${p.retireAge}, 10th to 90th: ${fmtMoney(res.retirementBalance.p10)} to ${fmtMoney(res.retirementBalance.p90)}`),
    stat('Year most failures happen', res.peakFailureAge === null ? 'None' : `Age ${res.peakFailureAge}`,
      res.peakFailureAge === null ? 'no path ran out of money' : `${Math.round(peakShare * 100)}% of failures; median failure at ${res.medianFailureAge}`),
  ];
  if (isDynamic(p) && !noRetirement) {
    items.push(stat('Median first-year spending', fmtMoney(res.spend.firstMedian), 'at retirement, today\'s dollars'));
    items.push(stat('Worst-decile lowest spending', fmtMoney(res.spend.lowestP10), 'lowest yearly spend, 10th percentile'));
    if (p.strategy === 'guardrails') items.push(stat('Paths with a spending cut', `${Math.round(res.spend.cutShare * 100)}%`, 'at least once in retirement'));
  }
  byId('stats').innerHTML = items.join('');
  byId('mini').textContent = `${fmtPct(res.successRate)}% success, median end ${fmtMoney(res.ending.median)}`;
  byId('hist-note').textContent = res.histogram.above > 0
    ? `Bars cover plans that lasted. The last bar also holds ${fmtInt(res.histogram.above)} paths above ${fmtMoney(res.histogram.edges[res.histogram.edges.length - 1])}.`
    : 'Bars cover plans that lasted; the left bar is plans that ran out.';

  const seq = last.seq;
  byId('seq-card').hidden = !seq;
  if (seq) {
    const row = (cls, name, run) => `<li><i class="swl ${cls}"></i>${name}: <b>${run.failedAge ? `ran out at ${run.failedAge}` : fmtMoney(run.ending)}</b></li>`;
    byId('seq-legend').innerHTML = row('seq-worst', 'Worst years first', seq.worstFirst) + row('seq-drawn', 'Years as drawn', seq.asDrawn) + row('seq-best', 'Best years first', seq.bestFirst);
    byId('seq-text').textContent = `Start with the median retirement balance of ${fmtMoney(seq.startBalance)}. One simulated retirement of ${seq.ages.length - 1} years averages ${(seq.geometricMean * 100).toFixed(1)}% a year (geometric, real). Replaying exactly those returns in a different order changes the ending balance, because early losses hit while the portfolio is still large and being drawn down.`;
  }
}

function drawCharts() {
  if (!last) return;
  drawFan(byId('fan'), last.res, byId('readout'));
  drawHistogram(byId('hist'), last.res);
  drawFailures(byId('fail'), last.res);
  if (last.seq) drawSequence(byId('seq'), last.seq);
}

// ---------- Wiring ----------

function bind() {
  const form = byId('controls');
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', (e) => {
    const key = e.target.dataset.key;
    if (!key) return;
    const f = FIELDS[key];
    if (f.kind === 'num') {
      if (e.target.value === '' || Number.isNaN(e.target.valueAsNumber)) return;
      params[key] = f.pct ? e.target.valueAsNumber / 100 : e.target.valueAsNumber;
    } else {
      params[key] = f.kind === 'check' ? e.target.checked : e.target.value;
    }
    changed();
  });
  form.addEventListener('change', (e) => {
    params = normalizeParams(params);
    const f = FIELDS[e.target.dataset.key];
    if (f && f.kind === 'num') e.target.value = toDisplay(f, params[f.key]);
    changed();
  });
  byId('sims').addEventListener('change', (e) => { params.sims = Number(e.target.value); changed(); });
  byId('seed').addEventListener('input', (e) => {
    if (e.target.value === '' || Number.isNaN(e.target.valueAsNumber)) return;
    params.seed = normalizeParams({ seed: e.target.valueAsNumber }).seed;
    changed();
  });
  byId('seed').addEventListener('change', syncInputs);
  byId('reseed').addEventListener('click', () => { params.seed = Math.floor(Math.random() * 4294967296); changed(); });
  byId('rerun').addEventListener('click', run);
  byId('copy').addEventListener('click', async () => {
    const field = byId('share');
    let ok = false;
    try { await navigator.clipboard.writeText(field.value); ok = true; } catch (e) { field.select(); ok = document.execCommand && document.execCommand('copy'); }
    byId('copy').textContent = ok ? 'Copied' : 'Press Ctrl+C';
    setTimeout(() => { byId('copy').textContent = 'Copy link'; }, 1600);
  });
  window.addEventListener('hashchange', () => {
    const next = decodeState(location.hash);
    if (next && encodeState(next) !== encodeState(params)) { params = next; changed(); }
  });
  let width = 0;
  let frame = 0;
  new ResizeObserver(() => {
    const w = byId('results').clientWidth;
    if (w === width) return;
    width = w;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(drawCharts);
  }).observe(byId('results'));
}

function init() {
  buildForm();
  buildPersonas();
  params = decodeState(location.hash) || params;
  bind();
  changed();
  run();
}

init();
