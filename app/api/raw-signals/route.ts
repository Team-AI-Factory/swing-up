import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/client";
import { listRawSignals, normalizeRawSignalInput, serializeRawSignal } from "@/lib/raw-signals";

function safeError(status = 500) {
  return NextResponse.json({ ok: false, message: "Raw signals are unavailable right now." }, { status });
}

export async function GET(request: NextRequest) {
  if (!process.env.DATABASE_URL) return safeError(503);

  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? "25");
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 100) : 25;

  try {
    const signals = await listRawSignals(limit);
    return NextResponse.json({ ok: true, limit, signals });
  } catch {
    return safeError();
  }
}

export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) return safeError(503);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Request body must be valid JSON." }, { status: 400 });
  }

  const normalized = normalizeRawSignalInput(body);
  if (!normalized.ok) {
    return NextResponse.json({ ok: false, message: normalized.message }, { status: 400 });
  }

  try {
    const created = await prisma.rawSignal.create({ data: normalized.data });
    return NextResponse.json({ ok: true, signal: serializeRawSignal(created) }, { status: 201 });
  } catch {
    return safeError();
  }
}
