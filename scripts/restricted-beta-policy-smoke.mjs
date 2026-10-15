import assert from 'node:assert/strict';
import { loadTsModule } from './helpers/load-typescript-module.mjs';
import { inSimpleAlertPilot } from './helpers/simple-alert-pilot-fixture.mjs';
const { restrictedBetaScopeBlocker } = loadTsModule('@/lib/restricted-beta-policy');
const receipt = { id: 'official', url: 'https://www.sec.gov/Archives/issuer.htm', official: true };
const identity = { ticker: 'AIOT', cik: '0001774170', company: 'Powerfleet, Inc.' };
const event = { ...identity, relationship: 'direct', eventFamily: 'financing_dilution', receipts: [receipt], eventMagnitude: { metrics: [{ promotionEvidenceVerified: true, kind: 'dilution_percent', value: 10, sourceReceiptId: receipt.id, sourceUrl: receipt.url }] } };
await inSimpleAlertPilot(async () => {
  assert.equal(restrictedBetaScopeBlocker(event), null);
  for (const changed of [{ ticker: 'TEST' }, { cik: '0000000001' }, { company: 'Wrong issuer' }, { cik: undefined }]) assert.match(restrictedBetaScopeBlocker({ ...event, ...changed }), /exact issuer/);
  for (const malformed of [null, {}, { ...event, eventMagnitude: { metrics: {} } }, { ...event, receipts: null }]) assert.notEqual(restrictedBetaScopeBlocker(malformed), null);
  for (const relationship of ['second_order', 'third_order']) assert.match(restrictedBetaScopeBlocker({ ...event, relationship }), /indirect/);
  for (const eventFamily of ['macro_rates', 'supply_chain', 'ai_breakthrough', 'unknown']) assert.match(restrictedBetaScopeBlocker({ ...event, eventFamily }), /event family/);
  for (const metrics of [[], [{ ...event.eventMagnitude.metrics[0], sourceUrl: 'https://wrong.example' }], [{ ...event.eventMagnitude.metrics[0], promotionEvidenceVerified: false }], [{ ...event.eventMagnitude.metrics[0], value: NaN }], [{ ...event.eventMagnitude.metrics[0], kind: 'guidance_change_percent' }], [{ ...event.eventMagnitude.metrics[0], value: '10' }]]) assert.match(restrictedBetaScopeBlocker({ ...event, eventMagnitude: { metrics } }), /quantity/);
  assert.equal(restrictedBetaScopeBlocker({ ...identity, relationship: 'direct', eventFamily: 'valuation_gap' }), null);
});
assert.equal(restrictedBetaScopeBlocker({ relationship: 'second_order' }), null, 'Nonpilot policy unchanged');
console.log('PASS restricted beta scope: direct quantified source-bound events, explicit parked reasons, valuation separate, nonpilot unchanged');
