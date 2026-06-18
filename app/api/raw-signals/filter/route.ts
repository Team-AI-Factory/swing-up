import { NextRequest, NextResponse } from "next/server";
import { applySignalRuleFilter, createSignalFilterContext, type SignalFilterStatus } from "@/lib/signal-filter";
import { prisma } from "@/lib/db/client";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

function safeLimit(value: unknown) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_LIMIT), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

async function readLimit(request: NextRequest) {
  if (!request.body) return DEFAULT_LIMIT;

  try {
    const body = (await request.json()) as { limit?: unknown };
    return safeLimit(body.limit);
  } catch {
    return DEFAULT_LIMIT;
  }
}

function emptySummary() {
  return {
    ok: true,
    processed: 0,
    promoted: 0,
    queued: 0,
    filtered: 0,
    rejected: 0,
    error: 0,
  };
}

export async function POST(request: NextRequest) {
  try {
    const limit = await readLimit(request);
    const signals = await prisma.rawSignal.findMany({
      where: { processedStatus: { in: ["new", "queued"] } },
      orderBy: { receivedAt: "desc" },
      take: limit,
    });

    const context = createSignalFilterContext();
    const summary = emptySummary();

    for (const signal of signals) {
      const decision = applySignalRuleFilter(signal, context);
      await prisma.rawSignal.update({
        where: { id: signal.id },
        data: { processedStatus: decision.status },
      });

      summary.processed += 1;
      summary[decision.status as SignalFilterStatus] += 1;
    }

    return NextResponse.json(summary);
  } catch {
    return NextResponse.json({ ok: false, error: "Unable to run raw signal rule filter." }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "POST to this route with an optional JSON body such as { \"limit\": 25 } to run the rule filter.",
  });
}
