import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

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

export async function GET(request: NextRequest) {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const expected = process.env.SWING_UP_AUTOMATION_TOKEN?.trim();
  if (expected && suppliedToken(request) !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ ok: true, databaseConfigured: false, usableOutcomeRows: 0, safety: { databaseWrites: false } });

  try {
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
      prisma.historicalEvent.count(),
      prisma.historicalEvent.count({ where: { sourceUrl: { not: null } } }),
      prisma.historicalEvent.count({ where: { priceAfter1d: { not: null } } }),
      prisma.historicalEvent.count({ where: { priceAfter7d: { not: null } } }),
      prisma.historicalEvent.count({ where: { priceAfter30d: { not: null } } }),
      prisma.historicalEvent.count({ where: { priceAfter90d: { not: null } } }),
      prisma.historicalEvent.count({ where: { outcomeLabel: { not: "unknown" } } }),
      prisma.rawSignal.count(),
      prisma.rawSignal.count({ where: { sourceUrl: { not: null } } }),
      prisma.alert.count(),
      prisma.alert.count({ where: { publishedAt: { not: null } } }),
      prisma.priceSnapshot.count(),
      prisma.marketPriceSnapshot.count(),
      prisma.aiCommitteeRun.count(),
      prisma.aiCommitteeRun.count({ where: { status: { in: ["completed", "approved", "rejected", "needs_more_data"] } } }),
      prisma.sourceHealth.count(),
      prisma.historicalEvent.groupBy({ by: ["eventType"], _count: { _all: true }, orderBy: { _count: { eventType: "desc" } }, take: 20 }),
      prisma.historicalEvent.groupBy({ by: ["outcomeLabel"], _count: { _all: true }, orderBy: { _count: { outcomeLabel: "desc" } }, take: 20 }),
      prisma.historicalEvent.findMany({
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
      }),
    ]);

    const usableOutcomeRows = Math.max(historicalWith30d, historicalWith90d);
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
      eventTypes: eventTypeGroups.map((row) => ({ eventType: row.eventType, count: row._count._all })),
      outcomeLabels: outcomeGroups.map((row) => ({ outcomeLabel: row.outcomeLabel, count: row._count._all })),
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
      calibrationPosture: usableOutcomeRows >= 200
        ? "database_has_material_real_outcome_history"
        : usableOutcomeRows >= 30
          ? "database_has_initial_real_outcome_history"
          : "database_history_is_not_yet_large_enough_for_90_percent_calibration",
      safety: { databaseWrites: false, r2Writes: false, publishing: false, notifications: false, payments: false, openAiCalls: false },
      secretsRedacted: true,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      databaseConfigured: true,
      error: "read_only_data_audit_failed",
      errorMessageSafe: error instanceof Error ? error.message.slice(0, 220) : "unknown_error",
      safety: { databaseWrites: false, publishing: false, notifications: false },
    }, { status: 500 });
  }
}
