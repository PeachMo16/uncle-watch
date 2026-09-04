// Descriptive, filing-dated personal history. No return prediction or learned classifier.
import { dedupeAmendments } from './parse.mjs';
import { normalizeCik } from './edgar.mjs';

const DAY = 86400000;
export function validDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}
const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const median = (xs) => {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y), m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const round = (n) => n === null ? null : Math.round(n * 100) / 100;
const unique = (xs) => [...new Set(xs.filter(Boolean))];

export function coverageIssues(coverage, from, to) {
  if (!coverage) return ['coverage was not recorded'];
  const issues = [];
  const overlaps = (item) => !item.filingFrom || !item.filingTo || (item.filingFrom <= to && item.filingTo >= from);
  const inRange = (item) => !validDate(item.filingDate) || (item.filingDate >= from && item.filingDate <= to);
  const history = coverage.history;
  if (!history) issues.push('submission index coverage is unknown');
  else {
    for (const item of history.failedArchives ?? []) if (overlaps(item)) issues.push(`archive failed: ${item.name}`);
    for (const item of history.skippedArchives ?? []) if (overlaps(item)) issues.push(`archive not read: ${item.name}`);
    if (!history.requested && history.archivesAdvertised && !(history.skippedArchives?.length)) issues.push('older submission indexes were not read');
    if (history.sources?.some((s) => s.stale)) issues.push('a submission index came from stale cache');
  }
  for (const [key, label] of [['failedFiles', 'failed XML'], ['skippedFiles', 'unsupported filing'], ['omittedFiles', 'filing omitted by limit']]) {
    const n = (coverage[key] ?? []).filter(inRange).length;
    if (n) issues.push(`${n} ${label}${n > 1 ? 's' : ''} in the comparison window`);
  }
  return issues;
}

function periodStats(events) {
  const sales = events.filter((e) => e.code === 'S');
  const buys = events.filter((e) => e.code === 'P');
  const byDay = new Map();
  for (const e of sales) {
    if (!byDay.has(e.date)) byDay.set(e.date, { value: 0, completePrice: true });
    const day = byDay.get(e.date);
    if (Number.isFinite(e.price) && e.price > 0) day.value += e.shares * e.price;
    else day.completePrice = false;
  }
  const pricedDays = [...byDay.values()].filter((d) => d.completePrice).map((d) => d.value);
  const dates = [...byDay.keys()].sort();
  return { saleTransactions: sales.length, saleDays: byDay.size, buyTransactions: buys.length,
    buyDays: new Set(buys.map((e) => e.date)).size, pricedSaleDays: pricedDays.length,
    medianDailyReportedSaleValue: round(median(pricedDays)),
    saleDateFrom: dates[0] ?? null, saleDateTo: dates.at(-1) ?? null,
    planStatus: Object.fromEntries(['10b5-1 indicated', 'no 10b5-1 indication', 'unknown']
      .map((status) => [status, sales.filter((e) => e.planStatus === status).length])) };
}

