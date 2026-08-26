// uncle rate: 7 dimensions, each 0-100 with evidence, weighted composite
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

export function uncleRate(report, sub) {
  const dims = [];
  const sells = report.sells;
  const opp = sells.filter((s) => !s.plan10b51);

  // 1 · opportunistic ratio — routine plan sells carry no signal (Cohen/Malloy/Pomorski)
  const oppRatio = sells.length ? opp.length / sells.length : 0;
  dims.push({
    key: 'opportunistic', label: 'Opportunistic ratio', weight: 0.20,
    score: clamp(oppRatio * 100),
    evidence: sells.length ? `${opp.length} of ${sells.length} sells were outside 10b5-1 plans` : 'no insider sells on record',
  });

  // 2 · cluster density — different uncles reaching for the exit at once
  const maxIns = Math.max(0, ...report.clusters.map((c) => new Set(c.map((x) => x.insider)).size));
  const clusterValue = report.clusters.reduce((s, c) => s + c.reduce((a, x) => a + x.value, 0), 0);
  dims.push({
    key: 'clusters', label: 'Cluster density', weight: 0.15,
    score: clamp(report.clusters.length * 25 + maxIns * 10),
    evidence: report.clusters.length
      ? `${report.clusters.length} windows with ≥2 insiders selling within 10 days (max ${maxIns} insiders, ~$${clusterValue.toLocaleString()} total)`
      : 'no multi-insider sell clusters',
  });

  // 3 · ladder acceleration — escalating % of stake sold day after day
  let ladder = null;
  const byInsider = {};
  for (const s of opp) (byInsider[s.insider] ??= []).push(s);
  for (const [name, ss] of Object.entries(byInsider)) {
    const known = ss.filter((s) => s.pctOfStake != null);
    for (let i = 0; i < known.length; i++) {
      const run = known.filter((s) => (new Date(s.date) - new Date(known[i].date)) / 86400000 >= 0 && (new Date(s.date) - new Date(known[i].date)) / 86400000 <= 10);
      if (run.length < 2) continue;
      const peak = Math.max(...run.map((s) => s.pctOfStake));
      if (!ladder || peak > ladder.peak) ladder = { name, peak, days: run.length, from: run[0].date, to: run[run.length - 1].date };
    }
  }
  dims.push({
    key: 'ladder', label: 'Ladder acceleration', weight: 0.15,
    score: ladder ? clamp(ladder.peak * 1.2) : 0,
    evidence: ladder
      ? `${ladder.name} reached ${ladder.peak}% of stake in a single slice, ${ladder.days} sells over ${ladder.from} → ${ladder.to}`
      : 'no accelerating multi-day sell ladders',
  });

  // 4 · exit discipline — tightest personal price band across ≥3 opportunistic sells
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
    evidence: disc
      ? `${disc.name}: ${disc.n} sells inside $${disc.lo}–$${disc.hi} (${(disc.spread * 100).toFixed(0)}% band)`
      : 'no insider with ≥3 opportunistic sells',
  });

  // 5 · net insider flow — do insiders ever buy with their own cash?
  const sellV = sells.reduce((s, x) => s + x.value, 0);
  const buyV = report.buys.reduce((s, x) => s + x.value, 0);
  dims.push({
    key: 'flow', label: 'Net insider flow', weight: 0.10,
    score: sellV + buyV ? clamp((sellV / (sellV + buyV)) * 100) : 0,
    evidence: `~$${sellV.toLocaleString()} sold vs ~$${buyV.toLocaleString()} open-market bought`,
  });

  // 6 · dilution engine — shelf registrations and offering supplements
  const forms = sub.filings.recent.form;
  const dilForms = forms.filter((f) => /^(424B|S-1|S-3|F-3|F-10|SUPPL)/.test(f));
  dims.push({
    key: 'dilution', label: 'Dilution engine', weight: 0.15,
    score: clamp(dilForms.length * 7),
    evidence: dilForms.length ? `${dilForms.length} offering/shelf filings (${[...new Set(dilForms)].join(', ')})` : 'no shelf/offering filings in recent history',
  });

  // 7 · shell history — name changes, fresh 10-12G registration (reverse-merger tell)
  const fn = sub.formerNames?.length ?? 0;
  const has1012G = forms.some((f) => /^(10-12G|20FR12G)/.test(f));
  const shellBits = [];
  if (fn) shellBits.push(`${fn} former name${fn > 1 ? 's' : ''} (${sub.formerNames.map((x) => x.name).join('; ')})`);
  if (has1012G) shellBits.push('fresh 12(g) registration (reverse-merger fingerprint)');
  dims.push({
    key: 'shell', label: 'Shell history', weight: 0.15,
    score: clamp(fn * 35 + (has1012G ? 45 : 0)),
    evidence: shellBits.join(' · ') || 'no name changes or fresh registrations on file',
  });

  const composite = Math.round(dims.reduce((s, d) => s + d.score * d.weight, 0));
  return { composite, dims };
}
