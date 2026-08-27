import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { classifyAlertOutcome } from "@/lib/alert-outcome-classifier";

export type LedgerOutcomeStatus = "tracking" | "win" | "neutral" | "loss" | "needs_more_data";

const APPROVED_STATUSES = new Set(["approved"]);

function numberValue(value: unknown): number | null {
  if (value instanceof Prisma.Decimal) return value.toNumber();
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/^\$/, "")) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function daysBetween(start: Date | null, end: Date | null) {
  if (!start || !end) return 0;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
}

function normalizeOutcome(outcome: string): LedgerOutcomeStatus {
  if (outcome === "missing_data") return "needs_more_data";
  if (["tracking", "win", "neutral", "loss", "needs_more_data"].includes(outcome)) return outcome as LedgerOutcomeStatus;
  return "tracking";
}

export async function createSnapshotFromAlert(input: {
  alertId?: unknown;
  price?: unknown;
  capturedAt?: unknown;
  provider?: unknown;
  providerAssetId?: unknown;
  currency?: unknown;
  sourceUrl?: unknown;
  dataQuality?: unknown;
}) {
  const warnings: string[] = [];
  const alertId = typeof input.alertId === "string" ? input.alertId.trim() : "";
  if (!alertId) return { ok: false, result: "needs_more_data", error: "alertId is required.", warnings };

  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) return { ok: false, result: "needs_more_data", error: "Alert was not found.", warnings };
  if (!APPROVED_STATUSES.has(alert.status.toLowerCase())) {
    return { ok: false, result: "needs_more_data", alertStatus: alert.status, error: "Only approved alerts can create public price snapshots.", warnings };
  }

  const suppliedPrice = numberValue(input.price);
  const capturedAt = typeof input.capturedAt === "string" && !Number.isNaN(Date.parse(input.capturedAt)) ? new Date(input.capturedAt) : new Date();
  const provider = typeof input.provider === "string" && input.provider.trim() ? input.provider.trim() : "manual";
  const providerAssetId = typeof input.providerAssetId === "string" && input.providerAssetId.trim() ? input.providerAssetId.trim() : null;
  const currency = typeof input.currency === "string" && input.currency.trim() ? input.currency.trim().toUpperCase() : "USD";
  const sourceUrl = typeof input.sourceUrl === "string" && input.sourceUrl.trim() ? input.sourceUrl.trim() : null;
  const dataQuality = input.dataQuality === "live" ? "live" : "unverified";
  const existing = await prisma.priceSnapshot.findFirst({ where: { alertId: alert.id, provider }, orderBy: { capturedAt: "asc" } });

  if (suppliedPrice == null) {
    warnings.push("No live price provider or explicit price was available; no fake snapshot was created.");
    return { ok: true, result: "needs_more_data", alertId: alert.id, ticker: alert.ticker, snapshot: existing, warnings };
  }

  const latestSnapshot = await prisma.priceSnapshot.upsert({
    where: { alertId_provider_capturedAt: { alertId: alert.id, provider, capturedAt } },
    create: { alertId: alert.id, ticker: alert.ticker, price: new Prisma.Decimal(suppliedPrice), capturedAt, provider, providerAssetId, currency, sourceUrl, dataQuality },
    update: { price: new Prisma.Decimal(suppliedPrice), providerAssetId, currency, sourceUrl, dataQuality },
  });
  const snapshot = existing ?? latestSnapshot;

  return { ok: true, result: existing ? "updated_latest_price" : "created_first_snapshot", alertId: alert.id, ticker: alert.ticker, snapshot, latestSnapshot, warnings };
}

export async function updateLedgerOutcome(input: { ledgerId?: unknown; alertId?: unknown }) {
  const ledgerId = typeof input.ledgerId === "string" ? input.ledgerId.trim() : "";
  const alertId = typeof input.alertId === "string" ? input.alertId.trim() : "";
  const where = ledgerId ? { id: ledgerId } : alertId ? { alertId } : undefined;
  if (!where) return { ok: false, result: "needs_more_data", error: "ledgerId or alertId is required.", warnings: [] };

  const ledger = await prisma.publicLedger.findFirst({ where, include: { alert: true } });
  if (!ledger) return { ok: false, result: "needs_more_data", error: "Ledger entry was not found.", warnings: [] };

  const entry = asRecord(ledger.entry);
  const ticker = String(entry.ticker ?? ledger.alert?.ticker ?? "").trim().toUpperCase();
  const warnings: string[] = [];
  if (!ticker) warnings.push("Ledger entry has no ticker, so price snapshots cannot be matched.");

  const snapshots = ticker ? await prisma.priceSnapshot.findMany({ where: { alertId: ledger.alertId ?? undefined, ticker, dataQuality: "live" }, orderBy: { capturedAt: "asc" } }) : [];
  const priceAtAlert = numberValue(entry.priceAtAlert) ?? numberValue(snapshots[0]?.price);
  const publishedAt = ledger.alert?.publishedAt ?? ledger.createdAt;

  if (!snapshots.length) warnings.push("No price snapshots are available; outcome remains needs_more_data.");
  if (priceAtAlert == null) warnings.push("Missing priceAtAlert; outcome remains needs_more_data.");

  const preview = classifyAlertOutcome({
    alertId: String(entry.alertId ?? ledger.alertId ?? ledger.id),
    ticker,
    priceAtAlert: priceAtAlert ?? undefined,
    publishedAt: publishedAt.toISOString(),
    priceSnapshots: snapshots.map((snapshot) => ({ price: snapshot.price.toNumber(), capturedAt: snapshot.capturedAt.toISOString() })),
  });

  const latest = snapshots.at(-1) ?? null;
  const status = warnings.length ? "needs_more_data" : normalizeOutcome(preview.outcomePreview);
  const nextEntry: Prisma.InputJsonObject = {
    ...entry,
    ticker,
    priceAtAlert: priceAtAlert ?? null,
    latestPrice: latest ? latest.price.toString() : null,
    maxGain: preview.maxGain,
    maxDrawdown: preview.maxDrawdown,
    daysTracked: daysBetween(publishedAt, latest?.capturedAt ?? null),
    outcome: status,
    tracking: status === "tracking" || status === "needs_more_data",
    result1D: preview.result1D.returnPct == null ? null : `${round(preview.result1D.returnPct)}%`,
    result3D: preview.result3D.returnPct == null ? null : `${round(preview.result3D.returnPct)}%`,
    result7D: preview.result7D.returnPct == null ? null : `${round(preview.result7D.returnPct)}%`,
    result30D: preview.result30D.returnPct == null ? null : `${round(preview.result30D.returnPct)}%`,
    result90D: preview.result90D.returnPct == null ? null : `${round(preview.result90D.returnPct)}%`,
    warnings: Array.from(new Set([...(Array.isArray(entry.warnings) ? entry.warnings.filter((item): item is string => typeof item === "string") : []), ...warnings, ...preview.warnings])),
    outcomeUpdatedAt: new Date().toISOString(),
    result: status === "needs_more_data" ? "Needs more price data before outcome can be classified." : preview.simpleExplanation,
  };

  const updated = await prisma.publicLedger.update({ where: { id: ledger.id }, data: { entry: nextEntry } });
  return { ok: true, result: status, ledgerId: updated.id, publicSlug: updated.publicSlug, alertId: updated.alertId, outcome: status, latestPrice: nextEntry.latestPrice, priceAtAlert: nextEntry.priceAtAlert, maxGain: nextEntry.maxGain, maxDrawdown: nextEntry.maxDrawdown, daysTracked: nextEntry.daysTracked, warnings: nextEntry.warnings, ledgerEntry: nextEntry };
}
