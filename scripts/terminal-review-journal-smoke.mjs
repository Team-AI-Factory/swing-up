import assert from "node:assert/strict";
import crypto from "node:crypto";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";

const pilot = {
  SWING_UP_SIMPLE_PILOT_ENABLED: "true", RAILWAY_GIT_BRANCH: "pilot-simple-alerts",
  RAILWAY_PROJECT_ID: "83d99341-d622-475f-8035-00ef3d0916d1",
  RAILWAY_ENVIRONMENT_ID: "87afb8d7-c4fc-4f84-92b6-5d2820a689b6",
  SWING_UP_PR262_STORAGE_PREFIX: "branch-labs/simple-alerts/", SWING_UP_R2_WRITE_PREFIX: "branch-labs/simple-alerts/",
};
const originalEnvironment = Object.fromEntries(Object.keys(pilot).map(key => [key, process.env[key]]));
Object.assign(process.env, pilot);
try {
  const identity = { cik: "0000903651", ticker: "INOD" };
  const now = new Date("2026-10-07T00:00:00Z");
  const later = new Date("2036-10-07T00:00:00Z");
  const root = "test/terminal-reviews-v1/";
  const journalKey = `${root}companies/${identity.cik}.json`;
  const objects = new Map();
  const calls = [];
  let revision = 0;
  let fault = null;
  let researchWritesAllowed = false;
  const storage = {
    readVersionedTextFromR2: async (key, options = {}) => {
      calls.push({ operation: "read", key, signal: options.signal });
      options.signal?.throwIfAborted();
      const saved = objects.get(key);
      if (!saved) return { found: false, text: null, etag: null };
      return { found: true, text: saved.text, etag: saved.etag };
    },
    writeVersionedJsonToR2: async (key, value, options = {}) => {
      calls.push({ operation: "write", key, options });
      options.signal?.throwIfAborted();
      assert.ok(key.startsWith(root) || researchWritesAllowed && key.startsWith("test/research-evidence/"),
        "Only the terminal journal or explicitly tested research writer may write; never dollar/count ledgers");
      assert.ok(options.createOnly === true || typeof options.expectedEtag === "string", "Every write requires strict CAS");
      assert.ok(!(options.createOnly && options.expectedEtag), "A write cannot create and replace simultaneously");
      const existing = objects.get(key);
      if ((options.createOnly && existing) || (options.expectedEtag && existing?.etag !== options.expectedEtag)) {
        return { written: false, conflict: true };
      }
      const mode = fault?.key(key) ? fault.mode : null;
      if (mode === "refuse") return { written: false, conflict: false };
      if (mode === "conflict") return { written: false, conflict: true };
      objects.set(key, { text: JSON.stringify(value), etag: `etag-${++revision}` });
      if (mode === "uncertain") return { written: false, conflict: false };
      if (mode === "throw_after_commit") throw new Error("simulated_network_loss_after_commit");
      return { written: true, conflict: false };
    },
  };
  const reload = () => loadTsModule("@/lib/opportunity-engine/pr262-terminal-reviews", {
    "@/lib/r2-warehouse": storage,
    "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => `test/${key}` },
  });
  let journal = reload();
  const evidence = loadTsModule("@/lib/equity-signal/terminal-review-evidence");
  const revisions = loadTsModule("@/lib/equity-signal/review-evidence-revision");
  const { completeCommitteeReview } = loadTsModule("@/lib/ai-committee/review-policy");
  const roles = ["analyst_agent", "skeptic_agent", "final_judge"];
  const committee = outcome => ({ ok: true, status: "completed", agentsCompleted: 3, agentsFailed: 0,
    finishedAt: now.toISOString(), output: { overallRecommendation: outcome,
      modelUsageSummary: { reviewPlan: { policy: "focused_v1", agentIds: roles },
        roleDiagnostics: roles.map(agentId => ({ agentId, status: "completed" })) } } });
  assert.equal(completeCommitteeReview(committee("approve")), true, "Use the real focused completion contract");
  assert.equal(completeCommitteeReview({ ok: true, agentsCompleted: 14, agentsFailed: 0, output: {} }), true);
  const base = {
    source: [{ id: "valuation-day-1", summary: "Generated valuation scan at 80", rawEventType: "valuation_review" }],
    companyProfile: { sourceUrl: "https://www.sec.gov/Archives/edgar/data/903651/annual.htm", sourceFiledAt: "2026-08-01",
      business: "Business description", customers: "Customer description" },
    industry: "Software", outlookRange: { currency: "USD", conservative: 90, base: 120, optimistic: 150 },
    reviewPolicy: { policy: "focused_v1", model: "model-a" },
    financialDocuments: [{ url: "https://www.sec.gov/Archives/edgar/data/903651/annual.htm", filedAt: "2026-08-01", digest: "document-a", readComplete: true }],
    modelAssumptions: { growth: 0.1, multiple: 20 },
    facts: [{ metric: "revenue", value: 100, unit: "USD", periodStart: "2026-01-01", periodEnd: "2026-06-30",
      filedAt: "2026-08-01", form: "10-Q", concept: "Revenue", accession: "a-1" }],
    sourceComplete: true, priceReady: true, haltKnown: true, halted: false,
    valuation: { currentPriceSupportsValuation: true, base: 120 },
  };
  const analysis = { fundamentals: { revenue: 100, netIncome: 10, freeCashFlow: 12 } };
  const makeQuery = (changes = {}) => {
    const { packet = base, price = 80, ticker = identity.ticker, cik = identity.cik, direction = "upside",
      scope = "valuation", financialAnalysis = analysis, ...rest } = changes;
    return { cik, ticker, fingerprint: `valuation:${cik}:${direction}:${revisions.reviewEvidenceRevision(packet, false)}`,
      evidence: evidence.terminalReviewEvidence({ cik, ticker, scope, evidence: packet, analysis: financialAnalysis, price }), ...rest };
  };
  const reserve = (query, attemptId, options = {}) => journal.reserveTerminalReview({ ...query,
    direction: "upside", eventId: `daily-${attemptId}`, attemptId, now, ...options });
  const finish = (query, attemptId, outcome = "reject", options = {}) => journal.finishTerminalReviewAttempt({
    ...identity, ticker: query.ticker, eventId: `daily-${attemptId}`, attemptId, now,
    report: { openAiCalled: true, candidateFingerprint: query.fingerprint,
      selectedCandidate: { ...identity, direction: "upside", terminalEvidence: query.evidence }, committee: committee(outcome) }, ...options,
  });
  const parsed = key => JSON.parse(objects.get(key).text);
  const clear = () => { objects.clear(); calls.length = 0; fault = null; researchWritesAllowed = false; journal = reload(); };
  const query = makeQuery();
  assert.deepEqual(evidence.validatedTerminalEvidence(query.evidence, identity), query.evidence,
    "Constructor output must already be canonical, without leaking raw input fields");
  assert.deepEqual(Object.keys(query.evidence).sort(), ["version", "cik", "ticker", "scope", "sourceEvidenceKey", "comparison", "decisionKey"].sort());

  for (const [recommendation, outcome] of [["approve", "approved"], ["reject", "rejected"], ["needs_more_data", "needs_more_data"]]) {
    clear();
    assert.equal((await journal.checkTerminalReview(query)).kind, "eligible");
    assert.equal(await reserve(query, recommendation), true);
    const decision = await finish(query, recommendation, recommendation);
    assert.equal(decision.outcome, outcome);
    assert.equal(parsed(journalKey).decisions.length, 1);
    assert.equal(parsed(journalKey).pending.length, 0);
    journal = reload();
    const dailyAlias = makeQuery({ packet: { ...base, source: [{ ...base.source[0], id: "valuation-day-9000", summary: "A later generated scan" }] } });
    assert.equal((await journal.checkTerminalReview(dailyAlias)).decision.outcome, outcome);
    assert.equal(await reserve(dailyAlias, `another-${recommendation}`, { now: later }), false, "Completed verdicts have no day/TTL expiration");
    const signal = new AbortController().signal;
    calls.length = 0;
    const read = await journal.readTerminalDecision({ cik: identity.cik, decisionKey: decision.decisionKey, signal });
    assert.equal(read.outcome, outcome);
    assert.equal(Object.hasOwn(read, "committee"), false, "Public decision reads exclude internal Committee receipts");
    assert.ok(calls.length > 0 && calls.every(call => call.signal === signal), "readTerminalDecision must propagate its signal");
    const controller = new AbortController();
    controller.abort(new Error("terminal_read_cancelled"));
    await assert.rejects(journal.readTerminalDecision({ cik: identity.cik, decisionKey: decision.decisionKey, signal: controller.signal }), /terminal_read_cancelled/);
  }

  clear();
  const unknownDirection = makeQuery({ direction: "unknown" });
  assert.equal(await reserve(unknownDirection, "unknown-direction", { direction: "unknown" }), true);
  const unknownDecision = await finish(unknownDirection, "unknown-direction", "needs_more_data", {
    report: { openAiCalled: true, candidateFingerprint: unknownDirection.fingerprint,
      selectedCandidate: { ...identity, direction: "unknown", terminalEvidence: unknownDirection.evidence }, committee: committee("needs_more_data") },
  });
  assert.equal(unknownDecision.direction, "unknown");
  assert.equal(unknownDecision.outcome, "needs_more_data");
  journal = reload();
  assert.equal((await journal.checkTerminalReview(unknownDirection)).decision.outcome, "needs_more_data");
  assert.equal(await reserve(unknownDirection, "unknown-retry", { direction: "unknown", now: later }), false,
    "A completed needs-more-data decision stays held even when direction was unresolved");

  clear();
  assert.equal(await reserve(query, "a"), true);
  await finish(query, "a", "approve");
  const changedFacts = makeQuery({ packet: { ...base, facts: [{ ...base.facts[0], value: 110 }] } });
  assert.equal((await journal.checkTerminalReview(changedFacts)).kind, "eligible", "New financial facts reopen review");
  assert.equal(await reserve(changedFacts, "b"), true);
  await finish(changedFacts, "b", "reject");
  journal = reload();
  const returnedA = makeQuery({ packet: { ...base, reviewPolicy: { policy: "focused_v2", model: "model-z" } } });
  assert.equal((await journal.checkTerminalReview(returnedA)).decision.outcome, "approved", "A -> B -> A must find A in retained history");
  assert.equal(await reserve(returnedA, "a-again", { now: later }), false);
  assert.equal(parsed(journalKey).decisions.length, 2);

  const drift = makeQuery({ packet: { ...base, reviewPolicy: { policy: "focused_v2", model: "model-z" },
    modelAssumptions: { growth: 0.9, multiple: 200 }, outlookRange: { ...base.outlookRange, base: 300 },
    companyProfile: { ...base.companyProfile, business: "Reworded model summary" },
    facts: [{ ...base.facts[0], retrievedAt: later.toISOString(), sourceUrl: "https://different-cache.example/facts" }],
    priceReady: false, sourceComplete: false }, price: 80.01, direction: "downside" });
  assert.equal(evidence.sameTerminalReviewEvidence(query.evidence, drift.evidence), true, "Policy/model/retrieval/quote jitter cannot reopen review");
  assert.equal((await journal.checkTerminalReview(drift)).kind, "terminal");
  const alias = makeQuery({ ticker: "INOD.A", packet: { ...base, reviewPolicy: { version: "new" } } });
  assert.equal(evidence.sameTerminalReviewEvidence(query.evidence, alias.evidence), true, "Issuer aliases share economic evidence");
  assert.equal(evidence.validatedTerminalEvidence(query.evidence, { ...identity, ticker: "INOD.A" }), null, "Descriptor validation still rejects a mismatched ticker");
  assert.equal((await journal.checkTerminalReview(alias)).kind, "terminal");
  await assert.rejects(journal.checkTerminalReview({ ...query, ticker: "INOD.A" }), /terminal_review_evidence_invalid/);
  assert.equal(evidence.sameTerminalReviewEvidence(query.evidence, makeQuery({ cik: "0000903652" }).evidence), false);
  assert.equal(evidence.sameTerminalReviewEvidence(query.evidence, makeQuery({ price: 84 }).evidence), false, "A 5% observed price move is material");
  assert.equal(makeQuery({ price: 84 }).fingerprint, query.fingerprint, "The legacy revision does not encode raw quote price");
  assert.equal((await journal.checkTerminalReview(makeQuery({ price: 84 }))).kind, "eligible",
    "A material observed-price transition must reopen review even when the old revision string is unchanged");
  assert.equal(evidence.sameTerminalReviewEvidence(query.evidence, makeQuery({ price: 82.8 }).evidence), false, "A 5pp valuation-gap transition is material");
  assert.equal(evidence.sameTerminalReviewEvidence(makeQuery({ price: 99.9 }).evidence, makeQuery({ price: 100.1 }).evidence), false, "A frozen valuation-threshold crossing is material");
  assert.equal(evidence.sameTerminalReviewEvidence(query.evidence, makeQuery({ packet: { ...base, halted: true } }).evidence), false);
  assert.equal(evidence.sameTerminalReviewEvidence(query.evidence, makeQuery({ packet: { ...base, financialDocuments: [] }, price: null }).evidence), true,
    "Lost provenance and missing quotes cannot prove novelty");
  assert.equal(evidence.sameTerminalReviewEvidence(query.evidence, makeQuery({ financialAnalysis: { fundamentals: { ...analysis.fundamentals, revenue: 101 } } }).evidence), false);
  const eventA = makeQuery({ scope: "event", packet: { ...base, source: [{ rawEventType: "earnings", id: "day-one", summary: "Actual issuer statement" }] } });
  const eventAlias = makeQuery({ scope: "event", packet: { ...base, source: [{ rawEventType: "earnings", id: "day-two", summary: "Actual issuer statement" }] } });
  assert.equal(evidence.sameTerminalReviewEvidence(eventA.evidence, eventAlias.evidence), true);
  assert.equal(evidence.sameTerminalReviewEvidence(eventA.evidence,
    makeQuery({ scope: "event", packet: { ...base, source: [{ rawEventType: "earnings", summary: "Issuer changed its guidance" }] } }).evidence), false);

  const snapshot = { version: 1, fingerprint: query.fingerprint, ...identity, direction: "upside", evidence: base };
  const legacySnapshot = evidence.legacyTerminalReviewEvidence(snapshot, { ...identity, fingerprint: query.fingerprint, direction: "upside" });
  assert.ok(legacySnapshot);
  assert.deepEqual(evidence.validatedTerminalEvidence(legacySnapshot, identity), legacySnapshot);
  clear();
  const legacy = { fingerprint: query.fingerprint, outcome: "approved_pending_checks", reviewEvidenceSnapshot: snapshot };
  assert.deepEqual(await journal.checkTerminalReview({ ...drift, legacy }), { kind: "held", reason: "terminal_legacy_same_evidence", outcome: "approved" });
  journal = reload();
  assert.equal((await journal.checkTerminalReview(drift)).reason, "terminal_legacy_same_evidence");
  assert.equal((await journal.checkTerminalReview(changedFacts)).kind, "eligible", "Known legacy sources permit genuinely new facts");
  for (const reviewEvidenceSnapshot of [undefined, { ...snapshot, fingerprint: "forged" }, { ...snapshot, evidence: { ...base, facts: [] } }]) {
    clear();
    const held = await journal.checkTerminalReview({ ...changedFacts, legacy: { fingerprint: query.fingerprint, outcome: "rejected", reviewEvidenceSnapshot } });
    assert.equal(held.reason, "terminal_legacy_provenance_unknown", "Unknown/malformed legacy baselines hold conservatively");
    journal = reload();
    assert.equal(await reserve(changedFacts, "unknown-legacy", { now: later }), false);
  }
  clear();
  await assert.rejects(journal.checkTerminalReview({ ...query, legacy: { fingerprint: "valuation:0000903652:upside:a", outcome: "rejected" } }), /terminal_review_legacy_identity_invalid/);

  const accession = "0000903651-26-000001";
  const secUrl = (accessionNumber = accession, cik = identity.cik) =>
    `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNumber.replaceAll("-", "")}/current.htm`;
  const sourceAt = "2026-08-01T15:00:00Z";
  const legacyEvent = { ...identity, eventId: `sec:${accession}`, eventObservedAt: sourceAt,
    sources: [{ url: secUrl(), label: "SEC 8-K" }] };
  const primary = evidence.legacyPrimarySourceReviewEvidence(legacyEvent, identity);
  assert.ok(primary);
  assert.equal(primary.comparison.provenance, "legacy_primary_source");
  assert.deepEqual(primary.comparison.knownCategories, ["sourceDocuments"]);
  assert.deepEqual(primary.comparison.external.sourceDocuments.map(atom => JSON.parse(atom)), [[identity.cik, accession, new Date(sourceAt).toISOString()]]);
  assert.deepEqual(evidence.validatedTerminalEvidence(primary, identity), primary, "Sparse legacy descriptors are canonical too");
  assert.equal(primary.comparison.market.price, null, "Legacy source provenance must not invent an old price");
  assert.equal(primary.comparison.reference.base, null);
  const currentEvent = (sourceChanges = {}, packetChanges = {}) => {
    const packet = { ...base, source: [{ id: `sec:${accession}`, rawEventType: "earnings", summary: "Original official issuer statement",
      url: secUrl(), publishedAt: sourceAt, official: true, ...sourceChanges }], ...packetChanges };
    return makeQuery({ packet, scope: "event", fingerprint: `event:${identity.cik}:${revisions.reviewEvidenceRevision(packet, false)}` });
  };
  const unchangedEvent = currentEvent();
  const laterEvent = currentEvent({ id: "sec:0000903651-26-000002", url: secUrl("0000903651-26-000002"),
    publishedAt: "2026-08-02T15:00:00Z", summary: "A different later official issuer filing" });
  for (const invalidDate of ["2026-08-02", "2026-02-30T15:00:00Z", "2026-08-02T24:00:00Z", "2026-08-02T15:00:00+00:00"]) {
    assert.equal(evidence.legacyPrimarySourceReviewEvidence({ ...legacyEvent, eventObservedAt: invalidDate }, identity), null);
    assert.deepEqual(currentEvent({ url: secUrl("0000903651-26-000002"), publishedAt: invalidDate }).evidence.comparison.external.sourceDocuments, [],
      "Date-only, rolled or noncanonical timestamps cannot prove a later SEC source");
  }
  for (const invalidUrl of [secUrl().replace("www.sec.gov", "user:password@www.sec.gov"),
    secUrl().replace("www.sec.gov", "www.sec.gov:443"), secUrl().replace("www.sec.gov", "www.sec.gov:8443"),
    `${secUrl()}?source=changed`, `${secUrl()}#changed`]) {
    assert.equal(evidence.legacyPrimarySourceReviewEvidence({ ...legacyEvent, sources: [{ url: invalidUrl }] }, identity), null);
    assert.deepEqual(currentEvent({ url: invalidUrl }).evidence.comparison.external.sourceDocuments, [],
      "Credentials, explicit ports, queries and fragments cannot prove canonical SEC source identity");
  }
  assert.deepEqual(currentEvent({ publishedAt: "2026-08-01T15:00:00.1Z" }).evidence.comparison.external.sourceDocuments.map(atom => JSON.parse(atom)),
    [[identity.cik, accession, "2026-08-01T15:00:00.100Z"]], "Accepted source timestamps normalize to UTC milliseconds");
  const filerAccession = "0001104659-26-000002";
  const separateFiler = evidence.legacyPrimarySourceReviewEvidence({ ...legacyEvent, eventId: `sec:${filerAccession}`,
    sources: [{ url: secUrl(filerAccession) }] }, identity);
  assert.ok(separateFiler, "A filing-agent accession prefix need not equal the issuer CIK in the SEC path");
  assert.deepEqual(separateFiler.comparison.external.sourceDocuments.map(atom => JSON.parse(atom)),
    [[identity.cik, filerAccession, new Date(sourceAt).toISOString()]]);
  const legacyPrimary = { cik: identity.cik, fingerprint: "retained-event-fingerprint", outcome: "rejected", primarySourceProvenance: legacyEvent };
  clear();
  assert.equal((await journal.checkTerminalReview({ ...unchangedEvent, legacy: [legacyPrimary] })).reason, "terminal_legacy_same_evidence");
  assert.equal(parsed(journalKey).legacy[0].evidence.comparison.provenance, "legacy_primary_source");
  journal = reload();
  const heldEvents = [
    currentEvent({ id: "refetched-daily-id", summary: "Changed summary after another retrieval", publishedAt: later.toISOString(), retrievedAt: later.toISOString() }),
    currentEvent({ id: "sec:0000903651-26-000003", url: secUrl("0000903651-26-000003"), publishedAt: "2026-07-30T15:00:00Z", retrievedAt: later.toISOString() }),
    currentEvent({ url: secUrl("0000903651-26-000002"), publishedAt: sourceAt }),
    currentEvent({ url: secUrl("0000903651-26-000002", "0000903652"), publishedAt: later.toISOString() }),
    currentEvent({ url: "https://news.example/new-filing", publishedAt: later.toISOString() }),
    currentEvent({ url: secUrl("0000903651-26-000002"), publishedAt: later.toISOString(), official: false }),
    currentEvent({ url: secUrl("0000903651-26-000002"), publishedAt: later.toISOString(), official: undefined }),
    currentEvent({ url: secUrl("0000903651-26-000002"), publishedAt: later.toISOString(), summary: "" }),
    currentEvent({ url: secUrl("0000903651-26-000002"), publishedAt: "not-a-date" }),
    currentEvent({ url: secUrl("0000903651-26-000002"), publishedAt: later.toISOString() }, { sourceComplete: false }),
    currentEvent({ url: secUrl("0000903651-26-000002"), publishedAt: later.toISOString() }, { sourceComplete: undefined }),
  ];
  for (const heldEvent of heldEvents) {
    assert.equal(evidence.sameTerminalReviewEvidence(primary, heldEvent.evidence), true,
      "Same accession, older source, retrieval changes, wrong issuer, or incomplete/unofficial provenance cannot release a legacy hold");
    assert.equal((await journal.checkTerminalReview(heldEvent)).kind, "held");
  }
  assert.equal(evidence.sameTerminalReviewEvidence(primary, laterEvent.evidence), false);
  assert.equal((await journal.checkTerminalReview(laterEvent)).kind, "eligible", "Only a different later official issuer accession releases the sparse baseline");
  assert.equal(await reserve(laterEvent, "later-official-source"), true);

  for (const invalidLegacyEvent of [
    { ...legacyEvent, eventId: "daily-generated-id" },
    { ...legacyEvent, eventId: "sec:0000903651-26-000099" },
    { ...legacyEvent, eventObservedAt: undefined },
    { ...legacyEvent, eventObservedAt: "invalid" },
    { ...legacyEvent, cik: "0000903652" },
    { ...legacyEvent, sources: [{ url: secUrl(accession, "0000903652") }] },
    { ...legacyEvent, sources: [{ url: "https://unofficial.example/source" }] },
  ]) {
    assert.equal(evidence.legacyPrimarySourceReviewEvidence(invalidLegacyEvent, identity), null);
    clear();
    assert.equal((await journal.checkTerminalReview({ ...laterEvent,
      legacy: [{ ...legacyPrimary, primarySourceProvenance: invalidLegacyEvent }] })).reason, "terminal_legacy_provenance_unknown",
    "An unproven legacy source cannot release the conservative hold");
  }

  clear();
  const research = loadTsModule("@/lib/opportunity-engine/pr262-research-evidence", {
    "@/lib/r2-warehouse": storage,
    "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => `test/${key}` },
  });
  const indexKey = research.RESEARCH_ALERT_INDEX_KEY;
  assert.deepEqual(await research.readLegacyTerminalReviews(identity.cik), []);
  const retainedRow = { ...legacyEvent, quality: { committeeCompleted: true }, committee: { completed: 3, failed: 0 },
    committeeStatus: "rejected", reviewEvidenceFingerprint: "valid-rejected" };
  const retained = ["approved", "approved_pending_checks", "rejected", "needs_more_data"].map(committeeStatus =>
    ({ ...retainedRow, committeeStatus, reviewEvidenceFingerprint: `valid-${committeeStatus}` }));
  const uncertain = [
    { ...retainedRow, quality: { committeeCompleted: false }, reviewEvidenceFingerprint: "display-overwritten" },
    { ...retainedRow, quality: {}, reviewEvidenceFingerprint: "completion-unproven" },
    { ...retainedRow, quality: { committeeCompleted: false }, committeeStatus: "awaiting_review", reviewEvidenceFingerprint: "prior-review-awaiting" },
  ];
  const excluded = [
    { ...retainedRow, committee: { completed: 2, failed: 1 }, reviewEvidenceFingerprint: "partially-failed" },
    { ...retainedRow, committee: { completed: 3 }, reviewEvidenceFingerprint: "failed-count-unknown" },
    { ...retainedRow, committee: { completed: 3, failed: null }, reviewEvidenceFingerprint: "failed-count-null" },
    { ...retainedRow, quality: {}, committee: { failed: 0 }, reviewEvidenceFingerprint: "completed-count-unknown" },
    { ...retainedRow, quality: {}, committee: { completed: 0, failed: 0 }, committeeStatus: "awaiting_review", reviewEvidenceFingerprint: "unreviewed" },
    { ...retainedRow, cik: "0000903652", reviewEvidenceFingerprint: "different-issuer" },
    { ...retainedRow, reviewEvidenceFingerprint: "" },
  ];
  const retainedPayload = { version: 1, alerts: [...retained, ...uncertain, ...excluded] };
  objects.set(indexKey, { text: JSON.stringify(retainedPayload), etag: "retained-index" });
  const retainedSignal = new AbortController().signal;
  const beforeReadWrites = calls.filter(call => call.operation === "write").length;
  const migrated = await research.readLegacyTerminalReviews(identity.cik, retainedSignal);
  assert.deepEqual(migrated.map(row => row.fingerprint), [...retained, ...uncertain].map(row => row.reviewEvidenceFingerprint),
    "Exact-issuer proved completions and retained zero-failure prior-review counts migrate conservatively");
  assert.ok(migrated.slice(0, retained.length).every(row => row.completionProven === true));
  assert.ok(migrated.slice(retained.length).every(row => row.outcome === "unknown" && row.completionProven === false),
    "An overwritten display cannot fabricate a proved terminal outcome");
  assert.equal(calls.at(-1).signal, retainedSignal);
  assert.equal(calls.filter(call => call.operation === "write").length, beforeReadWrites);
  assert.deepEqual(parsed(indexKey), retainedPayload, "Legacy reads preserve the source index");
  assert.deepEqual(migrated[0].primarySourceProvenance, { cik: identity.cik, eventId: legacyEvent.eventId,
    eventObservedAt: legacyEvent.eventObservedAt, sources: legacyEvent.sources });
  assert.equal((await journal.checkTerminalReview({ ...unchangedEvent, legacy: migrated })).reason, "terminal_legacy_same_evidence");
  assert.equal(parsed(journalKey).legacy.length, retained.length + uncertain.length, "All retained legacy verdicts and uncertainty holds migrate via the array API");
  journal = reload();
  assert.equal((await journal.checkTerminalReview(laterEvent)).kind, "eligible");
  objects.set(indexKey, { text: JSON.stringify({ alerts: null }), etag: "malformed-index" });
  await assert.rejects(research.readLegacyTerminalReviews(identity.cik), /terminal_review_legacy_index_invalid/);
  objects.set(indexKey, { text: null, etag: "missing-index-text" });
  await assert.rejects(research.readLegacyTerminalReviews(identity.cik), /terminal_review_legacy_index_invalid/);
  objects.set(indexKey, { text: "{", etag: "corrupt-index-json" });
  await assert.rejects(research.readLegacyTerminalReviews(identity.cik));
  await assert.rejects(research.readLegacyTerminalReviews("bad-cik"), /terminal_review_legacy_identity_invalid/);

  for (const recommendation of ["needs_more_data", "approve"]) {
    clear();
    researchWritesAllowed = true;
    const completedFingerprint = `event-paid-${recommendation}`;
    const changedDisplayFingerprint = `event-refreshed-${recommendation}`;
    const company = "Innodata Inc.";
    const profile = companyProfileFixture({ ...identity, company }, now);
    const candidate = { ...identity, company, companyProfile: profile, direction: "upside", eventFamily: "regulatory_approval",
      eventHeadline: "Issuer announces its official regulatory decision", currency: "USD", industry: "Application software",
      valuationRange: { conservativeValue: 90, baseValue: 120, optimisticValue: 150 },
      evidenceFingerprint: completedFingerprint, fundamentals: { available: true, items: [] },
      quote: { price: 80, observedAt: now.toISOString(), actionableForSeriousSignal: true },
      receipts: [{ id: legacyEvent.eventId, publisher: "SEC", url: secUrl(), publishedAt: sourceAt,
        rawEventType: "regulatory_approval", summary: "The issuer announced its official regulatory decision.", official: true }] };
    const paidCommittee = committee(recommendation);
    const paidReport = { selectedCandidate: candidate, committee: paidCommittee, openAiCalled: true,
      candidateFingerprint: completedFingerprint, seriousSignalFound: recommendation === "approve",
      status: recommendation === "approve" ? "serious_buy" : "candidate_needs_more_data", tradingHaltSafety: { currentStateKnown: true } };
    const event = { id: legacyEvent.eventId, ...identity, observedAt: sourceAt };
    const recordInput = { event, report: paidReport, sourceDecisionGrade: true, sourceFailureReason: null, now,
      ...(recommendation === "approve" ? { approvedResultKey: "test/review-result.json" } : {}) };
    await research.recordResearchEvidence(recordInput);
    const paidRow = parsed(indexKey).alerts[0];
    assert.equal(paidRow.committeeStatus, recommendation === "approve" ? "approved" : "needs_more_data");
    assert.equal(paidRow.quality.committeeCompleted, true);
    assert.equal(paidRow.completedReview.fingerprint, completedFingerprint);
    assert.equal(completeCommitteeReview(paidRow.completedReview.committee), true, "The saved proof still satisfies the real complete-review contract");
    assert.equal(paidRow.completedReview.committee.output.overallRecommendation, recommendation);
    assert.deepEqual(paidRow.completedReview.committee.output.modelUsageSummary, paidCommittee.output.modelUsageSummary);

    const refreshAt = new Date(now.getTime() + 60_000);
    await research.recordResearchEvidence({ event, sourceDecisionGrade: true, sourceFailureReason: null, now: refreshAt,
      report: { ...paidReport, committee: null, openAiCalled: false, seriousSignalFound: false,
        candidateFingerprint: changedDisplayFingerprint, status: "qualified_signal_openai_not_requested",
        selectedCandidate: { ...candidate, evidenceFingerprint: changedDisplayFingerprint,
          quote: { ...candidate.quote, price: 81, observedAt: refreshAt.toISOString() } } } });
    const refreshed = parsed(indexKey).alerts[0];
    assert.equal(refreshed.committeeStatus, "awaiting_review", "An unpaid display refresh may reset its provisional label");
    assert.equal(refreshed.committeeApproved, false, "A changed display snapshot cannot inherit approval");
    assert.equal(refreshed.quality.committeeCompleted, false);
    assert.equal(refreshed.reviewEvidenceFingerprint, changedDisplayFingerprint);
    assert.deepEqual(refreshed.completedReview, paidRow.completedReview, "The actual writer preserves the completed fingerprint and full Committee through unpaid refreshes");
    assert.deepEqual(refreshed.committee, paidRow.committee);
    const preservedReviews = await research.readLegacyTerminalReviews(identity.cik);
    assert.equal(preservedReviews.length, 1);
    assert.equal(preservedReviews[0].fingerprint, completedFingerprint, "Migration uses completed evidence identity, not overwritten display identity");
    assert.equal(preservedReviews[0].outcome, recommendation === "approve" ? "approved" : "needs_more_data");
    assert.equal(preservedReviews[0].completionProven, true);
    assert.equal((await journal.checkTerminalReview({ ...unchangedEvent, legacy: preservedReviews })).reason, "terminal_legacy_same_evidence");

    const historic = structuredClone(refreshed);
    delete historic.completedReview;
    historic.quality = { ...historic.quality, committeeCompleted: false };
    clear();
    objects.set(indexKey, { text: JSON.stringify({ version: 1, alerts: [historic] }), etag: "pre-preservation-unpaid-refresh" });
    const uncertainReviews = await research.readLegacyTerminalReviews(identity.cik);
    assert.equal(uncertainReviews.length, 1, "Older unpaid refreshes must not erase evidence that a review may have completed");
    assert.equal(uncertainReviews[0].fingerprint, changedDisplayFingerprint);
    assert.equal(uncertainReviews[0].outcome, "unknown");
    assert.equal(uncertainReviews[0].completionProven, false);
    assert.deepEqual(await journal.checkTerminalReview({ ...unchangedEvent, legacy: uncertainReviews }),
      { kind: "held", reason: "terminal_legacy_completion_unknown", outcome: "unknown" });
    assert.equal(parsed(journalKey).decisions.length, 0, "An uncertainty hold is not a fabricated approval or rejection");
    journal = reload();
    assert.equal(await reserve(unchangedEvent, `historic-refresh-${recommendation}`, { now: later }), false);
  }

  const futureCohort = { ...loadTsModule("@/config/simple-alert-pilot.json"), cohortId: "future-cohort-20261008" };
  const switchedResearch = loadTsModule("@/lib/opportunity-engine/pr262-research-evidence", {
    "@/lib/r2-warehouse": storage,
    "@/config/simple-alert-pilot.json": futureCohort,
  });
  const futureRoot = "branch-labs/simple-alerts/cohorts/future-cohort-20261008/research-evidence";
  const historicalRoots = ["branch-labs/simple-alerts/research-evidence",
    "branch-labs/simple-alerts/cohorts/small-ai-25-20261003-v1/research-evidence"];
  assert.equal(switchedResearch.RESEARCH_ALERT_INDEX_KEY, `${futureRoot}/alerts-v1.json`,
    "Use the real storage resolver with a replacement cohort configuration");
  for (const oldRoot of historicalRoots) {
    for (const sourceKind of ["event-card", "valuation-marker"]) {
      clear();
      objects.set(`${futureRoot}/alerts-v1.json`, { text: JSON.stringify({ version: 1, alerts: [] }), etag: "new-cohort-empty" });
      const oldKey = sourceKind === "event-card" ? `${oldRoot}/alerts-v1.json` : `${oldRoot}/valuation-reviews/${identity.cik}.json`;
      const oldBody = sourceKind === "event-card" ? { version: 1, alerts: [retainedRow] }
        : { cik: identity.cik, fingerprint: query.fingerprint, outcome: "needs_more_data", reviewEvidenceSnapshot: snapshot };
      objects.set(oldKey, { text: JSON.stringify(oldBody), etag: "old-cohort-retained" });
      assert.equal(objects.has(`${futureRoot}/valuation-reviews/${identity.cik}.json`), false);
      const originalOld = structuredClone(objects.get(oldKey));
      const cohortSignal = new AbortController().signal;
      calls.length = 0;
      const historic = await switchedResearch.readLegacyTerminalReviews(identity.cik, cohortSignal);
      assert.equal(historic.length, 1, `The ${sourceKind} must be found in ${oldRoot} despite an empty current cohort`);
      assert.equal(historic[0].fingerprint, sourceKind === "event-card" ? retainedRow.reviewEvidenceFingerprint : query.fingerprint);
      assert.ok(calls.some(call => call.operation === "read" && call.key === oldKey));
      assert.ok(calls.every(call => call.operation === "read" && call.signal === cohortSignal), "Every cross-cohort read remains read-only and cancellable");
      const current = sourceKind === "event-card" ? unchangedEvent : query;
      assert.equal((await journal.checkTerminalReview({ ...current, legacy: historic })).reason, "terminal_legacy_same_evidence");
      journal = reload();
      assert.equal(await reserve(current, `cohort-retry-${sourceKind}`, { now: later }), false,
        "Moving the current cohort cannot reopen a pre-journal terminal review");
      assert.deepEqual(objects.get(oldKey), originalOld, "Migration never rewrites historical cohort evidence");
    }
  }
  for (const oversizedRoot of [futureRoot, ...historicalRoots]) {
    clear();
    objects.set(`${oversizedRoot}/alerts-v1.json`, { text: JSON.stringify({ alerts:
      [...Array.from({ length: 100 }, () => ({ ...retainedRow, cik: "0000903652" })), retainedRow] }), etag: "oversized-index" });
    await assert.rejects(switchedResearch.readLegacyTerminalReviews(identity.cik), /terminal_review_legacy_index_invalid/,
      "An oversized current or historical index must fail closed instead of truncating a terminal record");
    assert.equal(calls.filter(call => call.operation === "write").length, 0);
  }
  clear();
  objects.set(`${futureRoot}/alerts-v1.json`, { text: JSON.stringify({ alerts: Array.from({ length: 100 }, (_, index) =>
    ({ ...retainedRow, reviewEvidenceFingerprint: `bounded-history-${index}` })) }), etag: "maximum-supported-index" });
  assert.equal((await switchedResearch.readLegacyTerminalReviews(identity.cik)).length, 100, "Exactly 100 historical rows remain supported");

  clear();
  const concurrent = await Promise.all([reserve(query, "concurrent-one"), reserve(query, "concurrent-two")]);
  assert.equal(concurrent.filter(Boolean).length, 1, "Strict-CAS concurrent admission permits one attempt");
  assert.equal(parsed(journalKey).pending.length, 1);
  journal = reload();
  assert.equal((await journal.checkTerminalReview(query)).reason, "terminal_review_recovery_pending");
  assert.equal(await reserve(query, "pending-never-expires", { now: later }), false);

  for (const mode of ["refuse", "uncertain", "throw_after_commit", "conflict"]) {
    clear();
    fault = { key: key => key === journalKey, mode };
    await assert.rejects(reserve(query, mode), /terminal_review_journal_write_failed|simulated_network_loss_after_commit|terminal_review_admission_conflict/);
    fault = null;
    journal = reload();
    const result = await journal.checkTerminalReview(query);
    assert.equal(result.kind, ["uncertain", "throw_after_commit"].includes(mode) ? "held" : "eligible");
    if (result.kind === "held") assert.equal(result.reason, "terminal_review_recovery_pending");
  }

  clear();
  assert.equal(await reserve(query, "recover-append"), true);
  fault = { key: key => key === journalKey, mode: "refuse" };
  await assert.rejects(finish(query, "recover-append", "reject"), /terminal_review_journal_write_failed/);
  assert.equal(parsed(journalKey).decisions.length, 0);
  assert.equal(parsed(journalKey).pending.length, 1);
  assert.equal([...objects.keys()].filter(key => key.includes("/attempts/")).length, 1, "The completed receipt persists before a failed append");
  fault = null;
  journal = reload();
  assert.equal((await journal.checkTerminalReview(query)).decision.outcome, "rejected", "Reload repairs the append from its receipt without paid replay");
  assert.equal(parsed(journalKey).decisions.length, 1);
  assert.equal(parsed(journalKey).pending.length, 0);
  await finish(query, "recover-append", "reject");
  assert.equal(parsed(journalKey).decisions.length, 1, "An identical completion retry is idempotent");

  for (const mode of ["refuse", "uncertain", "throw_after_commit"]) {
    clear();
    assert.equal(await reserve(query, `receipt-${mode}`), true);
    fault = { key: key => key.includes("/attempts/"), mode };
    await assert.rejects(finish(query, `receipt-${mode}`, "approve"), /terminal_review_receipt_write_failed|simulated_network_loss_after_commit/);
    fault = null;
    journal = reload();
    const result = await journal.checkTerminalReview(query);
    assert.equal(result.kind, mode === "refuse" ? "held" : "terminal");
    if (mode === "refuse") assert.equal(await reserve(query, "cannot-replay"), false);
    else assert.equal(result.decision.outcome, "approved");
  }

  clear();
  assert.equal(await reserve(query, "corruption"), true);
  await finish(query, "corruption", "reject");
  const intact = structuredClone(objects.get(journalKey));
  for (const replacement of [
    { ...intact, etag: null },
    { ...intact, text: "{" },
    { ...intact, text: JSON.stringify({ ...JSON.parse(intact.text), decisions: [] }) },
    { ...intact, text: null },
  ]) {
    objects.set(journalKey, replacement);
    const writesBefore = calls.filter(call => call.operation === "write").length;
    await assert.rejects(journal.checkTerminalReview(query));
    await assert.rejects(reserve(query, "corrupt-must-block"));
    assert.equal(calls.filter(call => call.operation === "write").length, writesBefore, "Corrupt/missing-ETag state must not be overwritten");
  }
  objects.set(journalKey, intact);
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  const seal = value => crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
  const corrupt = JSON.parse(intact.text);
  corrupt.decisions[0].outcome = "approved";
  const { integrity: ignoredIntegrity, ...unsealed } = corrupt;
  assert.ok(ignoredIntegrity);
  corrupt.integrity = seal(unsealed);
  objects.set(journalKey, { ...intact, text: JSON.stringify(corrupt) });
  await assert.rejects(journal.checkTerminalReview(query), /terminal_review_decision_invalid/, "Even a resealed journal cannot validate a forged decision");

  clear();
  assert.equal(await reserve(query, "bad-receipt"), true);
  fault = { key: key => key === journalKey, mode: "refuse" };
  await assert.rejects(finish(query, "bad-receipt"), /terminal_review_journal_write_failed/);
  fault = null;
  const receiptKey = [...objects.keys()].find(key => key.includes("/attempts/"));
  const damagedReceipt = parsed(receiptKey);
  damagedReceipt.decision = null;
  objects.set(receiptKey, { text: JSON.stringify(damagedReceipt), etag: "tampered" });
  await assert.rejects(journal.checkTerminalReview(query), /terminal_review_receipt_invalid/);

  for (const kind of ["partial", "technical", "precall_denied"]) {
    clear();
    const costKey = "test/serious-signal/ai-cost-v1.json";
    const countKey = "test/sensor/provider-budgets-v1.json";
    objects.set(costKey, { text: JSON.stringify({ reservedUsd: 2.75, observedUsd: 0.25 }), etag: "cost-unchanged" });
    objects.set(countKey, { text: JSON.stringify({ paidAdmissions: 1, reservations: ["already-counted"] }), etag: "count-unchanged" });
    const costs = structuredClone(objects.get(costKey)), counts = structuredClone(objects.get(countKey));
    assert.equal(await reserve(query, kind), true);
    const incomplete = kind === "partial" ? { ...committee("reject"), agentsCompleted: 2, agentsFailed: 1 }
      : { ok: false, agentsCompleted: 0, agentsFailed: 3, output: { overallRecommendation: "reject" } };
    assert.equal(completeCommitteeReview(incomplete), false);
    assert.equal(await finish(query, kind, "reject", { report: { openAiCalled: kind !== "precall_denied", committee: incomplete } }), null);
    assert.equal(parsed(journalKey).decisions.length, 0, "Technical and partial reviews are not terminal verdicts");
    assert.equal(parsed(journalKey).pending.length, 0);
    assert.equal((await journal.checkTerminalReview(query)).kind, "eligible");
    assert.deepEqual(objects.get(costKey), costs, "Journal release cannot refund dollars");
    assert.deepEqual(objects.get(countKey), counts, "Journal release cannot release paid counts");
  }
  console.log("PASS: real terminal evidence/journal, all terminal outcomes, durable aliases and A-B-A, conservative legacy, strict CAS and concurrency, corruption and crash recovery, signal propagation, and isolated technical release.");
} finally {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
