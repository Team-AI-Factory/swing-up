import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

type LedgerFromAlertSourceMode = "live" | "partial" | "needs_more_data";

const ledgerEligibleStatuses = new Set(["approved", "candidate"]);

function decimalText(value: Prisma.Decimal | null | undefined) {
  return value ? value.toString() : null;
}

function slugPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "alert";
}

function publicSlug(alertId: string, ticker: string) {
  return `${slugPart(ticker)}-${alertId.slice(0, 8)}`;
}

function sourceMode(hasScore: boolean, hasPriceAtAlert: boolean, receiptsCount: number): LedgerFromAlertSourceMode {
  if (!hasScore || !hasPriceAtAlert) return "needs_more_data";
  if (receiptsCount === 0) return "partial";
  return "live";
}

function responseForLedgerRow(params: {
  result: "created" | "existing";
  ledger: { id: string; alertId: string | null; publicSlug: string; entry: Prisma.JsonValue; createdAt: Date };
}) {
  const entry = params.ledger.entry && typeof params.ledger.entry === "object" && !Array.isArray(params.ledger.entry)
    ? params.ledger.entry as Record<string, unknown>
    : {};

  return {
    ok: true,
    result: params.result,
    sourceMode: entry.sourceMode ?? "needs_more_data",
    ledgerId: params.ledger.id,
    publicSlug: params.ledger.publicSlug,
    alertId: params.ledger.alertId ?? entry.alertId,
    outcome: entry.outcome ?? "tracking",
    warnings: Array.isArray(entry.warnings) ? entry.warnings : [],
    ledgerEntry: entry,
  };
}

export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { ok: false, result: "needs_more_data", sourceMode: "needs_more_data", error: "DATABASE_URL is not configured; no ledger row was created." },
      { status: 503 },
    );
  }

  let payload: { alertId?: unknown };
  try {
    payload = (await request.json()) as { alertId?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be valid JSON with an alertId." }, { status: 400 });
  }

  const alertId = typeof payload.alertId === "string" ? payload.alertId.trim() : "";
  if (!alertId) {
    return NextResponse.json({ ok: false, error: "alertId is required." }, { status: 400 });
  }

  const alert = await prisma.alert.findUnique({
    where: { id: alertId },
    include: {
      scores: { orderBy: { createdAt: "desc" }, take: 1 },
      sources: true,
      patternMatches: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!alert) {
    return NextResponse.json({ ok: false, result: "needs_more_data", sourceMode: "needs_more_data", error: "Alert was not found." }, { status: 404 });
  }

  const normalizedStatus = alert.status.toLowerCase();
  if (!ledgerEligibleStatuses.has(normalizedStatus)) {
    return NextResponse.json(
      { ok: false, result: "needs_more_data", sourceMode: "needs_more_data", error: "Only approved or candidate alerts can be added to the public ledger.", alertStatus: alert.status },
      { status: 409 },
    );
  }

  const existing = await prisma.publicLedger.findFirst({ where: { alertId: alert.id } });
  if (existing) return NextResponse.json(responseForLedgerRow({ result: "existing", ledger: existing }));

  const latestSnapshot = await prisma.priceSnapshot.findFirst({ where: { ticker: alert.ticker }, orderBy: { capturedAt: "desc" } });
  const score = alert.scores[0];
  const patternMatch = alert.patternMatches[0];
  const priceAtAlert = decimalText(latestSnapshot?.price);
  const warnings: string[] = [];

  if (!priceAtAlert) warnings.push("No price snapshot was available for this ticker; priceAtAlert and latestPrice are not set yet.");
  if (!score) warnings.push("No alert score was available; score fields are not set yet.");
  if (alert.sources.length === 0) warnings.push("No source receipts were available for this alert yet.");

  const mode = sourceMode(Boolean(score), Boolean(priceAtAlert), alert.sources.length);
  const trackingStartedAt = new Date();
  const entry: Prisma.InputJsonObject = {
    alertId: alert.id,
    ticker: alert.ticker,
    company: alert.company,
    action: alert.action,
    event: alert.event,
    alertDate: (alert.publishedAt ?? trackingStartedAt).toISOString(),
    priceAtAlert,
    latestPrice: priceAtAlert,
    profitPotentialScore: score?.profitPotential ?? null,
    evidenceConfidenceScore: score?.evidenceConfidence ?? null,
    riskLevel: score?.riskLevel ?? null,
    historicalPatternMatch: patternMatch?.confidenceLabel ?? (patternMatch?.similarity ? patternMatch.similarity.toString() : null),
    outcome: "tracking",
    receiptsCount: alert.sources.length,
    warnings,
    sourceMode: mode,
    trackingStartedAt: trackingStartedAt.toISOString(),
    createdFrom: "api/ledger/from-alert",
    result: "Tracking started; no performance outcome has been classified yet.",
  };

  try {
    const created = await prisma.publicLedger.create({
      data: { alertId: alert.id, publicSlug: publicSlug(alert.id, alert.ticker), entry },
    });

    return NextResponse.json(responseForLedgerRow({ result: "created", ledger: created }), { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await prisma.publicLedger.findFirst({ where: { alertId: alert.id } });
      if (duplicate) return NextResponse.json(responseForLedgerRow({ result: "existing", ledger: duplicate }));
    }

    return NextResponse.json(
      { ok: false, result: "needs_more_data", sourceMode: "needs_more_data", error: "Ledger row could not be created safely." },
      { status: 500 },
    );
  }
}
