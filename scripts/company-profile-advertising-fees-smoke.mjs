import assert from 'node:assert/strict';
import { loadTsModule } from './helpers/load-typescript-module.mjs';

// Synthetic text reproduces the explicit fee-payer construction observed in
// Cardlytics' 2025 annual, filed 2026-03-04. No live profile or network writes.
const p = loadTsModule('@/lib/company-profile');
const identity = { ticker: 'TEST', company: 'Example Ads, Inc.', cik: '0000000123' };
const sourceUrl = 'https://www.sec.gov/Archives/edgar/data/123/000000012326000001/annual.htm';
const now = new Date('2026-10-06T21:00:00Z');
const business = 'We operate an advertising analytics platform that processes purchase records and reports campaign results.';
const customer = 'Through the Example Ads platform, our financial media network, marketers can deliver advertising content to customers that allows them to earn rewards, which are funded with a portion of the fees we collect from marketers.';
const padding = 'Campaign reports contain aggregate records organized by the original transaction date. '.repeat(5);
const run = (sentence, extra = {}) => p.inspectCompanyProfileExtraction({ identity, sourceUrl, form: '10-K', filedAt: '2026-03-04', now,
  html: `Item 1. Business\n${business}\n${sentence}\n${padding}\nItem 1A. Risk Factors\n`, ...extra });
const yes = run(customer);
assert.ok(yes.profile, 'Explicit issuer-platform fees collected from marketers identify the paying population');
assert.equal(yes.profile.customers, customer, 'Keep the full original statement, including reward recipients and payment direction');
assert.equal(yes.profile.sourceFiledAt, '2026-03-04');
assert.equal(yes.profile.sourceUrl, sourceUrl);
assert.equal(yes.profile.cik, identity.cik);
for (const sentence of [
  customer.replace('fees we collect from marketers', 'fees we pay to marketers'),
  customer.replace('fees we collect from marketers', 'fees our partners collect from marketers'),
  customer.replace('fees we collect from marketers', 'fees we expect to collect from marketers'),
  customer.replace('fees we collect from marketers', 'fees we do not collect from marketers'),
  customer.replace('fees we collect from marketers', 'fees collected from consumers'),
  customer.replace('Example Ads', 'Another Issuer'),
  customer.replace('our financial media network', "our competitor's financial media network"),
  customer.replace(', which are funded with a portion of the fees we collect from marketers', ''),
  'We enable marketers to reach potential buyers through digital advertising channels.',
  'Our partners provide us with access to their customers and purchase data.',
]) assert.equal(run(sentence).profile, null, `No inferred customer: ${sentence}`);
assert.equal(run(customer, { sourceUrl: sourceUrl.replace('/123/', '/456/') }).profile, null);
assert.equal(run(customer, { filedAt: '2027-03-04' }).profile, null);
assert.equal(run(customer, { filedAt: '2020-03-04' }).profile, null);
assert.equal(p.verifiedCompanyProfile(yes.profile, { ...identity, cik: '456' }, now), null);
assert.equal(p.verifiedCompanyProfile({ ...yes.profile, customers: customer.replace('collect from', 'pay to'), description: `${business} ${customer.replace('collect from', 'pay to')}` }, identity, now), null);
console.log('Advertising fee-payer extraction: exact issuer, whole quote/dates, payment direction, no third-party/forecast/user-only inference, provenance and freshness gates passed.');
