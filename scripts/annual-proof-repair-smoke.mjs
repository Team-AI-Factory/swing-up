import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { gunzipSync } from 'node:zlib';
import { loadTsModule } from './helpers/load-typescript-module.mjs';
import { filingFixtureManifest, filingFixture } from './helpers/filing-facts-fixture.mjs';
import { companyProfileFixture } from './helpers/company-profile-fixture.mjs';
import { terminalHarness } from './terminal-review-runner-smoke.mjs';
import { inSimpleAlertPilot } from './helpers/simple-alert-pilot-fixture.mjs';

// Only source bytes are authentic. Prices, fundamentals, profile, provider
// replies and storage are local test doubles; no live or paid calls are allowed.
let networkAttempts = 0;
const blocked = () => { networkAttempts++; throw Error('real_network_forbidden'); };
globalThis.fetch = http.request = http.get = https.request = https.get = net.Socket.prototype.connect = blocked;
const manifest = JSON.parse(fs.readFileSync(new URL('./fixtures/annual-proof/manifest.json', import.meta.url), 'utf8'));
const rawFixture = record => {
  const raw = gunzipSync(fs.readFileSync(new URL(`./fixtures/annual-proof/${record.fixture}`, import.meta.url)));
  assert.equal(raw.byteLength, record.rawBytes);
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), record.sha256);
  return raw.toString('utf8');
};
const annualBody = rawFixture(manifest), indexBody = rawFixture(manifest.index), source = manifest.source;
const quarterlyFixture = filingFixtureManifest.sources.find(f => f.source.cik === source.cik && f.source.form === '10-Q');
const quarterlyBody = filingFixture(quarterlyFixture), quarterSource = quarterlyFixture.source;
const promptTools = loadTsModule('@/lib/ai-committee/prompt-input');
const hour = 3_600_000, observations = [];
const decodePrompt = prompt => {
  const expand = x => {
    if (Array.isArray(x)) return x.map(expand);
    if (!x || typeof x !== 'object') return x;
    if (x.verbatimValueRef) return prompt.sharedEvidenceValues[x.verbatimValueRef];
    if (x.verbatimTextRef) return prompt.sharedEvidenceTexts[x.verbatimTextRef];
    if (x.verbatimTextParts) return x.verbatimTextParts.map(expand).join('');
    const record = (keys, values) => Object.fromEntries(prompt.sharedEvidenceKeys[keys].map((k, i) => [k, expand(values[i])]));
    if (x.verbatimRecord) return record(x.verbatimRecord[0], x.verbatimRecord.slice(1));
    if (x.verbatimRecordList) return x.verbatimRecordList.items.map(row => Array.isArray(row) ? record(x.verbatimRecordList.fields, row) : expand(row));
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, expand(v)]));
  };
  return expand(prompt.evidencePack);
};
function harness() {
  const promptBytes = [], prompts = [], requests = [], timeouts = [];
  const h = terminalHarness({ observeProviderInput: input => {
    assert.equal(input.maximumPromptBytes, 60_000);
    assert.equal(promptTools.committeePromptPreflight({ ...input, model: 'gpt-6-luna' }), undefined);
    const schema = input.responseSchema ? { type: 'json_schema', json_schema: { ...input.responseSchema, strict: true } } : undefined;
    promptBytes.push(promptTools.committeePromptInputBytes(input.messages, schema));
    prompts.push(decodePrompt(JSON.parse(input.messages[1].content)));
  } });
  Object.assign(h.identity, { ticker: 'INOD', company: 'Innodata Inc.', cik: source.cik });
  h.state.now = new Date('2026-10-15T05:00:00Z'); h.state.model = 'gpt-6-luna'; h.newEvent();
  const overrides = { '@/lib/r2-warehouse': h.storage, '@/lib/opportunity-engine/pr262-storage': { pr262StorageKey: h.key } };
  const financial = loadTsModule('@/lib/equity-signal/financial-evidence', overrides);
  const budgetModule = loadTsModule('@/lib/opportunity-engine/pr262-sensor-fetch-budget', overrides);
  const key = h.key(`research-evidence/financial-documents/${source.cik}.json`);
  let mode = 'complete';
  const rawFetch = async (input, options) => {
    const url = String(input); requests.push(url);
    assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store'); assert.ok(options.signal);
    if (url === manifest.index.url) {
      if (mode === 'cross_issuer_index') return Response.json({ ...JSON.parse(indexBody), cik: 1647639 });
      if (mode === 'index_exact_cap') return new Response(indexBody.padEnd(4_000_000, ' '));
      return new Response(indexBody, { headers: { 'content-type': 'application/json' } });
    }
    if (url === quarterSource.url) return new Response(quarterlyBody);
    assert.equal(url, source.url, 'Only the selected annual and quarterly slots are allowed');
    if (mode === '206') return new Response(annualBody, { status: 206 });
    if (mode === '404') return new Response('not found', { status: 404 });
    if (mode === 'cross_issuer_response') {
      const response = new Response(annualBody);
      Object.defineProperty(response, 'url', { value: source.url.replace('/903651/', '/1647639/') });
      return response;
    }
    if (mode === 'exact_cap') return new Response(annualBody.padEnd(5_000_000, ' '));
    if (mode === 'oversized') return new Response(annualBody.padEnd(5_000_001, ' '));
    if (mode === 'interrupted') {
      let sent = false;
      return new Response(new ReadableStream({ pull(c) {
        if (sent) c.error(Error('fixture_interrupted'));
        else { sent = true; c.enqueue(new TextEncoder().encode(annualBody.slice(0, 10000))); }
      } }));
    }
    if (mode === 'timeout') return new Promise((_, reject) => {
      const keepAlive = setTimeout(() => {}, 16_000);
      options.signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(options.signal.reason); }, { once: true });
    });
    if (mode === 'malformed') return new Response(annualBody.replace(/<\/html>\s*$/i, ''));
    if (mode === 'unusable') return new Response('<html><body>No financial sections.</body></html>');
    if (mode === 'changed') return new Response(annualBody.replace(/<\/html>\s*$/i, '<p>Liquidity and capital resources. Test-only changed financial evidence for transition testing.</p></html>'));
    return new Response(annualBody);
  };
  const collect = async () => {
    const priorDateNow = Date.now, priorTimeout = AbortSignal.timeout;
    Date.now = () => h.state.now.getTime();
    AbortSignal.timeout = ms => { timeouts.push(ms); return priorTimeout(ms); };
    try {
      const budget = await budgetModule.createPr262SensorBudgetedFetch({ now: h.state.now, fetchImpl: rawFetch });
      const result = await financial.collectFinancialDocuments(source.cik, budget.fetchImpl, h.state.now);
      return { result, summary: budget.summary() };
    } finally { Date.now = priorDateNow; AbortSignal.timeout = priorTimeout; }
  };
  const seed = (value, due = false) => {
    const old = structuredClone(value); old.checkedAt = h.state.now.toISOString();
    old.nextCheckAt = new Date(h.state.now.getTime() + (due ? 0 : 6 * hour)).toISOString();
    h.objects.set(key, { value: old, etag: '"seed"' }); return old;
  };
  const run = extra => h.runRunner({ resolveCompanyProfile: async () => companyProfileFixture(h.identity, new Date('2026-10-15T05:00:00Z')),
    collectFinancialDocuments: async () => (await collect()).result, ...extra });
  return { h, financial, budgetModule, rawFetch, key, collect, seed, run, requests, promptBytes, prompts, timeouts,
    annual: value => value.documents.find(d => d.url === source.url), quarter: value => value.documents.find(d => d.url === quarterSource.url),
    mode: value => { mode = value; }, advance: (ms = 6 * hour) => { h.state.now = new Date(h.state.now.getTime() + ms); },
    journal: () => h.objects.get(h.key(`terminal-reviews-v1/companies/${source.cik}.json`))?.value };
}
const stripAnnual = (f, value) => { const result = structuredClone(value); delete f.annual(result).transportProof; return result; };
const identity = report => ({ fingerprint: report.candidateFingerprint, snapshot: { fingerprint: report.selectedCandidate.reviewEvidenceSnapshot.fingerprint, financialDocuments: report.selectedCandidate.reviewEvidenceSnapshot.evidence.financialDocuments },
  terminal: report.selectedCandidate.terminalEvidence, baseline: report.selectedCandidate.valuationBaseline });

