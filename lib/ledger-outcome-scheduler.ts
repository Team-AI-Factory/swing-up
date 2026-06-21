import { Prisma } from "@prisma/client";
import { classifyAlertOutcome } from "@/lib/alert-outcome-classifier";
import { prisma } from "@/lib/db/client";
import type { LedgerOutcomeStatus } from "@/lib/ledger-outcome-worker";

type SchedulerInput = { dryRun?: unknown; ledgerId?: unknown; limit?: unknown; confirmUpdate?: unknown };
type CheckpointKey = "result1D" | "result3D" | "result7D" | "result30D" | "result90D";

const FINAL_OUTCOMES = new Set(["win", "neutral", "loss"]);
const CHECKPOINTS: Array<{ days: number; key: CheckpointKey; label: string }> = [
  { days: 1, key: "result1D", label: "1D" },
  { days: 3, key: "result3D", label: "3D" },
  { days: 7, key: "result7D", label: "7D" },
  { days: 30, key: "result30D", label: "30D" },
  { days: 90, key: "result90D", label: "90D" },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function boolValue(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true" ? true : value.toLowerCase() === "false" ? false : fallback;
  return fallback;
}

function positiveInt(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 50) : fallback;
}

function numberValue(value: unknown): number | null {
  if (value instanceof Prisma.Decimal) return value.toNumber();
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/^\$/, "")) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function daysBetween(start: Date, end: Date) {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
}

function pctText(value: number | null) {
  return value == null ? null : `${Math.round(value * 100) / 100}%`;
}

function normalizeOutcome(value: unknown): LedgerOutcomeStatus {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (["tracking", "win", "neutral", "loss", "needs_more_data"].includes(normalized)) return normalized as LedgerOutcomeStatus;
  return "tracking";
}

function finalOutcome(previewOutcome: string, ninetyDayReturn: number | null, latestReturn: number | null): LedgerOutcomeStatus {
  if (ninetyDayReturn == null && latestReturn == null) return "needs_more_data";
  if (["win", "neutral", "loss"].includes(previewOutcome)) return previewOutcome as LedgerOutcomeStatus;
  return "tracking";
}

