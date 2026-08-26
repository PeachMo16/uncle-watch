import test from 'node:test';
import assert from 'node:assert/strict';

import { uncleRate } from '../lib/score.mjs';

test('returns seven traceable dimensions and their weighted composite', () => {
  const sells = [
    { insider: 'A', date: '2026-01-01', plan10b51: false, pctOfStake: 20, price: 10, value: 1000 },
    { insider: 'A', date: '2026-01-03', plan10b51: false, pctOfStake: 50, price: 11, value: 2000 },
    { insider: 'A', date: '2026-01-05', plan10b51: false, pctOfStake: 80, price: 12, value: 3000 },
    { insider: 'B', date: '2026-01-05', plan10b51: true, pctOfStake: 10, price: 12, value: 500 },
  ];
  const report = {
    sells,
    buys: [{ value: 500 }],
    clusters: [[sells[0], { ...sells[1], insider: 'C' }]],
  };
  const sub = {
    formerNames: [{ name: 'Old Example' }],
    filings: { recent: { form: ['S-3', '424B5', '10-12G'] } },
  };

  const rate = uncleRate(report, sub);
  assert.deepEqual(rate.dims.map((d) => d.key), [
    'opportunistic', 'clusters', 'ladder', 'discipline', 'flow', 'dilution', 'shell',
  ]);
  assert.equal(rate.dims.reduce((sum, d) => sum + d.weight, 0), 1);
  assert.equal(rate.composite, Math.round(rate.dims.reduce((sum, d) => sum + d.score * d.weight, 0)));
  assert.match(rate.dims.find((d) => d.key === 'ladder').evidence, /20% → 50% → 80%/);
  assert.match(rate.dims.find((d) => d.key === 'shell').evidence, /Old Example/);
});
