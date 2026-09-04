// sell-point fingerprint: features, clusters, roster, exit zone
const TRAIL = 60; // trading days for run-up base

export function buildReport(insiders, days) {
  const idxByDate = new Map(days.map((d, i) => [d.date, i]));
  const nearestIdx = (date) => {
    if (idxByDate.has(date)) return idxByDate.get(date);
    for (let i = days.length - 1; i >= 0; i--) if (days[i].date <= date) return i;
    return -1; // no earlier quote exists: never substitute a future price
  };

  const sells = [];
  const buys = [];
  for (const ins of insiders) {
    for (const e of ins.events) {
      if (e.code === 'P' && e.price) buys.push({ insider: ins.name, insiderCik: ins.cik ?? null, date: e.date, price: e.price, shares: e.shares, value: Math.round(e.shares * e.price), accession: e.accession, filingDate: e.filingDate });
      if (e.code !== 'S' || !e.price) continue;
      const i = nearestIdx(e.date);
      const win = i < 0 ? [] : days.slice(Math.max(0, i - TRAIL), i + 1);
      const low60 = win.length ? Math.min(...win.map((d) => d.close)) : null;
      const yr = i < 0 ? [] : days.slice(Math.max(0, i - 252), i + 1);
      const high52w = yr.length ? Math.max(...yr.map((d) => d.close)) : null;
      const stakeBefore = e.sharesAfter != null ? e.sharesAfter + e.shares : null;
      sells.push({
        insider: ins.name,
        insiderCik: ins.cik ?? null,
        accession: e.accession,
        filingDate: e.filingDate,
        roles: ins.roles,
        date: e.date,
        price: e.price,
        shares: e.shares,
        value: Math.round(e.shares * e.price),
        planStatus: e.planStatus,
        runupX: low60 > 0 ? +(e.price / low60).toFixed(2) : null,
        offHigh: high52w > 0 ? +((e.price / high52w - 1) * 100).toFixed(1) : null,
        priceContextDays: win.length,
        pctOfStake: stakeBefore ? +((e.shares / stakeBefore) * 100).toFixed(1) : null,
        sharesAfter: e.sharesAfter,
      });
    }
  }
  sells.sort((a, b) => a.date.localeCompare(b.date));

  // clusters: ≥2 distinct insiders selling inside a strict 10-calendar-day window
  // (rolling window, not adjacent-gap chaining — a chain of 8-day gaps must not merge into one "cluster")
  // Scored features use only sells that affirmatively lack a 10b5-1 indication. Pre-2023
  // sells have unknown plan status: a missing checkbox proves nothing, so they are
  // excluded here (and counted), exactly as the plan-status ratio already excludes them.
  const noInd = sells.filter((s) => s.planStatus === 'no 10b5-1 indication');
  const unknown = sells.filter((s) => s.planStatus === 'unknown');
  const clusters = [];
  let i = 0;
  while (i < noInd.length) {
    const end = new Date(noInd[i].date).getTime() + 10 * 86400000;
    let j = i;
    while (j + 1 < noInd.length && new Date(noInd[j + 1].date).getTime() <= end) j++;
    const win = noInd.slice(i, j + 1);
    if (new Set(win.map((x) => x.insiderCik || x.insider)).size >= 2) { clusters.push(win); i = j + 1; }
    else i++;
  }

  const roster = insiders.map((ins) => {
    const last = ins.events[ins.events.length - 1];
    return {
      name: ins.name,
      cik: ins.cik ?? null,
      roles: ins.roles,
      lastKnownShares: last?.sharesAfter ?? null,
      asOf: last?.date ?? null,
      totalSold: ins.events.filter((e) => e.code === 'S').reduce((s, e) => s + e.shares, 0),
    };
  }).sort((a, b) => (b.lastKnownShares ?? 0) - (a.lastKnownShares ?? 0));

  // exit zone is descriptive, not scored: every sell not affirmatively marked 10b5-1
  // goes in, and the basis (how many are of unknown status) is printed with it
  let exitZone = null;
  const opp = [...noInd, ...unknown].sort((a, b) => a.date.localeCompare(b.date));
  if (opp.length) {
    const prices = opp.map((s) => s.price).sort((a, b) => a - b);
    const runups = opp.map((s) => s.runupX).filter((n) => n != null).sort((a, b) => a - b);
    const q = (arr, p) => arr.length ? arr[Math.floor(p * (arr.length - 1))] : null;
    exitZone = {
      priceP25: q(prices, 0.25), median: q(prices, 0.5), priceP75: q(prices, 0.75),
      runupP25: q(runups, 0.25), runupMedian: q(runups, 0.5), runupP75: q(runups, 0.75),
      basis: { noIndication: noInd.length, unknown: unknown.length },
    };
  }

  return { generated: new Date().toISOString(), lastClose: days[days.length - 1], sells, buys, clusters, roster, exitZone, unknownStatusSells: unknown.length };
}
