import crypto from "node:crypto";
import { validatedReviewEvidenceSnapshot } from "@/lib/equity-signal/review-evidence-revision";

type Json = Record<string, unknown>;
const object = (v: unknown): Json => v && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === "object"
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => [k, stable(value)])) : v;
const hash = (v: unknown) => crypto.createHash("sha256").update(JSON.stringify(stable(v))).digest("hex");
const text = (v: unknown) => typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
const positive = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
const rows = (v: unknown) => Array.isArray(v) ? v.map(object) : [];
const atoms = (v: unknown[]) => [...new Set(v.map(value => JSON.stringify(stable(value))))].sort();
const categories = ["sources", "sourceDocuments", "facts", "documents", "profileSources", "scanner", "currency"] as const;
type Category = typeof categories[number];
const scannerFields = ["revenue", "netIncome", "freeCashFlow", "dilutedEpsTtm", "revenueGrowthTtmPercent", "revenueGrowthFyPercent",
  "netIncomeGrowthTtmPercent", "epsGrowthTtmPercent", "grossMarginPercent", "operatingMarginPercent", "netMarginPercent",
  "debtToEquityPercent", "currentRatio", "returnOnEquityPercent", "returnOnAssetsPercent"];

export type TerminalEvidence = {
  version: 1; cik: string; ticker: string; scope: "valuation" | "event";
  sourceEvidenceKey: string; decisionKey: string;
  comparison: {
    provenance: "current" | "legacy_snapshot" | "legacy_primary_source";
    external: Record<Category, string[]>;
    knownCategories: Category[];
    market: { price: number | null; actionable: boolean; halted: boolean | null };
    reference: { base: number | null; thresholds: number[] };
  };
};

function secPrimarySource(urlValue: unknown, cik: string, publishedAt: unknown) {
  if (typeof urlValue !== "string" || !/^https:\/\/(?:www\.)?sec\.gov\//i.test(urlValue)
    || typeof publishedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(publishedAt)
    || !Number.isFinite(Date.parse(publishedAt))) return null;
  const normalizedDate = new Date(publishedAt).toISOString();
  const paddedDate = publishedAt.includes(".") ? publishedAt.replace(/\.(\d+)Z$/, (_, digits: string) => `.${digits.padEnd(3, "0")}Z`)
    : publishedAt.replace(/Z$/, ".000Z");
  if (normalizedDate !== paddedDate) return null;
  try {
    const url = new URL(urlValue);
    const parts = /^\/Archives\/edgar\/data\/(\d+)\/(\d{18})\//i.exec(url.pathname);
    if (url.protocol !== "https:" || !["sec.gov", "www.sec.gov"].includes(url.hostname) || url.username || url.password || url.port || url.search || url.hash
      || !parts || Number(parts[1]) !== Number(cik)) return null;
    return [cik, `${parts[2].slice(0, 10)}-${parts[2].slice(10, 12)}-${parts[2].slice(12)}`, normalizedDate];
  } catch { return null; }
}

/** An old approval must never attest targets recalculated by a newer model.
 * This is a publication check only; changing it cannot buy a paid review. */
export function terminalPublicationPacketKey(candidate: Json) {
  const forecast = object(candidate.priceForecast);
  return hash({ valuationRange: candidate.valuationRange ?? null,
    forecast: Object.fromEntries(["status", "horizon", "probabilityDirectionCorrectPercent", "sampleSize", "medianReturnPercent",
      "pessimisticReturnPercent", "optimisticReturnPercent", "medianPrice", "lowPrice", "highPrice", "basedOnMarketRelativeOutcomes"]
      .map(key => [key, forecast[key] ?? null])) });
}

/** External evidence and observed market state only. Frozen model reference
 * levels assist comparisons, but policy/model changes cannot create a key. */
