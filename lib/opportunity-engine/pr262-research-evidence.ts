import crypto from "node:crypto";
import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";
import { explainCandidate, plainEvidenceGaps } from "@/lib/signal-explanation";
import type { VerifiedFactsCache, VerifiedFactsSnapshot } from "@/lib/equity-signal/fundamentals";

type Json = Record<string, unknown>;
const object = (v: unknown): Json => v && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
const text = (v: unknown) => typeof v === "string" ? v.slice(0, 1500) : "";
const hash = (v: string) => crypto.createHash("sha256").update(v).digest("hex").slice(0, 24);
const ROOT = pr262StorageKey("research-evidence");
export const RESEARCH_ALERT_INDEX_KEY = `${ROOT}/alerts-v1.json`;

export async function readEvidenceFollowup(eventId: string) {
  const saved = await readVersionedTextFromR2(`${ROOT}/followups/${hash(eventId)}.json`);
  return saved.found && saved.text ? object(JSON.parse(saved.text)) : {};
}

export const verifiedFactsCache: VerifiedFactsCache = {
  async read(cik) {
    if (!/^\d{10}$/.test(cik)) return null;
    const saved = await readVersionedTextFromR2(`${ROOT}/company-facts/${cik}.json`);
    if (!saved.found || !saved.text) return null;
    const value = object(JSON.parse(saved.text));
    return value.cik === cik && Array.isArray(object(value.fundamentals).items) ? value as VerifiedFactsSnapshot : null;
  },
  async write(snapshot) {
    const key = `${ROOT}/company-facts/${snapshot.cik}.json`;
    const saved = await readVersionedTextFromR2(key);
    await writeVersionedJsonToR2(key, snapshot, saved.etag ? { expectedEtag: saved.etag } : { createOnly: true });
  },
};

export async function reserveRejectionAudit(eventId: string, now: Date) {
  if (parseInt(hash(eventId).slice(0, 4), 16) % 10 !== 0) return false;
  const key = `${ROOT}/rejection-audit/${now.toISOString().slice(0, 10)}/paid-sample-reservation.json`;
  const result = await writeVersionedJsonToR2(key, { eventId, reservedAt: now.toISOString(), maximumPerDay: 1 }, { createOnly: true });
  return result.written === true && !result.conflict;
}

export async function readResearchAlerts() {
  const stored = await readVersionedTextFromR2(RESEARCH_ALERT_INDEX_KEY);
  if (!stored.found || !stored.text) return [] as Json[];
  const body = object(JSON.parse(stored.text));
  return Array.isArray(body.alerts) ? body.alerts.map(object).slice(0, 100) : [];
}

export async function readEvidenceQuality(now = new Date()) {
  const stored = await readVersionedTextFromR2(`${ROOT}/quality/${now.toISOString().slice(0, 10)}.json`);
  if (!stored.found || !stored.text) return { available: false as const };
  const value = object(JSON.parse(stored.text));
  const samples = Array.isArray(value.samples) ? value.samples.map(object) : [];
  const reviewed = samples.filter(row => typeof row.eventToReviewMinutes === "number");
  return { available: true as const, updatedAt: text(value.updatedAt), uniqueEvents: samples.length,
    scope: "Latest evidence checks for up to 500 unique events today; seven checks per event.",
    averageCompletenessPercent: Number(value.averageCompletenessPercent ?? 0),
    missingFieldCounts: object(value.missingFieldCounts),
    averageMinutesToFirstReview: reviewed.length ? Math.round(reviewed.reduce((sum, row) => sum + Number(row.eventToReviewMinutes), 0) / reviewed.length) : null,
  };
}

export function evidenceTasks(report: Json) {
  const gaps = [...new Set([...(Array.isArray(report.blockers) ? report.blockers : []),
    ...(Array.isArray(object(report.researchReview).gaps) ? object(report.researchReview).gaps as unknown[] : []),
    ...(Array.isArray(object(object(report.committee).output).missingEvidence) ? object(object(report.committee).output).missingEvidence as unknown[] : [])]
    .filter((x): x is string => typeof x === "string"))];
  const joined = gaps.join(" ");
  const financialMetrics = Object.entries({ revenue: /revenue|sales/i, diluted_eps: /\beps\b|earnings per share/i,
    operating_cash_flow: /cash flow|cash generation/i, capital_expenditure: /capex|capital expenditure/i,
    long_term_debt_noncurrent: /debt|leverage/i, shares_outstanding: /shares|dilution/i,
    net_income: /net income|net profit/i, assets: /assets/i, liabilities: /liabilities/i,
  }).filter(([, pattern]) => pattern.test(joined)).map(([metric]) => metric);
  return { gaps: gaps.slice(0, 20), tasks: [
    ...(/source|filing|exhibit|proof|Truth/i.test(joined) ? [{ type: "source_document", action: "Retrieve the exact filing and referenced exhibit; try known alternate issuer sources.", complete: false }] : []),
    ...(/fundamental|magnitude|material|financial|revenue/i.test(joined) || financialMetrics.length ? [{ type: "financial_facts", action: "Refresh dated company facts and compare the event's size with the company.", fields: financialMetrics, complete: false }] : []),
    ...(/price|quote|market|halt/i.test(joined) ? [{ type: "market_evidence", action: "Refresh the price observation and trading-halt check.", complete: false }] : []),
    ...(/direction|causal|transmission/i.test(joined) ? [{ type: "business_effect", action: "Reassess the effect on income, costs or ownership using the retrieved documents.", complete: false }] : []),
  ] };
}

