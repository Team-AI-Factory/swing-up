export type Pr262ReviewBlocker = "missing_profile" | "missing_price_scenarios" | "missing_industry"
  | "committee_disabled" | "same_evidence" | "ai_budget" | "review_capacity"
  | "ai_provider" | "accounting_unavailable" | "reservation_unclassified";

const DAY_MS = 24 * 60 * 60_000;

/** Name evidence gaps precisely so unchanged daily inputs can remain parked. */
export function pr262EvidenceBlocker(reportStatus: string, fields: Record<string, unknown>): Pr262ReviewBlocker | null {
  if (reportStatus === "candidate_company_profile_pending") return "missing_profile";
  if (reportStatus !== "candidate_alert_details_pending") return null;
  if (fields.priceScenarios === false) return "missing_price_scenarios";
  if (fields.industry === false) return "missing_industry";
  return null;
}

/** Scenario and classification inputs refresh on the existing daily foundation pass. */
export function pr262EvidenceRetryAt(blocker: Pr262ReviewBlocker | null, now: Date): string | null {
  return blocker === "missing_price_scenarios" || blocker === "missing_industry"
    ? new Date(now.getTime() + DAY_MS).toISOString()
    : null;
}

/** Keep duplicate protection separate from money, provider access and bookkeeping failures. */
export function pr262ReservationBlocker(reason: string | null | undefined): Pr262ReviewBlocker {
  if (reason === "committee_disabled") return "committee_disabled";
  if (["candidate_already_recorded", "candidate_already_reserved", "same_evidence", "paid_evidence_cooldown"].includes(reason ?? "")) return "same_evidence";
  if (reason === "daily_cost_fuse") return "ai_budget";
  if (reason === "daily_review_limit") return "review_capacity";
  if (reason === "provider_cooldown" || reason === "provider_access") return "ai_provider";
  if (reason === "accounting_unavailable") return "accounting_unavailable";
  return "reservation_unclassified";
}

export function pr262QueueBlocker(error: string | null | undefined): Pr262ReviewBlocker | null {
  const value = error ?? "";
  if (value.includes("candidate_company_profile_pending")) return "missing_profile";
  const explicit = value.match(/:blocker=(missing_price_scenarios|missing_industry|committee_disabled|same_evidence|ai_budget|review_capacity|ai_provider|accounting_unavailable|reservation_unclassified)(?=[:;\s]|$)/)?.[1];
  if (explicit) return explicit as Pr262ReviewBlocker;
  // Older generic denials do not prove either a budget shortage or a duplicate.
  if (/qualified_signal_openai_reservation_denied/.test(value)) return "reservation_unclassified";
  return null;
}
