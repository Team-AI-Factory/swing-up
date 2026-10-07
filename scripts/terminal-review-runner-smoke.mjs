import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";
import { inSimpleAlertPilot } from "./helpers/simple-alert-pilot-fixture.mjs";

// Synthetic financial/source/provider responses. The runner, Committee
// orchestration, evidence classifier, terminal journal and event job stay real.
export function terminalHarness({ eventMode = "valuation", eventAliases = true } = {}) {
  const identity = { ticker: "AIOT", company: "Powerfleet, Inc.", cik: "0001774170" };
  const state = { now: new Date("2026-10-05T15:00:00Z"), price: 50, quoteReady: true,
    haltKnown: true, halted: false, profileReady: true, sourceComplete: true,
    verdict: "positive", failRole: null, failRoleStatus: "provider_error", factsRevision: 0, documentRevision: 0,
    policyRevision: "fixture-policy-A", model: "gpt-4.1-mini", baseValue: 100,
    confidence: 90, roleCalls: 0, moneyCalls: 0, runnerCalls: 0, sequence: 0,
    failJournalAppend: false, conflictJournalWrites: 0, documentsReady: true, documentsFail: false,
    documentsComplete: true, essentialFactsReady: true, debtReady: true, eventMode,
    sourceRevision: 1, sourcePublishedAt: "2026-10-05T15:00:00.000Z", eventAliases, historyFault: null };
  const objects = new Map(), writes = [], fetches = [], reports = [], reads = [];
  const prefix = "branch-labs/simple-alerts/terminal-integration";
  const key = relative => `${prefix}/${relative}`;
  const journalKey = key(`terminal-reviews-v1/companies/${identity.cik}.json`);
  let etagCounter = 0, modules;
  const storage = {
    readVersionedTextFromR2: async (objectKey, options = {}) => {
      reads.push({ operation: "read", key: objectKey, options });
      options.signal?.throwIfAborted();
      const stored = objects.get(objectKey);
      return stored ? { found: true, text: JSON.stringify(stored.value), etag: stored.etag }
        : { found: false, text: null, etag: null };
    },
    listR2ObjectKeys: async (prefix, options = {}) => {
      reads.push({ operation: "list", key: prefix, options });
      options.signal?.throwIfAborted();
      if (state.historyFault === "timeout") throw new Error("fixture_history_timeout");
      const keys = [...objects.keys()].filter(key => key.startsWith(prefix));
      return { keys: keys.slice(0, options.limit), isTruncated: state.historyFault === "truncated" || keys.length > options.limit,
        nextContinuationToken: null };
    },
    writeVersionedJsonToR2: async (objectKey, value, options = {}) => {
      const prior = objects.get(objectKey);
      if (objectKey === journalKey) {
        assert.ok(options.createOnly === true || typeof options.expectedEtag === "string", "Every journal mutation must use CAS");
        if (state.failJournalAppend && value.decisions.length > (prior?.value.decisions.length ?? 0)) throw new Error("fixture_terminal_append_failed");
        if (state.conflictJournalWrites > 0) { state.conflictJournalWrites--; return { written: false, conflict: true }; }
      }
      if ((options.createOnly && prior) || (options.expectedEtag !== undefined && options.expectedEtag !== prior?.etag)) return { written: false, conflict: true };
      const etag = `"fixture-${++etagCounter}"`;
      objects.set(objectKey, { value: structuredClone(value), etag });
      writes.push({ key: objectKey, value: structuredClone(value), options });
      return { written: true, conflict: false, etag };
    },
  };
  const analysis = () => ({ ...identity, tradingViewSymbol: "NASDAQ:AIOT", industry: "Software", sector: "Technology", currency: "USD",
    observedAt: state.now.toISOString(), currentPrice: state.price,
    fairValue: { conservativeValue: state.baseValue - 5, baseValue: state.baseValue, optimisticValue: state.baseValue + 5,
      methods: [{ method: "earnings_power", value: state.baseValue - 5 }, { method: "owner_earnings_fcf", value: state.baseValue + 5 }] },
    scores: { fairValueConfidence: state.confidence, evidenceCompleteness: 90, businessQuality: 85, balanceSheet: 75, risk: 20 },
    fundamentals: { revenue: 1000000000 + state.factsRevision * 1000000 }, decision: { action: "buy" } });
  const facts = () => ({ cik: Number(identity.cik), facts: { "us-gaap": Object.fromEntries([
    ["Revenues", "USD", 1000000000 + state.factsRevision * 1000000], ["NetIncomeLoss", "USD", 2000000],
    ["Assets", "USD", 3000000], ["CashAndCashEquivalentsAtCarryingValue", "USD", 4000000],
    ["StockholdersEquity", "USD", 5000000], ["CommonStockSharesOutstanding", "shares", 1000000],
    ["EarningsPerShareDiluted", "USD/shares", 2], ["NetCashProvidedByUsedInOperatingActivities", "USD", 2000000],
    ["PaymentsToAcquirePropertyPlantAndEquipment", "USD", 100000],
    ["LongTermDebtNoncurrent", "USD", 300000],
  ].filter(([concept]) => state.essentialFactsReady || concept !== "EarningsPerShareDiluted")
    .filter(([concept]) => state.debtReady || concept !== "LongTermDebtNoncurrent")
    .map(([concept, unit, value]) => [concept, { units: { [unit]: [{ val: value,
      ...(["Assets", "StockholdersEquity", "CashAndCashEquivalentsAtCarryingValue", "CommonStockSharesOutstanding", "LongTermDebtNoncurrent"].includes(concept) ? {} : { start: "2025-01-01" }),
      end: concept === "LongTermDebtNoncurrent" ? "2025-06-30" : "2025-12-31", filed: "2026-02-20", form: "10-K" }] } }])) } });
  const annualUrl = `https://www.sec.gov/Archives/edgar/data/${Number(identity.cik)}/000177417026000001/annual.htm`;
  const profile = () => state.profileReady ? { ...companyProfileFixture(identity, new Date("2026-10-05T15:00:00Z")), sourceUrl: annualUrl, sourceFiledAt: "2026-02-20" } : null;
  const provider = name => ({ provider: name, status: name === "nasdaq_trade_halts" && !state.haltKnown ? "unavailable" : "connected",
    checkedAt: state.now.toISOString(), nextRetryAt: null, sourceUrls: [], receipts: [], recordsRead: 1, error: null,
    entitlementVerified: true, cached: false });
  const docs = () => ({ version: 1, cik: identity.cik, checkedAt: state.now.toISOString(), nextCheckAt: state.now.toISOString(),
    cached: false, failures: state.documentsFail ? [{ sourceUrl: annualUrl, reason: "fixture_document_unavailable" }] : [], documents: state.documentsReady ? [{ url: annualUrl, form: "10-K", filedAt: "2026-02-20", digest: `fixture-document-${state.documentRevision}`,
      readComplete: state.documentsComplete, excerpts: [{ topic: "segments", text: "Synthetic source-backed software segment facts" },
        { topic: "customers", text: "Synthetic customer concentration facts" }, { topic: "margins", text: "Synthetic margin facts" }] }] : [] });
  let event;
  const newEvent = (label = "daily") => { event = { ...identity, id: `valuation:${identity.cik}:${label}:${++state.sequence}`,
    source: "market_price", sourceProvider: "market_watch", sourceHealthStatus: "connected", observedAt: state.now.toISOString(),
    title: `${identity.ticker} valuation review`, kind: "valuation_review", priority: 100, reason: "Synthetic valuation candidate",
    url: "https://www.tradingview.com/symbols/NASDAQ-AIOT/", sourceUrl: "https://www.tradingview.com/symbols/NASDAQ-AIOT/",
    tradingViewSymbol: "NASDAQ:AIOT", mappingStatus: "mapped", mappingMethod: "official_sec_cik_exact",
    queueAttempts: 0, queueNextAttemptAt: null, queueLastAttemptAt: null, queueLastError: null };
    if (state.eventMode === "sec") {
      const accession = `0001774170-26-${String(state.sourceRevision).padStart(6, "0")}`;
      const url = `https://www.sec.gov/Archives/edgar/data/1774170/${accession.replaceAll("-", "")}/${accession}-index.html`;
      Object.assign(event, { id: `sec:${accession}${state.eventAliases ? `:alias:${state.sequence}` : ""}`, source: "sec", sourceProvider: "sec_broad", kind: "8-K", form: "8-K", accession,
        observedAt: state.sourcePublishedAt,
        identityMethod: "official_sec_archive_link", url, sourceUrl: url, canonicalSecIndexUrl: url,
        title: "Powerfleet, Inc. wins $200 million contract", reason: "Powerfleet, Inc. signed a committed $200 million contract for one year of services." });
    }
    return event;
  };
  newEvent();
  const receipt = () => ({ id: event.id, title: event.title, summary: JSON.stringify(analysis()), url: event.url,
    publisher: "TradingView company financials", publishedAt: state.now.toISOString(), channel: "market_price_sensor",
    official: false, primarySource: false, scheduled: false, symbolHints: [identity.ticker], companyHints: [identity.company], rawEventType: "valuation_review" });
  const fetchImpl = async input => {
    const url = String(input); fetches.push(url);
    if (/companyfacts\/CIK\d+\.json$/.test(url)) return Response.json(facts());
    if (/submissions\/CIK\d+\.json$/.test(url)) return Response.json({ cik: Number(identity.cik), filings: { recent: {
      form: ["10-K"], filingDate: ["2026-02-20"], accessionNumber: ["0001774170-26-000001"], primaryDocument: ["annual.htm"], reportDate: ["2025-12-31"],
    } } });
    if (url === annualUrl) return new Response(`<html>${"Synthetic report introduction. ".repeat(100)}<p>Reportable segments include software services.</p><p>Major customers use inventory systems. Revision ${state.documentRevision}.</p><p>Gross margin reflects subscription sales.</p></html>`);
    throw new Error(`Unexpected fixture network request: ${url}`);
  };
  const overrides = {
    "@/lib/r2-warehouse": storage,
    "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key },
    "@/lib/branch-signal-lab": { branchProviderCallRequest: () => null },
    "@/lib/opportunity-engine/pr262-sensor-fetch-budget": { createPr262SensorBudgetedFetch: async ({ fetchImpl }) => ({ fetchImpl, flush: async () => ({ persisted: true }), summary: () => ({}) }) },
    "@/lib/opportunity-engine/pr262-change-sensor": {
      READY_EVENT_TTL_MS: 48 * 3600000, readNextPr262PendingSensorEvent: async () => event,
      acknowledgePr262PendingSensorEvent: async () => ({ acknowledged: true }), retryPr262PendingSensorEvent: async () => ({ retried: true }),
    },
    "@/lib/opportunity-engine/pr262-company-directory": { readPr262ResolvedSensorCompany: async () => ({ event,
      directoryEntry: { ...identity, tradingViewSymbol: "NASDAQ:AIOT", exchange: "NASDAQ", securityType: "common_stock", isPrimaryListing: true,
        batchKey: key("fixture/batch.json"), analysisIndex: 0, valueCycleId: "fixture", universeRefreshedAt: state.now.toISOString() }, valueAnalysis: analysis() }) },
    "@/lib/opportunity-engine/pr262-pilot-watch-valuation": { readPilotWatchValuation: async () => ({ analysis: analysis(), receivedAt: state.now.toISOString() }),
      pilotValuationUnitsBlocker: () => null, PILOT_WATCH_VALUATION_MAX_AGE_MS: 15 * 60000 },
    "@/lib/opportunity-engine/pr262-trade-halt-snapshot": { fetchPr262TradeHalts: async () => provider("nasdaq_trade_halts") },
    "@/lib/opportunity-engine/company-profile-cache": { ensureCompanyProfile: async () => profile(), warmFoundationCompanyProfiles: async () => ({}) },
    "@/lib/opportunity-engine/us-value-investing-engine": { refreshUsValueCompany: async () => { throw new Error("Unexpected company refresh"); } },
    "@/lib/opportunity-engine/us-value-investing-safety": { hardenUsValueCompanyAnalysis: value => value },
    "@/lib/opportunity-engine/pr262-serious-watch-out-authority": { promotePr262SeriousWatchOut: async () => ({ promoted: false, outboxKey: null }) },
    "@/lib/ai-committee/provider": {
      modelForTier: () => state.model, getAiCommitteeProviderStatus: () => ({ configured: true, enabled: true, dryRunDefault: false }),
      runOpenAiCommitteeProvider: async input => {
        state.roleCalls++;
        const data = JSON.parse(input.messages[1].content), agentId = data.agent.id;
        if (agentId === state.failRole) return { ok: false, status: state.failRoleStatus, model: state.model,
          ...(state.failRoleStatus === "provider_error" ? { failure: { category: "server_error", httpStatus: 500, code: "fixture_uncertain_usage" } } : {}) };
        return { ok: true, finishReason: "stop", model: state.model,
          tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, cachedPromptTokens: 0 },
          content: JSON.stringify({ agentId, verdict: state.verdict, confidence: 95,
            keyFindings: agentId === "analyst_agent" ? ["Company: It sells business software.", "What happened: The price is below the estimate.", "Why it matters: The financial results support the estimate.", "Possible outcome: The gap could close.", "Risks: Earnings could disappoint."] : [],
            supportingEvidence: [], concerns: state.verdict === "negative" ? ["The supplied financial assumptions overstate sustainable margins."] : [],
            missingData: state.verdict === "needs_more_data" ? ["A verified current debt maturity schedule is required."] : [],
            followUpChecks: [], suggestedActionLabel: "Review valuation", riskNotes: [] }) };
      },
    },
    "@/lib/ai-committee/evidence-pack": { buildAiCommitteeEvidencePack: async () => { throw new Error("Unexpected database evidence read"); } },
    "@/lib/ai-committee/run-persistence": { persistAiCommitteeRun: async () => { throw new Error("Unexpected database write"); } },
    "@/lib/equity-signal/event-sources": { collectEventSources: async () => { throw new Error("Unexpected broad feed"); },
      mergeSecFilingDetails: (values, details) => values.map(value => ({ ...value, summary: `${value.summary} ${details.find(detail => detail.receipt.id === value.id)?.text ?? ""}` })) },
    "@/lib/equity-signal/sec-filing-details": { enrichSecFilingDetails: async receipts => {
      const text = "Powerfleet, Inc. signed a committed $200 million contract for one year of software services. The agreement is final and work begins this quarter. ".repeat(4);
      return { provider: provider("sec_filing_details"), details: [{ receipt: receipts[0], form: "8-K", indexUrl: receipts[0].url,
        primaryDocumentUrl: `${receipts[0].url}/primary.htm`, exhibitDocumentUrl: `${receipts[0].url}/exhibit.htm`, exhibitDocumentType: "EX-99.1",
        eventExhibitMissing: !state.sourceComplete, documentsFetched: 2, text, textLength: text.length, truncated: false, fetchedAt: state.now.toISOString() }],
        diagnostics: { selected: 1, enriched: 1, failed: 0, items: [{ receiptId: receipts[0].id, errorCategory: state.sourceComplete ? null : "event_exhibit_not_found" }],
          skipped: { unsupported_form: 0, invalid_url: 0, invalid_date: 0, stale: 0, failure_cooldown: 0, retry_not_due: 0, run_limit: 0 } } };
    } },
    "@/lib/equity-signal/universe": { loadEquityUniverse: async () => { throw new Error("Unexpected universe rebuild"); } },
    "@/lib/equity-signal/macro": { fetchMacroContext: async () => { throw new Error("Unexpected macro fetch"); } },
    "@/lib/equity-signal/historical-bootstrap": { mergeHistoricalSignals: (...values) => values.flat(), bootstrapPublicHistoricalSignals: async () => { throw new Error("Unexpected history fetch"); } },
    "@/lib/equity-signal/market": { enrichCandidateQuotes: async candidates => {
      for (const candidate of candidates) candidate.quote = { ticker: candidate.ticker, price: state.price, previousClose: 50, changePercent: 0,
        volume: 10000, averageVolume: 10000, marketCap: 1000000000, observedAt: state.now.toISOString(), source: "Synthetic fixture quote",
        delayedMinutes: 0, actionableForSeriousSignal: state.quoteReady, marketSession: state.halted ? "halted" : "regular" };
      return { candidates, provider: provider("market_quote"), marketSnapshot: [], benchmarkQuote: null, benchmarkTicker: "SPY" };
    } },
  };
  const reload = () => {
    const modelPolicy = loadTsModule("@/lib/ai-committee/model-policy");
    overrides["@/lib/ai-committee/model-policy"] = { ...modelPolicy, COMMITTEE_MODEL_POLICY: state.policyRevision };
    modules = {
      runner: loadTsModule("@/lib/equity-signal/runner", overrides),
      journal: loadTsModule("@/lib/opportunity-engine/pr262-terminal-reviews", overrides),
      eventJob: loadTsModule("@/lib/opportunity-engine/pr262-event-job", overrides),
      money: loadTsModule("@/lib/opportunity-engine/pr262-ai-daily-cost", overrides),
      research: loadTsModule("@/lib/opportunity-engine/pr262-research-evidence", overrides),
    };
  };
  reload();
  const runRunner = async ({ persist = true, ...extra } = {}) => {
    const attemptId = `runner:${++state.sequence}`;
    let reserved = false;
    const report = await modules.runner.runEquitySignalLab({ now: state.now, fetchImpl, allowOpenAi: true,
      allowIncompleteCommitteeReview: true, collectFinancialDocuments: async () => docs(), resolveCompanyProfile: async () => profile(),
      terminalReview: input => modules.journal.checkTerminalReview(input),
      beforeOpenAiCall: async input => {
        state.moneyCalls++;
        reserved = await modules.journal.reserveTerminalReview({ ...input, fingerprint: input.candidateFingerprint,
          evidence: input.terminalEvidence, eventId: event.id, attemptId, now: state.now });
        return reserved;
      },
      targetedContext: { analysisKind: "valuation", universe: { entries: [{ ...identity, name: identity.company, aliases: [], exchange: "NASDAQ", securityType: "common_stock" }], coverage: {}, sources: [] },
        receipts: [receipt()], providers: [provider("nasdaq_trade_halts")], historicalSignalsComplete: true, storedCompanyAnalysis: analysis(), sourceEvidenceIncomplete: !state.sourceComplete },
      ...extra });
    state.runnerCalls++; reports.push(report);
    if (reserved && persist) await modules.journal.finishTerminalReviewAttempt({ ...identity, attemptId, eventId: event.id, report, now: state.now });
    return report;
  };
  const runJob = async () => {
    const result = await modules.eventJob.runPr262EventJob({ now: state.now, clock: () => state.now, fetchImpl, allowOpenAi: true,
      beforeOpenAiCall: async reservation => { state.moneyCalls++; return (await modules.money.reservePr262AiCommitteeBudget(reservation, state.now)).allowed; } });
    const resultPayload = result.resultKey ? objects.get(result.resultKey)?.value : result.nonterminalAuditKey ? objects.get(result.nonterminalAuditKey)?.value : null;
    const report = resultPayload?.report;
    if (report) { reports.push(report); await modules.money.recordPr262AiCommitteeCost(report, state.now); }
    return { result, report };
  };
  return { state, objects, writes, reads, fetches, reports, key, journalKey, identity, newEvent, reload, runRunner, runJob,
    get journal() { return objects.get(journalKey)?.value; }, get modules() { return modules; },
    advance: ms => { state.now = new Date(state.now.getTime() + ms); newEvent(); } };
}

