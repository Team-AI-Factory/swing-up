import cohort from "@/config/simple-alert-pilot.json";
import { isSimpleAlertPilot } from "@/lib/simple-alert-pilot-runtime";
import { profileCik } from "@/lib/company-profile";

export function pilotCompanies() {
  // This replacement is fixed at 25. Any expansion needs a separate reviewed change.
  if (cohort.companies.length !== 25
    || new Set(cohort.companies.map(row => row.ticker)).size !== cohort.companies.length
    || new Set(cohort.companies.map(row => row.cik)).size !== cohort.companies.length
    || cohort.companies.some(row => !/^[A-Z][A-Z0-9.-]{0,11}$/.test(row.ticker)
      || !/^\d{10}$/.test(row.cik) || row.monitoringEligible !== true
      || row.tenXVerified !== false || row.valuationReady !== false
      || !["existing_evidence_gates_required", "financing_compliance_quarantine"].includes(row.upsidePolicy))
    || cohort.companies.filter(row => row.upsidePolicy === "financing_compliance_quarantine").length !== 1
    || cohort.companies.find(row => row.ticker === "REKR")?.upsidePolicy !== "financing_compliance_quarantine") {
    throw new Error("simple_pilot_cohort_invalid");
  }
  return cohort.companies;
}
export function pilotIncludes(identity: { ticker?: unknown; cik?: unknown }) {
  if (!isSimpleAlertPilot()) return true;
  return pilotCompanies().some(row => row.ticker === identity.ticker
    && (!identity.cik || profileCik(identity.cik) === row.cik));
}
export function pilotSourceEnabled(provider: string) {
  return !isSimpleAlertPilot() || ["sec_broad", "sec_urgent", "trade_halts", "market_watch"].includes(provider);
}

/** A cohort membership is research admission, never a buy or valuation approval.
 * Match either issuer key for the deny rule so malformed aliases cannot clear it. */
export function pilotUpsideBlocker(identity: { ticker?: unknown; cik?: unknown }): string | null {
  if (!isSimpleAlertPilot()) return null;
  const row = pilotCompanies().find(row => row.upsidePolicy === "financing_compliance_quarantine"
    && (row.ticker === String(identity.ticker ?? "").toUpperCase()
      || (profileCik(identity.cik) !== null && row.cik === profileCik(identity.cik))));
  return row ? row.quarantineReason ?? "Pilot financing/compliance quarantine blocks ordinary upside alerts." : null;
}

/** Preserve evidence for monitoring without letting saved or provisional upside
 * records acquire public eligibility. Downside/risk records keep existing gates. */
export function applyPilotResearchAlertPolicy<T extends Record<string, unknown>>(row: T): T {
  const blocker = pilotUpsideBlocker(row);
  if (!blocker || !["buy", "buy_research", "upside"].includes(String(row.action))) return row;
  return { ...row, action: "price_watch", userAlertEligible: false, committeeApproved: false,
    committeeStatus: "not_eligible", publicationStatus: "provisional_alert", monitoringOnly: true,
    upsideBlockedReason: blocker };
}