export async function runLedgerOutcomeScheduler(input: SchedulerInput) {
  const dryRun = boolValue(input.dryRun, true);
  const confirmUpdate = boolValue(input.confirmUpdate, false);
  const ledgerId = typeof input.ledgerId === "string" ? input.ledgerId.trim() : "";
  const limit = positiveInt(input.limit, 10);
  const warnings: string[] = [];

  if (!dryRun && !confirmUpdate) {
    return { ok: false, dryRun, ledgerRowsChecked: 0, ledgerRowsUpdated: 0, skipped: [{ reason: "confirmUpdate=true is required when dryRun=false." }], missingPriceData: [], calculatedResults: [], warnings, nextRecommendedAction: "Retry with dryRun=true first, then pass confirmUpdate=true only when the calculated changes look correct." };
  }

  const rows = await prisma.publicLedger.findMany({
    where: ledgerId ? { id: ledgerId } : undefined,
    include: { alert: true },
    orderBy: { createdAt: "asc" },
    take: ledgerId ? 1 : limit,
  });

  const calculatedResults = [];
  const skipped = [];
  const missingPriceData = [];
  let ledgerRowsUpdated = 0;
  const now = new Date();

  for (const row of rows) {
    const entry = asRecord(row.entry);
    const currentOutcome = normalizeOutcome(entry.outcome ?? entry.status);
    if (!ledgerId && FINAL_OUTCOMES.has(currentOutcome)) {
      skipped.push({ ledgerId: row.id, publicSlug: row.publicSlug, reason: `Final outcome is already ${currentOutcome}; not overwriting historical outcome.` });
      continue;
    }

    const publishedAt = row.alert?.publishedAt ?? row.createdAt;
    const ticker = String(entry.ticker ?? row.alert?.ticker ?? "").trim().toUpperCase();
    const rowWarnings: string[] = [];
    if (!ticker) rowWarnings.push("Ledger row has no ticker; price snapshots cannot be matched.");
    const dueCheckpoints = CHECKPOINTS.filter((checkpoint) => daysBetween(publishedAt, now) >= checkpoint.days).map((checkpoint) => checkpoint.label);
    if (!dueCheckpoints.length) rowWarnings.push("No outcome checkpoint is due yet for this alert time.");

    const snapshots = ticker ? await prisma.priceSnapshot.findMany({ where: { ticker }, orderBy: { capturedAt: "asc" } }) : [];
    const priceAtAlert = numberValue(entry.priceAtAlert ?? entry.alertPrice) ?? numberValue(snapshots[0]?.price);
    if (!snapshots.length || priceAtAlert == null) missingPriceData.push({ ledgerId: row.id, publicSlug: row.publicSlug, ticker: ticker || null, reason: !snapshots.length ? "No stored price snapshots found." : "Missing price at alert." });

    const preview = classifyAlertOutcome({
      alertId: String(row.alertId ?? row.id),
      ticker,
      priceAtAlert: priceAtAlert ?? undefined,
      publishedAt: publishedAt.toISOString(),
      priceSnapshots: snapshots.map((snapshot) => ({ price: snapshot.price.toNumber(), capturedAt: snapshot.capturedAt.toISOString() })),
    });
    const latest = snapshots.at(-1) ?? null;
    const latestReturn = priceAtAlert && latest ? Math.round(((latest.price.toNumber() - priceAtAlert) / priceAtAlert) * 10000) / 100 : null;
    const enoughForFinal = daysBetween(publishedAt, now) >= 90 && preview.result90D.returnPct != null;
    const outcome = enoughForFinal ? finalOutcome(preview.outcomePreview, preview.result90D.returnPct, latestReturn) : (snapshots.length && priceAtAlert ? "tracking" : "needs_more_data");

    const nextEntry: Record<string, unknown> = { ...entry, ticker, priceAtAlert, latestPrice: latest ? latest.price.toString() : null, latestResult: pctText(latestReturn), maxGain: preview.maxGain, maxDrawdown: preview.maxDrawdown, daysTracked: latest ? daysBetween(publishedAt, latest.capturedAt) : 0, outcome, tracking: outcome === "tracking" || outcome === "needs_more_data", outcomeUpdatedAt: now.toISOString(), result: outcome === "needs_more_data" ? "Needs price data before ledger outcome can be classified." : preview.simpleExplanation, warnings: Array.from(new Set([...rowWarnings, ...preview.warnings])) };

    for (const checkpoint of CHECKPOINTS) {
      if (dueCheckpoints.includes(checkpoint.label)) nextEntry[checkpoint.key] = pctText(preview[checkpoint.key].returnPct);
    }

    calculatedResults.push({ ledgerId: row.id, publicSlug: row.publicSlug, alertId: row.alertId, ticker, dueCheckpoints, latestResult: nextEntry.latestResult, result1D: nextEntry.result1D ?? null, result3D: nextEntry.result3D ?? null, result7D: nextEntry.result7D ?? null, result30D: nextEntry.result30D ?? null, result90D: nextEntry.result90D ?? null, maxGain: preview.maxGain, maxDrawdown: preview.maxDrawdown, currentOutcome, calculatedOutcome: outcome, warnings: nextEntry.warnings });

    if (!dryRun) {
      await prisma.publicLedger.update({ where: { id: row.id }, data: { entry: nextEntry as Prisma.InputJsonObject } });
      ledgerRowsUpdated += 1;
    }
  }

  return { ok: true, dryRun, ledgerRowsChecked: rows.length, ledgerRowsUpdated, skipped, missingPriceData, calculatedResults, warnings, nextRecommendedAction: dryRun ? "Review calculatedResults, then rerun with dryRun=false and confirmUpdate=true if the changes are correct." : "Open /ledger and public alert pages to verify the updated outcomes are visible." };
}
