import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";

const MAX_LIMIT = 100;
const VALID_EVENT_TYPES = new Set([
  "earnings_surprise",
  "guidance_cut",
  "guidance_raise",
  "sec_filing",
  "insider_buy",
  "insider_sell",
  "fda_approval",
  "trial_success",
  "trial_failure",
  "macro_shock",
  "crypto_shock",
  "product_launch",
]);
const VALID_OUTCOMES = new Set(["positive", "negative", "neutral", "mixed", "unknown"]);
const SIMPLE_FILTER = /^[a-zA-Z0-9_.-]{1,40}$/;

function cleanString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function safeLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? "25", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 25;
  return Math.min(parsed, MAX_LIMIT);
}

function cleanDecimal(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return new Prisma.Decimal(parsed.toFixed(2));
}

function safeHistoricalEvent(event: {
  id: string;
  ticker: string;
  companyName: string | null;
  sector: string | null;
  eventType: string;
  eventDate: Date;
  title: string | null;
  summary: string | null;
  source: string | null;
  sourceUrl: string | null;
  priceBefore: Prisma.Decimal | null;
  priceAfter1d: Prisma.Decimal | null;
  priceAfter7d: Prisma.Decimal | null;
  priceAfter30d: Prisma.Decimal | null;
  outcomeLabel: string;
  notes: string | null;
  createdAt: Date;
}) {
  return {
    id: event.id,
    ticker: event.ticker,
    company_name: event.companyName,
    sector: event.sector,
    event_type: event.eventType,
    event_date: event.eventDate.toISOString().slice(0, 10),
    title: event.title,
    summary: event.summary,
    source: event.source,
    source_url: event.sourceUrl,
    price_before: event.priceBefore?.toString() ?? null,
    price_after_1d: event.priceAfter1d?.toString() ?? null,
    price_after_7d: event.priceAfter7d?.toString() ?? null,
    price_after_30d: event.priceAfter30d?.toString() ?? null,
    outcome_label: event.outcomeLabel,
    notes: event.notes,
    created_at: event.createdAt.toISOString(),
  };
}

export async function GET(request: NextRequest) {
  try {
    const limit = safeLimit(request.nextUrl.searchParams.get("limit"));
    const ticker = cleanString(request.nextUrl.searchParams.get("ticker")).toUpperCase();
    const eventType = cleanString(request.nextUrl.searchParams.get("event_type"));

    const where: Prisma.HistoricalEventWhereInput = {};
    if (ticker && SIMPLE_FILTER.test(ticker)) where.ticker = ticker;
    if (eventType && SIMPLE_FILTER.test(eventType)) where.eventType = eventType;

    const events = await prisma.historicalEvent.findMany({
      where,
      orderBy: [{ eventDate: "desc" }, { createdAt: "desc" }],
      take: limit,
    });

    return NextResponse.json({ ok: true, limit, events: events.map(safeHistoricalEvent) });
  } catch {
    return NextResponse.json({ ok: false, error: "Unable to load historical events." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const ticker = cleanString(body.ticker).toUpperCase();
    const eventType = cleanString(body.event_type ?? body.eventType);
    const eventDateValue = cleanString(body.event_date ?? body.eventDate);
    const title = cleanString(body.title);
    const summary = cleanString(body.summary);
    const outcomeLabel = cleanString(body.outcome_label ?? body.outcomeLabel, "unknown");

    if (!ticker || !eventType || !eventDateValue || !title || !summary) {
      return NextResponse.json(
        { ok: false, error: "ticker, event_type, event_date, title, and summary are required." },
        { status: 400 },
      );
    }
    if (!SIMPLE_FILTER.test(ticker) || !VALID_EVENT_TYPES.has(eventType)) {
      return NextResponse.json({ ok: false, error: "Invalid ticker or event_type." }, { status: 400 });
    }
    if (!VALID_OUTCOMES.has(outcomeLabel)) {
      return NextResponse.json({ ok: false, error: "Invalid outcome_label." }, { status: 400 });
    }

    const eventDate = new Date(`${eventDateValue}T00:00:00.000Z`);
    if (Number.isNaN(eventDate.getTime())) {
      return NextResponse.json({ ok: false, error: "Invalid event_date." }, { status: 400 });
    }

    const created = await prisma.historicalEvent.create({
      data: {
        ticker,
        eventType,
        eventDate,
        title,
        summary,
        companyName: cleanString(body.company_name ?? body.companyName) || null,
        sector: cleanString(body.sector) || null,
        source: cleanString(body.source) || null,
        sourceUrl: cleanString(body.source_url ?? body.sourceUrl) || null,
        priceBefore: cleanDecimal(body.price_before ?? body.priceBefore),
        priceAfter1d: cleanDecimal(body.price_after_1d ?? body.priceAfter1d),
        priceAfter7d: cleanDecimal(body.price_after_7d ?? body.priceAfter7d),
        priceAfter30d: cleanDecimal(body.price_after_30d ?? body.priceAfter30d),
        outcomeLabel,
        notes: cleanString(body.notes) || null,
      },
    });

    return NextResponse.json({ ok: true, event: safeHistoricalEvent(created) }, { status: 201 });
  } catch {
    return NextResponse.json({ ok: false, error: "Unable to save historical event." }, { status: 500 });
  }
}
