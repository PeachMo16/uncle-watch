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

export function parseFiling(xml, meta = {}) {
  const owners = [...xml.matchAll(/<reportingOwner>[\s\S]*?<\/reportingOwner>/g)].map((m) => m[0]).map((o) => ({
    name: tag(o, 'rptOwnerName'),
    cik: tag(o, 'rptOwnerCik').replace(/^0+/, ''),
    isDirector: tag(o, 'isDirector') === '1' || tag(o, 'isDirector').toLowerCase() === 'true',
    isOfficer: tag(o, 'isOfficer') === '1' || tag(o, 'isOfficer').toLowerCase() === 'true',
    isTenPercentOwner: tag(o, 'isTenPercentOwner') === '1' || tag(o, 'isTenPercentOwner').toLowerCase() === 'true',
    title: tag(o, 'officerTitle'),
  }));
  const transactions = [...xml.matchAll(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/g)].map((m) => m[0]).map((t) => ({
    date: val(t, 'transactionDate'),
    code: (t.match(/<transactionCode>([A-Z])<\/transactionCode>/) || [])[1] || '',
    shares: Number(val(t, 'transactionShares')) || 0,
    price: Number(val(t, 'transactionPricePerShare')) || null,
    acqDisp: val(t, 'transactionAcquiredDisposedCode'), // A / D
    sharesAfter: Number(val(t, 'sharesOwnedFollowingTransaction')) || null,
  }));
  return {
    ...meta,
    issuerName: tag(xml, 'issuerName'),
    issuerSymbol: tag(xml, 'issuerTradingSymbol'),
    issuerCik: tag(xml, 'issuerCik').replace(/^0+/, ''),
    periodOfReport: tag(xml, 'periodOfReport'),
    plan10b51: tag(xml, 'aff10b5One') === '1' || tag(xml, 'aff10b5One').toLowerCase() === 'true',
    owners,
    transactions,
  };
}

export function parseFiles(files) {
  return files.map((f) => parseFiling(readFileSync(f.out ?? f, 'utf8'), {
    form: f.form, filingDate: f.filingDate, accession: f.accession,
  }));
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
        insiders[key].events.push({ ...t, filingDate: fl.filingDate, plan10b51: fl.plan10b51, accession: fl.accession });
      }
    }
  }
  return Object.values(insiders).map((i) => ({
    ...i,
    roles: [...i.roles],
    events: i.events.sort((a, b) => a.date.localeCompare(b.date)),
  }));
}
