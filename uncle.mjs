#!/usr/bin/env node
// 🐀 uncle — who is selling your stock at the top, and how often they've done it before
// usage:
//   uncle rate <TICKER>      score a ticker (fetches SEC Form 4s + prices, prints report, writes radar SVG)
//   uncle who <name|CIK>     observed career + personal historical comparison
//   uncle actions <TICKER>   the raw feed: every insider transaction, newest first
//   uncle tickets            leaderboard of every ticker you've rated
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { tickerToCik, getSubmissions, fetchOwnershipXmls, normalizeCik } from './lib/edgar.mjs';
import { parseFiles, aggregateInsiders, dedupeAmendments } from './lib/parse.mjs';
import { getPrices } from './lib/prices.mjs';
import { buildReport } from './lib/analyze.mjs';
import { uncleRate } from './lib/score.mjs';
import { radarSvg } from './lib/radar.mjs';
import { buildPersonalHistory } from './lib/history.mjs';
import { parseArgs } from './lib/cli-options.mjs';

let parsed;
try { parsed = parseArgs(process.argv.slice(2)); }
catch (error) { console.error(`uncle: ${error.message}`); process.exit(1); }
const { command: cmd, argument: arg, options } = parsed;
const money = (n) => '$' + Math.round(n).toLocaleString();

function printCoverage(c) {
  console.log(`  Coverage: ${c.loadedXmlFilings}/${c.eligibleXmlFilings} supported XML filings loaded; ${c.filingDateFrom ?? '?'} → ${c.filingDateTo ?? '?'}`);
  console.log(`  Older indexes: ${c.history.archivesLoaded}/${c.history.archivesAdvertised} read; ${c.skippedFiles.length} unsupported filings; ${c.omittedFiles.length} omitted by limit; ${c.failedFiles.length} failed downloads.`);
  if (c.history.failedArchives.length) console.log(`  ⚠ Failed history indexes: ${c.history.failedArchives.map((a) => a.name).join(', ')}`);
  if (c.history.sources.some((s) => s.stale)) console.log('  ⚠ A submission index is from stale cache; new filings may be missing.');
  if (!c.completeSupportedXml || c.skippedFiles.length) console.log('  Partial observed history; missing filings are not evidence of no trading.');
}