await inSimpleAlertPilot(async () => {
  process.env.SWING_UP_PR262_EXTERNAL_NOTIFICATIONS_ENABLED = 'false';
  const f = harness(), fresh = (await f.collect()).result;
  assert.equal(f.requests.length, 3); assert.equal(fresh.documents.length, 2);
  assert.deepEqual(f.annual(fresh).transportProof.response, { cik: source.cik, rawBytes: manifest.rawBytes, sha256: manifest.sha256 });
  assert.equal(f.financial.financialDocumentsReady(fresh), true);
  const legacy = stripAnnual(f, fresh), old = f.seed(legacy), before = f.requests.length;
  assert.equal(f.financial.financialDocumentsEvidenceView(legacy).documents[0].transportCompleteness, 'unknown');
  assert.match(f.financial.financialDocumentsPublicationGap(legacy), /unknown/);
  const writes = f.h.writes.length;
  assert.equal((await f.collect()).result.cached, true);
  assert.equal(f.requests.length, before); assert.equal(f.h.writes.length, writes);
  f.advance();
  const repaired = (await f.collect()).result;
  assert.equal(f.requests.length - before, 2, 'Due annual-only repair is index plus annual');
  assert.equal(f.annual(repaired).digest, f.annual(old).digest); assert.deepEqual(f.annual(repaired).excerpts, f.annual(old).excerpts);
  assert.equal(f.annual(repaired).collectedAt, f.h.state.now.toISOString());
  assert.equal(f.financial.financialDocumentsReady(repaired), true);
  let count = f.requests.length; f.advance(); await f.collect();
  assert.equal(f.requests.length - count, 1, 'Repeated successful due collection uses only index');
  const both = stripAnnual(f, fresh); delete f.quarter(both).factExtraction; delete f.quarter(both).transportProof;
  f.advance(); f.seed(both, true); count = f.requests.length;
  const repairedBoth = (await f.collect()).result;
  assert.equal(f.requests.length - count, 3); assert.deepEqual(f.quarter(repairedBoth).factExtraction, f.quarter(fresh).factExtraction);
  const denial = await f.budgetModule.createPr262SensorBudgetedFetch({ now: f.h.state.now, fetchImpl: f.rawFetch });
  count = f.requests.length; await assert.rejects(() => denial.fetchImpl(source.url), /pr262_sensor_budget_guard/);
  assert.equal(f.requests.length, count);
  assert.ok(f.timeouts.every(ms => ms === 15000));
  observations.push({ test: 'Actual wrapper and collector', cold: 3, preDue: 0, annualOnlyDue: 2, bothDue: 3, repeatedDue: 1, denialTransport: 0, requestTimeoutMs: 15000 });

  for (const mutation of [
    d => { d.accession = '0001104659-26-000001'; }, d => { d.reportingPeriod = '2024-12-31'; },
    d => { d.url = d.url.replace('/903651/', '/1647639/'); }, d => { d.collectedAt = '2020-01-01T00:00:00Z'; },
    d => { d.excerpts[0].text += ' changed'; }, d => { d.transportProof.response.sha256 = '0'.repeat(64); },
    d => { d.transportProof.response.rawBytes++; }, d => { d.transportProof.response.cik = '0001647639'; },
  ]) {
    const tampered = structuredClone(repaired); mutation(f.annual(tampered));
    assert.equal(f.financial.financialDocumentsReady(tampered), false);
    assert.equal(f.financial.financialDocumentsEvidenceView(tampered).documents[0].transportCompleteness, 'unknown');
  }
  const grafted = { ...repaired, cik: '0001647639' };
  assert.equal(f.financial.financialDocumentsReady(grafted), false);
  assert.equal(f.financial.financialDocumentsEvidenceView(grafted).documents[0].transportCompleteness, 'unknown');
  for (const kind of ['invalid_proof', 'partial', 'stale_bound_identity']) {
    const invalid = structuredClone(repaired);
    if (kind === 'invalid_proof') f.annual(invalid).transportProof.documentKey = 'invalid';
    if (kind === 'partial') { delete f.annual(invalid).transportProof; f.annual(invalid).readComplete = false; }
    if (kind === 'stale_bound_identity') f.annual(invalid).reportingPeriod = '2024-12-31';
    f.advance(); f.seed(invalid, true); count = f.requests.length;
    const fixed = (await f.collect()).result;
    assert.equal(f.requests.length - count, 2); assert.equal(f.financial.financialDocumentsReady(fixed), true);
    assert.equal(f.annual(fixed).reportingPeriod, source.reportingPeriod);
  }
  // A valid historical v1 receipt is not swept merely to add raw-byte metadata.
  const previousVersion = structuredClone(repaired), v1 = f.annual(previousVersion);
  delete v1.transportProof.response;
  v1.transportProof.documentKey = crypto.createHash('sha256').update(JSON.stringify([v1.url, v1.accession, v1.form,
    v1.filedAt, v1.reportingPeriod, v1.digest, v1.collectedAt])).digest('hex');
  assert.equal(f.financial.financialDocumentsReady(previousVersion), true);
  f.advance(); f.seed(previousVersion, true); count = f.requests.length;
  assert.deepEqual(f.annual((await f.collect()).result), v1); assert.equal(f.requests.length - count, 1);
  const rebind = document => {
    document.transportProof.documentKey = crypto.createHash('sha256').update(JSON.stringify([
      document.url, document.accession, document.form, document.filedAt, document.reportingPeriod, document.digest, document.collectedAt,
      ...(document.factExtraction === undefined ? [] : [crypto.createHash('sha256').update(JSON.stringify(document.factExtraction)).digest('hex')]),
      ...(document.transportProof.response === undefined ? [] : [document.transportProof.response]),
    ])).digest('hex');
    return document;
  };
  const malformedUrls = [
    source.url.replace('https:', 'http:'), source.url.replace('www.sec.gov', 'www.sec.gov.evil.example'),
    source.url.replace('www.sec.gov', 'evil.example@www.sec.gov'), source.url.replace('www.sec.gov', 'www.sec.gov:444'),
    `${source.url}?issuer=903651`, `${source.url}#other-source`, source.url.replace('/903651/', '/0000000000/'),
    source.url.replace('/903651/', '/0000903651/'), source.url.replace('/903651/', '/0001647639/'),
    source.url.replace('/903651/', '/00000903651/'), source.url.replace('/903651/', '/90365x/'),
    source.url.replace('/903651/', '/%39%30%33%36%35%31/'), source.url.replace('/data/903651/', '/data/other/../903651/'),
    source.url.replace('/000110465926020655/', '/000110465926020656/'),
    source.url.replace('inod-20251231x10k.htm', 'inod-20251231x10k.htm/extra'), 'not a URL',
  ];
  for (const receipt of [v1, f.annual(repaired)]) {
    const container = document => ({ ...repaired, documents: [document] });
    for (const cik of ['0000903651', '903651']) {
      assert.equal(f.financial.financialDocumentsReady({ ...container(receipt), cik }), true);
      assert.equal(f.financial.financialDocumentsPublicationGap({ ...container(receipt), cik }), null);
    }
    for (const cik of [undefined, null, '0001647639', '1647639', '0000000000', '', '903651x', '00000903651']) {
      const moved = { ...container(receipt), cik };
      assert.equal(f.financial.financialDocumentsReady(moved), false, `Every receipt checks collection issuer ${cik}`);
      assert.match(f.financial.financialDocumentsPublicationGap(moved), /unknown/);
      assert.equal(f.financial.financialDocumentsEvidenceView(moved).documents[0].transportCompleteness, 'unknown');
    }
    for (const url of [source.url.replace('www.sec.gov', 'sec.gov')]) {
      const sameIssuer = rebind({ ...structuredClone(receipt), url });
      assert.equal(f.financial.financialDocumentsReady(container(sameIssuer)), true, 'Equivalent official issuer URL remains valid');
    }
    for (const url of malformedUrls) {
      const invalid = rebind({ ...structuredClone(receipt), url });
      assert.equal(f.financial.financialDocumentsReady(container(invalid)), false, url);
      assert.equal(f.financial.financialDocumentCompleteness(invalid, source.cik), 'unknown', url);
    }
  }
  observations.push({ test: 'Proof identity binding', mutatedFieldsHeld: 8, crossIssuerContainerHeld: true, invalidPartialStaleDueRepair: 3, validLegacyProofDueReads: 1, legacyAndNewWrongIssuerHeld: true, malformedUrlCasesPerFormat: malformedUrls.length, paddedCollectionCikAccepted: true, noncanonicalIssuerPathsHeld: true });

  for (const mode of ['206', '404', 'exact_cap', 'oversized', 'interrupted', 'timeout', 'malformed', 'unusable', 'cross_issuer_response', 'cross_issuer_index', 'index_exact_cap']) {
    f.advance(); const previous = f.seed(legacy, true); f.mode(mode); count = f.requests.length;
    const failed = (await f.collect()).result;
    assert.deepEqual(f.annual(failed), f.annual(previous), `${mode}: previous annual row preserved exactly`);
    assert.deepEqual(f.quarter(failed), f.quarter(previous));
    assert.equal(f.financial.financialDocumentsReady(failed), false); assert.ok(failed.failures.length, mode);
    assert.equal(Date.parse(failed.nextCheckAt) - f.h.state.now.getTime(), hour);
    assert.equal(f.requests.length - count, mode.includes('index') ? 1 : 2);
    count = f.requests.length; const stored = JSON.stringify(f.h.objects.get(f.key).value);
    assert.equal((await f.collect()).result.cached, true); assert.equal(f.requests.length, count);
    assert.equal(JSON.stringify(f.h.objects.get(f.key).value), stored);
  }
  // Once the index reselects the exact annual source, even an expired cache's
  // prior row survives a failed normal read. No stale row is a skip shortcut.
  f.advance(); const expired = f.seed(legacy, true);
  expired.checkedAt = new Date(f.h.state.now.getTime() - 25 * hour).toISOString();
  expired.nextCheckAt = new Date(f.h.state.now.getTime() - 19 * hour).toISOString();
  f.h.objects.set(f.key, { value: expired, etag: '"expired"' }); f.mode('206'); count = f.requests.length;
  const expiredFailed = (await f.collect()).result;
  assert.deepEqual(f.annual(expiredFailed), f.annual(expired)); assert.equal(f.requests.length - count, 3);
  assert.equal(f.financial.financialDocumentsReady(expiredFailed), false);
  f.advance(hour); f.mode('complete'); count = f.requests.length;
  assert.equal(f.financial.financialDocumentsReady((await f.collect()).result), true);
  assert.equal(f.requests.length - count, 2);
  const quota = harness(); quota.seed(stripAnnual(quota, fresh), true);
  quota.h.objects.set(quota.h.key('sensor/provider-budgets-v1.json'), { etag: '"quota"', value: {
    version: 2, updatedAt: quota.h.state.now.toISOString(), lastCadenceAt: {}, hourlyCounts: {
      shared_sec_annual_filings: { [quota.h.state.now.toISOString().slice(0, 13)]: 3500 },
    },
  } });
  const quotaDenied = (await quota.collect()).result;
  assert.deepEqual(quota.annual(quotaDenied), quota.annual(legacy));
  assert.deepEqual(quota.requests, [manifest.index.url], 'Shared annual quota blocks before transport');
  assert.equal(quota.financial.financialDocumentsReady(quotaDenied), false); assert.ok(quotaDenied.failures.length);
  observations.push({ test: 'Failure preservation', cases: 11, annualAndQuarterRowsPreserved: true, immediateRetryRequests: 0, backoffHours: 1, quotaDeniedAnnualTransport: 0 });

  // Fresh positive model results cannot publish unknown annual coverage.
  const held = harness(); held.seed(stripAnnual(held, fresh));
  const heldReport = await held.run();
  assert.equal(heldReport.openAiCalled, true); assert.equal(heldReport.seriousSignalFound, false);
  assert.equal(heldReport.committee.finalJudge.verdict, 'positive');
  const heldDecision = structuredClone(held.journal().decisions), heldCalls = held.h.state.roleCalls, heldMoney = held.h.state.moneyCalls;
  held.advance(); await held.collect();
  const heldReplay = await held.run();
  assert.equal(heldReplay.openAiCalled, false); assert.equal(heldReplay.seriousSignalFound, false, 'Proof must not turn a historical needs-more-data review into approval');
  assert.deepEqual(held.journal().decisions, heldDecision); assert.equal(held.h.state.roleCalls, heldCalls); assert.equal(held.h.state.moneyCalls, heldMoney);

  // Existing genuine approval is retained through a metadata-only hold/repair.
  const approved = harness(); approved.seed(fresh);
  const first = await approved.run();
  assert.equal(first.seriousSignalFound, true, JSON.stringify({ status: first.status, blockers: first.blockers }));
  const baseline = identity(first), decision = structuredClone(approved.journal().decisions), calls = approved.h.state.roleCalls, money = approved.h.state.moneyCalls;
  approved.seed(stripAnnual(approved, fresh));
  const missing = await approved.run();
  assert.equal(missing.openAiCalled, false); assert.equal(missing.seriousSignalFound, false); assert.deepEqual(identity(missing), baseline);
  approved.advance(); const newlyProven = (await approved.collect()).result;
  const replay = await approved.run();
  assert.equal(replay.openAiCalled, false); assert.equal(replay.seriousSignalFound, true); assert.deepEqual(identity(replay), baseline);
  assert.deepEqual(approved.journal().decisions, decision); assert.equal(approved.h.state.roleCalls, calls); assert.equal(approved.h.state.moneyCalls, money);
  // All semantic/current gates remain required after transport repair.
  approved.h.state.haltKnown = false;
  assert.equal((await approved.run()).seriousSignalFound, false);
  approved.h.state.haltKnown = true;
  assert.equal((await approved.run({ verifiedFactsCache: { requiredMetrics: ['long_term_debt_noncurrent'], read: async () => null, write: async () => {} } })).seriousSignalFound, false);
  assert.equal(approved.h.state.roleCalls, calls); assert.equal(approved.h.state.moneyCalls, money);

  // Real delivery consumer, using the real approved runner output in the same
  // local outbox envelope produced by event-job. No external notification sends.
  const delivery = loadTsModule('@/lib/notifications/serious-signal-delivery', {
    '@/lib/r2-warehouse': approved.h.storage, '@/lib/opportunity-engine/pr262-storage': { pr262StorageKey: approved.h.key },
    '@/lib/opportunity-engine/pr262-terminal-reviews': approved.h.modules.journal,
    '@/lib/opportunity-engine/company-profile-cache': { readCompanyProfiles: async () => new Map() },
  });
  const outboxKey = approved.h.key('serious-signal/outbox/event-job/buy/INOD/annual-proof.json');
  const outbox = { version: 1, kind: 'pr262_committee_verified_event_signal', createdAt: approved.h.state.now.toISOString(),
    eventId: 'annual-proof-fixture', resultKey: 'local-result', ticker: 'INOD', cik: source.cik, alertType: 'buy',
    candidateFingerprint: replay.candidateFingerprint, candidate: replay.selectedCandidate, committee: replay.committee,
    authority: { exactIssuerMapping: true, currentEvidenceGatesPassed: true, freshQuoteAndHaltStateKnown: true,
      fullCommitteeAgentsCompleted: replay.committee.agentsCompleted, finalJudgePositiveMinimumConfidence: 80, historicalCasesRequired: false } };
  const setOutbox = documents => approved.h.objects.set(outboxKey, { value: { ...structuredClone(outbox), candidate: { ...structuredClone(outbox.candidate), financialDocuments: documents } }, etag: '"outbox"' });
  for (const documents of [stripAnnual(approved, newlyProven), { ...newlyProven, cik: '0001647639' }, { ...previousVersion, cik: '0001647639' }]) {
    setOutbox(documents); const writes = approved.h.writes.length;
    await assert.rejects(() => delivery.deliverSeriousSignalOutbox(outboxKey, { now: approved.h.state.now }), /financial_completeness_unproved/);
    assert.equal(approved.h.writes.length, writes);
  }
  setOutbox(newlyProven);
  const delivered = await delivery.deliverSeriousSignalOutbox(outboxKey, { now: approved.h.state.now });
  assert.equal(delivered.deliveryStatus, 'delivered');
  const receipts = [...approved.h.objects].filter(([key]) => key.includes('/receipts/web_feed/'));
  assert.equal(receipts.length, 1);
  assert.equal((await delivery.deliverSeriousSignalOutbox(outboxKey, { now: approved.h.state.now })).deliveryStatus, 'delivered');
  assert.deepEqual([...approved.h.objects].filter(([key]) => key.includes('/receipts/web_feed/')), receipts);
  assert.equal(approved.h.state.roleCalls, calls); assert.equal(approved.h.state.moneyCalls, money); assert.deepEqual(approved.journal().decisions, decision);

  // A truly changed excerpt is substantive evidence and follows the existing
  // controlled review policy once; restoring the old proof never reopens it.
  approved.advance(); approved.seed(stripAnnual(approved, newlyProven), true); approved.mode('changed');
  const changed = (await approved.collect()).result;
  assert.notEqual(approved.annual(changed).digest, approved.annual(newlyProven).digest);
  assert.equal((await approved.run()).openAiCalled, true);
  const changedCalls = approved.h.state.roleCalls, changedMoney = approved.h.state.moneyCalls;
  assert.equal(changedMoney - money, 1);
  assert.equal((await approved.run()).openAiCalled, false); assert.equal(approved.h.state.roleCalls, changedCalls);
  approved.seed(newlyProven);
  assert.equal((await approved.run()).openAiCalled, false); assert.equal(approved.h.state.moneyCalls, changedMoney);
  assert.equal(approved.journal().decisions.length, 2);

  for (const pack of approved.prompts) {
    const rows = pack.financialDiligence.documents.documents;
    assert.deepEqual(rows.find(d => d.url === quarterSource.url).factExtraction, approved.quarter(fresh).factExtraction);
    assert.match(pack.financialDiligence.documents.transportCompletenessScope, /selected windows, not all financial notes/);
  }
  const maximumPromptBytes = Math.max(...approved.promptBytes, ...held.promptBytes);
  assert.ok(maximumPromptBytes < 60_000);
  observations.push({ test: 'Actual runner, terminal journal, prompts and delivery', historicalNeedsDataPreserved: true,
    approvedMetadataRepairReused: true, paidReopen: 0, changedReviewKeys: false, semanticGatesRetained: true,
    promptCount: approved.prompts.length + held.prompts.length, maximumPromptBytes, typedFactsUnchanged: true, deliveryReceipts: 1, substantiveChangeReviews: 1, expiredPriorAnnualPreserved: true });
});
assert.equal(networkAttempts, 0);
console.log(JSON.stringify({ result: 'PASS', fixture: { source, rawBytes: manifest.rawBytes, sha256: manifest.sha256 }, observations, networkAttempts }, null, 2));
