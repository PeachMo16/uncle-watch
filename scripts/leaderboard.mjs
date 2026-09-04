#!/usr/bin/env node
// builds LEADERBOARD.md from every data/<TICKER>/score.json — run after `uncle rate` on a watchlist
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';

const rows = [];
for (const t of readdirSync('data')) {
  const p = `data/${t}/score.json`;
  if (!existsSync(p)) continue;
  const s = JSON.parse(readFileSync(p, 'utf8'));
  const r = existsSync(`data/${t}/report.json`) ? JSON.parse(readFileSync(`data/${t}/report.json`, 'utf8')) : null;
  rows.push({ ...s, exitZone: r?.exitZone ?? null, lastClose: r?.lastClose?.close ?? null });
}
rows.sort((a, b) => b.composite - a.composite);

const bar = (n) => '█'.repeat(Math.round(n / 10)).padEnd(10, '·');
const lines = [
  '# 🐀 uncle tickets',
  '',
  `Updated ${new Date().toISOString().slice(0, 10)} by [the weekly workflow](.github/workflows/leaderboard.yml)`,
  'on the tickers in [WATCHLIST](WATCHLIST). Scoring v' + (rows[0]?.scoringVersion ?? '?') + '. Not investment advice —',
  'a reading aid that ranks which filings deserve your attention. See [honest limitations](README.md#honest-limitations).',
  '',
  '| ticker | uncle rate | | loudest dimension | open-market buying | exit zone (p25–p75) | last close |',
  '|---|---:|---|---|---|---|---:|',
];
for (const r of rows) {
  const top = [...r.dims].sort((a, b) => b.score - a.score)[0];
  const buy = r.counterSignals?.find((c) => c.key === 'openMarketBuying');
  const z = r.exitZone ? `$${r.exitZone.priceP25.toFixed(2)}–$${r.exitZone.priceP75.toFixed(2)}` : '—';
  lines.push(`| $${r.ticker}${r.fpi ? ' ⚠ FPI' : ''} | **${r.composite}** | \`${bar(r.composite)}\` | ${top.label.toLowerCase()} (${top.score}) | ${buy?.observed ? '↑ yes' : 'none'} | ${z} | ${r.lastClose != null ? '$' + r.lastClose.toFixed(2) : '—'} |`);
}
lines.push('', '⚠ FPI = foreign-issuer forms on file. Most FPI insiders were exempt from Form 4 until March 2026 and exemptions still apply case by case: the uncles may be behind the curtain, so the score is a floor, not a reading.', '');
writeFileSync('LEADERBOARD.md', lines.join('\n'));
console.log(`LEADERBOARD.md · ${rows.length} tickers`);
