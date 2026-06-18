import { prisma } from "@/lib/db/client";

type SourceHealthRecord = {
  id: string;
  source: string;
  status: string;
  checkedAt: Date;
  lastSuccessAt: Date | null;
  responseTimeMs: number | null;
  errorMessage: string | null;
  usage: string | null;
  notes: string | null;
};

const safeStatuses = new Set(["connected", "not_configured", "stubbed", "degraded", "error"]);

function summarizeDatabaseError(error: unknown) {
  if (error instanceof Error) {
    return error.message.split("\n")[0]?.slice(0, 160) || "Database connection failed";
  }

  return "Database connection failed";
}

function serializeRow(row: SourceHealthRecord) {
  return {
    id: row.id,
    source: row.source,
    status: safeStatuses.has(row.status) ? row.status : "error",
    lastChecked: row.checkedAt.toISOString(),
    lastSuccess: row.lastSuccessAt?.toISOString() ?? null,
    responseTimeMs: row.responseTimeMs,
    errorMessage: row.errorMessage ? row.errorMessage.slice(0, 240) : null,
    usage: row.usage,
    notes: row.notes,
  };
}

export type SerializedSourceHealth = ReturnType<typeof serializeRow>;

export type SourceHealthPayload = {
  ok: boolean;
  message: string;
  sources: SerializedSourceHealth[];
};

export async function getSourceHealth(): Promise<SourceHealthPayload> {
  if (!process.env.DATABASE_URL) {
    return {
      ok: false,
      message: "DATABASE_URL is not configured, so source health cannot be loaded yet.",
      sources: [],
    };
  }

  try {
    const rows = await prisma.sourceHealth.findMany({ orderBy: { source: "asc" } });

    return {
      ok: true,
      message: rows.length ? "Source health loaded from the database." : "No source health rows found. Run npm run db:seed.",
      sources: rows.map(serializeRow),
    };
  } catch (error) {
    return {
      ok: false,
      message: summarizeDatabaseError(error),
      sources: [],
    };
  }
}