export function buildPersonalHistory(filings, ownerCik, { asOf = new Date().toISOString().slice(0, 10), recentDays = 90, baselineDays = 1095, coverage = null } = {}) {
  const cik = normalizeCik(ownerCik);
  if (!validDate(asOf)) throw new Error('as-of must be a real YYYY-MM-DD date');
  for (const [name, value] of Object.entries({ recentDays, baselineDays })) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 36500) throw new Error(`${name} must be a positive integer up to 36500`);
  }
  const recentFrom = shift(asOf, 1 - recentDays), baselineTo = shift(recentFrom, -1), baselineFrom = shift(recentFrom, -baselineDays);
  const excluded = { otherOwner: 0, missingIssuer: 0, missingFilingDate: 0, filedAfterAsOf: 0, invalidOrFutureTransactions: 0, ambiguousAmendments: 0 };
  const available = [];
  const seen = new Set();
  for (const f of filings) {
    if (!f.owners.some((o) => o.cik === cik)) { excluded.otherOwner++; continue; }
    if (!f.issuerCik) { excluded.missingIssuer++; continue; }
    if (!validDate(f.filingDate)) { excluded.missingFilingDate++; continue; }
    if (f.filingDate > asOf) { excluded.filedAfterAsOf++; continue; }
    if (f.accession && seen.has(f.accession)) continue;
    if (f.accession) seen.add(f.accession);
    if (/\/A$/.test(f.form ?? '') && !f.dateOfOriginalSubmission) excluded.ambiguousAmendments++;
    available.push(f);
  }
  // Filter by availability BEFORE applying corrections, so a later amendment cannot
  // rewrite a report dated before its filing. This is day-level, not intraday replay.
  const resolved = dedupeAmendments(available).sort((a, b) => a.filingDate.localeCompare(b.filingDate));
  const issuers = new Map(), aliases = [];
  for (const f of resolved) {
    const owners = f.owners.filter((o) => o.cik === cik);
    aliases.push(...owners.map((o) => o.name));
    if (!issuers.has(f.issuerCik)) issuers.set(f.issuerCik, { issuerCik: f.issuerCik, name: f.issuerName,
      symbol: f.issuerSymbol, names: [], symbols: [], firstFiling: f.filingDate, lastFiling: f.filingDate, filings: [], events: [] });
    const issuer = issuers.get(f.issuerCik);
    issuer.name = f.issuerName; issuer.symbol = f.issuerSymbol || issuer.symbol;
    issuer.names.push(f.issuerName); issuer.symbols.push(f.issuerSymbol); issuer.lastFiling = f.filingDate;
    const source = { accession: f.accession ?? null, filingDate: f.filingDate, acceptanceDateTime: f.acceptanceDateTime ?? null,
      form: f.form, url: f.url ?? (f.accession ? `https://www.sec.gov/Archives/edgar/data/${cik}/${f.accession.replace(/-/g, '')}/${f.accession}-index.html` : null) };
    issuer.filings.push(source);
    for (const [transactionIndex, e] of f.transactions.entries()) {
      if (!validDate(e.date) || e.date > asOf || !Number.isFinite(e.shares) || e.shares <= 0) { excluded.invalidOrFutureTransactions++; continue; }
      issuer.events.push({ ...e, transactionIndex, ...source, planStatus: f.planStatus ?? 'unknown', jointOwnerCount: f.owners.length });
    }
  }
  const issues = coverageIssues(coverage, baselineFrom, asOf);
  if (excluded.missingIssuer || excluded.missingFilingDate || excluded.invalidOrFutureTransactions) issues.push('some filing/transaction metadata could not be used');
  if (excluded.ambiguousAmendments) issues.push('an amendment lacks its original submission date; period-group fallback was used');
  const companies = [...issuers.values()].map((issuer) => {
    issuer.events.sort((a, b) => a.date.localeCompare(b.date) || a.filingDate.localeCompare(b.filingDate));
    const baselineEvents = issuer.events.filter((e) => e.date >= baselineFrom && e.date <= baselineTo);
    const recentEvents = issuer.events.filter((e) => e.date >= recentFrom && e.date <= asOf);
    const baseline = periodStats(baselineEvents), recent = periodStats(recentEvents);
    const reasons = [...issues];
    const sales = [...baselineEvents, ...recentEvents].filter((e) => e.code === 'S');
    const securities = unique(sales.map((e) => e.securityTitle));
    const ownership = unique(sales.map((e) => e.directOrIndirect));
    // Only judge the basis when there are sales to judge: an empty set is not "mixed".
    if (sales.length && (securities.length !== 1 || sales.some((e) => !e.securityTitle))) reasons.push('sale security class is mixed or unknown');
    if (sales.length && (ownership.length !== 1 || sales.some((e) => !e.directOrIndirect))) reasons.push('direct/indirect ownership basis is mixed or unknown');
    if (sales.some((e) => e.jointOwnerCount > 1)) reasons.push('joint-owner filings do not allocate economic exposure to this person');
    if (baseline.saleDays < 5) reasons.push('fewer than 5 baseline selling days');
    const span = baseline.saleDateFrom ? (Date.parse(baseline.saleDateTo) - Date.parse(baseline.saleDateFrom)) / DAY : 0;
    if (span < 180) reasons.push('baseline selling dates span fewer than 180 days');
    if (!recent.saleDays) reasons.push('no recent selling days observed');
    if (baseline.pricedSaleDays < baseline.saleDays || recent.pricedSaleDays < recent.saleDays) reasons.push('at least one sale day has missing prices');
    const ratio = !reasons.length && baseline.medianDailyReportedSaleValue > 0
      ? round(recent.medianDailyReportedSaleValue / baseline.medianDailyReportedSaleValue) : null;
    const pastMonths = unique(baselineEvents.filter((e) => e.code === 'S').map((e) => e.date.slice(5, 7))).sort();
    const recentMonths = unique(recentEvents.filter((e) => e.code === 'S').map((e) => e.date.slice(5, 7))).sort();
    return { ...issuer, names: unique(issuer.names), symbols: unique(issuer.symbols),
      lifetime: periodStats(issuer.events), baseline, recent,
      comparison: { medianDailySaleValueRatio: ratio, withheldReasons: reasons,
        baselineSaleMonths: pastMonths, recentSaleMonths: recentMonths,
        monthsNotSeenInObservedBaseline: recentMonths.filter((m) => !pastMonths.includes(m)),
        interpretation: 'Descriptive comparison of reported transaction values at one issuer. Not statistical abnormality, intent, or a return signal. Currency, inflation and split effects are not normalized.' } };
  }).sort((a, b) => a.firstFiling.localeCompare(b.firstFiling) || a.issuerCik.localeCompare(b.issuerCik));
  return { version: 1, ownerCik: cik, name: aliases.at(-1) ?? null, aliases: unique(aliases), asOf,
    windows: { recent: { from: recentFrom, to: asOf, days: recentDays }, baseline: { from: baselineFrom, to: baselineTo, days: baselineDays } },
    coverage, comparisonCoverageIssues: issues, excluded, companies,
    crossCompany: { observedIssuers: companies.length, recentlyActiveIssuers: companies.filter((c) => c.recent.saleDays || c.recent.buyDays).map((c) => c.issuerCik),
      firstObservedRecently: companies.filter((c) => c.firstFiling >= recentFrom).map((c) => c.issuerCik) },
    limitations: ['Observed supported filings are not an entire career or proof of all trading activity.',
      'Only non-derivative transactions are analyzed. Form 3/5 holdings may establish issuer history without contributing sale events.',
      'As-of uses currently retrievable filings with filingDate on or before the requested day; it does not reconstruct an archived intraday public-data snapshot.',
      'Calendar-month overlap is descriptive and is not the Cohen/Malloy/Pomorski routine/opportunistic classifier.',
      'The 5-selling-day and 180-day minimums are display heuristics, not empirically validated thresholds.'] };
}
