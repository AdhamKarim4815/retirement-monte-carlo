import test from 'node:test';
import assert from 'node:assert/strict';
import { mean, variance, stdev, percentile, percentileSorted, histogram, niceStep, argMax, weightedMedianIndex } from '../src/stats.js';

test('percentile: endpoints return the minimum and maximum', () => {
  const xs = [5, 1, 9, 3];
  assert.equal(percentile(xs, 0), 1);
  assert.equal(percentile(xs, 100), 9);
});

test('percentile: median of odd and even length lists', () => {
  assert.equal(percentile([3, 1, 2], 50), 2);
  assert.equal(percentile([4, 1, 3, 2], 50), 2.5);
});

test('percentile: linear interpolation between ranks', () => {
  assert.equal(percentileSorted([1, 2, 3, 4], 25), 1.75);
  assert.equal(percentileSorted([10, 20], 90), 19);
});

test('percentile: unsorted input matches sorted input, and input is not mutated', () => {
  const xs = [9, 2, 7, 4, 5, 1, 8];
  const copy = [...xs];
  assert.equal(percentile(xs, 75), percentileSorted([1, 2, 4, 5, 7, 8, 9], 75));
  assert.deepEqual(xs, copy);
});

test('percentile: single value and empty input', () => {
  assert.equal(percentile([42], 90), 42);
  assert.ok(Number.isNaN(percentile([], 50)));
});

test('mean, variance, stdev: known values', () => {
  const xs = [2, 4, 4, 4, 5, 5, 7, 9];
  assert.equal(mean(xs), 5);
  assert.ok(Math.abs(variance(xs) - 32 / 7) < 1e-12);
  assert.ok(Math.abs(stdev(xs) - Math.sqrt(32 / 7)) < 1e-12);
});

test('histogram: counts add up, overflow goes in the last bin and is reported', () => {
  const h = histogram([0, 1, 2, 3, 4, 100], { bins: 4, min: 0, max: 4 });
  assert.equal(h.counts.reduce((a, b) => a + b, 0), 6);
  assert.deepEqual(h.counts, [1, 1, 1, 3]);
  assert.equal(h.above, 1);
  assert.deepEqual(h.edges, [0, 1, 2, 3, 4]);
});

test('niceStep: picks 1, 2, 2.5, 5 times a power of ten', () => {
  assert.equal(niceStep(100, 5), 20);
  assert.equal(niceStep(1000000, 4), 250000);
  assert.equal(niceStep(7, 5), 2);
  assert.equal(niceStep(0, 5), 1);
});

test('argMax and weightedMedianIndex', () => {
  assert.equal(argMax([1, 5, 5, 2]), 1);
  assert.equal(argMax([]), -1);
  assert.equal(weightedMedianIndex([0, 1, 1, 2]), 2);
  assert.equal(weightedMedianIndex([4, 0, 0, 0]), 0);
  assert.equal(weightedMedianIndex([0, 0]), -1);
});
