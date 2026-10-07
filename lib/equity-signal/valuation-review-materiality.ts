import crypto from "node:crypto";
import { normalizeReviewEvidence } from "@/lib/equity-signal/review-evidence-revision";

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
const digest = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const SCANNER_FINANCIAL_FIELDS = ["revenue", "netIncome", "freeCashFlow", "dilutedEpsTtm",
  "revenueGrowthTtmPercent", "revenueGrowthFyPercent", "netIncomeGrowthTtmPercent", "epsGrowthTtmPercent",
  "grossMarginPercent", "operatingMarginPercent", "netMarginPercent", "debtToEquityPercent", "currentRatio",
  "returnOnEquityPercent", "returnOnAssetsPercent"] as const;

// Admission policy, not a financial standard or publication authority. Preserve
// exact fingerprints and both existing money/count locks alongside this guard.
export const VALUATION_REVIEW_COOLDOWN_MS = 12 * 60 * 60_000;
export const VALUATION_MATERIAL_MOVE_PERCENT = 5;
export const VALUATION_MATERIAL_GAP_POINTS = 5;

export type ValuationReviewBaseline = {
  version: 1;
  cik: string;
  evidenceKey: string;
  thresholdKey: string;
  priceReady: boolean;
  priceSupportsValuation: boolean | null;
  price: number | null;
  low: number | null;
  base: number | null;
  high: number | null;
  methods: Array<{ identity: string; value: number | null }>;
};

export function valuationReviewBaseline(input: {
  cik: string;
  evidence: Json;
  analysis: Json;
  gateChecks: Json;
  direction: string;
  price: number | null;
}): ValuationReviewBaseline {
  const methods = (Array.isArray(input.evidence.modelAssumptions) ? input.evidence.modelAssumptions : []).map(value => {
    const { value: estimate, ...assumptions } = object(value);
    return { assumptions, identity: digest(assumptions), value: number(estimate) };
  }).sort((a, b) => a.identity.localeCompare(b.identity));
  const outlook = object(input.evidence.outlookRange);
  const { low, base, high, ...outlookContext } = outlook;
  const valuationState = Object.fromEntries(Object.entries(object(input.evidence.valuation))
    .filter(([key]) => !["base", "low", "high", "currentPriceSupportsValuation"].includes(key)));
  const gateChecks = Object.fromEntries(Object.entries(input.gateChecks).filter(([key]) => key !== "currentPriceSupportsValuation"));
  const { priceReady, haltKnown, halted, ...evidence } = input.evidence;
  return {
    version: 1, cik: input.cik,
    evidenceKey: digest(normalizeReviewEvidence({ ...evidence,
      outlookRange: outlookContext, valuation: null,
      modelAssumptions: methods.map(method => method.assumptions),
      financialDocuments: (Array.isArray(evidence.financialDocuments) ? evidence.financialDocuments : [])
        .map(stable).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      // These are direct scanner financial inputs. Price-linked multiples,
      // market cap, retrieval times and calculated model outputs are excluded.
      scannerFundamentals: Object.fromEntries(SCANNER_FINANCIAL_FIELDS.map(field => [field, object(input.analysis.fundamentals)[field] ?? null])),
    })),
    thresholdKey: digest({ direction: input.direction, gateChecks,
      haltKnown, halted, valuationState,
      foundationAction: object(input.analysis.decision).action,
      foundationTier: object(input.analysis.decision).tier,
    }),
    priceReady: priceReady === true,
    priceSupportsValuation: input.price !== null && typeof input.gateChecks.currentPriceSupportsValuation === "boolean"
      ? input.gateChecks.currentPriceSupportsValuation : null,
    price: number(input.price), low: number(low), base: number(base), high: number(high),
    methods: methods.map(({ identity, value }) => ({ identity, value })),
  };
}

export function validValuationReviewBaseline(value: unknown): value is ValuationReviewBaseline {
  const row = object(value);
  return row.version === 1 && typeof row.cik === "string" && /^\d{10}$/.test(row.cik)
    && typeof row.priceReady === "boolean"
    && (row.priceSupportsValuation === null || typeof row.priceSupportsValuation === "boolean")
    && [row.evidenceKey, row.thresholdKey].every(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value))
    && [row.price, row.low, row.base, row.high].every(value => value === null || (typeof value === "number" && Number.isFinite(value) && value > 0))
    && Array.isArray(row.methods) && row.methods.every(value => {
      const method = object(value);
      return typeof method.identity === "string" && /^[a-f0-9]{64}$/.test(method.identity)
        && (method.value === null || (typeof method.value === "number" && Number.isFinite(method.value) && method.value > 0));
    });
}

