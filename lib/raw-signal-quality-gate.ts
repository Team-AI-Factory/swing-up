import type { RawSignal } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { evaluateRuleFilter, type RejectionReasonLabel, type RuleFilterInput } from "@/lib/rule-filter";

export type RawSignalQualityGateInput = RuleFilterInput & {
  rawSignalId?: unknown;
  id?: unknown;
  sourceUrl?: unknown;
  source_url?: unknown;
  signalType?: unknown;
  signal_type?: unknown;
  payload?: unknown;
  receivedAt?: unknown;
  received_at?: unknown;
  processedStatus?: unknown;
  processed_status?: unknown;
};

type JsonRecord = Record<string, unknown>;

const DUPLICATE_WINDOW_DAYS = 14;
const MIN_CANDIDATE_QUALITY_SCORE = 65;
const DUPLICATE_ALERT_STATUSES = ["candidate", "needs_more_data", "rejected", "draft", "queued", "review", "ready_for_review"];

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function safeDateText(value: Date | string | null | undefined) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function normalizeKeyPart(value: unknown) {
  return text(value).toLowerCase().replace(/https?:\/\/(www\.)?/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 140);
}

function duplicateKey(input: RuleFilterInput) {
  const explicit = text(input.duplicateKey);
  if (explicit) return normalizeKeyPart(explicit);
  return [input.source, input.ticker, input.url || input.title].map(normalizeKeyPart).filter(Boolean).join("::");
}

export function receiptsFromRawSignal(signal: Pick<RawSignal, "source" | "sourceUrl" | "title" | "payload" | "receivedAt">) {
  const payload = objectValue(signal.payload);
  const explicitReceipts = arrayValue(payload.receipts ?? payload.sourceReceipts ?? payload.receipt_urls ?? payload.receiptUrls);
  const receipts = explicitReceipts
    .map((item) => {
      if (typeof item === "string") return { url: item, source: signal.source, label: signal.source };
      const receipt = objectValue(item);
      return {
        label: text(receipt.label ?? receipt.title ?? receipt.summary, signal.source),
        url: text(receipt.url ?? receipt.receiptUrl ?? receipt.sourceUrl),
        source: text(receipt.source ?? receipt.sourceType, signal.source),
        capturedAt: receipt.capturedAt ?? receipt.publishedAt ?? receipt.date,
      };
    })
    .filter((receipt) => text(receipt.url) || text(receipt.label) || text(receipt.source));

  if (signal.sourceUrl && !receipts.some((receipt) => text(receipt.url) === signal.sourceUrl)) {
    receipts.unshift({ label: signal.title, url: signal.sourceUrl, source: signal.source, capturedAt: signal.receivedAt.toISOString() });
  }

  return receipts;
}

export function ruleInputFromRawSignal(signal: Pick<RawSignal, "id" | "source" | "ticker" | "signalType" | "title" | "summary" | "payload" | "receivedAt" | "importanceHint" | "sourceUrl">): RuleFilterInput {
  const payload = objectValue(signal.payload);
  const receipts = receiptsFromRawSignal(signal);
  return {
    title: signal.title,
    url: signal.sourceUrl ?? text(payload.url ?? payload.link ?? payload.receiptUrl),
    source: signal.source,
    summary: signal.summary,
    ticker: signal.ticker ?? payload.ticker,
    company: payload.company ?? payload.companyName,
    eventType: payload.eventType ?? signal.signalType,
    assetType: payload.assetType ?? (signal.ticker ? "equity" : undefined),
    sourceReliability: payload.sourceReliability,
    receipts,
    receiptUrls: receipts.map((receipt) => receipt.url).filter(Boolean),
    publishedAt: safeDateText(signal.receivedAt),
    importanceHint: signal.importanceHint,
    impactScore: typeof payload.impactScore === "number" ? payload.impactScore : undefined,
    duplicateKey: `${signal.source.toLowerCase()}::${(signal.ticker ?? "").toLowerCase()}::${signal.title.toLowerCase()}`,
    previousSignalKeys: [],
    alreadyPricedIn: payload.alreadyPricedIn,
    pricedInWarning: payload.pricedInWarning,
    marketSentimentRisk: payload.marketSentimentRisk,
    marketSentimentWarning: payload.marketSentimentWarning,
  };
}

