// Monte Carlo engine for a savings and retirement plan.
// Pure ES module: no DOM, no network, deterministic for a given parameter set (including the seed).
// Everything is modelled in real (today's) dollars; nominal inputs are converted with the inflation rate.

import { percentileSorted, mean, histogram, argMax, weightedMedianIndex, niceStep } from './stats.js';

export const DEFAULTS = {
  currentAge: 35, retireAge: 65, horizonAge: 95,
  savings: 150000, contribution: 15000, contributionGrowth: 0.02,
  returnBasis: 'real', inflation: 0.025,
  stockReturn: 0.065, stockVol: 0.17, bondReturn: 0.02, bondVol: 0.06, correlation: 0.1,
  glide: false, stockNow: 0.7, stockRetire: 0.5, stockEnd: 0.4,
  strategy: 'fixed', withdrawal: 60000, withdrawalRate: 0.04, floor: 30000,
  guardBand: 0.2, guardAdjust: 0.1,
  sims: 5000, seed: 20261016,
};

export const STRATEGIES = ['fixed', 'percent', 'guardrails'];
export const BAND_KEYS = ['p10', 'p25', 'p50', 'p75', 'p90'];
const BAND_PCT = [10, 25, 50, 75, 90];

const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Coerce arbitrary input into a valid, fully populated parameter object.
export function normalizeParams(raw = {}) {
  const r = { ...DEFAULTS, ...raw };
  const n = (key, lo, hi) => clamp(num(r[key], DEFAULTS[key]), lo, hi);
  const p = {};
  p.currentAge = Math.round(n('currentAge', 18, 100));
  p.horizonAge = Math.round(clamp(num(r.horizonAge, DEFAULTS.horizonAge), p.currentAge + 1, 110));
  p.retireAge = Math.round(clamp(num(r.retireAge, DEFAULTS.retireAge), p.currentAge, p.horizonAge));
  p.savings = n('savings', 0, 1e9);
  p.contribution = n('contribution', 0, 1e7);
  p.contributionGrowth = n('contributionGrowth', -0.1, 0.2);
  p.returnBasis = r.returnBasis === 'nominal' ? 'nominal' : 'real';
  p.inflation = n('inflation', -0.05, 0.25);
  p.stockReturn = n('stockReturn', -0.5, 0.5);
  p.stockVol = n('stockVol', 0, 1);
  p.bondReturn = n('bondReturn', -0.5, 0.5);
  p.bondVol = n('bondVol', 0, 1);
  p.correlation = n('correlation', -1, 1);
  p.glide = r.glide === true || r.glide === 1 || r.glide === '1';
  p.stockNow = n('stockNow', 0, 1);
  p.stockRetire = n('stockRetire', 0, 1);
  p.stockEnd = n('stockEnd', 0, 1);
  p.strategy = STRATEGIES.includes(r.strategy) ? r.strategy : 'fixed';
  p.withdrawal = n('withdrawal', 0, 1e8);
  p.withdrawalRate = n('withdrawalRate', 0, 1);
  p.floor = n('floor', 0, 1e8);
  p.guardBand = n('guardBand', 0.01, 0.9);
  p.guardAdjust = n('guardAdjust', 0, 0.5);
  p.sims = Math.round(n('sims', 1, 50000));
  p.seed = Math.floor(num(r.seed, DEFAULTS.seed)) >>> 0;
  return p;
}

// Human-readable notes about inputs that were adjusted or make the run degenerate.
export function checkParams(raw = {}) {
  const r = { ...DEFAULTS, ...raw };
  const p = normalizeParams(raw);
  const notes = [];
  if (num(r.horizonAge, 0) <= num(r.currentAge, 0)) notes.push('Plan end age must be above your current age, so it was adjusted.');
  else if (num(r.retireAge, 0) > p.horizonAge) notes.push('Retirement age cannot be past the plan end age, so it was adjusted.');
  else if (num(r.retireAge, 0) < p.currentAge) notes.push('Retirement age cannot be below your current age, so it was adjusted.');
  if (p.retireAge >= p.horizonAge) notes.push('There are no retirement years to simulate, so success is trivially 100%.');
  return notes;
}

// ---------- Random numbers ----------

// mulberry32: a tiny, fast 32-bit seeded PRNG. Returns floats in [0, 1).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Standard normal draws via the Box-Muller transform (each pair of uniforms yields two normals).
export function normalGenerator(rand) {
  let spare = null;
  return function normal() {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = rand();
    while (u === 0) u = rand();
    const v = rand();
    const radius = Math.sqrt(-2 * Math.log(u));
    spare = radius * Math.sin(2 * Math.PI * v);
    return radius * Math.cos(2 * Math.PI * v);
  };
}

// ---------- Market model ----------

// Annual growth factor 1 + R is lognormal with E[1 + R] = 1 + mu and Var[R] = sigma^2.
export function assetModel(mu, sigma) {
  const mean1 = 1 + mu;
  const s2 = Math.log(1 + (sigma * sigma) / (mean1 * mean1));
  return { mean1, m: Math.log(mean1) - s2 / 2, s: Math.sqrt(s2) };
}

