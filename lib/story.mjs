// the narrative next to the sells: 8-K item codes aligned with insider transactions.
//
// An 8-K is the form a company files when something happens between quarterly reports,
// and every 8-K carries the SEC's own item codes saying what kind of thing: a material
// agreement (1.01), an acquisition closed (2.01), an unregistered sale of equity (3.02),
// an officer leaving (5.02), a press release (7.01). This module reads the codes, never
// the filing bodies — a label here says what kind of news it was, not what it said.
// A sell near a filing is timing. It is not evidence of knowledge or of wrongdoing.
import { submissionRows } from './edgar.mjs';

export const ITEM_LABELS = {
  '1.01': 'material agreement', '1.02': 'agreement terminated', '1.03': 'bankruptcy or receivership',
  '1.04': 'mine safety', '1.05': 'material cybersecurity incident',
  '2.01': 'acquisition or disposition completed', '2.02': 'results of operations', '2.03': 'new debt obligation',
  '2.04': 'obligation accelerated', '2.05': 'exit or disposal costs', '2.06': 'material impairment',
  '3.01': 'listing notice (delisting or non-compliance)', '3.02': 'unregistered sale of equity', '3.03': 'holder rights modified',
  '4.01': 'auditor change', '4.02': 'non-reliance on prior financials (restatement)',
  '5.01': 'change in control', '5.02': 'officer or director change', '5.03': 'charter or bylaw amendment',
  '5.04': 'trading blackout (plan)', '5.05': 'code of ethics change', '5.06': 'shell status change',
  '5.07': 'shareholder vote', '5.08': 'shareholder nomination notice',
  '6.01': 'ABS informational', '6.02': 'ABS servicer change', '6.03': 'ABS credit enhancement', '6.04': 'ABS distribution failure', '6.05': 'ABS securities change',
  '7.01': 'press release (Reg FD)', '8.01': 'other event',
};
// exhibits ride on nearly every 8-K and say nothing on their own
export const SKIP_ITEMS = new Set(['9.01']);
// a press release or "other event" rides along with most substantive items; it only counts
// in the tally when the filing carries nothing more specific
export const GENERIC_ITEMS = new Set(['7.01', '8.01']);

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dayDiff = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

// one row per 8-K that carries at least one substantive item, oldest first
export function eightKEvents(sub) {
  return submissionRows(sub.filings.recent)
    .filter((r) => r.form === '8-K' || r.form === '8-K/A')
    .map((r) => {
      const items = String(r.items ?? '').split(',').map((s) => s.trim()).filter((s) => s && !SKIP_ITEMS.has(s));
      return {
        date: r.filingDate, // when it became public on EDGAR
        eventDate: ISO.test(r.reportDate ?? '') ? r.reportDate : null, // "date of earliest event reported"
        accession: r.accession, amendment: r.form === '8-K/A', items,
        labels: items.map((i) => ITEM_LABELS[i] ?? `item ${i}`),
      };
    })
    .filter((e) => e.items.length && ISO.test(e.date))
    .sort((a, b) => a.date.localeCompare(b.date) || a.accession.localeCompare(b.accession));
}

function baselineShare(events, from, to, window) {
  if (!from || !to) return null;
  const start = Date.parse(from), end = Date.parse(to);
  const total = Math.round((end - start) / 86400000) + 1;
  if (total <= 0) return null;
  const covered = new Set();
  for (const e of events) {
    const d = Date.parse(e.date);
    for (let k = 0; k <= window; k++) { const t = d - k * 86400000; if (t >= start && t <= end) covered.add(t); }
  }
  return +(covered.size / total).toFixed(2);
}

export function buildStory(sub, report, { window = 30, lookbackDays = 548 } = {}) {
  if (!Number.isSafeInteger(window) || window < 1) throw new Error('window must be a positive integer of days');
  const events = eightKEvents(sub);
  // 10b5-1 sells were scheduled in advance; their timing next to news is not the insider's
  const sells = report.sells.filter((s) => s.planStatus !== '10b5-1 indicated' && ISO.test(s.date ?? ''));
  const planSellsExcluded = report.sells.length - sells.length;

  const aligned = sells.map((s) => {
    const next = events.find((e) => e.date >= s.date && dayDiff(s.date, e.date) <= window) ?? null;
    const prev = [...events].reverse().find((e) => e.date <= s.date && dayDiff(e.date, s.date) <= window) ?? null;
    return { ...s, next: next && { ...next, days: dayDiff(s.date, next.date) }, prev: prev && { ...prev, days: dayDiff(prev.date, s.date) } };
  });

  // the timeline is anchored on the data, not the clock, so a cached run reads the same tomorrow
  const latest = [...events.map((e) => e.date), ...sells.map((s) => s.date)].sort().at(-1) ?? null;
  const from = latest ? new Date(Date.parse(latest) - lookbackDays * 86400000).toISOString().slice(0, 10) : null;
  const timeline = [
    ...events.filter((e) => !from || e.date >= from).map((e) => ({ kind: '8-K', ...e })),
    ...aligned.filter((s) => !from || s.date >= from).map((s) => ({ kind: 'SELL', ...s })),
  ].sort((a, b) => b.date.localeCompare(a.date) || (a.kind === b.kind ? 0 : a.kind === '8-K' ? -1 : 1));

  const before = aligned.filter((s) => s.next);
  const after = aligned.filter((s) => s.prev);
  const tally = new Map(), overall = new Map();
  for (const e of events) for (const i of e.items) overall.set(i, (overall.get(i) ?? 0) + 1);
  for (const s of before) {
    const specific = s.next.items.filter((i) => !GENERIC_ITEMS.has(i));
    for (const i of specific.length ? specific : s.next.items) tally.set(i, (tally.get(i) ?? 0) + 1);
  }
  // most sells ahead of it; ties go to the rarer item, the one that says more
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1] || overall.get(a[0]) - overall.get(b[0]) || a[0].localeCompare(b[0]))[0] ?? null;
  // how often a random day in this period sat inside the window before some 8-K: if this is
  // near 1, "sold within N days before an 8-K" describes the calendar, not the insiders
  const baseline = baselineShare(events, from, latest, window);
  const loudest = [...before].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0] ?? null;
  const headline = loudest
    ? `${loudest.insider} sold ${loudest.pctOfStake != null ? loudest.pctOfStake + '% of stake' : loudest.shares.toLocaleString() + ' shares'} ($${Math.round(loudest.value).toLocaleString()}) on ${loudest.date}, ${loudest.days === 0 ? 'the day of' : loudest.next.days + ' days before'} an 8-K: ${loudest.next.labels.join(' · ')}`
    : null;

  return {
    window, lookbackDays, from, to: latest, events, sells: aligned, timeline,
    summary: {
      sellsConsidered: sells.length, planSellsExcluded,
      soldWithinWindowBefore: before.length, soldWithinWindowAfter: after.length,
      topItemAhead: top ? { item: top[0], label: ITEM_LABELS[top[0]] ?? `item ${top[0]}`, sells: top[1] } : null,
      baselineShareOfDaysBeforeAn8K: baseline,
      headline,
    },
  };
}
