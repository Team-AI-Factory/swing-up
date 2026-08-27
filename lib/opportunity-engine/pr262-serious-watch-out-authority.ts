import crypto from "node:crypto";
import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";

const OUTBOX_PREFIX = pr262StorageKey("serious-signal/outbox/watch-out-v2");

type Json = Record<string, unknown>;

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedCik(value: unknown) {
  const digits = text(value)?.replace(/\D/g, "") ?? "";
  if (!digits || digits.length > 10 || /^0+$/.test(digits)) return null;
  return digits.replace(/^0+/, "");
}

function riskRule(candidate: Json) {
  const receipts = Array.isArray(candidate.receipts) ? candidate.receipts.map(object) : [];
  const corpus = [
    candidate.eventHeadline,
    candidate.whatHappened,
    candidate.eventFamily,
    ...receipts.flatMap((receipt) => [receipt.title, receipt.summary, receipt.rawEventType]),
  ].filter((value): value is string => typeof value === "string").join(" ").toLowerCase();
  const rules: Array<[string, RegExp]> = [
    ["trading_halt_or_resumption", /\b(trading halt|halted trading|trading suspension|suspended trading|trading resumes?|resumption of trading)\b/],
    ["delisting_or_exchange_compliance", /\b(delist|non.?compliance|minimum bid price|listing deficiency|late filing notice)\b/],
    ["accounting_auditor_or_restatement", /\b(restatement|auditor resign|material weakness|internal control weakness|financial statements?.{0,30}no longer be relied)\b/],
    ["regulator_or_law_enforcement", /\b(sec charges?|doj charges?|ftc sues?|enforcement action|subpoena|antitrust suit|court injunction)\b/],
    ["fda_or_clinical_failure", /\b(clinical hold|complete response letter|fda.{0,40}(reject|deny|recall|warning)|pivotal.{0,20}(fail|miss)|drug recall|device recall)\b/],
    ["bankruptcy_or_refinancing_stress", /\b(chapter 11|bankrupt|going concern|covenant breach|missed payment|payment default|debt restructuring|liquidity crisis)\b/],
    ["dilution_or_convertible", /\b(at-the-market|atm offering|secondary offering|share offering|convertible debt|convertible notes?|warrant exercise|dilution|new share issuance)\b/],
    ["earnings_guidance_cash_flow_break", /\b(guidance cut|lowers? guidance|withdraws? guidance|earnings miss|margin compression|cash flow deterioration|free cash flow decline)\b/],
    ["customer_supplier_contract_loss", /\b(major customer loss|customer terminated|contract terminated|contract cancellation|lost contract|supplier disruption|production interruption)\b/],
    ["cyber_or_operational_outage", /\b(cyberattack|ransomware|data breach|security breach|systems? outage|operational outage|network intrusion)\b/],
    ["leadership_or_governance_break", /\b(ceo resign|cfo resign|chief executive resign|chief financial officer resign|board conflict|insider misconduct|leadership shakeup)\b/],
    ["merger_or_financing_failure", /\b(merger terminated|deal terminated|transaction terminated|financing failed|deal blocked|merger blocked)\b/],
    ["geopolitical_tariff_sanction_shock", /\b(tariff|sanction|export control|military strike|invasion|war|supply chain shock)\b/],
    ["source_contradiction_or_integrity", /\b(source contradiction|data integrity|conflicting filing|conflicting disclosure)\b/],
  ];
  return rules.find(([, pattern]) => pattern.test(corpus))?.[0] ?? null;
}