export function ruleInputFromPayload(payload: RawSignalQualityGateInput): RuleFilterInput {
  const nested = objectValue(payload.payload);
  const sourceUrl = payload.sourceUrl ?? payload.source_url ?? payload.url ?? nested.sourceUrl ?? nested.url;
  return {
    ...payload,
    title: payload.title ?? nested.title,
    url: sourceUrl,
    source: payload.source ?? nested.source,
    summary: payload.summary ?? nested.summary,
    ticker: payload.ticker ?? nested.ticker,
    company: payload.company ?? nested.company ?? nested.companyName,
    eventType: payload.eventType ?? payload.signalType ?? payload.signal_type ?? nested.eventType,
    assetType: payload.assetType ?? nested.assetType,
    importanceHint: payload.importanceHint ?? nested.importanceHint,
    publishedAt: payload.publishedAt ?? payload.receivedAt ?? payload.received_at ?? nested.publishedAt,
  };
}

async function loadRecentDuplicateKeys(input: RuleFilterInput, rawSignalId?: string) {
  const since = new Date(Date.now() - DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const source = text(input.source);
  const ticker = text(input.ticker).toUpperCase();
  const url = text(input.url);
  const title = text(input.title);

  const duplicateClauses = [
    ...(url ? [{ sourceUrl: url }] : []),
    ...(source && ticker ? [{ source, ticker: { equals: ticker, mode: "insensitive" as const } }] : []),
    ...(source && title ? [{ source, title: { equals: title, mode: "insensitive" as const } }] : []),
  ];

  if (duplicateClauses.length === 0) return [];

  try {
    const rawSignals = await prisma.rawSignal.findMany({
      where: {
        id: rawSignalId ? { not: rawSignalId } : undefined,
        receivedAt: { gte: since },
        OR: duplicateClauses,
      },
      select: { id: true, source: true, ticker: true, title: true, sourceUrl: true },
      take: 25,
    });

    return rawSignals.map((signal) => ({ id: signal.id, key: duplicateKey({ source: signal.source, ticker: signal.ticker ?? undefined, title: signal.title, url: signal.sourceUrl ?? undefined }) }));
  } catch {
    return [];
  }
}

async function hasDuplicateCandidate(input: RuleFilterInput) {
  const ticker = text(input.ticker).toUpperCase();
  const event = text(input.summary) || text(input.title);
  if (!ticker || !event) return false;
  try {
    const duplicate = await prisma.alert.findFirst({
      where: { ticker, event, OR: DUPLICATE_ALERT_STATUSES.map((status) => ({ status: { equals: status, mode: "insensitive" as const } })) },
      select: { id: true },
    });
    return Boolean(duplicate);
  } catch {
    return false;
  }
}

function qualityScore(input: RuleFilterInput, reasons: RejectionReasonLabel[], duplicate: boolean) {
  let score = 100;
  if (duplicate) score -= 45;
  for (const reason of reasons) {
    if (reason === "needs_more_data") score -= 15;
    else if (reason === "missing_receipts" || reason === "weak_source") score -= 25;
    else score -= 12;
  }
  const receipts = Array.isArray(input.receipts) ? input.receipts.length : Array.isArray(input.receiptUrls) ? input.receiptUrls.length : 0;
  score += Math.min(receipts, 3) * 4;
  return Math.max(0, Math.min(100, score));
}

export async function evaluateRawSignalQualityGate(input: RuleFilterInput, rawSignalId?: string) {
  const currentKey = duplicateKey(input);
  const recentKeys = await loadRecentDuplicateKeys(input, rawSignalId);
  const suppliedKeys = Array.isArray(input.previousSignalKeys) ? input.previousSignalKeys.map(normalizeKeyPart).filter(Boolean) : [];
  const previousSignalKeys = Array.from(new Set([...recentKeys.map((item) => item.key), ...suppliedKeys]));
  const duplicateRawSignal = Boolean(currentKey) && previousSignalKeys.includes(currentKey);
  const duplicateCandidate = await hasDuplicateCandidate(input);
  const duplicate = duplicateRawSignal || duplicateCandidate;
  const ruleResult = evaluateRuleFilter({ ...input, duplicateKey: currentKey, previousSignalKeys });
  const rejectionReasons = Array.from(new Set<RejectionReasonLabel>([...ruleResult.rejectionReasons, ...(duplicate ? ["duplicate" as const] : [])]));
  const score = qualityScore(input, rejectionReasons, duplicate);
  const needsMoreData = ruleResult.decision === "needs_more_data" || rejectionReasons.includes("needs_more_data");
  const eligibleForCandidateAlert = !duplicate && ruleResult.decision === "pass" && score >= MIN_CANDIDATE_QUALITY_SCORE;

  return {
    ok: true,
    duplicate,
    duplicateRawSignal,
    duplicateCandidate,
    qualityScore: score,
    rejectionReasons,
    needsMoreData,
    eligibleForCandidateAlert,
    ruleFilterResult: ruleResult,
    compatibility: { callsPaidAiModel: false, publishesRealAlert: false, deletesRejectedSignals: false },
  };
}
