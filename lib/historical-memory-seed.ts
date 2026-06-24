import { prisma } from "@/lib/db/client";
import { getR2OperationalStatus, saveJsonToR2 } from "@/lib/r2-warehouse";

export type HistoricalMemorySeedInput = { dryRun?: boolean; maxEventsToSeed?: number; maxTickers?: number; confirmRun?: boolean };
type Obj = Record<string, unknown>;
const REDACTION_MODE = "metadata_only_safe_errors";

function asObj(v: unknown): Obj { return v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {}; }
function text(...values: unknown[]) { for (const v of values) if (typeof v === "string" && v.trim()) return v.trim(); return null; }
function num(v: unknown) { const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v); return Number.isFinite(n) ? n : null; }
function dateOnly(v: unknown) { const d = v instanceof Date ? v : typeof v === "string" || typeof v === "number" ? new Date(v) : null; return d && Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null; }
function safeTicker(v: unknown) { return text(v)?.toUpperCase().replace(/[^A-Z0-9.-]/g, "") || null; }
function unique<T>(items: T[]) { return [...new Set(items)]; }
function pct(before: number | null, after: number | null) { return before && after ? Number(((after - before) / before).toFixed(4)) : null; }
function eventIdFor(event: Obj) { return String(event.id ?? `${event.ticker}-${event.eventDate}-${event.eventType}`).replace(/[^A-Za-z0-9._=-]+/g, "-").slice(0, 120); }
function proofTypesFrom(payload: Obj, source: string | null) {
  const receipts = Array.isArray(payload.sourceReceipts) ? payload.sourceReceipts : Array.isArray(payload.receipts) ? payload.receipts : [];
  const fromReceipts = receipts.map((r) => text(asObj(r).type, asObj(r).sourceType, asObj(r).source)).filter(Boolean) as string[];
  return unique([text(payload.proofType, payload.proof_type), source, ...fromReceipts].filter(Boolean) as string[]);
}

function normalizeRawSignal(signal: Obj): Obj | null {
  const payload = asObj(signal.payload);
  const ticker = safeTicker(signal.ticker ?? payload.ticker ?? payload.symbol);
  const eventDate = dateOnly(signal.receivedAt ?? signal.createdAt ?? payload.eventDate ?? payload.publishedAt);
  if (!ticker || !eventDate) return null;
  const source = text(signal.source, payload.source, payload.sourceType);
  return {
    id: text(signal.id) ?? eventIdFor({ ticker, eventDate, eventType: signal.signalType }),
    ticker,
    company: text(payload.company, payload.companyName, payload.name),
    eventDate,
    eventType: text(payload.eventType, payload.catalystType, signal.signalType) ?? "general",
    sourceType: source ?? "stored_raw_signal",
    proofTypes: proofTypesFrom(payload, source),
    catalystType: text(payload.catalystType, payload.catalyst_type, payload.eventType, signal.signalType) ?? "unknown",
    title: text(signal.title, payload.title, payload.headline) ?? "Untitled historical signal",
    sourceUrl: text(signal.sourceUrl, payload.sourceUrl, payload.url),
    confidence: num(payload.confidence ?? payload.confidenceScore ?? payload.score),
    storedFrom: "postgres.raw_signals",
  };
}

function normalizeHistoricalEvent(event: Obj): Obj | null {
  const ticker = safeTicker(event.ticker);
  const eventDate = dateOnly(event.eventDate);
  if (!ticker || !eventDate) return null;
  const source = text(event.source);
  return {
    id: text(event.id) ?? eventIdFor({ ...event, ticker, eventDate }),
    ticker,
    company: text(event.companyName, event.company),
    eventDate,
    eventType: text(event.eventType) ?? "general",
    sourceType: source ?? "stored_historical_event",
    proofTypes: proofTypesFrom(asObj(event), source),
    catalystType: text(event.eventType) ?? "unknown",
    title: text(event.title, event.summary) ?? "Stored historical event",
    sourceUrl: text(event.sourceUrl),
    confidence: text(event.outcomeLabel) && event.outcomeLabel !== "unknown" ? 0.7 : null,
    storedFrom: "postgres.historical_events",
  };
}

