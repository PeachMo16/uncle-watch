#!/usr/bin/env node
// 🐀 uncle — who is selling your stock at the top, and how often they've done it before
// usage:
//   uncle rate <TICKER>      score a ticker (fetches SEC Form 4s + prices, prints report, writes radar SVG)
//   uncle who <name|CIK>     one insider's full career: every company they've filed on
//   uncle actions <TICKER>   the raw feed: every insider transaction, newest first
//   uncle tickets            leaderboard of every ticker you've rated
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { tickerToCik, getSubmissions, fetchOwnershipXmls } from './lib/edgar.mjs';
import { parseFiles, aggregateInsiders, dedupeAmendments } from './lib/parse.mjs';
import { getPrices } from './lib/prices.mjs';
import { buildReport } from './lib/analyze.mjs';
import { uncleRate } from './lib/score.mjs';
import { radarSvg } from './lib/radar.mjs';

const [cmd, arg] = process.argv.slice(2);
const money = (n) => '$' + Math.round(n).toLocaleString();

async function loadTicker(ticker) {
  const T = ticker.toUpperCase();
  const dir = `data/${T}`;
  mkdirSync(dir, { recursive: true });
  const { cik, name } = await tickerToCik(T);
  const sub = await getSubmissions(cik, `${dir}/submissions.json`);
  process.stdout.write(`${name} (CIK ${cik}) · fetching Form 4s`);
  const { files, fetched } = await fetchOwnershipXmls(sub, dir, { forms: ['4', '4/A'] });
  // a company's EDGAR feed also lists Form 4s it filed as a *shareholder* of other companies — keep only filings where it is the issuer
  const filings = dedupeAmendments(parseFiles(files).filter((f) => !f.issuerCik || f.issuerCik === cik));
  console.log(` — ${filings.length} filings (${fetched} new)`);
  const insiders = aggregateInsiders(filings);
  writeFileSync(`${dir}/insiders.json`, JSON.stringify(insiders, null, 2));
  const days = await getPrices(T, `${dir}/prices.json`);
  const report = buildReport(insiders, days);
  writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2));
  return { T, dir, name, sub, insiders, report };
}

async function rate(ticker) {
  const { T, dir, sub, report } = await loadTicker(ticker);
  const r = uncleRate(report, sub);
  const fpi = sub.filings.recent.form.some((f) => f === '20-F' || f === '6-K');
  writeFileSync(`${dir}/score.json`, JSON.stringify({ ticker: T, ...r, fpi, generated: new Date().toISOString() }, null, 2));
  writeFileSync(`${dir}/radar.svg`, radarSvg(T, r));

  console.log(`\n🐀 $${T} · UNCLE RATE ${r.composite}/100\n`);
  if (fpi) console.log(`  ⚠ foreign private issuer — exempt from Form 4. Zero insider filings ≠ zero insider selling;\n    the uncles are behind the curtain (Canadian issuers: see SEDI). Score is a floor, not a reading.\n`);
  for (const d of r.dims) {
    const bar = '█'.repeat(Math.round(d.score / 5)).padEnd(20, '·');
    console.log(`  ${bar} ${String(d.score).padStart(3)}  ${d.label}`);
    console.log(`  ${' '.repeat(26)}${d.evidence}`);
  }
  if (report.exitZone) {
    console.log(`\n  uncle exit zone: $${report.exitZone.priceP25}–$${report.exitZone.priceP75} (median $${report.exitZone.median}) · last close $${report.lastClose.close.toFixed(2)}`);
  }
  console.log(`\n  radar → ${dir}/radar.svg`);
}

async function who(q) {
  let cik = /^\d+$/.test(q) ? q : null;
  if (!cik) {
    // search cached insiders for a name match
    for (const t of readdirSync('data')) {
      const p = `data/${t}/insiders.json`;
      if (!existsSync(p)) continue;
      const hit = JSON.parse(readFileSync(p, 'utf8')).find((i) => i.name.toLowerCase().includes(q.toLowerCase()));
      if (hit) { cik = hit.cik; console.log(`matched ${hit.name} (CIK ${cik}) via $${t}`); break; }
    }
    if (!cik) return console.log(`no cached insider matches "${q}" — run \`uncle rate <TICKER>\` first, or pass a CIK directly`);
  }
  const dir = `data/people/${cik}`;
  mkdirSync(dir, { recursive: true });
  const sub = await getSubmissions(cik, `${dir}/submissions.json`);
  process.stdout.write(`${sub.name} · fetching ownership filings`);
  const { files, fetched } = await fetchOwnershipXmls(sub, dir);
  console.log(` — ${files.length} filings (${fetched} new)\n`);
  const boats = {};
  for (const fl of dedupeAmendments(parseFiles(files))) {
    if (!fl.issuerName) continue;
    const b = (boats[fl.issuerSymbol || fl.issuerCik] ??= { name: fl.issuerName, dates: [], sells: 0, sellValue: 0 });
    b.dates.push(fl.filingDate);
    for (const t of fl.transactions) {
      if (t.code !== 'S') continue;
      b.sells++;
      b.sellValue += t.shares * (t.price || 0);
    }
  }
  const list = Object.entries(boats).map(([sym, b]) => ({ sym, ...b, first: b.dates.sort()[0], last: b.dates[b.dates.length - 1] }))
    .sort((a, b) => a.first.localeCompare(b.first));
  console.log(`🐀 UNCLE WHO · ${sub.name} (CIK ${cik}) · ${list.length} boats\n`);
  for (const b of list) {
    console.log(`  ${b.sym.padEnd(8)} ${b.name.padEnd(40)} ${b.first} → ${b.last}  ${String(b.dates.length).padStart(2)} filings  sells: ${b.sells} tx ~${money(b.sellValue)}`);
  }
}

async function actions(ticker) {
  const T = ticker.toUpperCase();
  const p = `data/${T}/insiders.json`;
  const insiders = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : (await loadTicker(T)).insiders;
  const feed = insiders.flatMap((i) => i.events.map((e) => ({ ...e, insider: i.name })))
    .filter((e) => e.date)
    .sort((a, b) => b.date.localeCompare(a.date));
  console.log(`🐀 UNCLE ACTIONS · $${T} · ${feed.length} transactions, newest first\n`);
  for (const e of feed) {
    const kind = e.code === 'S' ? (e.plan10b51 ? 'sell (10b5-1 plan)' : 'SELL ⚠') : e.code === 'P' ? 'BUY' : e.code === 'M' ? 'option exercise' : e.code === 'A' ? 'grant' : e.code === 'X' ? 'warrant exercise' : e.code;
    console.log(`  ${e.date}  ${e.insider.padEnd(26)} ${kind.padEnd(18)} ${e.shares.toLocaleString().padStart(11)} sh${e.price ? ' @ $' + e.price : ''}  → holds ${e.sharesAfter?.toLocaleString() ?? '?'}`);
  }
}

function tickets() {
  const rows = [];
  for (const t of readdirSync('data')) {
    const p = `data/${t}/score.json`;
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
if (!cmd || !run[cmd] || (cmd !== 'tickets' && !arg)) {
  console.log('🐀 uncle — insider exit patterns from public SEC filings\n');
  console.log('  uncle rate <TICKER>     uncle rate 0-100, seven dimensions, evidence attached');
  console.log('  uncle who <name|CIK>    one uncle\'s entire career of boats');
  console.log('  uncle actions <TICKER>  raw insider transaction feed');
  console.log('  uncle tickets           leaderboard of rated tickers');
  process.exit(1);
}
await run[cmd](arg);
