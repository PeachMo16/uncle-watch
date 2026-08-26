// daily closes via Yahoo Finance chart API, cached
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export async function getPrices(ticker, cachePath) {
  let raw;
  if (cachePath && existsSync(cachePath)) {
    raw = JSON.parse(readFileSync(cachePath, 'utf8'));
  } else {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=8y&interval=1d`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' } });
    if (!resp.ok) throw new Error(`yahoo ${resp.status} for ${ticker}`);
    raw = await resp.json();
    if (cachePath) writeFileSync(cachePath, JSON.stringify(raw));
  }
  const r = raw.chart.result[0];
  return r.timestamp.map((t, i) => ({
    date: new Date(t * 1000).toISOString().slice(0, 10),
    close: r.indicators.quote[0].close[i],
  })).filter((d) => d.close != null);
}
