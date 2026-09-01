// uncle rate v2: 6 risk dimensions (each 0-100 with evidence, weighted composite)
// plus independent counter-signals that never enter the composite.
//
// v2 scoring-semantics changes (after the gold-digger LEAD-0004 literature audit):
//  - "opportunistic" renamed: the filter only ever measured the absence of a 10b5-1
//    indication, which is not Cohen/Malloy/Pomorski's behavioral routine/opportunistic
//    classification — that citation was removed. Plan status is three-valued
//    (10b5-1 indicated / no 10b5-1 indication / unknown) because the SEC checkbox
//    only applies to filings from 2023-04.
//  - Net insider flow removed from the composite: the classic literature supports
//    "real open-market buying is positive information", not "zero buying is negative".
//    Buying is now an independent counter-signal — no offset, no invented exchange rate.
//
// v3 changes:
//  - cluster / ladder / discipline use only sells that affirmatively lack a 10b5-1
//    indication. Pre-2023 unknown-status sells were already excluded from the ratio;
//    v2 still let them drive the other three dimensions as if they were unscheduled.
//    Now every scored dimension refuses to guess, and says how many sells it left out.
//  - ladder has a value floor: a two-step 50% → 100% exit of a hundred-dollar stake
//    used to score the same 100 as a seven-figure one. Shape alone is not a signal.
export const LADDER_MIN_VALUE = 25_000; // USD, whole run — hand-tuned like the weights
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