async function loadTicker(ticker) {
  const T = ticker.toUpperCase();
  if (!/^[A-Z0-9.-]{1,15}$/.test(T)) throw new Error('invalid ticker');
  const dir = `${options.dataDir}/${T}`;
  mkdirSync(dir, { recursive: true });
  const { cik, name } = await tickerToCik(T, options);
  const sub = await getSubmissions(cik, `${dir}/submissions.json`, { history: options.history });
  process.stdout.write(`${name} (CIK ${cik}) · fetching Form 4s`);
  const { files, fetched, coverage } = await fetchOwnershipXmls(sub, dir, { forms: ['4', '4/A'], cap: options.cap ?? 200 });
  // a company's EDGAR feed also lists Form 4s it filed as a *shareholder* of other companies — keep only filings where it is the issuer
  const filings = dedupeAmendments(parseFiles(files).filter((f) => !f.issuerCik || f.issuerCik === cik));
  console.log(` — ${filings.length} filings (${fetched} new)`);
  printCoverage(coverage);
  const insiders = aggregateInsiders(filings);
  writeFileSync(`${dir}/insiders.json`, JSON.stringify(insiders, null, 2));
  const days = await getPrices(T, `${dir}/prices.json`);
  const report = buildReport(insiders, days);
  writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${dir}/coverage.json`, JSON.stringify(coverage, null, 2));
  return { T, dir, name, sub, insiders, report, coverage };
}

async function rate(ticker) {
  const { T, dir, sub, report, coverage } = await loadTicker(ticker);
  const r = uncleRate(report, sub);
  const fpi = sub.filings.recent.form.some((f) => ['20-F', '40-F', '6-K'].includes(f));
  writeFileSync(`${dir}/score.json`, JSON.stringify({ ticker: T, ...r, fpi, coverage, generated: new Date().toISOString() }, null, 2));
  writeFileSync(`${dir}/radar.svg`, radarSvg(T, r));

  console.log(`\n🐀 $${T} · UNCLE RATE ${r.composite}/100\n`);
  if (fpi) console.log(`  ⚠ foreign-issuer forms on file. Most FPI insiders were exempt from Form 4 until March 2026 and exemptions\n    still apply case by case — zero filings ≠ zero selling; the uncles may be behind the curtain\n    (Canadian issuers: see SEDI). Score is a floor, not a reading. See README sources.\n`);
  for (const d of r.dims) {
    const bar = '█'.repeat(Math.round(d.score / 5)).padEnd(20, '·');
    console.log(`  ${bar} ${String(d.score).padStart(3)}  ${d.label}`);
    console.log(`  ${' '.repeat(26)}${d.evidence}`);
  }
  for (const c of r.counterSignals ?? []) {
    console.log(`\n  \x1b[32m${c.observed ? '↑' : '·'} ${c.label}: ${c.evidence}\x1b[0m`);
  }
  if (report.exitZone) {
    const z = report.exitZone;
    const basis = z.basis?.unknown ? ` · basis: ${z.basis.noIndication} no-indication + ${z.basis.unknown} unknown-status (pre-2023) sells` : '';
    console.log(`\n  uncle exit zone: $${z.priceP25}–$${z.priceP75} (median $${z.median}) · last close ${report.lastClose ? '$' + report.lastClose.close.toFixed(2) : 'unavailable'}${basis}`);
  }
  console.log(`\n  radar → ${dir}/radar.svg`);
}

async function who(q) {
  let cik = /^\d+$/.test(q) ? q : null;
  if (!cik) {
    const candidates = new Map();
    for (const t of existsSync(options.dataDir) ? readdirSync(options.dataDir) : []) {
      const p = `${options.dataDir}/${t}/insiders.json`;
      if (!existsSync(p)) continue;
      for (const hit of JSON.parse(readFileSync(p, 'utf8'))) {
        if ([hit.name, ...(hit.aliases ?? [])].some((name) => name.toLowerCase().includes(q.toLowerCase())) && hit.cik) candidates.set(normalizeCik(hit.cik), hit.name);
      }
    }
    if (candidates.size > 1) throw new Error(`ambiguous name "${q}"; pass a CIK: ${[...candidates].map(([id, name]) => `${name} (${id})`).join('; ')}`);
    if (!candidates.size) throw new Error(`no cached insider matches "${q}" — run \`uncle rate <TICKER>\` first, or pass a CIK directly`);
    cik = [...candidates.keys()][0];
  }
  cik = normalizeCik(cik);
  const dir = `${options.dataDir}/people/${cik}`;
  mkdirSync(dir, { recursive: true });
  const sub = await getSubmissions(cik, `${dir}/submissions.json`, { history: true });
  if (!options.json) console.log(`${sub.name} · reading historical ownership filings`);
  const { files, fetched, coverage } = await fetchOwnershipXmls(sub, dir, { cap: options.cap ?? Infinity, asOf: options.asOf });
  const report = buildPersonalHistory(parseFiles(files), cik, { asOf: options.asOf, recentDays: options.recentDays, coverage });
  report.name ??= sub.name;
  const output = `${dir}/history${options.asOf ? '-' + options.asOf : ''}.json`;
  writeFileSync(output, JSON.stringify(report, null, 2));
  if (options.json) return console.log(JSON.stringify(report, null, 2));
  console.log(`\n🐀 UNCLE WHO · ${sub.name} (CIK ${cik}) · ${report.companies.length} observed issuers · as of ${report.asOf}`);
  printCoverage(coverage);
  console.log(`  ${fetched} new downloads. Recent: ${report.windows.recent.from} → ${report.windows.recent.to}; baseline: ${report.windows.baseline.from} → ${report.windows.baseline.to}.`);
  for (const b of report.companies) {
    console.log(`\n  ${b.symbol || b.issuerCik} · ${b.name} (issuer CIK ${b.issuerCik})\n    ${b.firstFiling} → ${b.lastFiling} · ${b.filings.length} filings · ${b.lifetime.saleTransactions} sale transactions observed`);
    if (b.symbols.length > 1) console.log(`    Symbols observed: ${b.symbols.join(' → ')}`);
    console.log(`    Sale days: recent ${b.recent.saleDays}, baseline ${b.baseline.saleDays}. Buy days: recent ${b.recent.buyDays}, baseline ${b.baseline.buyDays}.`);
    if (!b.recent.saleDays) {
      console.log('    No recent selling days observed; no sale-size comparison.');
      continue;
    }
    const ratio = b.comparison.medianDailySaleValueRatio;
    if (ratio !== null) console.log(`    Median reported value per selling day: ${b.recent.medianDailyReportedSaleValue.toLocaleString()} vs ${b.baseline.medianDailyReportedSaleValue.toLocaleString()} (${ratio}× own baseline; reported units, unadjusted).`);
    else console.log(`    Size comparison unavailable: ${b.comparison.withheldReasons.join('; ')}.`);
    console.log(`    Sale calendar months: recent ${b.comparison.recentSaleMonths.join(', ') || 'none'}; observed baseline ${b.comparison.baselineSaleMonths.join(', ') || 'none'}.`);
    console.log(`    Recent plan-status transactions: ${Object.entries(b.recent.planStatus).map(([name, n]) => `${name}: ${n}`).join('; ')}.`);
  }
  console.log(`\n  Descriptive history, not a return signal or a routine/opportunistic classification.\n  Full timeline, filing links, exclusions and limitations → ${output}`);
}

