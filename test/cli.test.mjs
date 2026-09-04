import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = new URL('../uncle.mjs', import.meta.url).pathname;
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'uncle-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'people/42');
  mkdirSync(join(dir, 'form4'), { recursive: true });
  mkdirSync(join(dir, 'submission-history'));
  const rows = ['2023-08-01', '2024-01-01', '2024-06-01', '2025-01-01', '2025-12-01', '2026-08-01'].map((date, n) => ({
    form: '4', filingDate: date, accessionNumber: `0000000042-26-${String(n).padStart(6, '0')}`, primaryDocument: 'ownership.xml', acceptanceDateTime: `${date}T18:00:00Z` }));
  const columns = (rows) => Object.fromEntries(Object.keys(rows[0]).map((key) => [key, rows.map((r) => r[key])]));
  const archive = 'CIK0000000042-submissions-001.json';
  writeFileSync(join(dir, 'submissions.json'), JSON.stringify({ cik: '42', name: 'SYNTHETIC EXAMPLE', filings: { recent: columns(rows.slice(-1)), files: [{ name: archive, filingFrom: rows[0].filingDate, filingTo: rows[4].filingDate }] } }));
  writeFileSync(join(dir, 'submission-history', archive), JSON.stringify(columns(rows.slice(0, -1))));
  for (const [n, row] of rows.entries()) {
    const value = n === 5 ? 30 : 10;
    writeFileSync(join(dir, 'form4', `${row.filingDate}_${row.accessionNumber}.xml`), `<ownershipDocument>
      <periodOfReport>${row.filingDate}</periodOfReport>
      <issuer><issuerCik>0000000100</issuerCik><issuerName>SYNTHETIC CORP</issuerName><issuerTradingSymbol>SYN</issuerTradingSymbol></issuer>
      <reportingOwner><reportingOwnerId><rptOwnerCik>0000000042</rptOwnerCik><rptOwnerName>SYNTHETIC EXAMPLE</rptOwnerName></reportingOwnerId></reportingOwner>
      <aff10b5One>false</aff10b5One><nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle><transactionDate><value>${row.filingDate}</value></transactionDate>
      <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>10</value></transactionShares><transactionPricePerShare><value>${value}</value></transactionPricePerShare></transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>90</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
      <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
      </nonDerivativeTransaction></ownershipDocument>`);
  }
  return root;
}

test('who CLI reads cached historical pages, emits pure JSON and saves a dated evidence report', (t) => {
  const root = setup(t);
  const r = spawnSync(process.execPath, [script, 'who', '42', '--as-of', '2026-09-04', '--json', '--data-dir', root], { encoding: 'utf8', timeout: 5000 });
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.coverage.history.archivesLoaded, 1);
  assert.equal(report.coverage.loadedXmlFilings, 6);
  assert.equal(report.companies[0].comparison.medianDailySaleValueRatio, 3);
  assert.ok(report.companies[0].events[0].url.startsWith('https://www.sec.gov/Archives/'));
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'people/42/history-2026-09-04.json'), 'utf8')), report);
});

test('a capped history remains useful but does not fabricate a personal baseline', (t) => {
  const root = setup(t);
  const r = spawnSync(process.execPath, [script, 'who', '42', '--as-of', '2026-09-04', '--limit', '1', '--json', '--data-dir', root], { encoding: 'utf8', timeout: 5000 });
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.coverage.omittedFiles.length, 5);
  assert.equal(report.companies[0].comparison.medianDailySaleValueRatio, null);
});

test('the original rate command still builds its six-dimension score from a frozen offline fixture', (t) => {
  const root = setup(t), tickerDir = join(root, 'SYN');
  cpSync(join(root, 'people/42'), tickerDir, { recursive: true });
  const sub = JSON.parse(readFileSync(join(tickerDir, 'submissions.json'), 'utf8'));
  sub.cik = '100'; sub.name = 'SYNTHETIC CORP'; sub.filings.files = [];
  writeFileSync(join(tickerDir, 'submissions.json'), JSON.stringify(sub));
  writeFileSync(join(root, 'tickers.json'), JSON.stringify({ 0: { cik_str: 100, ticker: 'SYN', title: 'SYNTHETIC CORP' } }));
  writeFileSync(join(tickerDir, 'prices.json'), JSON.stringify({ chart: { result: [{ timestamp: [Date.parse('2026-08-01T00:00:00Z') / 1000], indicators: { quote: [{ close: [30] }] } }] } }));
  const r = spawnSync(process.execPath, [script, 'rate', 'SYN', '--data-dir', root], { encoding: 'utf8', timeout: 5000 });
  assert.equal(r.status, 0, r.stderr);
  const score = JSON.parse(readFileSync(join(tickerDir, 'score.json'), 'utf8'));
  assert.equal(score.scoringVersion, 3); assert.equal(score.dims.length, 6);
  assert.equal(score.coverage.loadedXmlFilings, 1);
  assert.ok(existsSync(join(tickerDir, 'radar.svg')));
});

test('ambiguous names refuse to pick a person and empty local data has a useful error', (t) => {
  const root = setup(t);
  mkdirSync(join(root, 'EXAMPLE'));
  writeFileSync(join(root, 'EXAMPLE/insiders.json'), JSON.stringify([{ cik: '42', name: 'SAME NAME' }, { cik: '43', name: 'SAME NAME' }]));
  const r = spawnSync(process.execPath, [script, 'who', 'SAME', '--data-dir', root], { encoding: 'utf8' });
  assert.equal(r.status, 1); assert.match(r.stderr, /ambiguous name/);
  const missing = spawnSync(process.execPath, [script, 'who', 'NOBODY', '--data-dir', join(root, 'empty')], { encoding: 'utf8' });
  assert.equal(missing.status, 1); assert.match(missing.stderr, /no cached insider matches/);
});
