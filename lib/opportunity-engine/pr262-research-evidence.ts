import { completeCommitteeReview, committeeRequestsRejectedWithoutUsage } from "@/lib/ai-committee/review-policy";
import { readCompanyProfiles } from "@/lib/opportunity-engine/company-profile-cache";
import { verifiedCompanyProfile, profileCik } from "@/lib/company-profile";
import crypto from "node:crypto";
import { evidenceTiming, summarizeEvidenceQuality } from "@/lib/opportunity-engine/pr262-evidence-metrics";
import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";
import { explainCandidate, plainEvidenceGaps } from "@/lib/signal-explanation";
import { alertDetails, completePriceOutlook, industryLabel } from "@/lib/alert-details";
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
  if (parseInt(hash(eventId).slice(0, 4), 16) % 10 !== 0) return null;
  const key = `${ROOT}/rejection-audit/${now.toISOString().slice(0, 10)}/paid-sample-reservation.json`;
  const reservationId = crypto.randomUUID();
  for (let attempt = 0; attempt < 4; attempt++) {
    const saved = await readVersionedTextFromR2(key);
    const previous = saved.found && saved.text ? object(JSON.parse(saved.text)) : {};
    // Legacy reservations may already represent a paid call. Only explicitly
    // released or expired, uncommitted leases may be reused.
    if (saved.found && (previous.status !== "released"
      && !(previous.status === "pending" && Date.parse(text(previous.expiresAt)) <= now.getTime()))) return null;
    if (saved.found && !saved.etag) return null;
    const result = await writeVersionedJsonToR2(key, { version: 2, eventId, reservationId,
      status: "pending", reservedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(), maximumPerDay: 1,
    }, saved.etag ? { expectedEtag: saved.etag } : { createOnly: true });
    if (result.conflict) continue;
    if (!result.written) return null;
    const transition = async (status: "committed" | "released", checkedAt: Date) => {
      const current = await readVersionedTextFromR2(key);
      const value = current.found && current.text ? object(JSON.parse(current.text)) : {};
      if (!current.etag || value.reservationId !== reservationId || value.status !== "pending") return false;
      if (status === "committed" && (Date.parse(text(value.expiresAt)) <= checkedAt.getTime()
        || checkedAt.toISOString().slice(0, 10) !== now.toISOString().slice(0, 10))) return false;
      const changed = await writeVersionedJsonToR2(key, { ...value, status, updatedAt: checkedAt.toISOString() }, { expectedEtag: current.etag });
      return changed.written === true && !changed.conflict;
    };
    return {
      commit: (checkedAt: Date) => transition("committed", checkedAt),
      release: async (checkedAt: Date) => { await transition("released", checkedAt); },
    };
  }
  return null;
}

export async function readResearchAlerts(): Promise<Json[]> {
  const stored = await readVersionedTextFromR2(RESEARCH_ALERT_INDEX_KEY);
  if (!stored.found || !stored.text) return [] as Json[];
  const body = object(JSON.parse(stored.text));
  const rows = Array.isArray(body.alerts) ? body.alerts.map(object).slice(0, 100) : [];
  const profiles = await readCompanyProfiles(rows).catch(() => new Map());
  return rows.map(row => {
    const profile = profiles.get(String(row.ticker));
    return profile && profile.company === row.company && profileCik(row.cik) === profile.cik
      ? { ...row, cik: profile.cik, companyProfile: profile, industry: industryLabel(row.industry, profile.industry) } : row;
  });
}

export function isResearchAlertCurrent(alert: Json, nowMs = Date.now()) {
  // Collection attempts update the card, but cannot renew the underlying evidence.
  const observedAt = alert.kind === "valuation"
    ? alert.valuationObservedAt ?? alert.eventObservedAt
    : alert.eventObservedAt;
  const observedMs = Date.parse(text(observedAt));
  const ageMs = nowMs - observedMs;
  return Number.isFinite(observedMs) && ageMs >= 0
    && ageMs <= (alert.kind === "valuation" ? 24 : 72) * 3600000;
}

