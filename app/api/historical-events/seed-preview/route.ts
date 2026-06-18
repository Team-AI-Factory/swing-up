import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { mockHistoricalEvents, normalizeHistoricalEvent, serializeHistoricalEvent } from "@/lib/historical-events";

function isDryRun(request: NextRequest) {
  return request.nextUrl.searchParams.get("dryRun") !== "false";
}

export async function GET(request: NextRequest) {
  try {
    const dryRun = isDryRun(request);
    const normalized = mockHistoricalEvents.map((event) => normalizeHistoricalEvent(event));

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        mockPreview: true,
        warning: "Mock preview only. No historical event rows were inserted, updated, deleted, backfilled, or published as alerts.",
        total: normalized.length,
        events: normalized.map((event) => serializeHistoricalEvent({ ...event, id: "mock-preview", createdAt: new Date() })),
      });
    }

    let created = 0;
    let skipped = 0;
    for (const event of normalized) {
      const existing = await prisma.historicalEvent.findFirst({
        where: { ticker: event.ticker, eventType: event.eventType, eventDate: event.eventDate, title: event.title },
        select: { id: true },
      });
      if (existing) {
        skipped += 1;
        continue;
      }
      await prisma.historicalEvent.create({ data: event });
      created += 1;
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      mockPreview: true,
      warning: "Mock preview seed inserted only missing mock rows. Existing historical event data was not deleted or overwritten. No alerts were published.",
      created,
      skipped,
      total: normalized.length,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Unable to prepare mock historical event preview." }, { status: 500 });
  }
}