const factorOf = (a, z) => (a.s === 0 ? a.mean1 : Math.exp(a.m + a.s * z));

function realMean(p, mu) {
  return p.returnBasis === 'nominal' ? (1 + mu) / (1 + p.inflation) - 1 : mu;
}

// Stock share at the start of the year at `age`: constant, or a two-leg linear glide path.
export function stockWeightAt(p, age) {
  if (!p.glide) return p.stockNow;
  if (p.retireAge > p.currentAge && age < p.retireAge) {
    return p.stockNow + (p.stockRetire - p.stockNow) * ((age - p.currentAge) / (p.retireAge - p.currentAge));
  }
  const span = p.horizonAge - p.retireAge;
  if (span <= 0) return p.stockRetire;
  return p.stockRetire + (p.stockEnd - p.stockRetire) * Math.min(1, (age - p.retireAge) / span);
}

// Portfolio growth factor generator: two correlated lognormal assets, rebalanced to target each year.
function makeMarket(p) {
  const stocks = assetModel(Math.max(-0.99, realMean(p, p.stockReturn)), p.stockVol);
  const bonds = assetModel(Math.max(-0.99, realMean(p, p.bondReturn)), p.bondVol);
  const rho = p.correlation;
  const rho2 = Math.sqrt(Math.max(0, 1 - rho * rho));
  return (weight, z1, z2) => weight * factorOf(stocks, z1) + (1 - weight) * factorOf(bonds, rho * z1 + rho2 * z2);
}

// ---------- Withdrawal rules ----------

// Guardrails (in the spirit of Guyton and Klinger): hold real spending steady, cut it when the
// current withdrawal rate drifts above the upper rail, raise it when it falls below the lower rail.
export function guardrailsWithdrawal({ previous, balance, initialRate, band, adjust, floor = 0 }) {
  const rate = balance > 0 ? previous / balance : Infinity;
  let amount = previous;
  let action = 'hold';
  if (rate > initialRate * (1 + band)) {
    amount = previous * (1 - adjust);
    action = 'cut';
  } else if (rate < initialRate * (1 - band)) {
    amount = previous * (1 + adjust);
    action = 'raise';
  }
  return { amount: Math.max(amount, floor), action };
}

// Amount to withdraw at the start of a retirement year. `state` carries guardrails memory.
function nextWithdrawal(p, state, balance) {
  if (p.strategy === 'percent') return Math.max(p.withdrawalRate * balance, p.floor);
  if (p.strategy === 'guardrails') {
    if (state.prev === null) {
      state.prev = Math.max(p.withdrawalRate * balance, p.floor);
    } else {
      const g = guardrailsWithdrawal({ previous: state.prev, balance, initialRate: p.withdrawalRate, band: p.guardBand, adjust: p.guardAdjust, floor: p.floor });
      if (g.action === 'cut') state.cuts++;
      state.prev = g.amount;
    }
    return state.prev;
  }
  return p.withdrawal;
}

const canPay = (need, balance) => need <= balance * (1 + 1e-12);

// ---------- Simulation ----------

