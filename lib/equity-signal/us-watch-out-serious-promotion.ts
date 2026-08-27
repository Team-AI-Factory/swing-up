import type { ArticleEvidenceReport, CandidateArticleEvidence } from "@/lib/equity-signal/article-evidence";

type Json = Record<string, unknown>;

export type SeriousWatchOutAlert = {
  ruleId: string;
  ruleName: string;
  priority: "P0" | "P1";
  ticker: string;
  company: string;
  eventFamily: string | null;
  observedAt: string;
  currentPrice: number | null;
  seriousSignal: true;
  action: "watch_out";
  publicationStatus: "serious_internal_review_only";
  notificationEligible: false;
  userApprovedRule: true;
  certificationStatus: "evidence_triggered_user_approved_not_historically_certified";
  reasons: string[];
  evidence: Json;
  duplicateKey: string;
  articleEvidence: CandidateArticleEvidence | null;
};

const MARKET_STRUCTURE_RULES = new Set([
  "liquidity_collapse_or_gap_risk",
  "volatility_regime_spike",
]);

const NO_ARTICLE_REQUIRED_RULES = new Set([
  ...MARKET_STRUCTURE_RULES,
  "source_contradiction_or_data_integrity_failure",
]);

const QUOTE_OPTIONAL_RULES = new Set([
  "trading_halt_or_resumption",
  "delisting_or_exchange_compliance",
  "source_contradiction_or_data_integrity_failure",
]);

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function articleForFinding(report: ArticleEvidenceReport, finding: Json) {
  const ticker = text(finding.ticker)?.toUpperCase();
  const family = text(finding.eventFamily);
  const observedAt = text(finding.observedAt)?.slice(0, 13);
  return Object.values(report.candidates).find((candidate) => candidate.ticker === ticker
    && (!family || candidate.eventFamily === family)
    && (!observedAt || candidate.key.includes(observedAt))) ?? null;
}

export function promoteApprovedWatchOutRules(input: {
  watchOutReview: unknown;
  articleEvidence: ArticleEvidenceReport;
}) {
  const review = object(input.watchOutReview);
  const marketScan = object(review.marketStructureScan);
  const marketScanComplete = (finite(marketScan.pagesFailed) ?? 1) === 0
    && (finite(marketScan.usPrimaryListingsChecked) ?? 0) >= 5_000;
  const findings = (Array.isArray(review.findings) ? review.findings : []).map(object);
  const seriousSignals: SeriousWatchOutAlert[] = [];
  const blocked: Array<{ ticker: string; ruleId: string; reasons: string[] }> = [];

  for (const finding of findings) {
    const ruleId = text(finding.ruleId) ?? "unknown";
    const evidence = object(finding.evidence);
    const ticker = text(finding.ticker)?.toUpperCase() ?? "";
    const currentPrice = finite(finding.currentPrice);
    const eventAgeHours = finite(evidence.eventAgeHours);
    const quoteAgeHours = finite(evidence.quoteAgeHours);
    const contradictionPenalty = finite(evidence.contradictionPenalty) ?? 0;
    const articleEvidence = articleForFinding(input.articleEvidence, finding);
    const isMarketRule = MARKET_STRUCTURE_RULES.has(ruleId);
    const articleRequired = !NO_ARTICLE_REQUIRED_RULES.has(ruleId);
    const quoteRequired = !QUOTE_OPTIONAL_RULES.has(ruleId);
    const checks = {
      marketScanComplete: !isMarketRule || marketScanComplete,
      approvedPriority: finding.priority === "P0" || finding.priority === "P1",
      exactIssuerMapping: evidence.exactIssuerMapping === true,
      primaryOrIndependentProof: evidence.primaryOrIndependentProof === true,
      freshEvent: eventAgeHours === null || eventAgeHours <= 168,
      freshQuote: !quoteRequired || (currentPrice !== null && currentPrice > 0 && quoteAgeHours !== null && quoteAgeHours <= 24),
      noRumour: evidence.noRumour === true,
      contradictionPolicy: ruleId === "source_contradiction_or_data_integrity_failure" ? contradictionPenalty >= 50 : contradictionPenalty < 50,
      fullArticleOrOfficialContent: !articleRequired || articleEvidence?.decisionGrade === true,
      noSyntheticData: evidence.noSyntheticData === true,
    };
    const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    if (failures.length) {
      blocked.push({ ticker, ruleId, reasons: failures });
      continue;
    }
    seriousSignals.push({
      ruleId,
      ruleName: text(finding.ruleName) ?? ruleId,
      priority: finding.priority === "P1" ? "P1" : "P0",
      ticker,
      company: text(finding.company) ?? ticker,
      eventFamily: text(finding.eventFamily),
      observedAt: text(finding.observedAt) ?? new Date().toISOString(),
      currentPrice,
      seriousSignal: true,
      action: "watch_out",
      publicationStatus: "serious_internal_review_only",
      notificationEligible: false,
      userApprovedRule: true,
      certificationStatus: "evidence_triggered_user_approved_not_historically_certified",
      reasons: [
        ...(Array.isArray(finding.reasons) ? finding.reasons.filter((item): item is string => typeof item === "string") : []),
        "This P0/P1 Watch Out rule was explicitly approved for serious internal promotion by the user.",
        articleRequired ? "The full article or detailed official source confirmed the material event; the headline alone was not used." : "This rule is based on complete live market-structure or contradiction evidence rather than an article headline.",
      ],
      evidence: { ...evidence, promotionChecks: checks },
      duplicateKey: text(finding.duplicateKey) ?? `${ruleId}:${ticker}`,
      articleEvidence,
    });
  }

  return {
    ...review,
    policyVersion: 2,
    newRulesPromotionMode: "serious_internal_user_approved_evidence_rules",
    seriousSignalsFromNewRules: seriousSignals.length,
    seriousSignals,
    blockedPromotionCandidates: blocked,
    certificationDisclosure: "P0/P1 findings are serious evidence-triggered Watch Out alerts under the user-approved policy. They are not represented as historically certified unless a separate certificate exists.",
    safety: {
      databaseWrites: false,
      publishing: false,
      notifications: false,
      seriousSignalPromotion: true,
      noSyntheticData: true,
    },
  };
}
