import { Prisma, type RawSignal } from "@prisma/client";
import { prisma } from "@/lib/db/client";

export type RawSignalSourceType = "news" | "market" | "macro" | "filing" | "regulatory" | "fx" | "crypto" | "other";
export type RawSignalImportanceHint = "low" | "medium" | "high";
export type RawSignalWriterStatus = "saved" | "skipped" | "rejected";
export type RawSignalSkipReason = "dry_run" | "duplicate";
export type RawSignalRejectReason = "missing_source" | "missing_useful_content" | "invalid_detected_at" | "database_unavailable";

export type RawSignalQualityHints = {
  importanceHint?: RawSignalImportanceHint;
  confidence?: number;
  sourceQuality?: "low" | "medium" | "high";
  useful?: boolean;
  reasons?: string[];
};

export type WriteRawSignalInput = {
  sourceName: string;
  sourceType?: RawSignalSourceType | string;
  title?: string | null;
  summary?: string | null;
  url?: string | null;
  ticker?: string | null;
  company?: string | null;
  eventType?: string | null;
  detectedAt?: Date | string | null;
  rawPayload?: Prisma.InputJsonValue | null;
  qualityHints?: RawSignalQualityHints;
  duplicateKey?: string | null;
  dryRun?: boolean;
};

export type WriteRawSignalResult =
  | { status: "saved"; rawSignalId: string; duplicateKey: string; reason: null }
  | { status: "skipped"; rawSignalId: null; duplicateKey: string; reason: RawSignalSkipReason }
  | { status: "rejected"; rawSignalId: null; duplicateKey: string | null; reason: RawSignalRejectReason };

function clean(value?: string | null, maxLength = 500) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function normalizeTicker(value?: string | null) {
  return clean(value, 32)?.toUpperCase() ?? null;
}

function toDate(value?: Date | string | null) {
  if (!value) return new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stablePart(value?: string | null) {
  return clean(value, 300)?.toLowerCase().replace(/\s+/g, " ") ?? "";
}

export function buildRawSignalDuplicateKey(input: Pick<WriteRawSignalInput, "sourceName" | "sourceType" | "eventType" | "ticker" | "title" | "url" | "detectedAt" | "duplicateKey">) {
  const explicit = clean(input.duplicateKey, 500);
  if (explicit) return explicit;
  const detectedAt = toDate(input.detectedAt);
  const day = detectedAt ? detectedAt.toISOString().slice(0, 10) : "unknown-date";
  return [input.sourceName, input.sourceType ?? "other", input.eventType ?? "general", normalizeTicker(input.ticker) ?? "", stablePart(input.url), stablePart(input.title), day]
    .filter((part) => part !== "")
    .join("|");
}

function payloadWithMetadata(input: WriteRawSignalInput, duplicateKey: string): Prisma.InputJsonObject {
  const base = input.rawPayload && typeof input.rawPayload === "object" && !Array.isArray(input.rawPayload)
    ? (input.rawPayload as Prisma.InputJsonObject)
    : { value: input.rawPayload ?? null };

  return {
    ...base,
    rawSignalWriter: {
      sourceName: input.sourceName,
      sourceType: input.sourceType ?? "other",
      eventType: input.eventType ?? "general",
      company: clean(input.company, 240),
      duplicateKey,
      confidence: input.qualityHints?.confidence ?? null,
      sourceQuality: input.qualityHints?.sourceQuality ?? null,
      qualityReasons: input.qualityHints?.reasons ?? [],
    },
  };
}

async function obviousDuplicate(input: { sourceName: string; ticker: string | null; eventType: string; title: string; url: string | null; detectedAt: Date; duplicateKey: string }) {
  const since = new Date(input.detectedAt.getTime() - 24 * 60 * 60 * 1000);
  const until = new Date(input.detectedAt.getTime() + 24 * 60 * 60 * 1000);
  const existing = await prisma.rawSignal.findFirst({
    where: {
      source: input.sourceName,
      OR: [
        ...(input.url ? [{ sourceUrl: input.url }] : []),
        { ticker: input.ticker, signalType: input.eventType, title: input.title, receivedAt: { gte: since, lte: until } },
        { payload: { path: ["rawSignalWriter", "duplicateKey"], equals: input.duplicateKey } },
      ],
    },
    select: { id: true },
  });
  return existing as Pick<RawSignal, "id"> | null;
}

export async function writeRawSignal(input: WriteRawSignalInput): Promise<WriteRawSignalResult> {
  const sourceName = clean(input.sourceName, 120);
  if (!sourceName) return { status: "rejected", rawSignalId: null, duplicateKey: null, reason: "missing_source" };

  const title = clean(input.title, 240) ?? clean(input.summary, 120) ?? clean(input.url, 240);
  const summary = clean(input.summary, 1000) ?? "";
  const eventType = clean(input.eventType, 80) ?? clean(input.sourceType, 80) ?? "general";
  const url = clean(input.url, 1000);
  const ticker = normalizeTicker(input.ticker);
  const detectedAt = toDate(input.detectedAt);
  if (!detectedAt) return { status: "rejected", rawSignalId: null, duplicateKey: null, reason: "invalid_detected_at" };

  const useful = input.qualityHints?.useful ?? Boolean(title && (summary || url || ticker || input.company || input.rawPayload));
  if (!title || !useful) return { status: "rejected", rawSignalId: null, duplicateKey: null, reason: "missing_useful_content" };

  const duplicateKey = buildRawSignalDuplicateKey({ ...input, sourceName });
  if (!process.env.DATABASE_URL) return input.dryRun ? { status: "skipped", rawSignalId: null, duplicateKey, reason: "dry_run" } : { status: "rejected", rawSignalId: null, duplicateKey, reason: "database_unavailable" };

  if (await obviousDuplicate({ sourceName, ticker, eventType, title, url, detectedAt, duplicateKey })) {
    return { status: "skipped", rawSignalId: null, duplicateKey, reason: "duplicate" };
  }
  if (input.dryRun) return { status: "skipped", rawSignalId: null, duplicateKey, reason: "dry_run" };

  const created = await prisma.rawSignal.create({
    data: {
      source: sourceName,
      ticker,
      signalType: eventType,
      title,
      summary,
      sourceUrl: url,
      receivedAt: detectedAt,
      processedStatus: "new",
      importanceHint: input.qualityHints?.importanceHint ?? "medium",
      payload: payloadWithMetadata(input, duplicateKey),
    },
    select: { id: true },
  });

  return { status: "saved", rawSignalId: created.id, duplicateKey, reason: null };
}
