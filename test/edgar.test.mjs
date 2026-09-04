import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchOwnershipXmls, getJson, getSubmissions } from '../lib/edgar.mjs';

const accession = (n) => `0000000042-26-${String(n).padStart(6, '0')}`;
const row = (n, date = '2026-01-01', doc = 'xslF345X05/ownership.xml') => ({ form: '4', filingDate: date, accessionNumber: accession(n), primaryDocument: doc, acceptanceDateTime: `${date}T18:00:00.000Z` });
const columns = (rows) => Object.fromEntries(['form', 'filingDate', 'accessionNumber', 'primaryDocument', 'acceptanceDateTime'].map((k) => [k, rows.map((r) => r[k])]));
const noSleep = async () => {};
const xml = '<ownershipDocument><issuer><issuerCik>1</issuerCik></issuer></ownershipDocument>';
function dir(t) {
  const path = mkdtempSync(join(tmpdir(), 'uncle-edgar-'));
  t.after(() => rmSync(path, { recursive: true, force: true })); return path;
}

test('historical indexes load separately; overlapping accessions prefer recent metadata', async (t) => {
  const root = dir(t), calls = [];
  const name = 'CIK0000000042-submissions-001.json';
  const recent = columns([row(2, '2026-01-02')]);
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => url.endsWith(name)
      ? columns([row(2, '2025-12-31', 'old.xml'), row(1, '2020-01-01')])
      : { cik: '42', filings: { recent, files: [{ name, filingFrom: '2020-01-01', filingTo: '2026-01-02' }] } } };
  };
  const sub = await getSubmissions('42', join(root, 'submissions.json'), { history: true, fetchImpl, sleepFn: noSleep });
  assert.deepEqual(sub.filings.recent, recent);
  assert.equal(sub.historyCoverage.archivesLoaded, 1);
  const download = await fetchOwnershipXmls(sub, root, { cap: Infinity, sleepFn: noSleep, fetchImpl: async (url) => {
    calls.push(url); return { ok: true, text: async () => xml };
  } });
  assert.equal(download.files.length, 2);
  assert.equal(download.files[0].filingDate, '2026-01-02');
  assert.ok(download.files[0].url.endsWith('/ownership.xml'));
  assert.equal(download.coverage.completeSupportedXml, true);
  assert.equal(download.files[1].acceptanceDateTime, '2020-01-01T18:00:00.000Z');
  assert.equal(calls.length, 4);
});

test('failed historical pages preserve recent data and report an incomplete history', async (t) => {
  const root = dir(t), name = 'CIK0000000042-submissions-001.json';
  const fetchImpl = async (url) => url.endsWith(name) ? { ok: false, status: 503 }
    : { ok: true, json: async () => ({ cik: '42', filings: { recent: columns([row(1)]), files: [{ name, filingFrom: '2010-01-01', filingTo: '2020-01-01' }] } }) };
  const sub = await getSubmissions('42', join(root, 'submissions.json'), { history: true, fetchImpl, sleepFn: noSleep });
  assert.equal(sub.historyCoverage.failedArchives.length, 1);
  const r = await fetchOwnershipXmls(sub, root, { sleepFn: noSleep, fetchImpl: async () => ({ ok: true, text: async () => xml }) });
  assert.equal(r.files.length, 1);
  assert.equal(r.coverage.completeSupportedXml, false);
});

test('limits, unsupported documents, as-of cutoff and failed/HTML downloads are separately counted', async (t) => {
  const root = dir(t);
  const sub = { cik: '42', filings: { recent: columns([row(1), row(2, '2026-01-02'), row(3, '2026-01-03'), row(4, '2026-01-04', 'legacy.txt'), row(5, '2027-01-01')]), files: [] } };
  const r = await fetchOwnershipXmls(sub, root, { cap: 2, asOf: '2026-12-31', sleepFn: noSleep,
    fetchImpl: async (url) => url.includes(accession(3).replaceAll('-', '')) ? { ok: true, text: async () => '<html>denied</html>' } : { ok: true, text: async () => xml } });
  assert.equal(r.coverage.listedOwnershipFilings, 4);
  assert.equal(r.coverage.skippedFiles.length, 1);
  assert.equal(r.coverage.omittedFiles.length, 1);
  assert.equal(r.coverage.failedFiles.length, 1);
  assert.equal(r.coverage.loadedXmlFilings, 1);
  assert.equal(r.files[0].accession, accession(2));
});

test('network exceptions on one XML do not silently truncate the remaining files', async (t) => {
  const root = dir(t);
  const sub = { cik: '42', filings: { recent: columns([row(1), row(2)]), files: [] } };
  let n = 0;
  const result = await fetchOwnershipXmls(sub, root, { sleepFn: noSleep, fetchImpl: async () => {
    if (!n++) throw new Error('offline'); return { ok: true, text: async () => xml };
  } });
  assert.equal(result.files.length, 1); assert.equal(result.coverage.failedFiles.length, 1);
});

test('stale JSON fallback carries freshness metadata and does not overwrite cache', async (t) => {
  const root = dir(t), path = join(root, 'old.json');
  writeFileSync(path, '{"cached":true}');
  const old = new Date(Date.now() - 48 * 3600000); utimesSync(path, old, old);
  let status;
  const result = await getJson('https://data.sec.gov/example', path, { fetchImpl: async () => ({ ok: false, status: 403 }), onStatus: (s) => { status = s; } });
  assert.deepEqual(result, { cached: true }); assert.equal(status.stale, true);
  assert.equal(readFileSync(path, 'utf8'), '{"cached":true}');
});

test('archive names cannot send requests to arbitrary locations', async (t) => {
  const root = dir(t); let calls = 0;
  const sub = await getSubmissions('42', join(root, 'submissions.json'), { history: true, sleepFn: noSleep, fetchImpl: async () => {
    calls++; return { ok: true, json: async () => ({ cik: '42', filings: { recent: columns([]), files: [{ name: '../../secret.json' }] } }) };
  } });
  assert.equal(calls, 1); assert.equal(sub.historyCoverage.failedArchives.length, 1);
});
