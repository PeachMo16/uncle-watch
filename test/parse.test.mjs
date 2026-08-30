import test from 'node:test';
import assert from 'node:assert/strict';

import { aggregateInsiders, dedupeAmendments, parseFiling, planStatusOf } from '../lib/parse.mjs';

function filingXml({ sharesAfter = '0', plan = 'true', owner = 'DOE JANE' } = {}) {
  return `
    <ownershipDocument>
      <periodOfReport>2026-01-02</periodOfReport>
      <issuer>
        <issuerCik>0000123456</issuerCik>
        <issuerName>Example Corp</issuerName>
        <issuerTradingSymbol>EXM</issuerTradingSymbol>
      </issuer>
      <reportingOwner>
        <reportingOwnerId>
          <rptOwnerCik>0000000042</rptOwnerCik>
          <rptOwnerName>${owner}</rptOwnerName>
        </reportingOwnerId>
        <reportingOwnerRelationship>
          <isDirector>1</isDirector>
          <isOfficer>0</isOfficer>
          <isTenPercentOwner>false</isTenPercentOwner>
          <officerTitle>Chair</officerTitle>
        </reportingOwnerRelationship>
      </reportingOwner>
      <aff10b5One>${plan}</aff10b5One>
      <nonDerivativeTransaction>
        <transactionDate><value>2026-01-02</value></transactionDate>
        <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
        <transactionAmounts>
          <transactionShares><value>100</value></transactionShares>
          <transactionPricePerShare><value>12.50</value></transactionPricePerShare>
          <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
        </transactionAmounts>
        <postTransactionAmounts>
          <sharesOwnedFollowingTransaction><value>${sharesAfter}</value></sharesOwnedFollowingTransaction>
        </postTransactionAmounts>
      </nonDerivativeTransaction>
    </ownershipDocument>`;
}

test('parses a planned full exit without losing zero shares-after', () => {
  const filing = parseFiling(filingXml(), {
    form: '4', filingDate: '2026-01-03', accession: 'example-1',
  });

  assert.equal(filing.issuerCik, '123456');
  assert.equal(filing.planStatus, '10b5-1 indicated');
  assert.deepEqual(filing.owners[0], {
    name: 'DOE JANE',
    cik: '42',
    isDirector: true,
    isOfficer: false,
    isTenPercentOwner: false,
    title: 'Chair',
  });
  assert.equal(filing.transactions[0].sharesAfter, 0);
  assert.equal(filing.transactions[0].price, 12.5);
});

test('latest Form 4/A supersedes the original filing', () => {
  const original = parseFiling(filingXml({ sharesAfter: '100' }), {
    form: '4', filingDate: '2026-01-03', accession: 'original',
  });
  const amendment = parseFiling(filingXml({ sharesAfter: '25' }), {
    form: '4/A', filingDate: '2026-01-05', accession: 'amendment',
  });

  const deduped = dedupeAmendments([original, amendment]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].accession, 'amendment');
  assert.equal(deduped[0].transactions[0].sharesAfter, 25);
});

test('aggregates roles and keeps filing provenance on events', () => {
  const filing = parseFiling(filingXml({ plan: 'false' }), {
    form: '4', filingDate: '2026-01-03', accession: 'example-2',
  });
  const [insider] = aggregateInsiders([filing]);

  assert.deepEqual(insider.roles.sort(), ['Chair', 'Director']);
  assert.equal(insider.events[0].accession, 'example-2');
  assert.equal(insider.events[0].planStatus, 'no 10b5-1 indication');
});

test('plan status is three-valued around the 2023-04 checkbox rule', () => {
  // post-rule filing, no checkbox → an actual "no" indication
  const post = parseFiling(filingXml({ plan: 'false' }), { form: '4', filingDate: '2026-01-03' });
  assert.equal(post.planStatus, 'no 10b5-1 indication');
  // pre-rule filing, no checkbox → proves nothing
  const pre = parseFiling(filingXml({ plan: 'false' }), { form: '4', filingDate: '2022-06-01' });
  assert.equal(pre.planStatus, 'unknown');
  // affirmative checkbox wins regardless of date
  assert.equal(planStatusOf(true, '2022-06-01'), '10b5-1 indicated');
  // missing filing date → unknown, never "no"
  assert.equal(planStatusOf(false, undefined), 'unknown');
});
