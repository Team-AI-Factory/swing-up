import cohort from "@/config/simple-alert-pilot.json";
import { isSimpleAlertPilot } from "@/lib/simple-alert-pilot-runtime";
import { profileCik } from "@/lib/company-profile";

export function pilotCompanies() {
  // Expanding the checked-in cohort requires the documented observation gates.
  if (![25, 50].includes(cohort.companies.length)
    || new Set(cohort.companies.map(row => row.ticker)).size !== cohort.companies.length) {
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
