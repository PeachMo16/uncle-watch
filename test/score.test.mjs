import test from 'node:test';
import assert from 'node:assert/strict';

import { uncleRate } from '../lib/score.mjs';

const sub = {
  formerNames: [{ name: 'Old Example' }],
  filings: { recent: { form: ['S-3', '424B5', '10-12G'] } },
};
const bareSub = { formerNames: [], filings: { recent: { form: [] } } };

function sellRow(over = {}) {
  return { insider: 'A', date: '2026-01-01', planStatus: 'no 10b5-1 indication', pctOfStake: 20, price: 10, value: 1000, ...over };
}

test('returns six traceable risk dimensions and their weighted composite', () => {
  const sells = [
    sellRow(),
    sellRow({ date: '2026-01-03', pctOfStake: 50, price: 11, value: 2000 }),
    sellRow({ date: '2026-01-05', pctOfStake: 80, price: 12, value: 3000 }),
    sellRow({ insider: 'B', date: '2026-01-05', planStatus: '10b5-1 indicated', pctOfStake: 10, price: 12, value: 500 }),
  ];
  const report = { sells, buys: [], clusters: [[sells[0], { ...sells[1], insider: 'C' }]] };

  const rate = uncleRate(report, sub);
  assert.equal(rate.scoringVersion, 2);
  assert.deepEqual(rate.dims.map((d) => d.key), [
    'noPlanIndication', 'clusters', 'ladder', 'discipline', 'dilution', 'shell',
  ]);
  // weights renormalized to ~1 after removing the flow dimension
  assert.ok(Math.abs(rate.dims.reduce((sum, d) => sum + d.weight, 0) - 1) < 0.001);
  assert.equal(rate.composite, Math.round(rate.dims.reduce((sum, d) => sum + d.score * d.weight, 0)));
  assert.match(rate.dims.find((d) => d.key === 'ladder').evidence, /20% → 50% → 80%/);
  assert.match(rate.dims.find((d) => d.key === 'shell').evidence, /Old Example/);
  assert.equal(rate.dims.find((d) => d.key === 'noPlanIndication').score, 75); // 3 of 4 status-known
});

test('pre-2023 unknown-status sells are excluded from the ratio, not counted as unscheduled', () => {
  const report = {
    sells: [
      sellRow({ planStatus: 'unknown', date: '2022-06-01' }),
      sellRow({ planStatus: 'unknown', date: '2022-07-01' }),
      sellRow({ planStatus: '10b5-1 indicated', date: '2026-01-05' }),
    ],
    buys: [], clusters: [],
  };
  const dim = uncleRate(report, sub).dims.find((d) => d.key === 'noPlanIndication');
  assert.equal(dim.score, 0); // 0 of 1 status-known
  assert.match(dim.evidence, /2 pre-2023 sells with unknown status excluded/);

  const allUnknown = uncleRate({ sells: [sellRow({ planStatus: 'unknown' })], buys: [], clusters: [] }, sub);
  assert.match(allUnknown.dims.find((d) => d.key === 'noPlanIndication').evidence, /plan status unknown for all 1 sells/);
});

// the four flow combinations: buying is a counter-signal, never part of the composite
test('only sells: no buy counter-signal, and absence adds zero risk score', () => {
  const rate = uncleRate({ sells: [sellRow()], buys: [], clusters: [] }, bareSub);
  assert.equal(rate.dims.some((d) => d.key === 'flow'), false);
  const cs = rate.counterSignals.find((c) => c.key === 'openMarketBuying');
  assert.equal(cs.observed, false);
  assert.match(cs.evidence, /none observed/);
  // all-sell/zero-buy no longer manufactures risk: composite reflects only the six dims
  assert.equal(rate.composite, Math.round(rate.dims.reduce((s, d) => s + d.score * d.weight, 0)));
});

test('only buys: counter-signal reports amount, count, buyers, latest date', () => {
  const rate = uncleRate({
    sells: [], clusters: [],
    buys: [
      { insider: 'A', date: '2026-02-01', value: 50000 },
      { insider: 'B', date: '2026-03-01', value: 25000 },
    ],
  }, bareSub);
  const cs = rate.counterSignals.find((c) => c.key === 'openMarketBuying');
  assert.equal(cs.observed, true);
  assert.match(cs.evidence, /\$75,000 across 2 buys by 2 insiders, most recent 2026-03-01/);
});

test('both: a token buy does not offset or reduce the sell-side composite', () => {
  const sells = [sellRow(), sellRow({ date: '2026-01-03', pctOfStake: 50 })];
  const without = uncleRate({ sells, buys: [], clusters: [] }, bareSub);
  const withBuy = uncleRate({ sells, buys: [{ insider: 'Z', date: '2026-01-04', value: 100 }], clusters: [] }, bareSub);
  assert.equal(withBuy.composite, without.composite);
  assert.equal(withBuy.counterSignals[0].observed, true);
});

test('neither sells nor buys: zero scores, no manufactured danger', () => {
  const rate = uncleRate({ sells: [], buys: [], clusters: [] }, bareSub);
  assert.equal(rate.composite, 0);
  assert.equal(rate.counterSignals[0].observed, false);
});
