import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPersonalHistory, coverageIssues } from '../lib/history.mjs';
import { parseArgs } from '../lib/cli-options.mjs';
import { aggregateInsiders, dedupeAmendments } from '../lib/parse.mjs';

const coverage = { history: { requested: true, archivesAdvertised: 0, archivesLoaded: 0, failedArchives: [], skippedArchives: [], sources: [] }, skippedFiles: [], failedFiles: [], omittedFiles: [] };
let seq = 0;
function filing(date, opts = {}) {
  return { form: '4', filingDate: date, acceptanceDateTime: `${date}T18:00:00Z`, accession: `test-${seq++}`,
    issuerCik: '100', issuerName: 'Company A', issuerSymbol: 'AAA', periodOfReport: opts.transactionDate ?? date,
    dateOfOriginalSubmission: null, planStatus: 'no 10b5-1 indication', owners: [{ cik: '42', name: 'Example Person' }],
    transactions: [{ code: 'S', date: opts.transactionDate ?? date, price: 10, shares: 10, sharesAfter: 90, securityTitle: 'Common Stock', directOrIndirect: 'D' }], ...opts };
}
const baseline = () => ['2023-08-01', '2024-01-01', '2024-06-01', '2025-01-01', '2025-12-01'].map((d) => filing(d));
const run = (fs, opts = {}) => buildPersonalHistory(fs, '42', { asOf: '2026-09-04', coverage, ...opts });

test('compares one person with their own issuer history and aggregates multiple sale lines per day', () => {
  const recent = filing('2026-08-01');
  recent.transactions.push({ ...recent.transactions[0], shares: 20 });
  const r = run([...baseline(), recent]);
  const c = r.companies[0];
  assert.equal(c.baseline.saleDays, 5); assert.equal(c.recent.saleDays, 1);
  assert.equal(c.recent.saleTransactions, 2);
  assert.equal(c.comparison.medianDailySaleValueRatio, 3);
  assert.equal(c.events.at(-1).accession, recent.accession);
  assert.equal(c.events.at(-1).acceptanceDateTime, recent.acceptanceDateTime);
  assert.deepEqual(c.comparison.withheldReasons, []);
});

test('later filings and later corrections cannot enter an earlier as-of history', () => {
  const original = filing('2025-01-02', { periodOfReport: '2025-01-01', transactionDate: '2025-01-01' });
  const fix = filing('2025-03-01', { form: '4/A', dateOfOriginalSubmission: '2025-01-02', periodOfReport: '2025-01-01', transactionDate: '2025-01-01' });
  fix.transactions[0].price = 50;
  const early = run([original, fix], { asOf: '2025-02-01' });
  assert.equal(early.excluded.filedAfterAsOf, 1);
  assert.equal(early.companies[0].lifetime.medianDailyReportedSaleValue, 100);
  const later = run([original, fix], { asOf: '2025-04-01' });
  assert.equal(later.companies[0].lifetime.saleTransactions, 1);
  assert.equal(later.companies[0].lifetime.medianDailyReportedSaleValue, 500);
});

test('CIKs preserve name/symbol changes and separate people with the same name', () => {
  const first = filing('2024-01-01');
  const renamed = filing('2025-01-01', { issuerName: 'Renamed A', issuerSymbol: 'NEW', owners: [{ cik: '42', name: 'New Name' }] });
  const other = filing('2025-02-01', { owners: [{ cik: '43', name: 'Example Person' }], issuerCik: '200' });
  const r = run([first, renamed, other]);
  assert.equal(r.companies.length, 1); assert.equal(r.excluded.otherOwner, 1);
  assert.deepEqual(r.aliases, ['Example Person', 'New Name']);
  assert.deepEqual(r.companies[0].symbols, ['AAA', 'NEW']);
  assert.equal(r.companies[0].symbol, 'NEW');
  assert.equal(aggregateInsiders([first, renamed, other]).length, 2);
});

