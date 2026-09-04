// EDGAR access + local cache. All data is public SEC filings.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

// SEC's declared format is "Sample Company Name AdminContact@example.com" — nothing else.
// A parenthesised URL in the UA gets a 403 from sec.gov (observed 2026-09-01), so keep it plain.
export const UA = 'uncle-watch ji.strawbrrynov@gmail.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ownershipXml = (xml) => /<ownershipDocument[\s>]/.test(xml) && /<\/ownershipDocument>/.test(xml);
export const fresh = (p, maxAgeMs = 24 * 3600 * 1000) => existsSync(p) && Date.now() - statSync(p).mtimeMs < maxAgeMs;

export async function getJson(url, cachePath, { fetchImpl = fetch, onStatus = () => {}, timeoutMs = 20_000 } = {}) {
  if (cachePath && fresh(cachePath)) {
    onStatus({ cached: true, stale: false, ageHours: (Date.now() - statSync(cachePath).mtimeMs) / 3600000 });
    return JSON.parse(readFileSync(cachePath, 'utf8'));
  }
  let resp;
  try {
    resp = await fetchImpl(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    resp = { ok: false, status: e.message };
  }
  if (!resp.ok) {
    // a stale cache beats a crash — but say so, loudly, so nobody reads old data as fresh
    if (cachePath && existsSync(cachePath)) {
      const age = Math.round((Date.now() - statSync(cachePath).mtimeMs) / 3600000);
      console.error(`  ⚠ ${resp.status} ${url} — using cached copy from ${age}h ago`);
      onStatus({ cached: true, stale: true, ageHours: age, error: String(resp.status) });
      return JSON.parse(readFileSync(cachePath, 'utf8'));
    }
    throw new Error(`${resp.status} ${url}`);
  }
  const j = await resp.json();
  onStatus({ cached: false, stale: false, ageHours: 0 });
  if (cachePath) writeFileSync(cachePath, JSON.stringify(j));
  return j;
}

export async function tickerToCik(ticker, { dataDir = 'data' } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const map = await getJson('https://www.sec.gov/files/company_tickers.json', join(dataDir, 'tickers.json'));
  const hit = Object.values(map).find((x) => x.ticker === ticker.toUpperCase());
  if (!hit) throw new Error(`ticker ${ticker} not found in SEC company map`);
  return { cik: String(hit.cik_str), name: hit.title };
}

export function normalizeCik(cik) {
  if (!/^\d{1,10}$/.test(String(cik)) || /^0+$/.test(String(cik))) throw new Error(`invalid CIK: ${cik}`);
  return String(cik).replace(/^0+/, '');
}

export function submissionRows(columns) {
  if (!columns || !Array.isArray(columns.form)) throw new Error('invalid submissions table: missing form array');
  for (const key of ['filingDate', 'accessionNumber']) {
    if (!Array.isArray(columns[key]) || columns[key].length !== columns.form.length) throw new Error(`invalid submissions table: ${key} length`);
  }
  return columns.form.map((form, i) => ({ form, filingDate: columns.filingDate[i], accession: columns.accessionNumber[i],
    primaryDocument: columns.primaryDocument?.[i] ?? '', acceptanceDateTime: columns.acceptanceDateTime?.[i] ?? null }));
}

export async function getSubmissions(cik, cachePath, { history = false, fetchImpl = fetch, sleepFn = sleep } = {}) {
  const normalized = normalizeCik(cik), padded = normalized.padStart(10, '0');
  let recentStatus;
  const sub = await getJson(`https://data.sec.gov/submissions/CIK${padded}.json`, cachePath,
    { fetchImpl, onStatus: (s) => { recentStatus = s; } });
  submissionRows(sub.filings?.recent); // malformed metadata must not become empty history
  const advertised = sub.filings.files ?? [];
  if (!Array.isArray(advertised)) throw new Error('invalid submissions archive list');
  const historyCoverage = { requested: history, archivesAdvertised: advertised.length,
    archivesLoaded: 0, failedArchives: [], skippedArchives: history ? [] : advertised,
    sources: [{ name: `CIK${padded}.json`, ...recentStatus }] };
  const archiveRows = [];
  if (history) for (const archive of advertised) {
    // The API gives filenames, never arbitrary URLs or local paths.
    if (!new RegExp(`^CIK${padded}-submissions-\\d+\\.json$`).test(archive.name ?? '')) {
      historyCoverage.failedArchives.push({ ...archive, error: 'invalid archive filename' }); continue;
    }
    try {
      const archiveDir = cachePath ? join(dirname(cachePath), 'submission-history') : null;
      if (archiveDir) mkdirSync(archiveDir, { recursive: true });
      const data = await getJson(`https://data.sec.gov/submissions/${archive.name}`, archiveDir ? join(archiveDir, archive.name) : undefined,
        { fetchImpl, onStatus: (s) => historyCoverage.sources.push({ name: archive.name, ...s }) });
      archiveRows.push(...submissionRows(data));
      historyCoverage.archivesLoaded++;
    } catch (error) {
      historyCoverage.failedArchives.push({ ...archive, error: error.message });
      console.error(`  ⚠ history unavailable: ${archive.name} — ${error.message}`);
    }
    await sleepFn(130);
  }
  // Keep recent separate: the existing six dimensions still describe the recent table.
  return { ...sub, cik: normalized, filings: { ...sub.filings, archiveRows }, historyCoverage };
}

// Download supported ownership XMLs. Coverage describes omissions, not an entire career.
export async function fetchOwnershipXmls(sub, dir, { forms = ['3', '3/A', '4', '4/A', '5', '5/A'], cap = 200,
  asOf, fetchImpl = fetch, sleepFn = sleep, timeoutMs = 20_000 } = {}) {
  if (cap !== Infinity && (!Number.isSafeInteger(cap) || cap < 1)) throw new Error('filing limit must be a positive integer or Infinity');
  const cik = normalizeCik(sub.cik);
  mkdirSync(`${dir}/form4`, { recursive: true });
  const unique = new Map();
  // Recent metadata wins if an accession overlaps an archive.
  for (const row of [...submissionRows(sub.filings.recent), ...(sub.filings.archiveRows ?? [])]) {
    if (!unique.has(row.accession)) unique.set(row.accession, row);
  }
  const listed = [...unique.values()].filter((r) => forms.includes(r.form) && (!asOf || r.filingDate <= asOf))
    .sort((a, b) => b.filingDate.localeCompare(a.filingDate) || b.accession.localeCompare(a.accession));
  const eligible = [], skippedFiles = [];
  for (const row of listed) {
    const doc = row.primaryDocument.replace(/^xslF345X\d+\//, '');
    if (!/^\d{10}-\d{2}-\d{6}$/.test(row.accession) || !/^\d{4}-\d{2}-\d{2}$/.test(row.filingDate) || !/^[\w.-]+$/.test(doc)) {
      skippedFiles.push({ accession: row.accession, filingDate: row.filingDate, reason: 'unsupported or invalid filing metadata' }); continue;
    }
    if (!doc.toLowerCase().endsWith('.xml')) {
      skippedFiles.push({ accession: row.accession, filingDate: row.filingDate, reason: 'non-XML ownership document (not parsed)' }); continue;
    }
    eligible.push({ ...row, url: `https://www.sec.gov/Archives/edgar/data/${cik}/${row.accession.replace(/-/g, '')}/${doc}`,
      out: `${dir}/form4/${row.filingDate}_${row.accession}.xml` });
  }
  const targets = eligible.slice(0, cap), loaded = [], failedFiles = [];
  let fetched = 0;
  for (const t of targets) {
    if (existsSync(t.out) && ownershipXml(readFileSync(t.out, 'utf8'))) { loaded.push(t); continue; }
    try {
      const resp = await fetchImpl(t.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const xml = await resp.text();
      if (!ownershipXml(xml)) throw new Error('response is not an ownership XML document');
      writeFileSync(t.out, xml); fetched++; loaded.push(t);
    } catch (error) {
      failedFiles.push({ accession: t.accession, filingDate: t.filingDate, error: error.message });
      console.error(`  ⚠ fetch failed ${t.accession}: ${error.message}`);
    }
    await sleepFn(130); // stay under SEC 10 req/s, including failures
  }
  const dates = loaded.map((f) => f.filingDate).sort();
  const history = sub.historyCoverage ?? { requested: false, archivesAdvertised: sub.filings.files?.length ?? 0,
    archivesLoaded: 0, failedArchives: [], skippedArchives: sub.filings.files ?? [], sources: [] };
  const coverage = { listedOwnershipFilings: listed.length, eligibleXmlFilings: eligible.length,
    selectedXmlFilings: targets.length, loadedXmlFilings: loaded.length, limit: cap === Infinity ? null : cap,
    filingDateFrom: dates[0] ?? null, filingDateTo: dates.at(-1) ?? null,
    skippedFiles, omittedFiles: eligible.slice(cap).map(({ accession, filingDate }) => ({ accession, filingDate })), failedFiles, history,
    completeSupportedXml: history.archivesAdvertised === history.archivesLoaded && !history.failedArchives.length && eligible.length === loaded.length };
  return { files: loaded, fetched, coverage };
}
