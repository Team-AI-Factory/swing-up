type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const cik = (value: unknown) => /^\d{1,10}$/.test(String(value ?? "")) && Number(value) > 0 ? String(value).padStart(10, "0") : null;
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export const NEGATIVE_EARNINGS_NOTICE = "The company reported negative earnings, so our earnings-based model cannot provide a supported fair value. This alert is based on the event. A price target and percentage return are not yet supported.";
export type NegativeEarningsEvidence = {
  reason: "negative_earnings"; ticker: string; cik: string; metric: "net_income" | "diluted_eps";
  value: number; unit: string; periodEnd: string; filedAt: string; checkedAt: string; sourceUrl: string;
};

/** Verify the exception from an exact issuer's dated financial facts, never a headline or a missing value. */
export function verifiedNegativeEarnings(value: unknown, identity: Json, now = new Date()): NegativeEarningsEvidence | null {
  const proof = object(value), issuer = cik(identity.cik);
  const checked = Date.parse(String(proof.checkedAt ?? "")), filed = Date.parse(String(proof.filedAt ?? "")), end = Date.parse(String(proof.periodEnd ?? ""));
  if (!issuer || proof.reason !== "negative_earnings" || proof.cik !== issuer || proof.ticker !== identity.ticker
    || !["net_income", "diluted_eps"].includes(String(proof.metric)) || !number(proof.value) || proof.value >= 0
    || proof.unit !== (proof.metric === "net_income" ? "USD" : "USD/shares")
    || proof.sourceUrl !== `https://data.sec.gov/api/xbrl/companyfacts/CIK${issuer}.json`
    || ![checked, filed, end].every(Number.isFinite) || end > filed || filed > checked || checked > now.getTime()
    || now.getTime() - checked > 30 * 86400000 || now.getTime() - end > 550 * 86400000) return null;
  return proof as NegativeEarningsEvidence;
}

export function negativeEarningsEvidence(candidate: Json, now = new Date()): NegativeEarningsEvidence | null {
  const fundamentals = object(candidate.fundamentals), issuer = cik(candidate.cik);
  if (!issuer || fundamentals.available !== true || !Array.isArray(fundamentals.items)
    || now.getTime() - Date.parse(String(fundamentals.checkedAt ?? "")) > 30 * 86400000) return null;
  // Prefer the latest period, then net income over EPS for the same period.
  // A later profitable period must not inherit an earlier loss exception.
  const earnings = fundamentals.items.map(object).filter(item => ["net_income", "diluted_eps"].includes(String(item.metric)) && number(item.value))
    .sort((a, b) => String(b.periodEnd).localeCompare(String(a.periodEnd)) || Number(b.metric === "net_income") - Number(a.metric === "net_income"))[0];
  return earnings ? verifiedNegativeEarnings({ ...earnings, reason: "negative_earnings", ticker: candidate.ticker, cik: issuer,
    checkedAt: fundamentals.checkedAt, sourceUrl: fundamentals.sourceUrl }, candidate, now) : null;
}

/** This is a model-work policy, not exclusion from event screening. */
export function hasNegativeEarnings(fundamentals: unknown) {
  const facts = object(fundamentals);
  return (number(facts.dilutedEpsTtm) && facts.dilutedEpsTtm < 0)\n    || (number(facts.netIncome) && facts.netIncome < 0);
}
