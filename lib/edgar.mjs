// EDGAR access + local cache. All data is public SEC filings.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';

// SEC's declared format is "Sample Company Name AdminContact@example.com" — nothing else.
// A parenthesised URL in the UA gets a 403 from sec.gov (observed 2026-09-01), so keep it plain.
export const UA = 'uncle-watch ji.strawbrrynov@gmail.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const fresh = (p, maxAgeMs = 24 * 3600 * 1000) => existsSync(p) && Date.now() - statSync(p).mtimeMs < maxAgeMs;

export async function getJson(url, cachePath) {
  if (cachePath && fresh(cachePath)) return JSON.parse(readFileSync(cachePath, 'utf8'));
  let resp;
  try {
    resp = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  } catch (e) {
    resp = { ok: false, status: e.message };
  }
  if (!resp.ok) {
    // a stale cache beats a crash — but say so, loudly, so nobody reads old data as fresh
    if (cachePath && existsSync(cachePath)) {
      const age = Math.round((Date.now() - statSync(cachePath).mtimeMs) / 3600000);
      console.error(`  ⚠ ${resp.status} ${url} — using cached copy from ${age}h ago`);
      return JSON.parse(readFileSync(cachePath, 'utf8'));
    }
    throw new Error(`${resp.status} ${url}`);
  }
  const j = await resp.json();
  if (cachePath) writeFileSync(cachePath, JSON.stringify(j));
  return j;
}

export async function tickerToCik(ticker) {
  mkdirSync('data', { recursive: true });
  const map = await getJson('https://www.sec.gov/files/company_tickers.json', 'data/tickers.json');
  const hit = Object.values(map).find((x) => x.ticker === ticker.toUpperCase());
  if (!hit) throw new Error(`ticker ${ticker} not found in SEC company map`);
  return { cik: String(hit.cik_str), name: hit.title };
}

export async function getSubmissions(cik, cachePath) {
  const padded = String(cik).padStart(10, '0');
  return getJson(`https://data.sec.gov/submissions/CIK${padded}.json`, cachePath);
}

// download raw ownership XMLs (Form 3/4/5) listed in a submissions JSON → dir/form4/
export async function fetchOwnershipXmls(sub, dir, { forms = ['3', '4', '4/A', '5'], cap = 200 } = {}) {
  const cik = String(sub.cik).replace(/^0+/, '');
  const r = sub.filings.recent;
  mkdirSync(`${dir}/form4`, { recursive: true });
  const targets = [];
  for (let i = 0; i < r.form.length && targets.length < cap; i++) {
    if (!forms.includes(r.form[i])) continue;
    const doc = (r.primaryDocument[i] || '').replace(/^xslF345X\d+\//, '');
    if (!doc.endsWith('.xml')) continue; // pre-2004 filings are txt, skip
    targets.push({
      form: r.form[i],
      filingDate: r.filingDate[i],
      accession: r.accessionNumber[i],
      url: `https://www.sec.gov/Archives/edgar/data/${cik}/${r.accessionNumber[i].replace(/-/g, '')}/${doc}`,
      out: `${dir}/form4/${r.filingDate[i]}_${r.accessionNumber[i]}.xml`,
    });
  }
  let fetched = 0;
  for (const t of targets) {
    if (existsSync(t.out)) continue;
    const resp = await fetch(t.url, { headers: { 'User-Agent': UA } });
    if (resp.ok) { writeFileSync(t.out, await resp.text()); fetched++; }
    else console.error(`  fetch fail ${resp.status} ${t.accession}`);
    await sleep(130); // stay well under SEC 10 req/s
  }
  return { files: targets.filter((t) => existsSync(t.out)), fetched };
}
