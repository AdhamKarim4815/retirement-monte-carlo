// Fictional personas. Each overrides DEFAULTS; everything is in today's dollars.

export const PRESETS = [
  {
    id: 'jordan', name: 'Jordan, 35', note: 'Steady mid-career saver, fixed spending',
    params: {},
  },
  {
    id: 'maya', name: 'Maya, 29', note: 'Early saver on a glide path',
    params: {
      currentAge: 29, retireAge: 62, horizonAge: 92, savings: 40000, contribution: 18000, contributionGrowth: 0.03,
      glide: true, stockNow: 0.9, stockRetire: 0.6, stockEnd: 0.4, withdrawal: 58000,
    },
  },
  {
    id: 'daniel', name: 'Daniel, 46', note: 'Late start, catching up',
    params: {
      currentAge: 46, retireAge: 67, horizonAge: 95, savings: 120000, contribution: 22000, contributionGrowth: 0.01,
      stockNow: 0.75, withdrawal: 50000,
    },
  },
  {
    id: 'priya', name: 'Priya and Sam, 58', note: 'Five years out, guardrails spending',
    params: {
      currentAge: 58, retireAge: 63, horizonAge: 95, savings: 1250000, contribution: 30000, contributionGrowth: 0,
      stockNow: 0.6, strategy: 'guardrails', withdrawalRate: 0.048, floor: 45000,
    },
  },
  {
    id: 'ruth', name: 'Ruth, 66', note: 'Just retired, a fixed paycheck-style budget',
    params: { currentAge: 66, retireAge: 66, horizonAge: 96, savings: 900000, contribution: 0, stockNow: 0.6, withdrawal: 42000 },
  },
  {
    id: 'leo', name: 'Leo, 41', note: 'Percent-of-portfolio spender with a floor',
    params: {
      currentAge: 41, retireAge: 60, horizonAge: 92, savings: 260000, contribution: 28000, contributionGrowth: 0.02,
      glide: true, stockNow: 0.85, stockRetire: 0.65, stockEnd: 0.45, strategy: 'percent', withdrawalRate: 0.04, floor: 35000,
    },
  },
];