export async function recordResearchEvidence(input: { event: Json; report: Json; companyAnalysis?: Json; sourceDecisionGrade: boolean; sourceFailureReason: string | null; now: Date; approvedResultKey?: string }) {
  const { event, report, now } = input;
  const candidate = object(report.selectedCandidate);
  const committee = object(report.committee);
  const output = object(committee.output);
  const paid = report.openAiCalled === true;
  const eventId = text(event.id);
  const nextEvidenceCheckAt = new Date(now.getTime() + 15 * 60_000).toISOString();
  const tasks = evidenceTasks(report);
  const previousFollowup = await readEvidenceFollowup(eventId);
  const previousReview = paid ? {} : previousFollowup;
  const completeness = {
    issuer: Boolean((candidate.ticker ?? event.ticker) && (candidate.cik ?? event.cik)), sourceDocument: input.sourceDecisionGrade,
    financialFacts: object(candidate.fundamentals).available === true,
    marketPrice: Boolean(object(candidate.quote).price), currentMarketPrice: object(candidate.quote).actionableForSeriousSignal === true,
    direction: candidate.direction === "upside" || candidate.direction === "downside",
    tradingHaltCheck: object(report.tradingHaltSafety).currentStateKnown === true,
  };
  const known = Object.values(completeness).filter(Boolean).length;
  const observed = Date.parse(text(event.observedAt));
  const quality = { fields: completeness, availableFields: known, requiredFields: Object.keys(completeness).length,
    completenessPercent: Math.round(known / Object.keys(completeness).length * 100),
    evidenceAgeMinutes: Number.isFinite(observed) ? Math.max(0, Math.round((now.getTime() - observed) / 60000)) : null,
    eventToReviewMinutes: paid && Number.isFinite(observed) ? Math.max(0, Math.round((now.getTime() - observed) / 60000)) : null,
    sourceFailureReason: input.sourceFailureReason, committeeRolesCompleted: Number(committee.agentsCompleted ?? 0),
  };
  const needsFollowup = (paid || previousFollowup.status === "collecting_evidence") && report.seriousSignalFound !== true && output.overallRecommendation !== "reject";
  if (needsFollowup) {
    const key = `${ROOT}/followups/${hash(eventId)}.json`;
    const current = await readVersionedTextFromR2(key);
    await writeVersionedJsonToR2(key, { version: 1, eventId, ticker: event.ticker, updatedAt: now.toISOString(),
      status: "collecting_evidence", nextEvidenceCheckAt,
      paidReviewNotBefore: paid ? new Date(now.getTime() + 86400000).toISOString() : previousReview.paidReviewNotBefore,
      candidateFingerprint: paid ? report.candidateFingerprint : previousReview.candidateFingerprint,
      gaps: paid ? tasks.gaps : previousReview.gaps ?? tasks.gaps,
      tasks: paid ? tasks.tasks : previousReview.tasks ?? tasks.tasks, quality,
      lastCollectionAt: now.toISOString(), evidenceChanged: Boolean(previousFollowup.candidateFingerprint && previousFollowup.candidateFingerprint !== report.candidateFingerprint),
    }, current.etag ? { expectedEtag: current.etag } : { createOnly: true });
  }
  if (previousFollowup.status === "collecting_evidence" && (output.overallRecommendation === "reject" || input.approvedResultKey)) {
    const key = `${ROOT}/followups/${hash(eventId)}.json`;
    const current = await readVersionedTextFromR2(key);
    await writeVersionedJsonToR2(key, { ...previousFollowup, status: output.overallRecommendation === "reject" ? "rejected" : "completed",
      updatedAt: now.toISOString(), nextEvidenceCheckAt: null, quality }, current.etag ? { expectedEtag: current.etag } : { createOnly: true });
  }
  // A bounded, deterministic sample exposes false negatives without storing every routine scan.
  const auditSample = report.rejectionAuditReview === true || (report.status === "no_qualified_signal" && parseInt(hash(eventId).slice(0, 4), 16) % 10 === 0);
  if (auditSample) {
    await writeVersionedJsonToR2(`${ROOT}/rejection-audit/${now.toISOString().slice(0, 10)}/${hash(eventId)}.json`, {
      version: 1, eventId, ticker: event.ticker, checkedAt: now.toISOString(), reason: report.noSignalReason, committeeAudited: report.rejectionAuditReview === true, reviewOutcome: output.overallRecommendation ?? null,
      candidate: (Array.isArray(report.rankedCandidates) ? report.rankedCandidates : []).slice(0, 1), quality,
      reconsideration: "Sample retained for false-negative review; exact identity and substantive source are still required.",
    }, { createOnly: true });
  }
  if (candidate.ticker && (report.seriousSignalFound !== true || input.approvedResultKey)) {
    const approved = Boolean(input.approvedResultKey) && report.seriousSignalFound === true && Number(committee.agentsCompleted) === 14 && Number(committee.agentsFailed) === 0 && output.overallRecommendation === "approve";
    const alert = { id: hash(eventId), eventId, createdAt: now.toISOString(), eventObservedAt: event.observedAt,
      ticker: candidate.ticker, company: candidate.company, action: candidate.direction === "upside" ? "buy" : candidate.direction === "downside" ? "sell" : "watch_out",
      valuationObservedAt: input.companyAnalysis?.observedAt ?? null,
      eventHeadline: candidate.eventHeadline, kind: candidate.eventFamily === "valuation_gap" ? "valuation" : "event",
      currentPrice: object(candidate.quote).price ?? null, priceObservedAt: object(candidate.quote).observedAt ?? null,
      fairValue: object(input.companyAnalysis?.fairValue).baseValue ?? null,
      userAlertEligible: output.overallRecommendation !== "reject", committeeApproved: approved,
      committeeStatus: approved ? "approved" : output.overallRecommendation === "reject" ? "rejected" : output.overallRecommendation === "approve" ? "approved_pending_checks" : paid || previousFollowup.status ? "needs_more_data" : "awaiting_review",
      committee: { completed: Number(committee.agentsCompleted ?? 0), failed: Number(committee.agentsFailed ?? 0), confidence: object(committee.finalJudge).confidence ?? null },
      publicationStatus: approved ? "committee_approved_alert" : "provisional_alert",
      explanation: { ...explainCandidate(candidate, input.companyAnalysis), missingInformation: plainEvidenceGaps(paid ? tasks.gaps : Array.isArray(previousReview.gaps) ? previousReview.gaps as string[] : tasks.gaps) },
      followup: approved || output.overallRecommendation === "reject" ? null : { status: "collecting_evidence", nextEvidenceCheckAt, tasks: tasks.tasks }, quality,
      sources: (Array.isArray(candidate.receipts) ? candidate.receipts : []).map(object).flatMap(r => {
        try { const u = new URL(text(r.url)); if (u.protocol !== "https:" || u.username || u.password) return []; u.search = ""; return [{ label: text(r.publisher), url: u.toString() }]; } catch { return []; }
      }).slice(0, 4),
    };
    for (let i = 0; i < 4; i++) {
      const current = await readVersionedTextFromR2(RESEARCH_ALERT_INDEX_KEY);
      const prior = current.found && current.text ? object(JSON.parse(current.text)) : {};
      const rows = Array.isArray(prior.alerts) ? prior.alerts.map(object) : [];
      const previous = rows.find(x => x.id === alert.id);
      if (!paid && previous) {
        alert.committee = previous.committee as typeof alert.committee;
        alert.committeeApproved = previous.committeeApproved === true;
        alert.committeeStatus = text(previous.committeeStatus);
        alert.publicationStatus = text(previous.publicationStatus);
        alert.userAlertEligible = previous.userAlertEligible === true;
      }
      const alerts = [alert, ...rows.filter(x => x.id !== alert.id)].slice(0, 100);
      const written = await writeVersionedJsonToR2(RESEARCH_ALERT_INDEX_KEY, { version: 1, updatedAt: now.toISOString(), alerts }, current.etag ? { expectedEtag: current.etag } : { createOnly: true });
      if (!written.conflict) { if (!written.written) throw new Error("research_alert_index_write_failed"); break; }
      if (i === 3) throw new Error("research_alert_index_conflict");
    }
  }
  // Separately measure evidence contents; successful HTTP responses cannot inflate completeness.
  const metricKey = `${ROOT}/quality/${now.toISOString().slice(0, 10)}.json`;
  for (let i = 0; i < 4; i++) {
    const saved = await readVersionedTextFromR2(metricKey);
    const value = saved.found && saved.text ? object(JSON.parse(saved.text)) : {};
    const samples = Array.isArray(value.samples) ? value.samples.map(object) : [];
    const previous = samples.find(row => row.eventId === eventId);
    const next = [{ eventId, checkedAt: now.toISOString(), ...quality, eventToReviewMinutes: previous?.eventToReviewMinutes ?? quality.eventToReviewMinutes, paidReview: paid || previous?.paidReview === true, rejectionAuditSampled: auditSample }, ...samples.filter(row => row.eventId !== eventId)].slice(0, 500);
    const written = await writeVersionedJsonToR2(metricKey, { version: 1, updatedAt: now.toISOString(), sampleUnit: "latest attempt per unique event", samples: next,
      events: next.length, averageCompletenessPercent: Math.round(next.reduce((sum, row) => sum + Number(row.completenessPercent ?? 0), 0) / next.length),
      missingFieldCounts: Object.fromEntries(Object.keys(completeness).map(field => [field, next.filter(row => object(row.fields)[field] !== true).length])),
    }, saved.etag ? { expectedEtag: saved.etag } : { createOnly: true });
    if (!written.conflict) break;
  }
  return { quality, rejectionAuditSampled: auditSample, evidenceFollowupScheduled: needsFollowup, nextEvidenceCheckAt };
}
