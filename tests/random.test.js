import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, normalGenerator, assetModel } from '../src/sim.js';
import { mean, variance } from '../src/stats.js';

const draw = (fn, n) => Float64Array.from({ length: n }, fn);

test('mulberry32: same seed gives the same sequence', () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});

test('mulberry32: different seeds give different sequences', () => {
  const a = draw(mulberry32(1), 20);
  const b = draw(mulberry32(2), 20);
  assert.notDeepEqual(a, b);
});

test('mulberry32: outputs stay inside [0, 1)', () => {
  const r = mulberry32(99);
  for (let i = 0; i < 50000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1);
  }
});

test('mulberry32: uniform mean and variance are close to 1/2 and 1/12', () => {
  const xs = draw(mulberry32(7), 200000);
  assert.ok(Math.abs(mean(xs) - 0.5) < 0.005);
  assert.ok(Math.abs(variance(xs) - 1 / 12) < 0.002);
});

test('normalGenerator: mean near 0 and variance near 1', () => {
  const z = normalGenerator(mulberry32(2024));
  const xs = draw(z, 200000);
  assert.ok(Math.abs(mean(xs)) < 0.01, `mean ${mean(xs)}`);
  assert.ok(Math.abs(variance(xs) - 1) < 0.02, `variance ${variance(xs)}`);
});

test('normalGenerator: about 95% of draws fall within 1.96 and skew is near zero', () => {
  const xs = draw(normalGenerator(mulberry32(31337)), 200000);
  const inside = xs.filter((v) => Math.abs(v) < 1.96).length / xs.length;
  assert.ok(Math.abs(inside - 0.95) < 0.005, `inside ${inside}`);
  const m = mean(xs);
  const skew = mean(xs.map((v) => (v - m) ** 3));
  assert.ok(Math.abs(skew) < 0.05);
});

test('normalGenerator: deterministic for a given seed, both halves of each pair', () => {
  const a = draw(normalGenerator(mulberry32(5)), 11);
  const b = draw(normalGenerator(mulberry32(5)), 11);
  assert.deepEqual(a, b);
});

test('assetModel: lognormal growth factor has mean 1 + mu and the requested volatility', () => {
  const mu = 0.07;
  const sigma = 0.18;
  const a = assetModel(mu, sigma);
  const z = normalGenerator(mulberry32(808));
  const returns = draw(() => Math.exp(a.m + a.s * z()) - 1, 300000);
  assert.ok(Math.abs(mean(returns) - mu) < 0.003, `mean ${mean(returns)}`);
  assert.ok(Math.abs(Math.sqrt(variance(returns)) - sigma) < 0.004);
});

test('assetModel: zero volatility collapses to the deterministic factor', () => {
  const a = assetModel(0.05, 0);
  assert.equal(a.s, 0);
  assert.equal(a.mean1, 1.05);
});
