import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/client";

export const rawSignalStatuses = ["new", "queued", "filtered", "promoted", "rejected", "error"] as const;
export const rawSignalImportanceHints = ["low", "medium", "high", "urgent"] as const;

const sensitiveKeyPattern = /(secret|token|password|passwd|authorization|api[_-]?key|access[_-]?key|private[_-]?key|credential)/i;
const statusSet = new Set<string>(rawSignalStatuses);
const importanceSet = new Set<string>(rawSignalImportanceHints);

export type RawSignalInput = {
  source: string;
  ticker?: string | null;
  signal_type?: string;
  title: string;
  summary?: string | null;
  payload?: unknown;
  received_at?: string;
  processed_status?: string;
  importance_hint?: string;
  source_url?: string | null;
};

function cleanString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, sensitiveKeyPattern.test(key) ? "[redacted]" : redactSecrets(child)]),
    );
  }

  return value;
}

function serializeRawSignalRow(row: {
  id: string;
  source: string;
  ticker: string | null;
  signalType: string;
  title: string;
  summary: string | null;
  payload: Prisma.JsonValue;
  receivedAt: Date;
  processedStatus: string;
  importanceHint: string;
  sourceUrl: string | null;
  createdAt: Date;
}) {
  const processedStatus = statusSet.has(row.processedStatus) ? row.processedStatus : "error";
  const importanceHint = importanceSet.has(row.importanceHint) ? row.importanceHint : "medium";

  return {
    id: row.id,
    source: row.source,
    ticker: row.ticker,
    signal_type: row.signalType,
    title: row.title,
    summary: row.summary,
    payload: redactSecrets(row.payload),
    received_at: row.receivedAt.toISOString(),
    processed_status: processedStatus,
    importance_hint: importanceHint,
    source_url: row.sourceUrl,
    created_at: row.createdAt.toISOString(),
  };
}

export const serializeRawSignal = serializeRawSignalRow;
export type SerializedRawSignal = ReturnType<typeof serializeRawSignalRow>;

export function normalizeRawSignalInput(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false as const, message: "Request body must be a JSON object." };
  }

  const input = body as RawSignalInput;
  const source = cleanString(input.source, 120);
  const title = cleanString(input.title, 240);

  if (!source || !title) {
    return { ok: false as const, message: "source and title are required." };
  }

  const receivedAt = input.received_at ? new Date(input.received_at) : new Date();
  if (Number.isNaN(receivedAt.getTime())) {
    return { ok: false as const, message: "received_at must be a valid date if provided." };
  }

  const processedStatus = cleanString(input.processed_status, 32) ?? "new";
  const importanceHint = cleanString(input.importance_hint, 32) ?? "medium";

  return {
    ok: true as const,
    data: {
      source,
      ticker: cleanString(input.ticker, 24),
      signalType: cleanString(input.signal_type, 80) ?? "unknown",
      title,
      summary: cleanString(input.summary, 1000),
      payload: redactSecrets(input.payload ?? {}) as Prisma.InputJsonValue,
      receivedAt,
      processedStatus: statusSet.has(processedStatus) ? processedStatus : "new",
      importanceHint: importanceSet.has(importanceHint) ? importanceHint : "medium",
      sourceUrl: cleanString(input.source_url, 500),
    },
  };
}

export async function listRawSignals(limit: number) {
  const rows = await prisma.rawSignal.findMany({
    take: limit,
    orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
  });

  return rows.map(serializeRawSignal);
}
