import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { redactSecrets, withRedactionMetadata } from "@/lib/redact-secrets";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function parseLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function errorList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => redactSecrets(item).slice(0, 240));
}

function summarizeRun(run: {
  id: string;
  source: string;
  startedAt: Date;
  finishedAt: Date;
  status: string;
  dryRun: boolean;
  recordsChecked: number;
  signalsCreated: number;
  duplicatesSkipped: number;
  errors: unknown;
  sourceHealthStatus: string | null;
}) {
  return {
    id: run.id,
    sourceName: run.source,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt.toISOString(),
    status: run.status,
    dryRun: run.dryRun,
    recordsChecked: run.recordsChecked,
    signalsCreated: run.signalsCreated,
    duplicatesSkipped: run.duplicatesSkipped,
    errors: errorList(run.errors),
    sourceHealthStatus: run.sourceHealthStatus,
  };
}

function summarizeDatabaseError(error: unknown) {
  if (error instanceof Error) return redactSecrets(error.message).split("\n")[0]?.slice(0, 160) || "Unable to load source run history.";
  return "Unable to load source run history.";
}

export async function GET(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(withRedactionMetadata({ ok: false, message: "DATABASE_URL is not configured, so source run history cannot be loaded yet.", runs: [] }));
  }

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

  try {
    const runs = await prisma.sourceRun.findMany({ orderBy: { startedAt: "desc" }, take: limit });
    return NextResponse.json(withRedactionMetadata({ ok: true, limit, runs: runs.map(summarizeRun) }));
  } catch (error) {
    return NextResponse.json(withRedactionMetadata({ ok: false, message: summarizeDatabaseError(error), runs: [] }), { status: 500 });
  }
}
