// sell-point fingerprint: features, clusters, roster, exit zone
const TRAIL = 60; // trading days for run-up base

export function buildReport(insiders, days) {
  const idxByDate = new Map(days.map((d, i) => [d.date, i]));
  const nearestIdx = (date) => {
    if (idxByDate.has(date)) return idxByDate.get(date);
    for (let i = days.length - 1; i >= 0; i--) if (days[i].date <= date) return i;
    return 0;
  };

  const sells = [];
  const buys = [];
  for (const ins of insiders) {
    for (const e of ins.events) {
      if (e.code === 'P' && e.price) buys.push({ insider: ins.name, date: e.date, price: e.price, shares: e.shares, value: Math.round(e.shares * e.price) });
      if (e.code !== 'S' || !e.price) continue;
      const i = nearestIdx(e.date);
      const win = days.slice(Math.max(0, i - TRAIL), i + 1);
      const low60 = Math.min(...win.map((d) => d.close));
      const yr = days.slice(Math.max(0, i - 252), i + 1);
      const high52w = Math.max(...yr.map((d) => d.close));
      const stakeBefore = e.sharesAfter != null ? e.sharesAfter + e.shares : null;
      sells.push({
        insider: ins.name,
        roles: ins.roles,
        date: e.date,
        price: e.price,
        shares: e.shares,
        value: Math.round(e.shares * e.price),
        plan10b51: e.plan10b51,
        runupX: +(e.price / low60).toFixed(2),
        offHigh: +((e.price / high52w - 1) * 100).toFixed(1),
        pctOfStake: stakeBefore ? +((e.shares / stakeBefore) * 100).toFixed(1) : null,
        sharesAfter: e.sharesAfter,
      });
    }
  }
  sells.sort((a, b) => a.date.localeCompare(b.date));

  // clusters: opportunistic sells by ≥2 distinct insiders within 10 calendar days
  const opp = sells.filter((s) => !s.plan10b51);
  const clusters = [];
  let cur = [];
  for (const s of opp) {
    if (cur.length && (new Date(s.date) - new Date(cur[cur.length - 1].date)) / 86400000 > 10) {
      if (new Set(cur.map((x) => x.insider)).size >= 2) clusters.push(cur);
      cur = [];
    }
    cur.push(s);
  }
  if (cur.length && new Set(cur.map((x) => x.insider)).size >= 2) clusters.push(cur);

  const roster = insiders.map((ins) => {
    const last = ins.events[ins.events.length - 1];
    return {
      name: ins.name,
      roles: ins.roles,
      lastKnownShares: last?.sharesAfter ?? null,
      asOf: last?.date ?? null,
      totalSold: ins.events.filter((e) => e.code === 'S').reduce((s, e) => s + e.shares, 0),
    };
  }).sort((a, b) => (b.lastKnownShares ?? 0) - (a.lastKnownShares ?? 0));

  let exitZone = null;
  if (opp.length) {
    const prices = opp.map((s) => s.price).sort((a, b) => a - b);
    const runups = opp.map((s) => s.runupX).sort((a, b) => a - b);
    const q = (arr, p) => arr[Math.floor(p * (arr.length - 1))];
    exitZone = {
      priceP25: q(prices, 0.25), median: q(prices, 0.5), priceP75: q(prices, 0.75),
      runupP25: q(runups, 0.25), runupMedian: q(runups, 0.5), runupP75: q(runups, 0.75),
    };
  }

  return { generated: new Date().toISOString(), lastClose: days[days.length - 1], sells, buys, clusters, roster, exitZone };
}