function meaningfulMove(before: number | null, after: number | null) {
  if (before === after) return false;
  if (before === null || after === null) return true;
  return Math.abs(after - before) / Math.abs(before) * 100 >= VALUATION_MATERIAL_MOVE_PERCENT - 1e-9;
}

/** Compare to the last admitted attempt, never an unpaid intermediate scan. */
export function materiallyChangedValuation(before: ValuationReviewBaseline, after: ValuationReviewBaseline) {
  if (before.cik !== after.cik || before.evidenceKey !== after.evidenceKey || before.thresholdKey !== after.thresholdKey) return true;
  // A stale observation may update visible evidence, but cannot buy another
  // incomplete review or turn fresh/stale oscillation into fresh evidence.
  if (!before.priceReady && after.priceReady) return true;
  if (before.priceSupportsValuation !== null && after.priceSupportsValuation !== null
    && before.priceSupportsValuation !== after.priceSupportsValuation) return true;
  if (before.price !== null && after.price !== null && meaningfulMove(before.price, after.price)) return true;
  if ((["low", "base", "high"] as const).some(key => meaningfulMove(before[key], after[key]))) return true;
  if (before.methods.length !== after.methods.length || before.methods.some((method, index) =>
    method.identity !== after.methods[index].identity || meaningfulMove(method.value, after.methods[index].value))) return true;
  const gap = (value: ValuationReviewBaseline) => value.price && value.base ? (value.base / value.price - 1) * 100 : null;
  const priorGap = gap(before), currentGap = gap(after);
  return priorGap !== null && currentGap !== null
    && Math.abs(currentGap - priorGap) >= VALUATION_MATERIAL_GAP_POINTS - 1e-9;
}

export type ValuationReviewReference = {
  fingerprint: string;
  reviewedAt?: string | null;
  valuationBaseline?: unknown;
};

/** Unknown legacy evidence is not proof of a new case. Never invent its age. */
export function valuationReviewCooldown(input: {
  fingerprint: string;
  valuationBaseline?: unknown;
  previous: ValuationReviewReference | null;
  now: Date;
}) {
  const cik = /^valuation:(\d{10}):/.exec(input.fingerprint)?.[1];
  if (!cik) return null; // Genuine source events retain their existing admission.
  const prior = input.previous;
  if (!prior || !prior.fingerprint.startsWith(`valuation:${cik}:`)) return null;
  const direction = /^valuation:\d{10}:(upside|downside):/.exec(input.fingerprint)?.[1];
  const priorDirection = /^valuation:\d{10}:(upside|downside):/.exec(prior.fingerprint)?.[1];
  // Legacy fingerprints already prove this transition without reconstructing
  // old numeric inputs. Existing exact-fingerprint locks still run separately.
  if (direction && priorDirection && direction !== priorDirection) return null;
  const reviewedAt = Date.parse(prior.reviewedAt ?? "");
  const retryAtMs = reviewedAt + VALUATION_REVIEW_COOLDOWN_MS;
  if (Number.isFinite(retryAtMs) && retryAtMs <= input.now.getTime()) return null;
  if (!Number.isFinite(retryAtMs)) return { allowed: false as const, nextRetryAt: null, reason: "valuation_baseline_unknown" };
  const previousValid = validValuationReviewBaseline(prior.valuationBaseline) && prior.valuationBaseline.cik === cik;
  const currentValid = validValuationReviewBaseline(input.valuationBaseline) && input.valuationBaseline.cik === cik;
  if (previousValid && currentValid && materiallyChangedValuation(prior.valuationBaseline as ValuationReviewBaseline, input.valuationBaseline as ValuationReviewBaseline)) return null;
  return {
    allowed: false as const,
    nextRetryAt: Number.isFinite(retryAtMs) ? new Date(retryAtMs).toISOString() : null,
    reason: previousValid && currentValid ? "valuation_immaterial_change" : "valuation_baseline_unknown",
  };
}
