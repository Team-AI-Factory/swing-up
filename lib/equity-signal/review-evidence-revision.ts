import crypto from "node:crypto";
import { isSimpleAlertPilot } from "@/lib/simple-alert-pilot-runtime";

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;

/** A new retrieval time or quote tick is not a new financial fact. */
export function reviewEvidenceRevision(evidence: Json, diagnostics = true) {
  const normalized: Json = {
    ...evidence,
    source: (Array.isArray(evidence.source) ? evidence.source : []).map(value => {
      const receipt = object(value);
      // The generated valuation receipt contains the refreshed price and scan
      // time. Its actual model inputs and threshold state are already below.
      return receipt.rawEventType === "valuation_review" ? ["valuation_review"] : [receipt.id, receipt.summary];
    }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    facts: (Array.isArray(evidence.facts) ? evidence.facts : []).map(value => {
      const fact = object(value);
      return [fact.metric, fact.value, fact.unit, fact.periodStart, fact.periodEnd, fact.filedAt, fact.form, fact.concept, fact.accession, fact.sourceUrl];
    }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
  const revision = crypto.createHash("sha256").update(JSON.stringify(stable(normalized))).digest("hex").slice(0, 16);
  if (diagnostics && isSimpleAlertPilot()) {
    // Diagnostic only: preserve the existing revision and admission locks.
    // Fixed labels and digests never expose source text, URLs or financial values.
    try {
      const components: Record<string, string> = {};
      for (const key of ["source", "companyProfile", "industry", "outlookRange", "reviewPolicy", "financialDocuments", "modelAssumptions", "facts", "sourceComplete", "priceReady", "haltKnown", "halted", "valuation"]) {
        if (normalized[key] !== undefined) components[key] = crypto.createHash("sha256")
          .update(JSON.stringify(stable(normalized[key]))).digest("hex").slice(0, 16);
      }
      console.info(`[simple-alert-review-revision] ${JSON.stringify({ version: 1, revision, components })}`);
    } catch { /* Diagnostic failure cannot change review eligibility. */ }
  }
  return revision;
}

/** Durable comparison baseline only. This never changes a review/admission key. */
export function validatedReviewEvidenceSnapshot(value: unknown, identity: { fingerprint: unknown; cik: unknown; direction: unknown }) {
  if (!isSimpleAlertPilot()) return null;
  const snapshot = object(value);
  const evidence = object(snapshot.evidence);
  if (snapshot.version !== 1 || snapshot.fingerprint !== identity.fingerprint
    || snapshot.cik !== identity.cik || snapshot.direction !== identity.direction
    || !/^\d{10}$/.test(String(identity.cik)) || !["upside", "downside", "unknown"].includes(String(identity.direction))
    || !["source", "companyProfile", "industry", "outlookRange", "reviewPolicy", "financialDocuments", "modelAssumptions", "facts", "sourceComplete", "priceReady", "haltKnown", "halted", "valuation"].every(key => Object.hasOwn(evidence, key))) return null;
  const revision = reviewEvidenceRevision(evidence, false);
  if (identity.fingerprint !== `valuation:${identity.cik}:${identity.direction}:${revision}`) return null;
  // Snapshot the actual inputs, retaining original dates, method values and
  // assumptions. No price normalization or repeat-admission relaxation here.
  return { version: 1 as const, fingerprint: identity.fingerprint as string,
    cik: identity.cik as string, direction: identity.direction as string,
    evidence: JSON.parse(JSON.stringify(evidence)) as Json };
}
