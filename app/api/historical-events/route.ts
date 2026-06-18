import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { normalizeHistoricalEvent, serializeHistoricalEvent } from "@/lib/historical-events";

const MAX_LIMIT = 100;
const SIMPLE_FILTER = /^[a-zA-Z0-9_.-]{1,40}$/;

function cleanString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function safeLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? "20", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 20;
  return Math.min(parsed, MAX_LIMIT);
}

export async function GET(request: NextRequest) {
  try {
    const limit = safeLimit(request.nextUrl.searchParams.get("limit"));
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({
        ok: true,
        store: "historical_events",
        status: "database_not_configured",
        note: "DATABASE_URL is not configured, so the Historical Event Store is empty in this environment. No alerts were published.",
        limit,
        count: 0,
        events: [],
      });
    }
    const ticker = cleanString(request.nextUrl.searchParams.get("ticker")).toUpperCase();
    const eventType = cleanString(request.nextUrl.searchParams.get("eventType") ?? request.nextUrl.searchParams.get("event_type"));
    const outcome = cleanString(request.nextUrl.searchParams.get("outcome"));

    const where: Prisma.HistoricalEventWhereInput = {};
    if (ticker && SIMPLE_FILTER.test(ticker)) where.ticker = ticker;
    if (eventType && SIMPLE_FILTER.test(eventType)) where.eventType = eventType;
    if (outcome && SIMPLE_FILTER.test(outcome)) where.outcomeLabel = outcome;

    const events = await prisma.historicalEvent.findMany({
      where,
      orderBy: [{ eventDate: "desc" }, { createdAt: "desc" }],
      take: limit,
    });

    return NextResponse.json({
      ok: true,
      store: "historical_events",
      note: "Historical Event Store v1 returns stored memory records only; it does not publish alerts.",
      limit,
      count: events.length,
      events: events.map((event) => serializeHistoricalEvent(event)),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Unable to load historical events." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const data = normalizeHistoricalEvent(body);
    const created = await prisma.historicalEvent.create({ data });

    return NextResponse.json({ ok: true, event: serializeHistoricalEvent(created) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save historical event.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
