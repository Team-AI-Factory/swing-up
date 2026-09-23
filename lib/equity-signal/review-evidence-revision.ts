import crypto from "node:crypto";

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;

/** A new retrieval time or quote tick is not a new financial fact. */
export function reviewEvidenceRevision(evidence: Json) {
  const normalized = {
    ...evidence,
    source: (Array.isArray(evidence.source) ? evidence.source : []).map(value => {
      const receipt = object(value);
      // The generated valuation receipt contains the refreshed price and scan
      // time. Its actual model inputs and threshold state are already below.
      return [receipt.id, receipt.rawEventType === "valuation_review" ? "valuation_review" : receipt.summary];
    }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    facts: (Array.isArray(evidence.facts) ? evidence.facts : []).map(value => {
      const fact = object(value);
      return [fact.metric, fact.value, fact.unit, fact.periodStart, fact.periodEnd, fact.filedAt, fact.form];
    }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
  return crypto.createHash("sha256").update(JSON.stringify(stable(normalized))).digest("hex").slice(0, 16);
}
