import { NextRequest, NextResponse } from "next/server";
import { createSnapshotFromAlert } from "@/lib/ledger-outcome-worker";
import { fetchLiveCryptoPrice } from "@/lib/live-crypto-market";
import { prisma } from "@/lib/db/client";

export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { ok: false, result: "needs_more_data", error: "DATABASE_URL is not configured; no price snapshot was created.", warnings: ["Live database is unavailable in this environment."] },
      { status: 503 },
    );
  }

  let payload: { alertId?: unknown; price?: unknown; latestPrice?: unknown; capturedAt?: unknown };
  try {
    payload = (await request.json()) as { alertId?: unknown; price?: unknown; latestPrice?: unknown; capturedAt?: unknown };
  } catch {
    return NextResponse.json({ ok: false, result: "needs_more_data", error: "Request body must be valid JSON with an alertId.", warnings: [] }, { status: 400 });
  }

  let price = payload.price ?? payload.latestPrice;
  let liveMetadata: Record<string, unknown> = {};
  if (price === undefined || price === null) {
    const alertId = typeof payload.alertId === "string" ? payload.alertId.trim() : "";
    const alert = alertId ? await prisma.alert.findUnique({ where: { id: alertId }, select: { ticker: true } }) : null;
    const quote = alert ? await fetchLiveCryptoPrice(alert.ticker) : null;
    if (quote?.ok && quote.points[0]) {
      price = quote.points[0].price;
      payload.capturedAt = quote.points[0].capturedAt.toISOString();
      liveMetadata = { provider: quote.provider, providerAssetId: quote.asset?.id, currency: quote.currency, sourceUrl: quote.sourceUrl, dataQuality: "live" };
    }
  }
  const result = await createSnapshotFromAlert({ alertId: payload.alertId, price, capturedAt: payload.capturedAt, ...liveMetadata });
  const status = result.ok && result.result !== "needs_more_data" ? 200 : result.ok ? 202 : 400;
  return NextResponse.json(result, { status });
}