export function uncleRate(report, sub) {
  const dims = [];
  const sells = report.sells;
  const noInd = sells.filter((s) => s.planStatus === 'no 10b5-1 indication');
  const unknown = sells.filter((s) => s.planStatus === 'unknown');
  const known = sells.length - unknown.length;
  // appended to the evidence of every dimension that had to leave unknown-status sells out
  const excluded = unknown.length ? ` (${unknown.length} pre-2023 sell${unknown.length > 1 ? 's' : ''} with unknown plan status excluded)` : '';

  // 1 · no-10b5-1-indication ratio — routine plan sells are pre-scheduled; sells filed
  // without the plan checkbox are not. Only filings from 2023-04 can say either way.
  dims.push({
    key: 'noPlanIndication', label: 'No 10b5-1 indication', weight: 0.20,
    score: clamp(known ? (noInd.length / known) * 100 : 0),
    evidence: !sells.length ? 'no insider sells on record'
      : !known ? `plan status unknown for all ${sells.length} sells (pre-2023 filings)`
      : `${noInd.length} of ${known} status-known sells filed with no 10b5-1 indication${unknown.length ? ` (${unknown.length} pre-2023 sells with unknown status excluded)` : ''}`,
  });

  // 2 · cluster density — different uncles reaching for the exit at once
  const maxIns = Math.max(0, ...report.clusters.map((c) => new Set(c.map((x) => x.insider)).size));
  const clusterValue = report.clusters.reduce((s, c) => s + c.reduce((a, x) => a + x.value, 0), 0);
  dims.push({
    key: 'clusters', label: 'Cluster density', weight: 0.15,
    score: clamp(report.clusters.length * 25 + maxIns * 10),
    evidence: (report.clusters.length
      ? `${report.clusters.length} windows with ≥2 insiders selling within 10 days (max ${maxIns} insiders, ~$${clusterValue.toLocaleString()} total)`
      : 'no multi-insider sell clusters') + excluded,
  });

  // 3 · ladder acceleration — a genuinely escalating sequence: each slice a larger % of stake
  // than the last, whole run inside 10 calendar days, whole run worth at least LADDER_MIN_VALUE
  let ladder = null;
  let belowFloor = 0;
  const byInsider = {};
  for (const s of noInd) (byInsider[s.insider] ??= []).push(s);
  for (const [name, ss] of Object.entries(byInsider)) {
    const knownPct = ss.filter((s) => s.pctOfStake != null);
    for (let i = 0; i < knownPct.length; i++) {
      const run = [knownPct[i]];
      for (let j = i + 1; j < knownPct.length; j++) {
        if ((new Date(knownPct[j].date) - new Date(knownPct[i].date)) / 86400000 > 10) break;
        if (knownPct[j].pctOfStake > run[run.length - 1].pctOfStake) run.push(knownPct[j]);
      }
      if (run.length < 2) continue;
      const value = run.reduce((a, s) => a + (s.value ?? 0), 0);
      if (value < LADDER_MIN_VALUE) { belowFloor++; continue; }
      const peak = run[run.length - 1].pctOfStake;
      if (!ladder || peak > ladder.peak) ladder = { name, peak, value, steps: run.map((s) => s.pctOfStake), from: run[0].date, to: run[run.length - 1].date };
    }
  }
  dims.push({
    key: 'ladder', label: 'Ladder acceleration', weight: 0.15,
    score: ladder ? clamp(ladder.peak * 1.2) : 0,
    evidence: (ladder
      ? `${ladder.name} escalated ${ladder.steps.join('% → ')}% of stake (~$${ladder.value.toLocaleString()}), ${ladder.from} → ${ladder.to}`
      : `no escalating multi-day sell ladders worth ≥ $${LADDER_MIN_VALUE.toLocaleString()}${belowFloor ? ` (${belowFloor} below the floor ignored)` : ''}`) + excluded,
  });

  // 4 · exit discipline — tightest personal price band across ≥3 no-indication sells
  let disc = null;
  for (const [name, ss] of Object.entries(byInsider)) {
    if (ss.length < 3) continue;
    const ps = ss.map((s) => s.price).sort((a, b) => a - b);
    const spread = (ps[ps.length - 1] - ps[0]) / ps[Math.floor(ps.length / 2)];
    if (!disc || spread < disc.spread) disc = { name, spread, n: ss.length, lo: ps[0], hi: ps[ps.length - 1] };
  }
  dims.push({
    key: 'discipline', label: 'Exit discipline', weight: 0.10,
    score: disc ? clamp(100 - disc.spread * 220) : 0,
    evidence: (disc
      ? `${disc.name}: ${disc.n} sells inside $${disc.lo}–$${disc.hi} (${(disc.spread * 100).toFixed(0)}% band)`
      : 'no insider with ≥3 sells lacking a 10b5-1 indication') + excluded,
  });

  // 5 · dilution engine — shelf registrations and offering supplements
  const forms = sub.filings.recent.form;
  const dilForms = forms.filter((f) => /^(424B|S-1|S-3|F-3|F-10|SUPPL)/.test(f));
  dims.push({
    key: 'dilution', label: 'Dilution engine', weight: 0.15,
    score: clamp(dilForms.length * 7),
    evidence: dilForms.length ? `${dilForms.length} offering/shelf filings (${[...new Set(dilForms)].join(', ')})` : 'no shelf/offering filings in recent history',
  });

  // 6 · shell history — name changes, fresh 10-12G registration (reverse-merger tell)
  const fn = sub.formerNames?.length ?? 0;
  const has1012G = forms.some((f) => /^(10-12G|20FR12G)/.test(f));
  const shellBits = [];
  if (fn) shellBits.push(`${fn} former name${fn > 1 ? 's' : ''} (${sub.formerNames.map((x) => x.name).join('; ')})`);
  if (has1012G) shellBits.push('fresh 12(g) registration (a common reverse-merger route — suggestive, not conclusive)');
  dims.push({
    key: 'shell', label: 'Shell history', weight: 0.15,
    score: clamp(fn * 35 + (has1012G ? 30 : 0)),
    evidence: shellBits.join(' · ') || 'no name changes or fresh registrations on file',
  });

  // renormalize the surviving weights so the composite stays 0-100
  // (v1 had a 7th dimension; relative proportions of the six are preserved)
  const wsum = dims.reduce((s, d) => s + d.weight, 0);
  for (const d of dims) d.weight = +(d.weight / wsum).toFixed(4);
  const composite = Math.round(dims.reduce((s, d) => s + d.score * d.weight, 0));

  // counter-signal: real open-market buying (code P, insider's own cash).
  // Reported, never scored: the literature says buying is informative when present —
  // it does not price an exchange rate against sell-side risk, and a token buy
  // must not launder a boat. Absence of buying is NOT evidence of danger.
  const buys = report.buys;
  const buyV = buys.reduce((s, x) => s + x.value, 0);
  const buyers = new Set(buys.map((b) => b.insider)).size;
  const lastBuy = buys.map((b) => b.date).sort().pop();
  const counterSignals = [{
    key: 'openMarketBuying', label: 'Open-market insider buying',
    observed: buys.length > 0,
    evidence: buys.length
      ? `~$${buyV.toLocaleString()} across ${buys.length} buy${buys.length > 1 ? 's' : ''} by ${buyers} insider${buyers > 1 ? 's' : ''}, most recent ${lastBuy}`
      : 'none observed (not scored — absence of buying is not evidence of danger)',
  }];

  return { scoringVersion: 3, composite, dims, counterSignals };
}