export function terminalReviewEvidence(input: {
  cik: string; ticker: string; scope: "valuation" | "event"; evidence: Json;
  analysis?: Json; price: number | null;
}): TerminalEvidence {
  const e = input.evidence, profile = object(e.companyProfile), outlook = object(e.outlookRange);
  const fundamentals = object(input.analysis?.fundamentals);
  const external: TerminalEvidence["comparison"]["external"] = {
    // Generated scan IDs and summaries contain dates, quotes and model output.
    // Event source IDs likewise may be regenerated daily; the actual text wins.
    sources: atoms(rows(e.source).filter(r => e.sourceComplete !== false && r.rawEventType !== "valuation_review").map(r =>
      [text(r.rawEventType), text(r.summary)]).filter(([, summary]) => Boolean(summary))),
    sourceDocuments: atoms(rows(e.source).filter(r => e.sourceComplete === true && r.official === true && text(r.summary))
      .map(r => secPrimarySource(r.url, input.cik, r.publishedAt)).filter(r => r !== null)),
    facts: atoms(rows(e.facts).filter(r => typeof r.metric === "string" && typeof r.value === "number" && Number.isFinite(r.value))
      .map(r => [r.metric, r.value, r.unit ?? null, r.periodStart ?? null, r.periodEnd ?? null, r.filedAt ?? null, r.form ?? null, r.concept ?? null, r.accession ?? null])),
    documents: atoms(rows(e.financialDocuments).filter(r => r.readComplete === true && text(r.url) && text(r.digest))
      .map(r => [text(r.url), text(r.filedAt), text(r.digest)])),
    // Model-authored profile wording is not a new primary source fact.
    profileSources: text(profile.sourceUrl) ? atoms([[text(profile.sourceUrl), text(profile.sourceFiledAt)]]) : [],
    scanner: atoms(scannerFields.filter(k => typeof fundamentals[k] === "number" && Number.isFinite(fundamentals[k]))
      .map(k => [k, fundamentals[k]])),
    currency: text(outlook.currency) ? atoms([text(outlook.currency)]) : [],
  };
  const base = positive(outlook.base);
  const comparison: TerminalEvidence["comparison"] = { provenance: "current", external,
    knownCategories: [...categories], market: { price: positive(input.price), actionable: e.priceReady === true,
      halted: e.haltKnown === true && typeof e.halted === "boolean" ? e.halted : null },
    reference: { base, thresholds: input.scope === "valuation" && base ? [base / 1.2, base, base / 0.8] : [] } };
  return descriptor(input, comparison);
}

function descriptor(identity: { cik: string; ticker: string; scope: "valuation" | "event" }, comparison: TerminalEvidence["comparison"]): TerminalEvidence {
  const sourceEvidenceKey = hash(comparison.external);
  const decisionKey = hash({ cik: identity.cik, external: comparison.external,
    market: { price: comparison.market.price, halted: comparison.market.halted } });
  return { version: 1, cik: identity.cik, ticker: identity.ticker, scope: identity.scope, sourceEvidenceKey, comparison, decisionKey };
}

export function validatedTerminalEvidence(value: unknown, identity: { cik: unknown; ticker: unknown }): TerminalEvidence | null {
  const r = object(value), c = object(r.comparison), market = object(c.market), reference = object(c.reference), external = object(c.external);
  if (r.version !== 1 || r.cik !== identity.cik || r.ticker !== identity.ticker || !/^\d{10}$/.test(String(r.cik))
    || typeof r.ticker !== "string" || !/^[A-Z0-9][A-Z0-9.\-^]{0,19}$/.test(r.ticker)
    || typeof identity.ticker !== "string" || !/^[A-Z0-9][A-Z0-9.\-^]{0,19}$/.test(identity.ticker)
    || !["valuation", "event"].includes(String(r.scope)) || !["current", "legacy_snapshot", "legacy_primary_source"].includes(String(c.provenance))
    || typeof market.actionable !== "boolean" || !(market.halted === null || typeof market.halted === "boolean")
    || !(market.price === null || positive(market.price) !== null) || !(reference.base === null || positive(reference.base) !== null)
    || !Array.isArray(reference.thresholds) || !reference.thresholds.every(v => positive(v) !== null)
    || !Array.isArray(c.knownCategories) || c.knownCategories.some(v => !categories.includes(v as Category))
    || new Set(c.knownCategories).size !== c.knownCategories.length
    || JSON.stringify(c.knownCategories) !== JSON.stringify(c.provenance === "current" ? categories
      : c.provenance === "legacy_primary_source" ? ["sourceDocuments"] : categories.filter(k => !["scanner", "sourceDocuments"].includes(k)))
    || !categories.every(k => Array.isArray(external[k]) && (external[k] as unknown[]).every(v => typeof v === "string")
      && JSON.stringify(external[k]) === JSON.stringify([...new Set(external[k] as string[])].sort()))) return null;
  const canonical = descriptor({ cik: r.cik as string, ticker: r.ticker, scope: r.scope as TerminalEvidence["scope"] }, c as TerminalEvidence["comparison"]);
  if (canonical.sourceEvidenceKey !== r.sourceEvidenceKey || canonical.decisionKey !== r.decisionKey) return null;
  return JSON.parse(JSON.stringify(canonical)) as TerminalEvidence;
}