test('cross-company history keeps issuers separate and never pools their dollar/price baseline', () => {
  const old = baseline(), recent = filing('2026-08-01', { issuerCik: '200', issuerName: 'Company B', issuerSymbol: 'BBB' });
  const r = run([...old, recent]);
  assert.equal(r.crossCompany.observedIssuers, 2);
  assert.deepEqual(r.crossCompany.firstObservedRecently, ['200']);
  assert.equal(r.companies[1].baseline.saleDays, 0);
  assert.equal(r.companies[1].comparison.medianDailySaleValueRatio, null);
});

test('duplicates and joint-owner filings do not double-count the selected person; joint size is not attributed', () => {
  const recent = filing('2026-08-01', { owners: [{ cik: '42', name: 'A' }, { cik: '43', name: 'B' }] });
  const c = run([...baseline(), recent, recent]).companies[0];
  assert.equal(c.recent.saleTransactions, 1);
  assert.equal(c.comparison.medianDailySaleValueRatio, null);
  assert.ok(c.comparison.withheldReasons.some((x) => x.includes('joint-owner')));
});

test('sparse, unpriced or mixed-security history does not manufacture a comparison', () => {
  const recent = filing('2026-08-01');
  assert.equal(run([recent]).companies[0].comparison.medianDailySaleValueRatio, null);
  const unpriced = baseline(); unpriced[0].transactions[0].price = null;
  assert.ok(run([...unpriced, recent]).companies[0].comparison.withheldReasons.some((x) => x.includes('missing prices')));
  const mixed = baseline(); mixed[0].transactions[0].securityTitle = 'Preferred Stock';
  assert.ok(run([...mixed, recent]).companies[0].comparison.withheldReasons.some((x) => x.includes('security class')));
});

test('an issuer with no sales in either window is not called mixed or unknown', () => {
  const holdingsOnly = filing('2024-01-01', { transactions: [] });
  const r = run([holdingsOnly]).companies[0];
  assert.equal(r.lifetime.saleTransactions, 0);
  assert.ok(!r.comparison.withheldReasons.some((x) => /security class|ownership basis/.test(x)));
  assert.ok(r.comparison.withheldReasons.includes('no recent selling days observed'));
});

test('missing archives in the comparison period block size comparison; unsupported ancient text does not', () => {
  const incomplete = { ...coverage, history: { ...coverage.history, failedArchives: [{ name: 'old.json', filingFrom: '2023-01-01', filingTo: '2025-01-01' }] } };
  const fs = [...baseline(), filing('2026-08-01')];
  assert.equal(run(fs, { coverage: incomplete }).companies[0].comparison.medianDailySaleValueRatio, null);
  const ancient = { ...coverage, skippedFiles: [{ accession: 'old', filingDate: '2001-01-01' }] };
  assert.equal(run(fs, { coverage: ancient }).companies[0].comparison.medianDailySaleValueRatio, 1);
  assert.ok(coverageIssues(null, '2020-01-01', '2026-01-01').length);
});

test('Form 3/5 amendments cannot replace a Form 4 in the same owner-period group', () => {
  const original = filing('2025-01-01');
  const initial = filing('2025-01-02', { form: '3/A', periodOfReport: original.periodOfReport });
  assert.equal(dedupeAmendments([original, initial]).length, 2);
});

test('date and CLI input errors fail explicitly', () => {
  assert.throws(() => run([], { asOf: '2026-02-30' }), /real YYYY-MM-DD/);
  assert.throws(() => parseArgs(['who', '42', '--limit', '0']), /limit/);
  assert.throws(() => parseArgs(['who', '42', '--as-of', '2026-02-30']), /real YYYY-MM-DD/);
  assert.throws(() => parseArgs(['rate', 'AAA', '--as-of', '2025-01-01']), /only to who/);
  assert.equal(parseArgs(['who', '42', '--limit', 'all']).options.cap, Infinity);
});