async function actions(ticker) {
  const T = ticker.toUpperCase();
  const p = `${options.dataDir}/${T}/insiders.json`;
  const insiders = existsSync(p) && !options.history && options.cap === undefined ? JSON.parse(readFileSync(p, 'utf8')) : (await loadTicker(T)).insiders;
  const feed = insiders.flatMap((i) => i.events.map((e) => ({ ...e, insider: i.name })))
    .filter((e) => e.date)
    .sort((a, b) => b.date.localeCompare(a.date));
  console.log(`🐀 UNCLE ACTIONS · $${T} · ${feed.length} transactions, newest first\n`);
  for (const e of feed) {
    const kind = e.code === 'S'
      ? (e.planStatus === '10b5-1 indicated' ? 'sell (10b5-1 plan)' : e.planStatus === 'unknown' ? 'SELL (plan status ?)' : 'SELL ⚠')
      : e.code === 'P' ? 'BUY' : e.code === 'M' ? 'option exercise' : e.code === 'A' ? 'grant' : e.code === 'X' ? 'warrant exercise' : e.code;
    console.log(`  ${e.date}  ${e.insider.padEnd(26)} ${kind.padEnd(18)} ${e.shares.toLocaleString().padStart(11)} sh${e.price ? ' @ $' + e.price : ''}  → holds ${e.sharesAfter?.toLocaleString() ?? '?'}`);
  }
}

function tickets() {
  const rows = [];
  for (const t of existsSync(options.dataDir) ? readdirSync(options.dataDir) : []) {
    const p = `${options.dataDir}/${t}/score.json`;
    if (existsSync(p)) rows.push(JSON.parse(readFileSync(p, 'utf8')));
  }
  if (!rows.length) return console.log('no rated tickers yet — run `uncle rate <TICKER>` first');
  rows.sort((a, b) => b.composite - a.composite);
  console.log('🐀 UNCLE TICKETS\n');
  for (const r of rows) {
    const bar = '█'.repeat(Math.round(r.composite / 5)).padEnd(20, '·');
    const top = [...r.dims].sort((a, b) => b.score - a.score)[0];
    console.log(`  ${bar} ${String(r.composite).padStart(3)}  $${r.ticker.padEnd(6)} loudest: ${top.label.toLowerCase()} (${top.score})`);
  }
}

const run = { rate, who, actions, tickets };
if (options.help || !cmd || !run[cmd] || (cmd !== 'tickets' && !arg)) {
  console.log('🐀 uncle — insider exit patterns from public SEC filings\n');
  console.log('  uncle rate <TICKER>     uncle rate 0-100, six risk dimensions + buy counter-signal, evidence attached');
  console.log('  uncle who <name|CIK>    observed issuer history + own past vs recent behavior');
  console.log('  uncle actions <TICKER>  raw insider transaction feed');
  console.log('  uncle tickets           leaderboard of rated tickers');
  console.log('\n  who: --as-of YYYY-MM-DD --recent-days 90 --limit all --json');
  console.log('  rate: --history --limit all (default: recent list, max 200 XML filings)');
  console.log('  all: --data-dir <directory>');
  process.exit(options.help ? 0 : 1);
}
try { await run[cmd](arg); } catch (error) { console.error(`uncle: ${error.message}`); process.exitCode = 1; }
