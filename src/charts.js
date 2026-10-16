// Hand-drawn SVG charts. No libraries. Colours come from CSS classes, so light and dark just work.
// Importing this file has no side effects; the DOM is only touched inside the draw* functions.

import { niceStep } from './stats.js';
import { BAND_KEYS } from './sim.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function fmtMoney(v) {
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 999500) return sign + '$' + String(+(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)) + 'M';
  if (a >= 1000) return sign + '$' + Math.round(a / 1000) + 'k';
  return sign + '$' + Math.round(a);
}

export function niceTicks(max, target = 5) {
  if (!(max > 0)) return [0, 1];
  const step = niceStep(max, target);
  const count = Math.ceil(max / step - 1e-9);
  return Array.from({ length: count + 1 }, (_, i) => +(i * step).toPrecision(12));
}

function node(tag, attrs, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k of Object.keys(attrs || {})) el.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(el);
  return el;
}

function label(parent, x, y, str, cls, anchor = 'start') {
  const t = node('text', { x, y, class: cls, 'text-anchor': anchor }, parent);
  t.textContent = str;
  return t;
}

// Fresh responsive SVG sized to its container.
function canvas(container, aspect, minH, maxH, attrs) {
  container.textContent = '';
  const w = Math.max(280, Math.floor(container.clientWidth) || 640);
  const h = Math.round(Math.min(maxH, Math.max(minH, w * aspect)));
  return { w, h, svg: node('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: 'chart-svg', ...attrs }, container) };
}

function yGrid(svg, m, w, h, ticks, top, fmt) {
  const Y = (v) => h - m.b - (v / top) * (h - m.t - m.b);
  for (const t of ticks) {
    node('line', { x1: m.l, x2: w - m.r, y1: Y(t), y2: Y(t), class: t === 0 ? 'axis' : 'grid' }, svg);
    label(svg, m.l - 8, Y(t) + 4, fmt(t), 'tick', 'end');
  }
  return Y;
}

function ageTicks(svg, m, h, X, from, to) {
  const step = to - from > 40 ? 10 : 5;
  for (let a = Math.ceil(from / step) * step; a <= to; a += step) label(svg, X(a), h - m.b + 17, String(a), 'tick', 'middle');
}

const READOUT = [['p90', '90th'], ['p75', '75th'], ['p50', 'Median'], ['p25', '25th'], ['p10', '10th']];

// Fan chart of percentile bands by age, with a crosshair readable by pointer or arrow keys.
export function drawFan(container, res, readout) {
  const { w, h, svg } = canvas(container, 0.5, 250, 380, {
    tabindex: '0', role: 'group', 'aria-roledescription': 'interactive chart',
    'aria-label': 'Fan chart of portfolio value by age. Use the left and right arrow keys to read values at each age.',
  });
  const m = { l: w < 520 ? 46 : 56, r: 38, t: 18, b: 28 };
  const { ages, bands } = res;
  const n = ages.length;
  const ticks = niceTicks(Math.max(...bands.p90));
  const top = ticks[ticks.length - 1];
  const X = (a) => m.l + ((a - ages[0]) / (ages[n - 1] - ages[0])) * (w - m.l - m.r);
  const Y = yGrid(svg, m, w, h, ticks, top, fmtMoney);
  ageTicks(svg, m, h, X, ages[0], ages[n - 1]);

  const pts = (arr) => ages.map((a, t) => `${X(a).toFixed(1)},${Y(arr[t]).toFixed(1)}`);
  const area = (lo, hi) => `M${pts(hi).join('L')}L${pts(lo).reverse().join('L')}Z`;
  node('path', { d: area(bands.p10, bands.p90), class: 'band-wide' }, svg);
  node('path', { d: area(bands.p25, bands.p75), class: 'band-mid' }, svg);
  node('path', { d: `M${pts(bands.p10).join('L')}`, class: 'edge' }, svg);
  node('path', { d: `M${pts(bands.p90).join('L')}`, class: 'edge' }, svg);
  node('path', { d: `M${pts(bands.p50).join('L')}`, class: 'median' }, svg);
  for (const [k, text] of [['p90', '90th'], ['p50', '50th'], ['p10', '10th']]) label(svg, w - m.r + 5, Y(bands[k][n - 1]) + 4, text, 'tick');

  const retire = res.params.retireAge;
  if (retire > ages[0] && retire < ages[n - 1]) {
    node('line', { x1: X(retire), x2: X(retire), y1: m.t, y2: h - m.b, class: 'marker' }, svg);
    label(svg, X(retire) + 5, m.t + 10, `Retire ${retire}`, 'tick');
  }

  const cross = node('g', { class: 'cross' }, svg);
  const line = node('line', { y1: m.t, y2: h - m.b }, cross);
  const dots = BAND_KEYS.map((k) => node('circle', { r: 3.5, class: `dot dot-${k}` }, cross));
  let idx = -1;
  function setIdx(i) {
    idx = Math.min(n - 1, Math.max(0, i));
    line.setAttribute('x1', X(ages[idx]));
    line.setAttribute('x2', X(ages[idx]));
    BAND_KEYS.forEach((k, j) => { dots[j].setAttribute('cx', X(ages[idx])); dots[j].setAttribute('cy', Y(bands[k][idx])); });
    readout.innerHTML = `<span class="ro-age">Age ${ages[idx]}</span>` +
      READOUT.map(([k, name]) => `<span class="ro"><i class="sw sw-${k}"></i>${name} <b>${fmtMoney(bands[k][idx])}</b></span>`).join('');
  }
  const fromPointer = (e) => {
    const box = svg.getBoundingClientRect();
    const frac = (e.clientX - box.left - m.l * (box.width / w)) / ((w - m.l - m.r) * (box.width / w));
    setIdx(Math.round(frac * (n - 1)));
  };
  svg.addEventListener('pointerdown', fromPointer);
  svg.addEventListener('pointermove', fromPointer);
  svg.addEventListener('keydown', (e) => {
    const move = { ArrowLeft: -1, ArrowRight: 1, PageDown: -5, PageUp: 5, Home: -n, End: n }[e.key];
    if (!move) return;
    e.preventDefault();
    setIdx(idx + move);
  });
  setIdx(res.retireIndex < n ? res.retireIndex : n - 1);
}

// Histogram of ending balances for plans that lasted, with a separate bar for plans that ran out.
export function drawHistogram(container, res) {
  const { w, h, svg } = canvas(container, 0.5, 230, 300, { role: 'img', 'aria-label': 'Histogram of ending balances at the plan end age.' });
  const hist = res.histogram;
  const m = { l: 40, r: 10, t: 22, b: 40 };
  const slot = 54;
  const x0 = m.l + slot + 14;
  const share = (c) => (c / res.sims) * 100;
  const peak = Math.max(share(hist.depleted), ...hist.counts.map(share));
  const ticks = niceTicks(peak, 4);
  const top = ticks[ticks.length - 1];
  const Y = yGrid(svg, m, w, h, ticks, top, (v) => `${v}%`);
  const bw = (w - m.r - x0) / hist.counts.length;

  const failH = (h - m.b) - Y(share(hist.depleted));
  node('rect', { x: m.l + 4, y: Y(share(hist.depleted)), width: slot - 8, height: Math.max(0, failH), class: 'bar bar-fail' }, svg);
  label(svg, m.l + slot / 2, Y(share(hist.depleted)) - 6, `${share(hist.depleted).toFixed(1)}%`, 'tick strong', 'middle');
  label(svg, m.l + slot / 2, h - m.b + 17, 'Ran out', 'tick', 'middle');

  hist.counts.forEach((c, k) => {
    const y = Y(share(c));
    node('rect', { x: x0 + k * bw + 0.5, y, width: Math.max(1, bw - 1), height: Math.max(0, h - m.b - y), class: 'bar' }, svg);
  });
  const every = Math.ceil(hist.counts.length / 5);
  for (let k = 0; k < hist.edges.length; k += every) label(svg, x0 + k * bw, h - m.b + 17, fmtMoney(hist.edges[k]), 'tick', 'middle');

  const med = res.ending.median;
  const edgeMax = hist.edges[hist.edges.length - 1];
  if (med > 0 && med < edgeMax) {
    const x = x0 + (med / edgeMax) * bw * hist.counts.length;
    node('line', { x1: x, x2: x, y1: m.t - 6, y2: h - m.b, class: 'marker' }, svg);
    label(svg, x + 5, m.t, `Median ${fmtMoney(med)}`, 'tick');
  }
}

// Share of all simulations that run out of money at each age.
export function drawFailures(container, res) {
  if (res.failures === 0) {
    container.textContent = '';
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = `No simulated path ran out of money before age ${res.params.horizonAge}.`;
    container.appendChild(p);
    return;
  }
  const { w, h, svg } = canvas(container, 0.5, 230, 300, { role: 'img', 'aria-label': 'Bar chart of the age at which plans run out of money.' });
  const m = { l: 40, r: 10, t: 22, b: 28 };
  const first = res.retireIndex;
  const counts = Array.from(res.failuresByAge).slice(first);
  const share = (c) => (c / res.sims) * 100;
  const ticks = niceTicks(Math.max(...counts.map(share)), 4);
  const top = ticks[ticks.length - 1];
  const Y = yGrid(svg, m, w, h, ticks, top, (v) => `${v}%`);
  const bw = (w - m.l - m.r) / counts.length;
  const startAge = res.ages[first];
  counts.forEach((c, k) => {
    const peak = startAge + k === res.peakFailureAge;
    node('rect', { x: m.l + k * bw + 0.5, y: Y(share(c)), width: Math.max(1, bw - 1), height: h - m.b - Y(share(c)), class: peak ? 'bar bar-peak' : 'bar bar-fail' }, svg);
    if (peak) label(svg, Math.min(w - m.r - 24, Math.max(m.l + 24, m.l + (k + 0.5) * bw)), Y(share(c)) - 6, `Age ${startAge + k}`, 'tick strong', 'middle');
  });
  const step = counts.length > 25 ? 5 : 2;
  for (let a = Math.ceil(startAge / step) * step; a < startAge + counts.length; a += step) label(svg, m.l + (a - startAge + 0.5) * bw, h - m.b + 17, String(a), 'tick', 'middle');
}

// Three orderings of the same retirement returns, drawn as balance lines by age.
export function drawSequence(container, seq) {
  const { w, h, svg } = canvas(container, 0.45, 220, 300, { role: 'img', 'aria-label': 'Line chart: the same returns in three different orders produce very different balances.' });
  const m = { l: 54, r: 14, t: 14, b: 28 };
  const runs = [['worstFirst', 'seq-worst'], ['asDrawn', 'seq-drawn'], ['bestFirst', 'seq-best']];
  const ticks = niceTicks(Math.max(...runs.map(([k]) => Math.max(...seq[k].balances))));
  const top = ticks[ticks.length - 1];
  const a0 = seq.ages[0];
  const a1 = seq.ages[seq.ages.length - 1];
  const X = (a) => m.l + ((a - a0) / (a1 - a0)) * (w - m.l - m.r);
  const Y = yGrid(svg, m, w, h, ticks, top, fmtMoney);
  ageTicks(svg, m, h, X, a0, a1);
  for (const [key, cls] of runs) {
    const run = seq[key];
    node('path', { d: 'M' + seq.ages.map((a, t) => `${X(a).toFixed(1)},${Y(run.balances[t]).toFixed(1)}`).join('L'), class: `seq ${cls}` }, svg);
    if (run.failedAge !== null) node('circle', { cx: X(run.failedAge), cy: Y(0), r: 4, class: `seq-dot ${cls}` }, svg);
  }
}
