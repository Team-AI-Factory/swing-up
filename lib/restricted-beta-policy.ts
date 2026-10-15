import { sameCompanyName } from "@/lib/company-profile";
import { isSimpleAlertPilot } from "@/lib/simple-alert-pilot-runtime";
import { pilotIncludes, pilotCompanies } from "@/lib/simple-alert-pilot-scope";

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
export const RESTRICTED_BETA_POLICY = "direct-company-beta-2026-10-15-v1";

/** Scope only. Passing this check cannot approve evidence, a review or delivery.
 * Saved packets are untrusted JSON and must prove the same scope as new ones. */
export function restrictedBetaScopeBlocker(value: unknown): string | null {
  if (!isSimpleAlertPilot()) return null;
  const candidate = object(value);
  if (!/^\d{10}$/.test(String(candidate.cik ?? "")) || !pilotIncludes(candidate)
    || !pilotCompanies().some(row => row.ticker === candidate.ticker && row.cik === candidate.cik && sameCompanyName(row.company, candidate.company))) return "Parked for restricted beta: the exact issuer is outside the approved 25-company pilot.";
  if (candidate.relationship !== "direct") return "Parked for restricted beta: indirect supplier, sector and macro opportunities are outside the direct-company scope.";
  // Valuation remains a separately identified, source-reconciled company case;
  // it must never be described as a newly verified announcement.
  if (candidate.eventFamily === "valuation_gap") return null;
  const directFamilies = new Set(["earnings_guidance", "contract_award", "merger_acquisition", "financing_dilution", "regulatory_enforcement"]);
  if (!directFamilies.has(String(candidate.eventFamily))) return "Parked for restricted beta: this event family is outside the initial direct, quantified company-event scope.";
  const metricKinds: Record<string, string[]> = {
    earnings_guidance: ["guidance_change_percent"], financing_dilution: ["offering_value", "offering_shares", "dilution_percent"],
    regulatory_enforcement: ["fine_value"], contract_award: ["contract_value"], merger_acquisition: ["transaction_value"],
  };
  const metrics = object(candidate.eventMagnitude).metrics, receipts = candidate.receipts;
  const verifiedQuantity = Array.isArray(metrics) && Array.isArray(receipts) && metrics.map(object).some(metric => metric.promotionEvidenceVerified === true
    && metricKinds[String(candidate.eventFamily)].includes(String(metric.kind))
    && typeof metric.value === "number" && Number.isFinite(metric.value) && metric.value > 0
    && typeof metric.sourceReceiptId === "string" && typeof metric.sourceUrl === "string"
    && receipts.map(object).some(receipt => receipt.id === metric.sourceReceiptId && receipt.url === metric.sourceUrl
      && (receipt.official === true || receipt.primarySource === true)));
  if (!verifiedQuantity) return "Parked for restricted beta: a source-bound, verified event quantity is still missing. A headline or score cannot replace it.";
  return null;
}