function committeeProof(report: Json, pointer: Json) {
  const committee = object(report.committee);
  const judge = object(committee.finalJudge);
  const output = object(committee.output);
  const candidate = object(report.selectedCandidate);
  const quote = object(candidate.quote);
  const halt = object(report.tradingHaltSafety);
  const candidateTicker = text(candidate.ticker)?.toUpperCase() ?? null;
  const pointerTicker = text(pointer.ticker)?.toUpperCase() ?? null;
  const candidateCik = normalizedCik(candidate.cik);
  const pointerCik = normalizedCik(pointer.cik);
  const officialEvidence = Array.isArray(candidate.receipts) && candidate.receipts.map(object).some((receipt) =>
    receipt.official === true || receipt.primarySource === true || receipt.channel === "sec_current_filings");
  const ruleId = riskRule(candidate);
  const approved = report.seriousSignalFound === true
    && report.actionableSignalFound === true
    && report.alertType === "sell"
    && candidate.direction === "downside"
    && candidateTicker !== null
    && candidateTicker === pointerTicker
    && candidateCik !== null
    && candidateCik === pointerCik
    && text(candidate.evidenceFingerprint) !== null
    && candidate.evidenceFingerprint === report.candidateFingerprint
    && candidate.gatePassed === true
    && Number(candidate.eventTruth) >= 80
    && Number(candidate.mappingConfidence) >= 95
    && Number(candidate.materiality) >= 65
    && Number(candidate.transmissionConfidence) >= 70
    && Number(candidate.evidenceIndependence) >= 78
    && candidate.rumour !== true
    && Number(candidate.contradictionPenalty) < 50
    && Number(candidate.pricedInPenalty) < 50
    && Number.isFinite(Number(quote.price))
    && Number(quote.price) > 0
    && quote.actionableForSeriousSignal === true
    && !["halted", "unknown"].includes(String(quote.marketSession ?? "unknown"))
    && halt.currentStateKnown === true
    && officialEvidence
    && committee.ok === true
    && committee.agentsCompleted === 14
    && committee.agentsFailed === 0
    && judge.verdict === "positive"
    && Number(judge.confidence) >= 80
    && output.overallRecommendation === "approve"
    && Boolean(ruleId);
  return { approved, ruleId, candidate, committee, judge, output };
}

export async function promotePr262SeriousWatchOut(resultKey: string | null | undefined) {
  if (!resultKey) return { promoted: false, reason: "no_result_key", outboxKey: null as string | null };
  const stored = await readVersionedTextFromR2(resultKey);
  if (!stored.found || !stored.text) return { promoted: false, reason: "result_missing", outboxKey: null as string | null };
  const payload = object(JSON.parse(stored.text));
  const report = object(payload.report);
  const pointer = object(payload.companyPointer);
  const proof = committeeProof(report, pointer);
  if (!proof.approved || !proof.ruleId) return { promoted: false, reason: "committee_or_watch_out_rule_not_proven", outboxKey: null as string | null };

  const ticker = text(pointer.ticker)?.toUpperCase() ?? "UNKNOWN";
  const fingerprint = text(report.candidateFingerprint) ?? crypto.createHash("sha256").update(resultKey).digest("hex").slice(0, 24);
  const outboxKey = `${OUTBOX_PREFIX}/${ticker}/${proof.ruleId}/${fingerprint.replace(/[^a-zA-Z0-9_-]+/g, "-")}.json`;
  const outbox = {
    version: 2,
    kind: "pr262_committee_verified_serious_watch_out",
    createdAt: text(report.checkedAt) ?? new Date().toISOString(),
    resultKey,
    ticker,
    cik: text(pointer.cik),
    alertType: "watch_out",
    ruleId: proof.ruleId,
    candidateFingerprint: report.candidateFingerprint,
    historicalCaseRequirement: "disabled",
    candidate: proof.candidate,
    committee: proof.committee,
    authority: {
      exactIssuerMapping: true,
      currentEvidenceGatesPassed: true,
      freshQuoteAndHaltStateKnown: true,
      fullCommitteeAgentsCompleted: 14,
      finalJudgePositiveMinimumConfidence: 80,
      historicalCasesRequired: false,
    },
    delivery: { mode: "durable_consumer", producerSendsDirectly: false, published: false, notifiedAtCreation: false, traded: false },
  };
  const written = await writeVersionedJsonToR2(outboxKey, outbox, { createOnly: true });
  if (written.conflict) {
    const existing = await readVersionedTextFromR2(outboxKey);
    if (!existing.found || !existing.text) throw new Error("pr262_watch_out_outbox_conflict_read_failed");
    const value = object(JSON.parse(existing.text));
    if (value.kind !== outbox.kind
      || value.resultKey !== resultKey
      || value.ticker !== ticker
      || normalizedCik(value.cik) !== normalizedCik(pointer.cik)
      || value.ruleId !== proof.ruleId
      || value.candidateFingerprint !== report.candidateFingerprint) {
      throw new Error("pr262_watch_out_outbox_content_conflict");
    }
  }
  return { promoted: true, reason: written.written ? "new_serious_watch_out" : "already_recorded", outboxKey, ruleId: proof.ruleId, ticker };
}
