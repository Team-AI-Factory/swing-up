import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";

const VALID_STATUSES = new Set(["new", "queued", "filtered", "promoted", "rejected", "error"]);
const VALID_IMPORTANCE = new Set(["low", "medium", "high", "urgent"]);
const MAX_LIMIT = 100;

function cleanString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function safeLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? "25", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 25;
  return Math.min(parsed, MAX_LIMIT);
}

function safeRawSignal(signal: {
  id: string;
  source: string;
  ticker: string | null;
  signalType: string;
  title: string;
  summary: string;
  payload: Prisma.JsonValue;
  receivedAt: Date;
  processedStatus: string;
  importanceHint: string;
  sourceUrl: string | null;
  createdAt: Date;
}) {
  return {
    id: signal.id,
    source: signal.source,
    ticker: signal.ticker,
    signal_type: signal.signalType,
    title: signal.title,
    summary: signal.summary,
    payload: signal.payload,
    received_at: signal.receivedAt.toISOString(),
    processed_status: signal.processedStatus,
    importance_hint: signal.importanceHint,
    source_url: signal.sourceUrl,
    created_at: signal.createdAt.toISOString(),
  };
}

export async function GET(request: NextRequest) {
  try {
    const limit = safeLimit(request.nextUrl.searchParams.get("limit"));
    const signals = await prisma.rawSignal.findMany({
      orderBy: { receivedAt: "desc" },
      take: limit,
    });

    return NextResponse.json({ ok: true, limit, signals: signals.map(safeRawSignal) });
  } catch {
    return NextResponse.json({ ok: false, error: "Unable to load raw signals." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const source = cleanString(body.source);
    const signalType = cleanString(body.signal_type ?? body.signalType, "general");
    const title = cleanString(body.title);
    const summary = cleanString(body.summary);

    if (!source || !signalType || !title || !summary) {
      return NextResponse.json(
        { ok: false, error: "source, signal_type, title, and summary are required." },
        { status: 400 },
      );
    }

    const processedStatus = cleanString(body.processed_status ?? body.processedStatus, "new");
    const importanceHint = cleanString(body.importance_hint ?? body.importanceHint, "medium");

    if (!VALID_STATUSES.has(processedStatus)) {
      return NextResponse.json({ ok: false, error: "Invalid processed_status." }, { status: 400 });
    }

    if (!VALID_IMPORTANCE.has(importanceHint)) {
      return NextResponse.json({ ok: false, error: "Invalid importance_hint." }, { status: 400 });
    }

    const created = await prisma.rawSignal.create({
      data: {
        source,
        ticker: cleanString(body.ticker) || null,
        signalType,
        title,
        summary,
        payload: (body.payload ?? {}) as Prisma.InputJsonValue,
        processedStatus,
        importanceHint,
        sourceUrl: cleanString(body.source_url ?? body.sourceUrl) || null,
        receivedAt: body.received_at || body.receivedAt ? new Date(String(body.received_at ?? body.receivedAt)) : undefined,
      },
    });

    return NextResponse.json({ ok: true, signal: safeRawSignal(created) }, { status: 201 });
  } catch {
    return NextResponse.json({ ok: false, error: "Unable to save raw signal." }, { status: 500 });
  }
}
