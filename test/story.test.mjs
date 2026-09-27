import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStory, eightKEvents, ITEM_LABELS } from '../lib/story.mjs';

function sub(rows) {
  const cols = { accessionNumber: [], filingDate: [], reportDate: [], form: [], items: [], primaryDocument: [] };
  rows.forEach(([filingDate, form, items, reportDate], i) => {
    cols.accessionNumber.push(`0000000000-26-${String(i + 1).padStart(6, '0')}`);
    cols.filingDate.push(filingDate); cols.form.push(form); cols.items.push(items);
    cols.reportDate.push(reportDate ?? filingDate); cols.primaryDocument.push('doc.htm');
  });
  return { filings: { recent: cols } };
}
const sell = (date, over = {}) => ({ insider: 'A', date, price: 10, shares: 1000, value: 10000, pctOfStake: 50, planStatus: 'no 10b5-1 indication', ...over });

test('8-K rows become labelled events; exhibits-only filings and non-8-Ks are dropped', () => {
  const events = eightKEvents(sub([
    ['2026-03-10', '8-K', '1.01,3.02,9.01', '2026-03-08'],
    ['2026-03-12', '8-K', '9.01'],
    ['2026-03-14', '4', ''],
    ['2026-03-20', '8-K/A', '2.01,9.01', '2026-01-05'],
  ]));
  assert.deepEqual(events.map((e) => e.date), ['2026-03-10', '2026-03-20']);
  assert.deepEqual(events[0].items, ['1.01', '3.02']);
  assert.deepEqual(events[0].labels, [ITEM_LABELS['1.01'], ITEM_LABELS['3.02']]);
  assert.equal(events[0].eventDate, '2026-03-08');
  assert.equal(events[1].amendment, true);
});

test('a sell is matched to the soonest 8-K after it and the latest before it, inside the window only', () => {
  const s = sub([
    ['2026-01-20', '8-K', '5.02,9.01'],
    ['2026-03-10', '8-K', '1.01,3.02,9.01'],
    ['2026-03-25', '8-K', '2.02,9.01'],
  ]);
  const story = buildStory(s, { sells: [sell('2026-02-28'), sell('2026-01-22', { insider: 'B' }), sell('2025-06-01', { insider: 'C' })] });
  const a = story.sells.find((x) => x.date === '2026-02-28');
  assert.equal(a.next.date, '2026-03-10'); // soonest after, not the later 03-25
  assert.equal(a.next.days, 10);
  assert.equal(a.prev, null); // 01-20 is 39 days back, outside the 30-day window
  const b = story.sells.find((x) => x.insider === 'B');
  assert.equal(b.prev.date, '2026-01-20'); assert.equal(b.prev.days, 2);
  assert.equal(b.next, null);
  const c = story.sells.find((x) => x.insider === 'C');
  assert.equal(c.next, null); assert.equal(c.prev, null);
});

test('10b5-1 sells are excluded from the alignment and counted', () => {
  const story = buildStory(sub([['2026-03-10', '8-K', '3.02,9.01']]), {
    sells: [sell('2026-03-01'), sell('2026-03-02', { planStatus: '10b5-1 indicated' }), sell('2022-03-02', { planStatus: 'unknown' })],
  });
  assert.equal(story.summary.sellsConsidered, 2); // no-indication + unknown
  assert.equal(story.summary.planSellsExcluded, 1);
});

test('summary tallies the item most often ahead of a sell and headlines the largest such sell', () => {
  const s = sub([
    ['2026-03-10', '8-K', '1.01,3.02,9.01'],
    ['2026-06-10', '8-K', '3.02,9.01'],
    ['2026-09-10', '8-K', '2.02,9.01'],
  ]);
  const story = buildStory(s, { sells: [
    sell('2026-03-01', { value: 5000 }),
    sell('2026-06-01', { insider: 'B', value: 90000, pctOfStake: 100 }),
    sell('2026-09-01', { insider: 'C', value: 20000 }),
    sell('2026-09-12', { insider: 'D', value: 1 }), // after the last filing, nothing ahead
  ] });
  assert.equal(story.summary.soldWithinWindowBefore, 3);
  assert.equal(story.summary.soldWithinWindowAfter, 1);
  assert.deepEqual(story.summary.topItemAhead, { item: '3.02', label: ITEM_LABELS['3.02'], sells: 2 });
  // 3.02 and 1.01 tie on one filing's worth of sells only if 1.01 were on both; here 3.02 leads outright
  assert.ok(story.summary.baselineShareOfDaysBeforeAn8K > 0 && story.summary.baselineShareOfDaysBeforeAn8K < 1);
  assert.match(story.summary.headline, /^B sold 100% of stake \(\$90,000\) on 2026-06-01, 9 days before an 8-K: unregistered sale of equity$/);
});

test('a press release riding on a substantive item does not win the tally; alone, it still counts', () => {
  const s = sub([['2026-03-10', '8-K', '3.02,7.01,9.01'], ['2026-06-10', '8-K', '7.01,9.01']]);
  const story = buildStory(s, { sells: [sell('2026-03-01'), sell('2026-06-01', { insider: 'B' })] });
  assert.deepEqual(story.summary.topItemAhead, { item: '3.02', label: ITEM_LABELS['3.02'], sells: 1 });
});

test('the baseline says how much of the calendar sits inside the window before some 8-K', () => {
  // one 8-K, latest date 2026-03-10, lookback 100 days → 31 of 101 days are "within 30 days before an 8-K"
  const story = buildStory(sub([['2026-03-10', '8-K', '8.01,9.01']]), { sells: [] }, { lookbackDays: 100 });
  assert.equal(story.summary.baselineShareOfDaysBeforeAn8K, +(31 / 101).toFixed(2));
  const dense = buildStory(sub(Array.from({ length: 12 }, (_, i) => [`2026-${String(i + 1).padStart(2, '0')}-15`, '8-K', '8.01,9.01'])), { sells: [] }, { lookbackDays: 300 });
  assert.equal(dense.summary.baselineShareOfDaysBeforeAn8K, 1);
});

test('timeline is newest first, 8-K before SELL on the same day, and bounded by the lookback from the latest date', () => {
  const s = sub([['2026-03-10', '8-K', '8.01,9.01'], ['2024-01-01', '8-K', '8.01,9.01']]);
  const story = buildStory(s, { sells: [sell('2026-03-10'), sell('2025-12-01')] }, { lookbackDays: 200 });
  assert.equal(story.to, '2026-03-10');
  assert.deepEqual(story.timeline.map((t) => `${t.date} ${t.kind}`), ['2026-03-10 8-K', '2026-03-10 SELL', '2025-12-01 SELL']);
  assert.equal(story.sells[0].next.days, 0);
});

test('no 8-Ks at all is a story with no alignments, not a crash', () => {
  const story = buildStory(sub([]), { sells: [sell('2026-03-01')] });
  assert.equal(story.events.length, 0);
  assert.equal(story.summary.headline, null);
  assert.equal(story.summary.topItemAhead, null);
});