// Incremental run: call step() until done, then finish(). Draw order is fixed (two normals per
// simulated year, even after a path fails), so a seed always means the same market paths.
export function createRun(raw) {
  const p = normalizeParams(raw);
  const years = p.horizonAge - p.currentAge;
  const cols = years + 1;
  const retireIdx = p.retireAge - p.currentAge;
  const growth = makeMarket(p);
  const normal = normalGenerator(mulberry32(p.seed));
  const weights = Array.from({ length: years }, (_, t) => stockWeightAt(p, p.currentAge + t));
  const contribs = Array.from({ length: years }, (_, t) => p.contribution * Math.pow(1 + p.contributionGrowth, t));

  const balances = new Float64Array(p.sims * cols);
  const failAge = new Int16Array(p.sims).fill(-1);
  const spendFirst = new Float64Array(p.sims);
  const spendLow = new Float64Array(p.sims);
  const cutCount = new Int16Array(p.sims);
  let done = 0;

  function simulateOne(i) {
    const row = i * cols;
    const state = { prev: null, cuts: 0 };
    let b = p.savings;
    let first = -1;
    let low = Infinity;
    let failed = false;
    balances[row] = b;
    for (let t = 0; t < years; t++) {
      const z1 = normal();
      const z2 = normal();
      if (!failed) {
        const g = growth(weights[t], z1, z2);
        if (t < retireIdx) {
          b = b * g + contribs[t];
        } else {
          const need = nextWithdrawal(p, state, b);
          if (canPay(need, b)) {
            b = Math.max(0, (b - need) * g);
            if (first < 0) first = need;
            if (need < low) low = need;
          } else {
            failed = true;
            failAge[i] = p.currentAge + t;
            b = 0;
          }
        }
      }
      balances[row + t + 1] = b;
    }
    spendFirst[i] = failed || first < 0 ? 0 : first;
    spendLow[i] = failed || low === Infinity ? 0 : low;
    cutCount[i] = state.cuts;
  }

  return {
    params: p,
    get done() { return done; },
    // Simulate paths until finished or until budgetMs elapses (checked every 32 paths).
    step(budgetMs = Infinity) {
      const start = Date.now();
      while (done < p.sims) {
        simulateOne(done++);
        if (budgetMs !== Infinity && done % 32 === 0 && Date.now() - start >= budgetMs) break;
      }
      return done / p.sims;
    },
    finish() {
      const ages = Array.from({ length: cols }, (_, t) => p.currentAge + t);
      const bands = {};
      for (const k of BAND_KEYS) bands[k] = new Float64Array(cols);
      const col = new Float64Array(p.sims);
      for (let t = 0; t < cols; t++) {
        for (let i = 0; i < p.sims; i++) col[i] = balances[i * cols + t];
        col.sort();
        BAND_KEYS.forEach((k, j) => { bands[k][t] = percentileSorted(col, BAND_PCT[j]); });
      }
      // `col` now holds the sorted ending balances (last column).
      const ending = col;
      const failuresByAge = new Int32Array(years);
      let failures = 0;
      const survivors = [];
      for (let i = 0; i < p.sims; i++) {
        if (failAge[i] >= 0) {
          failuresByAge[failAge[i] - p.currentAge]++;
          failures++;
        } else {
          survivors.push(balances[i * cols + years]);
        }
      }
      survivors.sort((a, b) => a - b);
      const cap = survivors.length ? percentileSorted(survivors, 95) : 0;
      const step = niceStep(cap, 20);
      const bins = Math.max(1, Math.ceil(cap / step));
      const hist = histogram(survivors, { bins, min: 0, max: bins * step });
      const worstN = Math.max(1, Math.ceil(p.sims * 0.1));
      const peak = failures > 0 ? argMax(failuresByAge) : -1;
      const median = weightedMedianIndex(failuresByAge);
      const spendSorted = (arr) => Float64Array.from(arr).sort();
      return {
        params: p,
        sims: p.sims,
        seed: p.seed,
        ages,
        bands,
        retireIndex: retireIdx,
        successRate: 1 - failures / p.sims,
        failures,
        failuresByAge,
        peakFailureAge: peak >= 0 ? p.currentAge + peak : null,
        medianFailureAge: failures > 0 ? p.currentAge + median : null,
        ending: {
          median: percentileSorted(ending, 50),
          p10: percentileSorted(ending, 10),
          p90: percentileSorted(ending, 90),
          mean: mean(ending),
          worstDecileMean: mean(ending.subarray(0, worstN)),
        },
        retirementBalance: { p10: bands.p10[retireIdx], p50: bands.p50[retireIdx], p90: bands.p90[retireIdx] },
        histogram: { depleted: failures, survivors: survivors.length, step, ...hist },
        spend: {
          retirementYears: Math.max(0, years - retireIdx),
          firstMedian: percentileSorted(spendSorted(spendFirst), 50),
          lowestP10: percentileSorted(spendSorted(spendLow), 10),
          cutShare: cutCount.reduce((a, c) => a + (c > 0 ? 1 : 0), 0) / p.sims,
        },
      };
    },
  };
}

export function simulate(raw) {
  const run = createRun(raw);
  run.step();
  return run.finish();
}

// Same result as simulate(), but yields to the event loop between short slices so a UI never freezes.
export async function simulateAsync(raw, { onProgress, isCancelled, sliceMs = 12 } = {}) {
  const run = createRun(raw);
  while (run.done < run.params.sims) {
    run.step(sliceMs);
    if (onProgress) onProgress(run.done / run.params.sims);
    if (isCancelled && isCancelled()) return null;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return run.finish();
}

// ---------- Sequence-of-returns illustration ----------

// Draw one retirement's worth of portfolio returns, then replay the SAME returns in three orders
// (as drawn, worst first, best first) with the same starting balance and spending rule.
export function sequenceRisk(raw, startBalance) {
  const p = normalizeParams(raw);
  const years = p.horizonAge - p.retireAge;
  if (years <= 0) return null;
  const growth = makeMarket(p);
  const normal = normalGenerator(mulberry32((p.seed ^ 0x9e3779b9) >>> 0));
  const factors = Array.from({ length: years }, (_, k) => growth(stockWeightAt(p, p.retireAge + k), normal(), normal()));
  const worstFirst = [...factors].sort((a, b) => a - b);
  const bestFirst = [...worstFirst].reverse();

  const replay = (order) => {
    const state = { prev: null, cuts: 0 };
    const balances = [startBalance];
    let b = startBalance;
    let failedAge = null;
    for (let k = 0; k < years; k++) {
      if (failedAge === null) {
        const need = nextWithdrawal(p, state, b);
        if (canPay(need, b)) b = Math.max(0, (b - need) * order[k]);
        else { failedAge = p.retireAge + k; b = 0; }
      }
      balances.push(b);
    }
    return { balances, failedAge, ending: b };
  };

  return {
    ages: Array.from({ length: years + 1 }, (_, k) => p.retireAge + k),
    startBalance,
    geometricMean: Math.exp(mean(factors.map(Math.log))) - 1,
    asDrawn: replay(factors),
    worstFirst: replay(worstFirst),
    bestFirst: replay(bestFirst),
  };
}