function labelsFromHistoricalEvent(event: Obj) {
  const before = num(event.priceBefore);
  const outcome1d = pct(before, num(event.priceAfter1d));
  const outcome7d = pct(before, num(event.priceAfter7d));
  const outcome30d = pct(before, num(event.priceAfter30d));
  const maxDrawdown30d = num(event.maxDrawdown);
  if ([outcome1d, outcome7d, outcome30d, maxDrawdown30d].every((v) => v === null)) return null;
  return { outcome1d, outcome7d, outcome30d, maxDrawdown30d, winLoss7d: outcome7d === null ? null : outcome7d > 0 ? "win" : "loss", winLoss30d: outcome30d === null ? null : outcome30d > 0 ? "win" : "loss", labelSource: "postgres.historical_events.real_price_fields" };
}

async function storedCounts() {
  if (!process.env.DATABASE_URL) return { rawSignals: 0, historicalEvents: 0, sourceRuns: 0, memoryEvents: 0, memoryOutcomes: 0, stage1Payloads: 0 };
  const [rawSignals, historicalEvents, sourceRuns, memoryEvents, memoryOutcomes, stage1Payloads] = await Promise.all([
    prisma.rawSignal.count().catch(() => 0),
    prisma.historicalEvent.count().catch(() => 0),
    prisma.sourceRun.count().catch(() => 0),
    prisma.rawDataObject.count({ where: { r2Key: { startsWith: "historical-memory/events/" } } }).catch(() => 0),
    prisma.rawDataObject.count({ where: { r2Key: { startsWith: "historical-memory/outcomes/" } } }).catch(() => 0),
    prisma.rawDataObject.count({ where: { OR: [{ r2Key: { contains: "stage1" } }, { r2Key: { contains: "candidate-raw-signals" } }] } }).catch(() => 0),
  ]);
  return { rawSignals, historicalEvents, sourceRuns, memoryEvents, memoryOutcomes, stage1Payloads };
}

export async function getHistoricalMemorySeedStatus() {
  const r2 = await getR2OperationalStatus({ allowRuntimeWriteCheck: false });
  const counts = await storedCounts();
  const tickers = process.env.DATABASE_URL ? await prisma.rawDataObject.findMany({ where: { r2Key: { startsWith: "historical-memory/events/" } }, select: { normalizedSymbol: true }, distinct: ["normalizedSymbol"], take: 500 }).catch(() => []) : [];
  const warnings = [counts.rawSignals + counts.historicalEvents + counts.memoryEvents < 5 ? "Small historical sample: fewer than 5 stored events are available, so pattern matches must stay weak." : null, counts.memoryOutcomes === 0 ? "No real outcome labels are stored yet; outcome-based pattern proof is unavailable." : null].filter(Boolean) as string[];
  return { enabled: true, r2Available: r2.writeAvailable, storedRawSignalsAvailable: counts.rawSignals > 0, storedEventsFound: counts.rawSignals + counts.historicalEvents + counts.memoryEvents, eventsWithOutcomeLabels: counts.memoryOutcomes, tickersWithMemory: unique(tickers.map((t) => t.normalizedSymbol).filter(Boolean) as string[]), sampleSizeWarnings: warnings, secretsRedacted: true, redactionMode: REDACTION_MODE, sourceRunHistoryAvailable: counts.sourceRuns > 0, stage1PayloadsAvailable: counts.stage1Payloads > 0 };
}

