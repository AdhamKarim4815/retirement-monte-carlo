// Small statistics helpers. Pure functions, no DOM, no dependencies.

export function mean(values) {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return values.length ? sum / values.length : NaN;
}

// Sample variance (n - 1 denominator).
export function variance(values) {
  const n = values.length;
  if (n < 2) return NaN;
  const m = mean(values);
  let acc = 0;
  for (let i = 0; i < n; i++) acc += (values[i] - m) * (values[i] - m);
  return acc / (n - 1);
}

export function stdev(values) {
  return Math.sqrt(variance(values));
}

export function sortedCopy(values) {
  return Float64Array.from(values).sort();
}

// Percentile of an already ascending-sorted array, p in [0, 100].
// Linear interpolation between closest ranks (the common "type 7" definition).
export function percentileSorted(sorted, p) {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

export function percentile(values, p) {
  return percentileSorted(sortedCopy(values), p);
}

// Index of the first maximum, or -1 for an empty list.
export function argMax(values) {
  let best = -1;
  for (let i = 0; i < values.length; i++) if (best < 0 || values[i] > values[best]) best = i;
  return best;
}

// Median position of a distribution given as counts per index (first index where cumulative >= half).
export function weightedMedianIndex(counts) {
  let total = 0;
  for (let i = 0; i < counts.length; i++) total += counts[i];
  if (total === 0) return -1;
  let run = 0;
  for (let i = 0; i < counts.length; i++) {
    run += counts[i];
    if (run * 2 >= total) return i;
  }
  return counts.length - 1;
}

// A "nice" step (1, 2, 2.5, 5 times a power of ten) at or above range / target.
export function niceStep(range, target = 5) {
  if (!(range > 0)) return 1;
  const raw = range / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  const mult = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return mult * pow;
}

// Equal-width histogram over [min, max]. Values above max land in the last bin and are also
// counted in `above`; values below min land in the first bin.
export function histogram(values, { bins, min, max }) {
  const width = (max - min) / bins;
  const counts = new Array(bins).fill(0);
  let above = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v > max) above++;
    const idx = Math.floor((v - min) / width);
    counts[Math.min(bins - 1, Math.max(0, idx))]++;
  }
  const edges = Array.from({ length: bins + 1 }, (_, k) => min + k * width);
  return { edges, counts, above };
}