/** Unknown legacy prices/gates/scanner inputs are deliberately not fabricated. */
export function legacyTerminalReviewEvidence(value: unknown, identity: { fingerprint: string; cik: string; ticker: string; direction: string }) {
  const snapshot = validatedReviewEvidenceSnapshot(value, identity);
  if (!snapshot) return null;
  const current = terminalReviewEvidence({ ...identity, scope: "valuation", evidence: snapshot.evidence, price: null });
  return descriptor(current, { ...current.comparison, provenance: "legacy_snapshot",
    knownCategories: categories.filter(k => !["scanner", "sourceDocuments"].includes(k)),
    market: { price: null, actionable: false, halted: null }, reference: { base: null, thresholds: [] } });
}

/** Sparse, authentic old SEC-event provenance. No old quote, financial inputs,
 * source text, model values or gates are inferred from the current candidate. */
export function legacyPrimarySourceReviewEvidence(value: unknown, identity: { cik: string; ticker: string }) {
  const row = object(value), accession = /^sec:(\d{10}-\d{2}-\d{6})$/.exec(String(row.eventId))?.[1];
  if (!accession || row.cik !== identity.cik) return null;
  const documents = rows(row.sources).map(source => secPrimarySource(source.url, identity.cik, row.eventObservedAt))
    .filter(source => source && source[1] === accession);
  if (!documents.length) return null;
  const current = terminalReviewEvidence({ ...identity, scope: "event", evidence: {}, price: null });
  return descriptor(current, { ...current.comparison, provenance: "legacy_primary_source", knownCategories: ["sourceDocuments"],
    external: { ...current.comparison.external, sourceDocuments: atoms(documents) } });
}

/** Directional comparison: loss of provenance never demonstrates novelty. Each
 * retained baseline is checked independently, so A -> B -> A remains held. */
export function sameTerminalReviewEvidence(before: TerminalEvidence, after: TerminalEvidence) {
  if (before.cik !== after.cik) return false;
  if (before.comparison.provenance === "legacy_primary_source") {
    const prior = before.comparison.external.sourceDocuments.map(atom => JSON.parse(atom) as string[]);
    return !after.comparison.external.sourceDocuments.some(atom => {
      const next = JSON.parse(atom) as string[];
      return next[0] === before.cik && !prior.some(old => old[1] === next[1])
        && prior.every(old => Date.parse(next[2]) > Date.parse(old[2]));
    });
  }
  const containsKnown = (beforeAtom: string, afterAtom: string) => {
    if (beforeAtom === afterAtom) return true;
    // Omitted metadata is deterioration, not a novel financial fact/document.
    try {
      const prior = JSON.parse(beforeAtom), next = JSON.parse(afterAtom);
      return Array.isArray(prior) && Array.isArray(next) && prior.length === next.length
        && next.every((value, index) => value === null || value === "" || JSON.stringify(value) === JSON.stringify(prior[index]));
    } catch { return false; }
  };
  if (before.comparison.knownCategories.some(k => after.comparison.external[k]
    .some(atom => !before.comparison.external[k].some(known => k === "sourceDocuments"
      ? JSON.stringify(JSON.parse(known).slice(0, 2)) === JSON.stringify(JSON.parse(atom).slice(0, 2)) : containsKnown(known, atom))))) return false;
  const prior = before.comparison.market, next = after.comparison.market;
  if (before.comparison.provenance === "legacy_snapshot") return true;
  if (prior.halted !== null && next.halted !== null && prior.halted !== next.halted) return false;
  // Freshness or missing quotes alone are not economic change. A newly usable
  // price is new evidence only when the original review explicitly lacked it.
  if (!next.actionable || next.price === null) return true;
  if (prior.price === null) return !next.actionable;
  const move = Math.abs(next.price - prior.price) / prior.price * 100;
  if (move >= 5 - 1e-9) return false;
  const reference = before.comparison.reference;
  if (reference.base !== null && Math.abs(reference.base / next.price - reference.base / prior.price) * 100 >= 5 - 1e-9) return false;
  const priorPrice = prior.price, nextPrice = next.price;
  if (reference.thresholds.some(level => (priorPrice <= level) !== (nextPrice <= level))) return false;
  return true;
}
