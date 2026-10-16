import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS, normalizeParams, checkParams, simulate, simulateAsync, stockWeightAt, guardrailsWithdrawal, sequenceRisk,
} from '../src/sim.js';

// A zero-volatility market with a single 5% growth factor, so results are deterministic.
const FLAT = { stockVol: 0, bondVol: 0, stockReturn: 0.05, bondReturn: 0.05, sims: 40 };
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} vs ${b}`);

// Independent closed forms (geometric series), not the engine's loop.
function accumulation(S, c, cg, g, n) {
  const q = 1 + cg;
  const contributions = g === q ? c * n * g ** (n - 1) : (c * (g ** n - q ** n)) / (g - q);
  return S * g ** n + contributions;
}
const afterWithdrawals = (B0, W, g, m) => B0 * g ** m - (W * g * (g ** m - 1)) / (g - 1);

test('zero volatility: every percentile band collapses onto one line', () => {
  const r = simulate({ ...FLAT });
  for (let t = 0; t < r.ages.length; t++) {
    assert.equal(r.bands.p10[t], r.bands.p90[t]);
    assert.equal(r.bands.p25[t], r.bands.p75[t]);
  }
});

test('zero volatility: accumulation phase matches the closed-form projection at every age', () => {
  const p = { ...FLAT, currentAge: 30, retireAge: 60, horizonAge: 60, savings: 25000, contribution: 9000, contributionGrowth: 0.03, stockNow: 0.5 };
  const r = simulate(p);
  r.ages.forEach((age, t) => near(r.bands.p50[t], accumulation(25000, 9000, 0.03, 1.05, t)));
});

test('zero volatility: contribution growth equal to the return still matches the closed form', () => {
  const p = { ...FLAT, currentAge: 40, retireAge: 55, horizonAge: 55, savings: 1000, contribution: 5000, contributionGrowth: 0.05 };
  const r = simulate(p);
  near(r.bands.p50[15], accumulation(1000, 5000, 0.05, 1.05, 15));
});

test('zero volatility: retirement phase with fixed spending matches the closed form', () => {
  const p = { ...FLAT, currentAge: 65, retireAge: 65, horizonAge: 90, savings: 1000000, contribution: 0, withdrawal: 50000 };
  const r = simulate(p);
  for (const m of [1, 10, 25]) near(r.bands.p50[m], afterWithdrawals(1000000, 50000, 1.05, m));
  assert.equal(r.successRate, 1);
});

test('zero volatility: full lifecycle (save, then spend) matches the closed form end to end', () => {
  const p = { ...FLAT, currentAge: 30, retireAge: 60, horizonAge: 90, savings: 20000, contribution: 12000, contributionGrowth: 0.02, withdrawal: 40000 };
  const r = simulate(p);
  const atRetire = accumulation(20000, 12000, 0.02, 1.05, 30);
  near(r.retirementBalance.p50, atRetire);
  near(r.ending.median, afterWithdrawals(atRetire, 40000, 1.05, 30));
});

test('zero volatility: a two-asset mix grows at the weighted factor', () => {
  const p = { ...FLAT, stockReturn: 0.08, bondReturn: 0.02, stockNow: 0.25, currentAge: 30, retireAge: 40, horizonAge: 40, savings: 100, contribution: 0 };
  const g = 0.25 * 1.08 + 0.75 * 1.02;
  near(simulate(p).ending.median, 100 * g ** 10);
});

test('contributions: zero return, flat contribution adds the same amount every year', () => {
  const p = { ...FLAT, stockReturn: 0, bondReturn: 0, currentAge: 30, retireAge: 40, horizonAge: 40, savings: 500, contribution: 1000, contributionGrowth: 0 };
  const r = simulate(p);
  r.ages.forEach((age, t) => assert.equal(r.bands.p50[t], 500 + 1000 * t));
});

test('contributions: they grow each year by the stated rate (end-of-year deposits)', () => {
  const p = { ...FLAT, stockReturn: 0, bondReturn: 0, currentAge: 30, retireAge: 33, horizonAge: 33, savings: 0, contribution: 100, contributionGrowth: 0.1 };
  const r = simulate(p);
  near(r.bands.p50[3], 100 + 110 + 121);
});

test('withdrawals: zero return, fixed spending is taken at the start of each year', () => {
  const p = { ...FLAT, stockReturn: 0, bondReturn: 0, currentAge: 65, retireAge: 65, horizonAge: 75, savings: 100, contribution: 0, withdrawal: 10 };
  const r = simulate(p);
  r.ages.forEach((age, t) => assert.equal(r.bands.p50[t], 100 - 10 * t));
  assert.equal(r.successRate, 1, 'ending at exactly zero still funded every withdrawal');
});

test('withdrawals: spending that cannot be paid counts as a failure at that age', () => {
  const p = { ...FLAT, stockReturn: 0, bondReturn: 0, currentAge: 65, retireAge: 65, horizonAge: 75, savings: 95, contribution: 0, withdrawal: 10 };
  const r = simulate(p);
  assert.equal(r.successRate, 0);
  assert.equal(r.peakFailureAge, 74);
  assert.equal(r.bands.p50[10], 0);
});

test('success probability is 0 when savings are zero and spending is positive', () => {
  const r = simulate({ currentAge: 65, retireAge: 65, horizonAge: 90, savings: 0, contribution: 0, withdrawal: 1000, sims: 300 });
  assert.equal(r.successRate, 0);
  assert.equal(r.failures, 300);
  assert.equal(r.peakFailureAge, 65);
  assert.equal(r.histogram.depleted, 300);
});

test('success probability is 1 for modest spending against a large portfolio', () => {
  const r = simulate({ currentAge: 65, retireAge: 65, horizonAge: 95, savings: 5000000, contribution: 0, withdrawal: 40000, sims: 1000 });
  assert.equal(r.successRate, 1);
  assert.equal(r.peakFailureAge, null);
  assert.equal(r.failures, 0);
});

test('same seed gives identical results, a different seed gives different ones', () => {
  const a = simulate({ ...DEFAULTS, sims: 500, seed: 77 });
  const b = simulate({ ...DEFAULTS, sims: 500, seed: 77 });
  const c = simulate({ ...DEFAULTS, sims: 500, seed: 78 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.bands.p50, c.bands.p50);
});

test('chunked async run matches the synchronous run exactly', async () => {
  const p = { ...DEFAULTS, sims: 800, seed: 4242 };
  const sync = simulate(p);
  const chunks = [];
  const asyncResult = await simulateAsync(p, { sliceMs: 0, onProgress: (f) => chunks.push(f) });
  assert.deepEqual(asyncResult, sync);
  assert.ok(chunks.length > 1, 'ran in more than one slice');
});

test('a cancelled async run resolves to null', async () => {
  assert.equal(await simulateAsync({ ...DEFAULTS, sims: 2000 }, { sliceMs: 0, isCancelled: () => true }), null);
});

test('common random numbers: changing the spending rule does not change the market paths', () => {
  const base = { ...DEFAULTS, sims: 400, seed: 9 };
  const a = simulate({ ...base, strategy: 'fixed' });
  const b = simulate({ ...base, strategy: 'percent', floor: 0 });
  for (let t = 0; t <= a.retireIndex; t++) assert.equal(a.bands.p50[t], b.bands.p50[t]);
});

test('nominal inputs are converted to real returns with the inflation rate', () => {
  const p = { ...FLAT, returnBasis: 'nominal', inflation: 0.025, stockReturn: 0.05, bondReturn: 0.05, currentAge: 30, retireAge: 40, horizonAge: 40, savings: 100, contribution: 0 };
  near(simulate(p).ending.median, 100 * (1.05 / 1.025) ** 10);
});

test('percent-of-portfolio with no floor can never run out of money', () => {
  const r = simulate({ ...DEFAULTS, strategy: 'percent', withdrawalRate: 0.05, floor: 0, sims: 600 });
  assert.equal(r.successRate, 1);
  assert.ok(r.ending.p10 > 0);
});

test('percent-of-portfolio with a high floor can fail', () => {
  const r = simulate({ ...DEFAULTS, strategy: 'percent', withdrawalRate: 0.03, floor: 90000, sims: 600 });
  assert.ok(r.successRate < 1);
});

test('guardrails: cut above the upper rail, raise below the lower rail, hold in between', () => {
  const g = { initialRate: 0.05, band: 0.2, adjust: 0.1, floor: 0 };
  const cut = guardrailsWithdrawal({ ...g, previous: 70000, balance: 1000000 });
  assert.equal(cut.action, 'cut');
  near(cut.amount, 63000);
  const raise = guardrailsWithdrawal({ ...g, previous: 30000, balance: 1000000 });
  assert.equal(raise.action, 'raise');
  near(raise.amount, 33000);
  const hold = guardrailsWithdrawal({ ...g, previous: 50000, balance: 1000000 });
  assert.equal(hold.action, 'hold');
  assert.equal(hold.amount, 50000);
});

test('guardrails: the spending floor is respected and an empty portfolio forces a cut', () => {
  const g = guardrailsWithdrawal({ previous: 70000, balance: 1000000, initialRate: 0.05, band: 0.2, adjust: 0.1, floor: 68000 });
  assert.equal(g.amount, 68000);
  assert.equal(guardrailsWithdrawal({ previous: 1, balance: 0, initialRate: 0.05, band: 0.2, adjust: 0.1 }).action, 'cut');
});

test('guardrails: start at rate times portfolio and hold steady when the market is flat', () => {
  const p = { ...FLAT, currentAge: 65, retireAge: 65, horizonAge: 70, savings: 1000000, contribution: 0, strategy: 'guardrails', withdrawalRate: 0.05, floor: 0 };
  const r = simulate(p);
  near(r.spend.firstMedian, 50000);
  assert.equal(r.spend.cutShare, 0);
});

test('guardrails: survives a stressed market more often than fixed spending at the same start', () => {
  const stress = { currentAge: 65, retireAge: 65, horizonAge: 95, savings: 1000000, contribution: 0, stockReturn: 0.04, stockVol: 0.2, sims: 3000, seed: 3 };
  const fixed = simulate({ ...stress, strategy: 'fixed', withdrawal: 55000 });
  const rails = simulate({ ...stress, strategy: 'guardrails', withdrawalRate: 0.055, floor: 0 });
  assert.ok(rails.successRate > fixed.successRate, `${rails.successRate} vs ${fixed.successRate}`);
  assert.ok(rails.spend.cutShare > 0);
});

test('glide path: weights interpolate from now, to retirement, to the horizon', () => {
  const p = normalizeParams({ glide: true, currentAge: 30, retireAge: 60, horizonAge: 90, stockNow: 0.9, stockRetire: 0.5, stockEnd: 0.3 });
  near(stockWeightAt(p, 30), 0.9);
  near(stockWeightAt(p, 45), 0.7);
  near(stockWeightAt(p, 60), 0.5);
  near(stockWeightAt(p, 75), 0.4);
  near(stockWeightAt(p, 90), 0.3);
  assert.equal(stockWeightAt({ ...p, glide: false }, 75), 0.9);
});

test('failure ages: the failure histogram adds up to the number of failures', () => {
  const r = simulate({ ...DEFAULTS, withdrawal: 120000, sims: 800 });
  assert.equal(r.failuresByAge.reduce((a, b) => a + b, 0), r.failures);
  assert.ok(r.failures > 0);
  assert.ok(r.medianFailureAge >= r.ages[r.retireIndex]);
  assert.equal(r.histogram.depleted, r.failures);
  assert.equal(r.histogram.counts.reduce((a, b) => a + b, 0), r.histogram.survivors);
});

test('percentile bands are ordered at every age', () => {
  const r = simulate({ ...DEFAULTS, sims: 600 });
  for (let t = 0; t < r.ages.length; t++) {
    assert.ok(r.bands.p10[t] <= r.bands.p25[t] && r.bands.p25[t] <= r.bands.p50[t]);
    assert.ok(r.bands.p50[t] <= r.bands.p75[t] && r.bands.p75[t] <= r.bands.p90[t]);
  }
});

test('normalizeParams: clamps ages, allocations and sims, and keeps the seed an unsigned integer', () => {
  const p = normalizeParams({ currentAge: 40, retireAge: 99, horizonAge: 70, stockNow: 4, correlation: -9, sims: 1e9, seed: -1 });
  assert.equal(p.retireAge, 70);
  assert.equal(p.stockNow, 1);
  assert.equal(p.correlation, -1);
  assert.equal(p.sims, 50000);
  assert.equal(p.seed, 4294967295);
  assert.equal(normalizeParams({ strategy: 'nonsense' }).strategy, 'fixed');
  assert.equal(normalizeParams({ savings: 'abc' }).savings, DEFAULTS.savings);
});

test('checkParams: explains adjustments and degenerate plans', () => {
  assert.equal(checkParams({}).length, 0);
  assert.ok(checkParams({ retireAge: 99, horizonAge: 90 })[0].includes('past the plan end'));
  assert.ok(checkParams({ retireAge: 90, horizonAge: 90 }).some((n) => n.includes('no retirement years')));
});

test('no retirement years: the plan trivially succeeds and the sequence demo is skipped', () => {
  const p = { ...DEFAULTS, retireAge: 95, horizonAge: 95, sims: 200 };
  assert.equal(simulate(p).successRate, 1);
  assert.equal(sequenceRisk(p, 1000000), null);
});

test('sequence of returns: same average return, but bad years first ends lower than good years first', () => {
  const p = { ...DEFAULTS, currentAge: 65, retireAge: 65, horizonAge: 95, savings: 1000000, withdrawal: 40000, seed: 11 };
  const s = sequenceRisk(p, 1000000);
  assert.ok(s.worstFirst.failedAge !== null, 'worst-first order runs out of money');
  assert.ok(s.worstFirst.ending < s.asDrawn.ending);
  assert.ok(s.asDrawn.ending < s.bestFirst.ending);
  assert.equal(s.ages.length, s.worstFirst.balances.length);
  assert.deepEqual(sequenceRisk(p, 1000000), s, 'deterministic for a given seed');
});

test('sequence of returns: with a zero-volatility market all orderings agree', () => {
  const p = { ...FLAT, currentAge: 65, retireAge: 65, horizonAge: 85, savings: 1000000, withdrawal: 50000 };
  const s = sequenceRisk(p, 1000000);
  near(s.worstFirst.ending, s.bestFirst.ending);
  near(s.geometricMean, 0.05);
});
