import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReport } from '../lib/analyze.mjs';

const days = Array.from({ length: 32 }, (_, i) => ({
  date: `2026-01-${String(i + 1).padStart(2, '0')}`,
  close: 10 + i / 10,
}));

function insider(name, events) {
  return { name, roles: ['Director'], events };
}

function sell(date, { plan10b51 = false, price = 12, shares = 10, sharesAfter = 90 } = {}) {
  return { code: 'S', date, plan10b51, price, shares, sharesAfter };
}

test('uses strict 10-day windows instead of chaining adjacent gaps', () => {
  const report = buildReport([
    insider('A', [sell('2026-01-01')]),
    insider('B', [sell('2026-01-09')]),
    insider('C', [sell('2026-01-18')]),
  ], days);

  assert.equal(report.clusters.length, 1);
  assert.deepEqual(report.clusters[0].map((x) => x.insider), ['A', 'B']);
});

test('excludes scheduled plan sales from opportunistic clusters and exit zones', () => {
  const report = buildReport([
    insider('A', [sell('2026-01-03', { plan10b51: true, price: 99 })]),
    insider('B', [sell('2026-01-04', { price: 11 })]),
    insider('C', [sell('2026-01-05', { price: 13 })]),
  ], days);

  assert.equal(report.clusters.length, 1);
  assert.deepEqual(report.clusters[0].map((x) => x.insider), ['B', 'C']);
  assert.equal(report.exitZone.priceP75, 11);
  assert.equal(report.exitZone.median, 11);
});

test('derives percent of stake from the post-transaction balance', () => {
  const report = buildReport([
    insider('A', [sell('2026-01-03', { shares: 25, sharesAfter: 75 })]),
  ], days);

  assert.equal(report.sells[0].pctOfStake, 25);
});
