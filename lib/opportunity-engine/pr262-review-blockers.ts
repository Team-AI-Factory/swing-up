export type Pr262ReviewBlocker = "missing_profile" | "same_evidence" | "ai_budget" | "review_capacity"
  | "ai_provider" | "accounting_unavailable" | "reservation_unclassified";

/** Keep duplicate protection separate from money, provider access and bookkeeping failures. */
export function pr262ReservationBlocker(reason: string | null | undefined): Pr262ReviewBlocker {
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
  const explicit = value.match(/:blocker=(same_evidence|ai_budget|review_capacity|ai_provider|accounting_unavailable|reservation_unclassified)(?=[:;\s]|$)/)?.[1];
  if (explicit) return explicit as Pr262ReviewBlocker;
  // Older generic denials do not prove either a budget shortage or a duplicate.
  if (/qualified_signal_openai_reservation_denied/.test(value)) return "reservation_unclassified";
  return null;
}
