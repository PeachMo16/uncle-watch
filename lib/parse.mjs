// Form 3/4/5 XML → structured filings → per-insider timelines
import { readFileSync } from 'node:fs';

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : '';
};
const val = (xml, name) => {
  const block = tag(xml, name);
  const m = block.match(/<value>([\s\S]*?)<\/value>/);
  return m ? m[1].trim() : '';
};

// SEC's mandatory 10b5-1 checkbox applies to filings from 2023-04-01; before that
// the aff10b5One field is voluntary/absent, so a missing flag proves nothing.
const CHECKBOX_RULE = '2023-04-01';
export function planStatusOf(affirmed, filingDate) {
  if (affirmed) return '10b5-1 indicated';
  if (filingDate && filingDate >= CHECKBOX_RULE) return 'no 10b5-1 indication';
  return 'unknown';
}

export function parseFiling(xml, meta = {}) {
  const owners = [...xml.matchAll(/<reportingOwner>[\s\S]*?<\/reportingOwner>/g)].map((m) => m[0]).map((o) => ({
    name: tag(o, 'rptOwnerName'),
    cik: tag(o, 'rptOwnerCik').replace(/^0+/, ''),
    isDirector: tag(o, 'isDirector') === '1' || tag(o, 'isDirector').toLowerCase() === 'true',
    isOfficer: tag(o, 'isOfficer') === '1' || tag(o, 'isOfficer').toLowerCase() === 'true',
    isTenPercentOwner: tag(o, 'isTenPercentOwner') === '1' || tag(o, 'isTenPercentOwner').toLowerCase() === 'true',
    title: tag(o, 'officerTitle'),
  }));
  const transactions = [...xml.matchAll(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/g)].map((m) => m[0]).map((t) => {
    // NB: sharesAfter of 0 (a full exit — the loudest possible signal) must survive; `|| null` would eat it
    const sa = val(t, 'sharesOwnedFollowingTransaction');
    return {
      date: val(t, 'transactionDate'),
      code: (t.match(/<transactionCode>([A-Z])<\/transactionCode>/) || [])[1] || '',
      shares: Number(val(t, 'transactionShares')) || 0,
      price: Number(val(t, 'transactionPricePerShare')) || null,
      acqDisp: val(t, 'transactionAcquiredDisposedCode'), // A / D
      sharesAfter: sa !== '' && Number.isFinite(Number(sa)) ? Number(sa) : null,
    };
  });
  return {
    ...meta,
    issuerName: tag(xml, 'issuerName'),
    issuerSymbol: tag(xml, 'issuerTradingSymbol'),
    issuerCik: tag(xml, 'issuerCik').replace(/^0+/, ''),
    periodOfReport: tag(xml, 'periodOfReport'),
    // a 4/A names the filing date of the Form 4 it corrects (no accession is given in the XML)
    dateOfOriginalSubmission: tag(xml, 'dateOfOriginalSubmission') || null,
    planStatus: planStatusOf(
      tag(xml, 'aff10b5One') === '1' || tag(xml, 'aff10b5One').toLowerCase() === 'true',
      meta.filingDate,
    ),
    owners,
    transactions,
  };
}

export function parseFiles(files) {
  return files.map((f) => parseFiling(readFileSync(f.out ?? f, 'utf8'), {
    form: f.form, filingDate: f.filingDate, accession: f.accession,
  }));
}

// a Form 4/A refiles (and may correct) the transactions of one original Form 4.
// Within a (issuer, owner set, period) group, an amendment that names its original's
// filing date (dateOfOriginalSubmission) supersedes only the originals filed that day —
// an untouched sibling Form 4 for the same period (say, a grant filed a week earlier)
// survives. An amendment that names no original date cannot be matched, so it falls
// back to the conservative rule: latest amendment supersedes the whole group.
const latest = (fs) => [...fs].sort((a, b) => a.filingDate.localeCompare(b.filingDate)).pop();
export function dedupeAmendments(filings) {
  const groups = {};
  for (const fl of filings) {
    const key = `${fl.issuerCik}|${fl.owners.map((o) => o.cik).sort().join('+')}|${fl.periodOfReport}`;
    (groups[key] ??= []).push(fl);
  }
  return Object.values(groups).flatMap((g) => {
    const amends = g.filter((f) => f.form === '4/A');
    if (!amends.length) return g;
    if (amends.some((a) => !a.dateOfOriginalSubmission)) return [latest(amends)];
    const byOrigDate = {};
    for (const a of amends) (byOrigDate[a.dateOfOriginalSubmission] ??= []).push(a);
    const kept = g.filter((f) => f.form !== '4/A' && !byOrigDate[f.filingDate]);
    for (const as of Object.values(byOrigDate)) kept.push(latest(as));
    return kept.sort((a, b) => a.filingDate.localeCompare(b.filingDate));
  });
}

// aggregate filings (one issuer) into per-insider event timelines
export function aggregateInsiders(filings) {
  const insiders = {};
  for (const fl of filings) {
    for (const o of fl.owners) {
      const key = o.name;
      insiders[key] ??= { name: o.name, cik: o.cik, roles: new Set(), events: [] };
      if (o.title) insiders[key].roles.add(o.title);
      if (o.isDirector) insiders[key].roles.add('Director');
      if (o.isTenPercentOwner) insiders[key].roles.add('10% owner');
      for (const t of fl.transactions) {
        insiders[key].events.push({ ...t, filingDate: fl.filingDate, planStatus: fl.planStatus, accession: fl.accession });
      }
    }
  }
  return Object.values(insiders).map((i) => ({
    ...i,
    roles: [...i.roles],
    events: i.events.sort((a, b) => a.date.localeCompare(b.date)),
  }));
}
