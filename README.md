# retirement-monte-carlo

Seeded Monte Carlo simulator for savings and retirement plans: a static page with no build step, no dependencies, and no network calls.

![Screenshot of the simulator showing a success probability, percentile fan chart and ending balance histogram](docs/screenshot.png)

**[Live demo](https://adhamkarim4815.github.io/retirement-monte-carlo/)**

## Live demo

Enable GitHub Pages for your copy of the repo (Settings, Pages, deploy from branch `main`, root folder). The app is then served at:

https://adhamkarim4815.github.io/retirement-monte-carlo/

It also works by simply opening `index.html` from disk (`file://`), offline.

## Run locally

```sh
git clone https://github.com/adhamkarim4815/retirement-monte-carlo.git
cd retirement-monte-carlo
open index.html        # or double-click it, or: python3 -m http.server
```

No install step. Node 20 or newer is only needed to run the tests.

## What it does

- Inputs: ages (current, retirement, plan end), savings, annual contribution with yearly growth, stock and bond return, volatility and correlation, real or nominal return basis with inflation, optional glide path for the stock share, and a withdrawal strategy: fixed real amount, percent of portfolio (with a spending floor), or guardrails.
- Runs 2,000 to 10,000 paths in the browser in roughly a tenth of a second, in short slices so the page never freezes.
- Outputs: fan chart of 10/25/50/75/90th percentile bands by age (hover, tap or use arrow keys), probability of success, median and worst-decile ending balances, histogram of ending balances, the age at which most failures happen, and a sequence-of-returns illustration.
- The seed is shown and editable. Same seed and inputs always give identical numbers, and changing only the spending rule reuses the same market paths, so comparisons are apples to apples.
- Six fictional personas to start from. The whole plan is encoded in the URL hash, so a link shares it.

## How the simulation works

Everything is in real (today's) dollars. Time steps are whole years; year `t` starts at age `currentAge + t`.

**Randomness.** `mulberry32(seed)` yields uniforms in [0, 1); Box-Muller turns pairs of them into standard normals. Each simulated year draws two independent normals `z1`, `z2`, always, even after a path has failed, so a seed maps to the same market paths regardless of strategy.

**Returns.** For an asset with expected arithmetic return `mu` and volatility `sigma`, the growth factor is lognormal: `1 + R = exp(m + s z)` with `s^2 = ln(1 + sigma^2 / (1 + mu)^2)` and `m = ln(1 + mu) - s^2 / 2`. This gives `E[1 + R] = 1 + mu` and `Var[R] = sigma^2` exactly, and never a return below -100%. Stocks use `z1`, bonds use `rho z1 + sqrt(1 - rho^2) z2`. With nominal inputs, `mu_real = (1 + mu) / (1 + inflation) - 1`. With `sigma = 0` the factor is exactly `1 + mu`.

**Portfolio.** With stock share `w` (constant, or interpolated linearly now to retirement to plan end for a glide path), annual growth is `g = w (1 + R_stock) + (1 - w) (1 + R_bond)`, i.e. rebalanced to target every year.

**Accumulation** (age below retirement): `B' = B g + c (1 + cg)^t`. Contributions are deposited at the end of the year.

**Retirement**: spending `W` is withdrawn at the start of the year, then the remainder grows: `B' = (B - W) g`. If `W > B`, the plan has failed at that age and the balance is 0 from then on. A balance that lands exactly on zero after paying the last withdrawal still counts as success.

**Withdrawal strategies**

| Strategy | Rule |
| --- | --- |
| Fixed | `W` is a constant real amount |
| Percent of portfolio | `W = max(rate * B, floor)` |
| Guardrails | First year `W0 = rate * B`. After that, with `r = W_prev / B`: if `r > rate (1 + band)` then `W = W_prev (1 - adjust)`; if `r < rate (1 - band)` then `W = W_prev (1 + adjust)`; otherwise `W = W_prev`. Always at least `floor` |

Guardrails here is a simplified take on Guyton and Klinger's rules (capital preservation and prosperity rules, working in real terms, no "skip the inflation raise" rule).

**Statistics.** Percentiles use linear interpolation between closest ranks. Success is the share of paths that paid every year of spending. The "worst decile" is the 10th percentile of ending balances (failed paths count as 0), alongside the mean of the worst 10%. The "year most failures happen" is the modal age at which paths first fail to pay.

**Sequence-of-returns illustration.** One retirement-length sequence of portfolio returns is drawn, then replayed worst-first, as drawn, and best-first, from the median retirement balance with your spending rule. The average return is identical in all three; only the order differs.

## Tests

```sh
node --test
```

The suite covers PRNG determinism and distribution sanity, percentile and histogram math, exact agreement with closed-form projections when volatility is zero, contribution and withdrawal mechanics, success probability of 0 and 1 in extreme cases, seed reproducibility, chunked versus synchronous runs, guardrails behaviour, the URL hash codec, and a repo-wide check for stray dash characters.

## Layout

```
index.html            page shell
src/sim.js            simulation engine (pure ES module, no DOM)
src/stats.js          percentiles, histogram and other helpers
src/presets.js        fictional personas
src/state.js          URL hash encode and decode
src/charts.js         hand-drawn SVG charts
src/app.js            form, wiring and rendering
src/styles.css        styles, light and dark
dist/rmc.bundle.js    src/ concatenated into one classic script (generated)
scripts/bundle.mjs    the concatenation script
tests/                node:test suite
docs/screenshot.png   screenshot used above
```

**Why a bundle?** Browsers block `import` of local files from `file://` pages, so `index.html` loads `dist/rmc.bundle.js`, a plain concatenation of `src/` (no minifying or transpiling) that also works on GitHub Pages. If you edit anything in `src/`, run `node scripts/bundle.mjs`; a test fails if the bundle is stale. For the same reason the simulation runs in short time slices on the main thread instead of a Web Worker, which browsers also refuse to start from `file://`.

## Limitations

This is an educational toy, not financial advice or a planning tool, and nothing here should drive real decisions.

- Returns are independent year to year and lognormal. Real markets have fatter tails, volatility clustering, and regime changes. Stock-bond correlation is fixed.
- Inflation is not random. No taxes, fees, social security or pension income, healthcare shocks, or one-off expenses. Contributions are fixed in real terms apart from the growth you set.
- Two assets only, rebalanced yearly, with a linear glide path.
- Simulated retirement ages are fixed; longevity is a single planning horizon, not a distribution.
- With 2,000 to 10,000 paths, success rates carry sampling noise of roughly a percentage point or less.

## License

MIT. See [LICENSE](LICENSE). Built by Adham Karim.
