import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/client";
import { historicalBackfillBatchSize, runHistoricalEventBackfill } from "@/lib/historical-event-backfill";

function dryRunFromBody(body: Record<string, unknown>) {
  return body.dryRun !== false;
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const dryRun = dryRunFromBody(body);
  const limit = historicalBackfillBatchSize(body.limit);

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({
      ok: true,
      dryRun,
      batchSize: limit,
      eventsConsidered: 0,
      eventsCreated: 0,
      duplicatesSkipped: 0,
      rejectedEvents: [],
      warnings: ["DATABASE_URL is not configured, so no historical events were read or written."],
      nextRecommendedAction: "Configure DATABASE_URL, healthcheck Build 101, then rerun the dry-run backfill with a small limit.",
      created: [],
      duplicates: [],
    });
  }

  try {
    const summary = await runHistoricalEventBackfill({ dryRun, limit, prisma });
    return NextResponse.json({ ok: true, ...summary });
  } catch {
    return NextResponse.json({
      ok: false,
      dryRun,
      eventsConsidered: 0,
      eventsCreated: 0,
      duplicatesSkipped: 0,
      rejectedEvents: [],
      warnings: ["Historical event backfill failed before any destructive action; no deletes or overwrites were attempted."],
      nextRecommendedAction: "Check database connectivity and rerun in dryRun mode before any write attempt.",
      created: [],
      duplicates: [],
    }, { status: 500 });
  }
}