export async function runRunnerRegressions() {
  for (const [verdict, outcome] of [["positive", "approved"], ["negative", "rejected"], ["needs_more_data", "needs_more_data"]]) {
    const h = terminalHarness(); h.state.verdict = verdict;
    const first = await h.runRunner();
    assert.equal(first.openAiCalled, true, JSON.stringify(first));
    assert.equal(h.journal.decisions[0].outcome, outcome);
    assert.equal(first.committee.agentsFailed, 0);
    const calls = h.state.roleCalls, money = h.state.moneyCalls;
    h.advance(13 * 3600000); h.reload();
    const afterExpiry = await h.runRunner();
    assert.equal(afterExpiry.openAiCalled, false, `${outcome} must survive the old 12-hour lock`);
    h.advance(24 * 3600000); h.reload();
    const nextDay = await h.runRunner();
    assert.equal(nextDay.openAiCalled, false, `${outcome} must survive daily identity and process reload`);
    assert.equal(h.state.roleCalls, calls); assert.equal(h.state.moneyCalls, money);
    assert.equal(h.journal.decisions.length, 1);
  }

  const h = terminalHarness();
  const original = await h.runRunner(), initialCalls = h.state.roleCalls;
  h.state.price = 50.1; h.state.baseValue = 101; h.state.policyRevision = "fixture-policy-B"; h.state.model = "gpt-4.1-mini-2025-04-14";
  h.advance(48 * 3600000); h.reload();
  const jitter = await h.runRunner();
  assert.equal(jitter.openAiCalled, false, "Policy, provider model, valuation assumptions and quote jitter cannot purchase another review");
  assert.equal(jitter.seriousSignalFound, false, "Changed model-derived targets cannot inherit the original publication approval");
  assert.equal(h.state.roleCalls, initialCalls);
  assert.equal(jitter.selectedCandidate.terminalDecisionKey, original.selectedCandidate.terminalDecisionKey);
  h.state.baseValue = 100; h.state.price = 60;
  const market = await h.runRunner();
  assert.equal(market.openAiCalled, true, "A real material market transition admits a review");
  assert.equal(h.journal.decisions.length, 2);
  h.state.price = 50; const afterMarket = h.state.roleCalls;
  assert.equal((await h.runRunner()).openAiCalled, false, "A to B to A retains the original completed decision");
  assert.equal(h.state.roleCalls, afterMarket);
  h.state.documentRevision++;
  assert.equal((await h.runRunner()).openAiCalled, true, "A new fully read filing digest admits a review");
  h.state.documentRevision = 0;
  assert.equal((await h.runRunner()).openAiCalled, false, "Old document evidence remains terminal after a newer decision");

  const pending = terminalHarness(); await pending.runRunner(); const calls = pending.state.roleCalls;
  pending.state.quoteReady = false;
  const stale = await pending.runRunner();
  assert.equal(stale.reviewOutcome, "approved_pending_checks"); assert.equal(stale.seriousSignalFound, false);
  pending.state.quoteReady = true; pending.state.haltKnown = false;
  assert.equal((await pending.runRunner()).seriousSignalFound, false, "Unknown current halt state cannot borrow the old approval's market gates");
  pending.state.haltKnown = true; pending.state.sourceComplete = false;
  assert.equal((await pending.runRunner()).seriousSignalFound, false, "Missing source completeness cannot be fabricated from a stored approval");
  pending.state.sourceComplete = true; pending.state.profileReady = false;
  assert.equal((await pending.runRunner()).seriousSignalFound, false, "A current verified profile is required on replay");
  pending.state.profileReady = true; pending.state.confidence = 70;
  assert.equal((await pending.runRunner()).seriousSignalFound, false, "Current valuation gates still constrain replay");
  pending.state.confidence = 90;
  pending.state.documentsReady = false;
  assert.equal((await pending.runRunner()).seriousSignalFound, false, "Missing current financial documents cannot inherit the original approval's evidence");
  pending.state.documentsReady = true; pending.state.documentsFail = true;
  assert.equal((await pending.runRunner()).seriousSignalFound, false, "A newer filing read failure must keep the approval pending");
  pending.state.documentsFail = false; pending.state.documentsComplete = false;
  assert.equal((await pending.runRunner()).seriousSignalFound, false, "Partial financial text cannot be represented as a complete source");
  pending.state.documentsComplete = true; pending.state.essentialFactsReady = false;
  const missingEssentials = await pending.runRunner();
  assert.ok(missingEssentials.selectedCandidate.valuationAudit.missingEssentialFacts.includes("diluted_eps"));
  assert.equal(missingEssentials.seriousSignalFound, false, "Missing essential valuation facts must hold a prior approval");
  pending.state.essentialFactsReady = true;
  const requestedDebt = { verifiedFactsCache: { requiredMetrics: ["long_term_debt_noncurrent"], read: async () => null, write: async () => {} } };
  const staleDebt = await pending.runRunner(requestedDebt);
  assert.ok(staleDebt.selectedCandidate.fundamentals.items.some(row => row.metric === "long_term_debt_noncurrent" && row.periodEnd === "2025-06-30"));
  assert.equal(staleDebt.seriousSignalFound, false, "A requested current debt fact cannot be satisfied by stale historical debt");
  pending.state.debtReady = false;
  assert.equal((await pending.runRunner(requestedDebt)).seriousSignalFound, false, "Missing requested debt cannot inherit the prior approval");
  pending.state.debtReady = true;
  assert.equal((await pending.runRunner()).seriousSignalFound, true, "Restored current checks permit the stored approval without new paid work");
  assert.equal(pending.state.roleCalls, calls);
  assert.equal(pending.state.moneyCalls, 1, "Publication-only checks never reach paid admission again");
  assert.equal(pending.journal.decisions.length, 1);

  console.log("Terminal runner integration: actual focused Committee outcomes, durable daily/reload holds, material transitions, A→B→A and current publication checks passed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await inSimpleAlertPilot(runRunnerRegressions);
