import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

type AuditError = { query: string; reason: string };

function branchAllowed() {
  if (process.env.SWING_UP_COMBINED_ENGINE_ALLOW_LOCAL === "true") return true;
  const branch = process.env.RAILWAY_GIT_BRANCH?.trim();
  const environment = process.env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase();
  return Boolean(
    process.env.RAILWAY_PROJECT_ID
    && branch === "agent/combined-opportunity-engine"
    && environment
    && environment !== "production"
  );
}

function suppliedToken(request: NextRequest) {
  return request.headers.get("x-swing-up-automation-token")?.trim()
    || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
}

function safeMessage(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/[A-Za-z0-9_\-]{24,}/g, "[redacted]").replace(/postgresql:\/\/[^\s]+/gi, "[redacted_database]").slice(0, 220)
    : "query_failed";
}

async function safeQuery<T>(query: string, operation: Promise<T>, fallback: T, errors: AuditError[]): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    errors.push({ query, reason: safeMessage(error) });
    return fallback;
  }
}

export async function GET(request: NextRequest) {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const expected = process.env.SWING_UP_AUTOMATION_TOKEN?.trim();
  if (expected && suppliedToken(request) !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ ok: true, databaseConfigured: false, usableOutcomeRows: 0, safety: { databaseWrites: false } });

  const errors: AuditError[] = [];
  const [
    historicalTotal,
    historicalWithReceipt,
    historicalWith1d,
    historicalWith7d,
    historicalWith30d,
    historicalWith90d,
    labelledOutcomes,
    rawSignals,
    rawSignalsWithReceipt,
    alerts,
    publishedAlerts,
    priceSnapshots,
    marketPriceSnapshots,
    committeeRuns,
    completedCommitteeRuns,
    sourceHealth,
    eventTypeGroups,
    outcomeGroups,
    latestEvents,
  ] = await Promise.all([
    safeQuery("historicalTotal", prisma.historicalEvent.count(), 0, errors),
    safeQuery("historicalWithReceipt", prisma.historicalEvent.count({ where: { sourceUrl: { not: null } } }), 0, errors),
    safeQuery("historicalWith1d", prisma.historicalEvent.count({ where: { priceAfter1d: { not: null } } }), 0, errors),
    safeQuery("historicalWith7d", prisma.historicalEvent.count({ where: { priceAfter7d: { not: null } } }), 0, errors),
    safeQuery("historicalWith30d", prisma.historicalEvent.count({ where: { priceAfter30d: { not: null } } }), 0, errors),
    safeQuery("historicalWith90d", prisma.historicalEvent.count({ where: { priceAfter90d: { not: null } } }), 0, errors),
    safeQuery("labelledOutcomes", prisma.historicalEvent.count({ where: { outcomeLabel: { not: "unknown" } } }), 0, errors),
    safeQuery("rawSignals", prisma.rawSignal.count(), 0, errors),
    safeQuery("rawSignalsWithReceipt", prisma.rawSignal.count({ where: { sourceUrl: { not: null } } }), 0, errors),
    safeQuery("alerts", prisma.alert.count(), 0, errors),
    safeQuery("publishedAlerts", prisma.alert.count({ where: { publishedAt: { not: null } } }), 0, errors),
    safeQuery("priceSnapshots", prisma.priceSnapshot.count(), 0, errors),
    safeQuery("marketPriceSnapshots", prisma.marketPriceSnapshot.count(), 0, errors),
    safeQuery("committeeRuns", prisma.aiCommitteeRun.count(), 0, errors),
    safeQuery("completedCommitteeRuns", prisma.aiCommitteeRun.count({ where: { status: { in: ["completed", "approved", "rejected", "needs_more_data"] } } }), 0, errors),
    safeQuery("sourceHealth", prisma.sourceHealth.count(), 0, errors),
    safeQuery("eventTypeGroups", prisma.historicalEvent.groupBy({ by: ["eventType"], _count: { _all: true }, take: 50 }), [], errors),
    safeQuery("outcomeGroups", prisma.historicalEvent.groupBy({ by: ["outcomeLabel"], _count: { _all: true }, take: 50 }), [], errors),
    safeQuery("latestEvents", prisma.historicalEvent.findMany({
      where: { OR: [{ priceAfter30d: { not: null } }, { priceAfter90d: { not: null } }] },
      orderBy: { eventDate: "desc" },
      take: 20,
      select: {
        ticker: true,
        eventType: true,
        eventDate: true,
        outcomeLabel: true,
        priceBefore: true,
        priceAfter1d: true,
        priceAfter7d: true,
        priceAfter30d: true,
        priceAfter90d: true,
        maxGain: true,
        maxDrawdown: true,
        source: true,
        sourceUrl: true,
      },
    }), [], errors),
  ]);

  const usableOutcomeRows = Math.max(historicalWith30d, historicalWith90d);
  const sortedEventTypes = [...eventTypeGroups]
    .map((row) => ({ eventType: row.eventType, count: row._count._all }))
    .sort((left, right) => right.count - left.count);
  const sortedOutcomeLabels = [...outcomeGroups]
    .map((row) => ({ outcomeLabel: row.outcomeLabel, count: row._count._all }))
    .sort((left, right) => right.count - left.count);

  return NextResponse.json({
    ok: true,
    databaseConfigured: true,
    checkedAt: new Date().toISOString(),
    counts: {
      historicalTotal,
      historicalWithReceipt,
      historicalWith1d,
      historicalWith7d,
      historicalWith30d,
      historicalWith90d,
      labelledOutcomes,
      usableOutcomeRows,
      rawSignals,
      rawSignalsWithReceipt,
      alerts,
      publishedAlerts,
      priceSnapshots,
      marketPriceSnapshots,
      committeeRuns,
      completedCommitteeRuns,
      sourceHealth,
    },
    eventTypes: sortedEventTypes,
    outcomeLabels: sortedOutcomeLabels,
    latestOutcomeSamples: latestEvents.map((row) => ({
      ...row,
      eventDate: row.eventDate.toISOString(),
      priceBefore: row.priceBefore?.toString() ?? null,
      priceAfter1d: row.priceAfter1d?.toString() ?? null,
      priceAfter7d: row.priceAfter7d?.toString() ?? null,
      priceAfter30d: row.priceAfter30d?.toString() ?? null,
      priceAfter90d: row.priceAfter90d?.toString() ?? null,
      maxGain: row.maxGain?.toString() ?? null,
      maxDrawdown: row.maxDrawdown?.toString() ?? null,
    })),
    queryErrors: errors,
    optionalTablesUnavailable: errors.map((error) => error.query),
    calibrationPosture: usableOutcomeRows >= 200
      ? "database_has_material_real_outcome_history"
      : usableOutcomeRows >= 30
        ? "database_has_initial_real_outcome_history"
        : "database_history_is_not_yet_large_enough_for_90_percent_calibration",
    safety: { databaseWrites: false, r2Writes: false, publishing: false, notifications: false, payments: false, openAiCalls: false },
    secretsRedacted: true,
  });
}