export async function runHistoricalMemorySeed(input: HistoricalMemorySeedInput = {}) {
  const dryRun = input.dryRun !== false;
  const confirmRun = input.confirmRun === true;
  const maxEvents = Math.max(1, Math.min(input.maxEventsToSeed ?? 100, 250));
  const maxTickers = Math.max(1, Math.min(input.maxTickers ?? 20, 100));
  const r2 = await getR2OperationalStatus({ allowRuntimeWriteCheck: false });
  const warnings = ["Seed uses only existing stored rows and real stored price fields; no synthetic history or fake outcomes are generated."];
  let rawSignals: Obj[] = [], historicalEvents: Obj[] = [];
  if (process.env.DATABASE_URL) {
    rawSignals = await prisma.rawSignal.findMany({ where: { ticker: { not: null } }, orderBy: { receivedAt: "desc" }, take: maxEvents * 2 }).catch(() => []) as unknown as Obj[];
    historicalEvents = await prisma.historicalEvent.findMany({ orderBy: { eventDate: "desc" }, take: maxEvents * 2 }).catch(() => []) as unknown as Obj[];
  } else warnings.push("DATABASE_URL is not configured, so stored Postgres samples are unavailable.");
  const normalized = [...historicalEvents.map(normalizeHistoricalEvent), ...rawSignals.map(normalizeRawSignal)].filter(Boolean) as Obj[];
  const seenTickers = new Set<string>(); const selected: Obj[] = [];
  for (const event of normalized) { const ticker = String(event.ticker); if (!seenTickers.has(ticker) && seenTickers.size >= maxTickers) continue; seenTickers.add(ticker); if (!selected.some((e) => eventIdFor(e) === eventIdFor(event))) selected.push(event); if (selected.length >= maxEvents) break; }
  const outcomes = selected.map((event) => ({ event, labels: labelsFromHistoricalEvent(historicalEvents.find((h) => text(h.id) === text(event.id)) ?? {}) })).filter((x) => x.labels);
  let eventsSaved = 0, outcomesSaved = 0; let r2SaveStatus = dryRun ? "skipped_dry_run" : !confirmRun ? "skipped_confirm_run_false" : !r2.writeAvailable ? "skipped_r2_write_not_confirmed_or_unavailable" : "not_attempted";
  if (!dryRun && confirmRun && r2.writeAvailable) {
    for (const event of selected) { const key = `historical-memory/events/${event.ticker}/${event.eventDate}/${eventIdFor(event)}.json`; try { await saveJsonToR2(key, event, { source: "historical-memory-seed", assetType: "stocks", symbol: String(event.ticker), dataType: "historical-memory-event", recordCount: 1 }); eventsSaved++; } catch { r2SaveStatus = "failed_safe"; } }
    for (const { event, labels } of outcomes) { const key = `historical-memory/outcomes/${event.ticker}/${event.eventDate}/${eventIdFor(event)}.json`; try { await saveJsonToR2(key, labels, { source: "historical-memory-seed", assetType: "stocks", symbol: String(event.ticker), dataType: "historical-memory-outcome", recordCount: 1 }); outcomesSaved++; } catch { r2SaveStatus = "failed_safe"; } }
    if (r2SaveStatus !== "failed_safe") r2SaveStatus = "saved";
  }
  if (selected.length < 5) warnings.push(`Small historical sample: only ${selected.length} event(s) found; pattern proof needs more real samples.`);
  if (outcomes.length === 0) warnings.push("No real price outcome labels found in stored price fields for selected events.");
  return { ok: true, enabled: true, dryRun, confirmRun, r2Available: r2.writeAvailable, storedRawSignalsAvailable: rawSignals.length > 0, storedEventsFound: normalized.length, eventsSeeded: dryRun || !confirmRun || !r2.writeAvailable ? 0 : eventsSaved, eventsPrepared: selected.length, eventsWithOutcomeLabels: outcomes.length, outcomesSeeded: dryRun || !confirmRun || !r2.writeAvailable ? 0 : outcomesSaved, tickersWithMemory: unique(selected.map((e) => String(e.ticker))), sampleSizeWarnings: warnings, r2SaveStatus, secretsRedacted: true, redactionMode: REDACTION_MODE, safety: { callsOpenAI: false, publishesAlerts: false, sendsTelegram: false }, previewEvents: selected.slice(0, 5), previewOutcomes: outcomes.slice(0, 5).map((x) => ({ eventId: eventIdFor(x.event), ticker: x.event.ticker, eventDate: x.event.eventDate, labels: x.labels })) };
}