export async function readEvidenceQuality(now = new Date()) {
  const stored = await readVersionedTextFromR2(`${ROOT}/quality/${now.toISOString().slice(0, 10)}.json`);
  if (!stored.found || !stored.text) return { available: false as const };
  const value = object(JSON.parse(stored.text));
  const samples = Array.isArray(value.samples) ? value.samples.map(object) : [];
  const summary = summarizeEvidenceQuality(samples);
  const reviewed = samples.filter(row => typeof object(row.timing).eventToFirstCommitteeMinutes === "number");
  return { available: true as const, updatedAt: text(value.updatedAt), uniqueEvents: samples.length,
    scope: "Latest evidence assessments for up to 500 unique events in the UTC day; excludes events not yet assessed. This is not a whole-universe success rate.",
    ...summary,
    missingFieldCounts: object(value.missingFieldCounts),
    averageMinutesToFirstReview: reviewed.length ? Math.round(reviewed.reduce((sum, row) => sum + Number(object(row.timing).eventToFirstCommitteeMinutes), 0) / reviewed.length) : null,
  };
}

export function evidenceTasks(report: Json) {
  const gaps = [...new Set([...(Array.isArray(report.blockers) ? report.blockers : []),
    ...(Array.isArray(object(report.researchReview).gaps) ? object(report.researchReview).gaps as unknown[] : []),
    ...(Array.isArray(object(object(report.committee).output).missingEvidence) ? object(object(report.committee).output).missingEvidence as unknown[] : [])]
    .filter((x): x is string => typeof x === "string"))];
  const joined = gaps.join(" ");
  const financialPatterns = Object.entries({ revenue: /revenue|sales/i, diluted_eps: /\beps\b|earnings per share/i,
    operating_cash_flow: /cash flow|cash generation/i, capital_expenditure: /capex|capital expenditure/i,
    long_term_debt_noncurrent: /debt|leverage/i, shares_outstanding: /shares|dilution/i,
    net_income: /net income|net profit/i, assets: /assets/i, liabilities: /liabilities/i,
  });
  const financialMetrics = financialPatterns.filter(([, pattern]) => pattern.test(joined)).map(([metric]) => metric);
  const comparativeMetrics = financialPatterns.filter(([, pattern]) => gaps.some(gap => pattern.test(gap)
    && /prior[- ]year|year[- ]over[- ]year|\byoy\b|same (?:quarter|period) last year/i.test(gap))).map(([metric]) => `${metric}_prior_year`);
  const candidate = object(report.selectedCandidate);
  const safeUrl = (value: unknown) => {
    try { const url = new URL(text(value)); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null; } catch { return null; }
  };
  const receiptIds = new Set((Array.isArray(candidate.receipts) ? candidate.receipts : []).map(item => text(object(item).id)).filter(Boolean));
  const documents = (Array.isArray(object(report.secFilingDetails).items) ? object(report.secFilingDetails).items as unknown[] : []).map(object)
    .filter(item => !receiptIds.size || receiptIds.has(text(item.receiptId))).slice(0, 3).map(item => ({
    filingUrl: safeUrl(item.indexUrl), primaryDocumentUrl: safeUrl(item.primaryDocumentUrl), exhibitDocumentUrl: safeUrl(item.exhibitDocumentUrl),
    requiredExhibitType: text(item.requiredExhibitType) || null,
    exhibitStatus: text(item.eventExhibitStatus) || "not_assessed", failureReason: text(item.errorCategory) || null,
  }));
  const documentAction = documents.some(item => item.exhibitStatus === "download_failed")
    ? "Retry the exact required exhibit URL whose download failed."
    : documents.some(item => item.exhibitStatus === "required_not_found")
      ? "Resolve the named required exhibit from the exact filing index or its primary-document links."
      : documents.length && documents.every(item => item.exhibitStatus === "not_required")
        ? "Retrieve the exact primary filing; no event exhibit is required by the source."
        : "Retrieve the exact source document and assess any explicitly referenced required exhibit.";
  return { gaps: gaps.slice(0, 20), tasks: [
    ...(/company profile|products or services|customers|industry|classification/i.test(joined) ? [{ type: "company_profile", action: "Retrieve the exact issuer's business description, customers and SEC industry classification before publication.", complete: false }] : []),
    ...(/valuation|forecast range|currency/i.test(joined) ? [{ type: "valuation_inputs", action: "Refresh this issuer's financial model and currency; require a supported three-case price range. Do not invent a target.", ticker: text(candidate.ticker), complete: false }] : []),
    ...(/source|filing|exhibit|proof|Truth/i.test(joined) ? [{ type: "source_document", action: documentAction, documents, sourceUrls: (Array.isArray(candidate.receipts) ? candidate.receipts : []).map(item => safeUrl(object(item).url)).filter(Boolean).slice(0, 3), complete: false }] : []),
    ...(/fundamental|magnitude|material|financial|revenue/i.test(joined) || financialMetrics.length ? [{ type: "financial_facts", action: comparativeMetrics.length ? "Retrieve dated current and comparable prior-year facts with the same reporting duration." : "Refresh dated company facts and compare the event's size with the company.", fields: [...financialMetrics, ...comparativeMetrics], comparison: comparativeMetrics.length ? "prior_year_same_duration" : null, complete: false }] : []),
    ...(/price|quote|market|halt/i.test(joined) ? [{ type: "market_evidence", action: "Refresh the price observation and trading-halt check.", ticker: text(candidate.ticker), fields: ["price", "observedAt", "marketSession", "tradingHaltState"], previousObservationAt: text(object(candidate.quote).observedAt) || null, complete: false }] : []),
    ...(/direction|causal|transmission/i.test(joined) ? [{ type: "business_effect", action: "Reassess the effect on income, costs or ownership using the retrieved documents.", complete: false }] : []),
  ] };
}

export async function recordResearchEvidence(input: { event: Json; report: Json; companyAnalysis?: Json; sourceDecisionGrade: boolean; sourceFailureReason: string | null; now: Date; approvedResultKey?: string; collectionTiming?: Json }) {
  const { event, report, now } = input;
  const candidate = object(report.selectedCandidate);
  const committee = object(report.committee);
  const output = object(committee.output);
  const screeningRejected = report.status === "candidate_valuation_risk_rejected";
  const paid = report.openAiCalled === true;
  const eventId = text(event.id);
  const nextEvidenceCheckAt = new Date(now.getTime() + 15 * 60_000).toISOString();
  const previousFollowup = await readEvidenceFollowup(eventId);
  const previousReview = paid ? {} : previousFollowup;
  const requestedTasks = evidenceTasks({ ...report, blockers: [
    ...(Array.isArray(previousReview.gaps) ? previousReview.gaps : []),
    ...(Array.isArray(report.blockers) ? report.blockers : []),
  ] });
  const requiredFinancialFields = requestedTasks.tasks.flatMap(task => task.type === "financial_facts" && "fields" in task ? task.fields : []);
  const financialItems = Array.isArray(object(candidate.fundamentals).items) ? object(candidate.fundamentals).items as unknown[] : [];
  const financialFactsRequired = ["valuation_gap", "earnings_guidance", "financing_dilution", "contract_award", "merger_acquisition"].includes(String(candidate.eventFamily)) || requiredFinancialFields.length > 0;
  const details = alertDetails(candidate, input.companyAnalysis, now);
  const completeness = {
    companyProfile: Boolean(verifiedCompanyProfile(candidate.companyProfile, candidate, now)),
    industry: Boolean(details.industry), priceScenarios: completePriceOutlook(details.outlook),
    issuer: Boolean((candidate.ticker ?? event.ticker) && (candidate.cik ?? event.cik)), sourceDocument: input.sourceDecisionGrade,
    financialFacts: !financialFactsRequired || (object(candidate.fundamentals).available === true
      && requiredFinancialFields.every(metric => financialItems.some(item => object(item).metric === metric))),
    marketPrice: Boolean(object(candidate.quote).price), currentMarketPrice: object(candidate.quote).actionableForSeriousSignal === true,
    direction: candidate.direction === "upside" || candidate.direction === "downside",
    tradingHaltCheck: object(report.tradingHaltSafety).currentStateKnown === true,
  };
  const applicableFields = Object.entries(completeness).filter(([field]) => field !== "priceScenarios" || !details.valuationException);
  const requiredFieldCount = applicableFields.length;
  const known = applicableFields.filter(([, complete]) => complete).length;
  const collectionGaps = [
    ...details.missing,
    ...(!completeness.companyProfile ? ["A verified company profile with products or services and customers is required."] : []),
    ...(!completeness.sourceDocument ? ["The source document or required filing exhibit is incomplete."] : []),
    ...(!completeness.financialFacts ? ["Verified financial fundamentals are missing."] : []),
    ...(!completeness.marketPrice || !completeness.currentMarketPrice ? ["A current market price observation is needed."] : []),
    ...(!completeness.direction ? ["The causal business effect and investment direction need more evidence."] : []),
    ...(!completeness.tradingHaltCheck ? ["Current trading-halt verification is needed."] : []),
  ];
  const tasks = evidenceTasks({ ...report, blockers: [
    ...requestedTasks.gaps, ...collectionGaps,
  ] });
  const timing = evidenceTiming({ event, candidate, committee, previous: object(object(previousFollowup.quality).timing), collection: input.collectionTiming, paid, now });
  const quality = { fields: completeness, availableFields: known, requiredFields: requiredFieldCount,
    applicability: { financialFacts: financialFactsRequired, priceScenarios: !details.valuationException },
    valuationException: details.valuationException ? "verified_negative_earnings_event" : null,
    committeeCompleted: completeCommitteeReview(committee),
    reviewOutcome: completeCommitteeReview(committee)
      ? output.overallRecommendation === "approve" ? "approved" : output.overallRecommendation === "reject" ? "rejected" : "incomplete_evidence"
      : paid && Number(committee.agentsFailed) > 0 ? "technical_failure"
      : report.status === "qualified_signal_openai_reservation_denied" || report.status === "qualified_signal_openai_not_requested" ? "budget_deferred"
      : known < requiredFieldCount ? "incomplete_evidence" : "awaiting_review",
    completenessPercent: Math.round(known / requiredFieldCount * 100),
    evidenceAgeMinutes: timing.sourceAgeMinutes,
    timing,
    eventToReviewMinutes: timing.eventToFirstCommitteeMinutes,
    sourceFailureReason: input.sourceFailureReason, committeeRolesCompleted: Number(committee.agentsCompleted ?? 0),
  };
  const collectionComplete = known === requiredFieldCount
    && (report.status === "qualified_signal_openai_reservation_denied" || report.status === "qualified_signal_openai_not_requested");
  const needsFollowup = !collectionComplete && (paid || previousFollowup.status === "collecting_evidence" || Boolean(candidate.ticker && known < requiredFieldCount)) && report.seriousSignalFound !== true && output.overallRecommendation !== "reject";
  if (needsFollowup) {
    const key = `${ROOT}/followups/${hash(eventId)}.json`;
    const current = await readVersionedTextFromR2(key);
    await writeVersionedJsonToR2(key, { version: 1, eventId, ticker: event.ticker, updatedAt: now.toISOString(),
      status: "collecting_evidence", nextEvidenceCheckAt,
      paidReviewNotBefore: paid ? new Date(now.getTime() + (committeeRequestsRejectedWithoutUsage(committee) ? 5 * 60000 : 86400000)).toISOString() : previousReview.paidReviewNotBefore,
      candidateFingerprint: paid ? report.candidateFingerprint : previousReview.candidateFingerprint,
      gaps: paid ? tasks.gaps : previousReview.gaps ?? tasks.gaps,
      tasks: tasks.tasks, quality,
      lastCollectionAt: now.toISOString(), evidenceChanged: Boolean(previousFollowup.candidateFingerprint && previousFollowup.candidateFingerprint !== report.candidateFingerprint),
    }, current.etag ? { expectedEtag: current.etag } : { createOnly: true });
  }
  if (previousFollowup.status === "collecting_evidence" && collectionComplete && output.overallRecommendation !== "reject") {
    const key = `${ROOT}/followups/${hash(eventId)}.json`;
    const current = await readVersionedTextFromR2(key);
    await writeVersionedJsonToR2(key, { ...previousFollowup, status: "awaiting_committee_capacity",
      updatedAt: now.toISOString(), lastCollectionAt: now.toISOString(), nextEvidenceCheckAt: null, quality },
      current.etag ? { expectedEtag: current.etag } : { createOnly: true });
  }
  if ((previousFollowup.status === "collecting_evidence" || previousFollowup.status === "awaiting_committee_capacity") && (output.overallRecommendation === "reject" || input.approvedResultKey)) {
    const key = `${ROOT}/followups/${hash(eventId)}.json`;
    const current = await readVersionedTextFromR2(key);
    await writeVersionedJsonToR2(key, { ...previousFollowup, status: output.overallRecommendation === "reject" ? "rejected" : "completed",
      updatedAt: now.toISOString(), nextEvidenceCheckAt: null, quality }, current.etag ? { expectedEtag: current.etag } : { createOnly: true });
  }
  // A bounded, deterministic sample exposes false negatives without storing every routine scan.
  const auditKey = `${ROOT}/rejection-audit/${now.toISOString().slice(0, 10)}/${hash(eventId)}.json`;
  let savedAudit = await readVersionedTextFromR2(auditKey);
  const auditSample = savedAudit.found || report.rejectionAuditReview === true
    || (report.status === "no_qualified_signal" && parseInt(hash(eventId).slice(0, 4), 16) % 10 === 0);
  if (auditSample) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const previous = savedAudit.found && savedAudit.text ? object(JSON.parse(savedAudit.text)) : {};
      const completedReview = paid && committee.ok === true && completeCommitteeReview(committee) && Number(committee.agentsFailed) === 0
        && ["approve", "reject", "needs_more_data"].includes(text(output.overallRecommendation));
      const result = await writeVersionedJsonToR2(auditKey, {
        ...previous, version: 2, eventId, ticker: event.ticker, checkedAt: now.toISOString(),
        sampledAt: previous.sampledAt ?? previous.checkedAt ?? now.toISOString(), reason: previous.reason ?? report.noSignalReason ?? null,
        selectedForAudit: report.rejectionAuditReview === true || previous.selectedForAudit === true,
        committeeAttempted: paid || previous.committeeAttempted === true,
        // Admission and budget reservations cannot stand in for a completed review.
        committeeAudited: completedReview || (previous.version === 2 && previous.committeeAudited === true),
        reviewedAt: completedReview ? now.toISOString() : previous.reviewedAt ?? null,
        reviewOutcome: completedReview ? output.overallRecommendation : previous.version === 2 ? previous.reviewOutcome ?? null : null,
        lastAttempt: paid ? { checkedAt: now.toISOString(), status: committee.status ?? report.status ?? null,
          agentsCompleted: Number(committee.agentsCompleted ?? 0), agentsFailed: Number(committee.agentsFailed ?? 0),
          recommendation: output.overallRecommendation ?? null,
          roleDiagnostics: Array.isArray(committee.roleDiagnostics) ? committee.roleDiagnostics : [],
        } : previous.lastAttempt ?? null,
        candidate: candidate.ticker ? [candidate] : (Array.isArray(report.rankedCandidates) ? report.rankedCandidates : []).slice(0, 1), quality,
        reconsideration: "Sample retained for false-negative review; exact identity and substantive source are still required.",
      }, savedAudit.etag ? { expectedEtag: savedAudit.etag } : { createOnly: true });
      if (!result.conflict) {
        if (!result.written) throw new Error("rejection_audit_write_failed");
        break;
      }
      if (attempt === 3) throw new Error("rejection_audit_write_conflict");
      savedAudit = await readVersionedTextFromR2(auditKey);
    }
  }
  if (candidate.ticker && (report.seriousSignalFound !== true || input.approvedResultKey)) {
    const approved = details.complete && Boolean(input.approvedResultKey) && report.seriousSignalFound === true && completeCommitteeReview(committee) && Number(committee.agentsFailed) === 0 && output.overallRecommendation === "approve";
    const alert = { id: hash(eventId), eventId, createdAt: now.toISOString(), eventObservedAt: event.observedAt,
      ticker: candidate.ticker, company: candidate.company, cik: candidate.cik, companyProfile: candidate.companyProfile ?? null, action: candidate.direction === "upside" ? "buy" : candidate.direction === "downside" ? "sell" : "watch_out",
      valuationObservedAt: input.companyAnalysis?.observedAt ?? null,
      reviewEvidenceFingerprint: candidate.evidenceFingerprint ?? report.candidateFingerprint ?? null,
      eventHeadline: candidate.eventHeadline, kind: candidate.eventFamily === "valuation_gap" ? "valuation" : "event",
      currentPrice: object(candidate.quote).price ?? null, priceObservedAt: object(candidate.quote).observedAt ?? null,
      currency: input.companyAnalysis?.currency ?? candidate.currency ?? null,
      industry: details.industry, sector: input.companyAnalysis?.sector ?? candidate.sector ?? null,
      eventFamily: candidate.eventFamily, outlook: details.outlook,
      fairValue: object(input.companyAnalysis?.fairValue).baseValue ?? null,
      userAlertEligible: details.complete && !screeningRejected && output.overallRecommendation !== "reject", committeeApproved: approved,
      committeeStatus: screeningRejected ? "not_eligible" : approved ? "approved" : output.overallRecommendation === "reject" ? "rejected" : output.overallRecommendation === "approve" ? "approved_pending_checks" : needsFollowup ? "needs_more_data" : "awaiting_review",
      committee: { completed: Number(committee.agentsCompleted ?? 0), failed: Number(committee.agentsFailed ?? 0), confidence: object(committee.finalJudge).confidence ?? null },
      publicationStatus: approved ? "committee_approved_alert" : "provisional_alert",
      explanation: { ...explainCandidate(candidate, input.companyAnalysis), missingInformation: plainEvidenceGaps(paid ? tasks.gaps : Array.isArray(previousReview.gaps) ? previousReview.gaps as string[] : tasks.gaps) },
      followup: approved || output.overallRecommendation === "reject" ? null : { status: needsFollowup ? "collecting_evidence" : "awaiting_committee_capacity", nextEvidenceCheckAt: needsFollowup ? nextEvidenceCheckAt : null, tasks: tasks.tasks }, quality,
      sources: (Array.isArray(candidate.receipts) ? candidate.receipts : []).map(object).flatMap(r => {
        try { const u = new URL(text(r.url)); if (u.protocol !== "https:" || u.username || u.password) return []; u.search = ""; return [{ label: text(r.publisher), url: u.toString() }]; } catch { return []; }
      }).slice(0, 4),
    };
    for (let i = 0; i < 4; i++) {
      const current = await readVersionedTextFromR2(RESEARCH_ALERT_INDEX_KEY);
      const prior = current.found && current.text ? object(JSON.parse(current.text)) : {};
      const rows = Array.isArray(prior.alerts) ? prior.alerts.map(object) : [];
      const previous = rows.find(x => x.id === alert.id);
      if (!paid && previous && !screeningRejected && output.overallRecommendation !== "reject" && !input.approvedResultKey) {
        alert.committee = previous.committee as typeof alert.committee;
        const sameReviewedSnapshot = previous.currentPrice === alert.currentPrice
          && previous.priceObservedAt === alert.priceObservedAt
          && previous.valuationObservedAt === alert.valuationObservedAt
          && previous.reviewEvidenceFingerprint === alert.reviewEvidenceFingerprint
          && Boolean(alert.reviewEvidenceFingerprint)
          && details.complete;
        alert.committeeApproved = sameReviewedSnapshot && previous.committeeApproved === true;
        alert.committeeStatus = previous.committeeApproved === true && !sameReviewedSnapshot ? "awaiting_review" : collectionComplete && previous.committeeApproved !== true
          ? "awaiting_review"
          : needsFollowup && previous.committeeStatus === "awaiting_review" ? "needs_more_data" : text(previous.committeeStatus);
        alert.publicationStatus = alert.committeeApproved ? "committee_approved_alert" : "provisional_alert";
        alert.userAlertEligible = details.complete && previous.committeeStatus !== "rejected";
        if (["rejected", "not_eligible"].includes(String(previous.committeeStatus))) {
          alert.committeeApproved = false;
          alert.committeeStatus = String(previous.committeeStatus);
          alert.publicationStatus = "provisional_alert";
          alert.userAlertEligible = false;
        }
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
    const next = [{ eventId, checkedAt: now.toISOString(), ...quality, eventToReviewMinutes: previous?.eventToReviewMinutes ?? quality.eventToReviewMinutes, paidReview: paid || previous?.paidReview === true, rejectionAuditSampled: auditSample || previous?.rejectionAuditSampled === true }, ...samples.filter(row => row.eventId !== eventId)].slice(0, 500);
    const written = await writeVersionedJsonToR2(metricKey, { version: 1, updatedAt: now.toISOString(), samples: next,
      events: next.length, ...summarizeEvidenceQuality(next),
      missingFieldCounts: Object.fromEntries(Object.keys(completeness).map(field => [field, next.filter(row => object(row.fields)[field] !== true).length])),
    }, saved.etag ? { expectedEtag: saved.etag } : { createOnly: true });
    if (!written.conflict) {
      if (!written.written) throw new Error("evidence_quality_write_failed");
      break;
    }
    if (i === 3) throw new Error("evidence_quality_write_conflict");
  }
  return { quality, rejectionAuditSampled: auditSample, evidenceFollowupScheduled: needsFollowup, nextEvidenceCheckAt };
}
