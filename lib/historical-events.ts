import { Prisma } from "@prisma/client";

export const HISTORICAL_EVENT_OUTCOMES = ["winner", "neutral", "loser"] as const;
export type HistoricalEventOutcome = (typeof HISTORICAL_EVENT_OUTCOMES)[number];

const VALID_OUTCOMES = new Set<string>(HISTORICAL_EVENT_OUTCOMES);
const DEFAULT_OUTCOME: HistoricalEventOutcome = "neutral";

export type HistoricalEventInput = Record<string, unknown>;

function cleanString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function cleanUpper(value: unknown) {
  return cleanString(value).toUpperCase();
}

function cleanDate(value: unknown) {
  const raw = cleanString(value);
  if (!raw) return null;
  const date = new Date(`${raw.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cleanDecimal(value: unknown, scale = 2) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return new Prisma.Decimal(parsed.toFixed(scale));
}

function cleanJsonArray(value: unknown): Prisma.InputJsonArray {
  return Array.isArray(value) ? (value.filter((item) => item !== undefined) as Prisma.InputJsonArray) : [];
}

function cleanJsonObject(value: unknown): Prisma.InputJsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Prisma.InputJsonObject) : {};
}

function outcome(value: unknown): HistoricalEventOutcome {
  const raw = cleanString(value).toLowerCase();
  return VALID_OUTCOMES.has(raw) ? (raw as HistoricalEventOutcome) : DEFAULT_OUTCOME;
}

function first(input: HistoricalEventInput, ...keys: string[]) {
  for (const key of keys) {
    if (input[key] !== undefined) return input[key];
  }
  return undefined;
}

export function normalizeHistoricalEvent(input: HistoricalEventInput): Prisma.HistoricalEventCreateInput {
  const eventDate = cleanDate(first(input, "eventDate", "event_date"));
  if (!eventDate) throw new Error("eventDate is required and must be a valid date.");

  const ticker = cleanUpper(input.ticker);
  const eventType = cleanString(first(input, "eventType", "event_type"), "general_event");
  if (!ticker) throw new Error("ticker is required.");

  const company = cleanString(first(input, "company", "companyName", "company_name")) || null;
  const summary = cleanString(first(input, "eventSummary", "summary")) || null;
  const sourceReceipts = cleanJsonArray(first(input, "sourceReceipts", "source_receipts"));
  const patternTags = cleanJsonArray(first(input, "patternTags", "pattern_tags"));
  const analystChanges = cleanJsonArray(first(input, "analystChanges", "analyst_changes"));
  const macroSnapshot = cleanJsonObject(first(input, "macroSnapshot", "macro_snapshot"));

  return {
    ticker,
    companyName: company,
    sector: cleanString(input.sector) || null,
    industry: cleanString(input.industry) || null,
    eventType,
    eventDate,
    title: cleanString(input.title) || summary?.slice(0, 120) || `${ticker} ${eventType}`,
    summary,
    source: cleanString(input.source) || (sourceReceipts[0] && typeof sourceReceipts[0] === "object" && "source" in sourceReceipts[0] ? cleanString((sourceReceipts[0] as Record<string, unknown>).source) : null),
    sourceUrl: cleanString(first(input, "sourceUrl", "source_url")) || null,
    sourceReceipts,
    priceBefore: cleanDecimal(first(input, "priceBeforeEvent", "priceBefore", "price_before")),
    priceAfter1d: cleanDecimal(first(input, "priceAfter1D", "priceAfter1d", "price_after_1d")),
    priceAfter3d: cleanDecimal(first(input, "priceAfter3D", "priceAfter3d", "price_after_3d")),
    priceAfter7d: cleanDecimal(first(input, "priceAfter7D", "priceAfter7d", "price_after_7d")),
    priceAfter30d: cleanDecimal(first(input, "priceAfter30D", "priceAfter30d", "price_after_30d")),
    priceAfter90d: cleanDecimal(first(input, "priceAfter90D", "priceAfter90d", "price_after_90d")),
    maxGain: cleanDecimal(first(input, "maxGain", "max_gain"), 4),
    maxDrawdown: cleanDecimal(first(input, "maxDrawdown", "max_drawdown"), 4),
    volumeBeforeEvent: cleanDecimal(first(input, "volumeBeforeEvent", "volume_before_event")),
    volumeAfterEvent: cleanDecimal(first(input, "volumeAfterEvent", "volume_after_event")),
    revenueGrowthAtTime: cleanDecimal(first(input, "revenueGrowthAtTime", "revenue_growth_at_time"), 4),
    marginTrend: cleanString(first(input, "marginTrend", "margin_trend")) || null,
    cashFlowTrend: cleanString(first(input, "cashFlowTrend", "cash_flow_trend")) || null,
    debtLevel: cleanString(first(input, "debtLevel", "debt_level")) || null,
    valuationAtTime: cleanString(first(input, "valuationAtTime", "valuation_at_time")) || null,
    analystChanges,
    insiderActivity: cleanString(first(input, "insiderActivity", "insider_activity")) || null,
    macroSnapshot,
    sectorTrend: cleanString(first(input, "sectorTrend", "sector_trend")) || null,
    outcomeLabel: outcome(first(input, "outcome", "outcomeLabel", "outcome_label")),
    patternTags,
    notes: cleanString(input.notes) || "Mock/preview historical event; not a real alert.",
    forwardReturns: {
      priceAfter1D: first(input, "priceAfter1D", "priceAfter1d", "price_after_1d") ?? null,
      priceAfter3D: first(input, "priceAfter3D", "priceAfter3d", "price_after_3d") ?? null,
      priceAfter7D: first(input, "priceAfter7D", "priceAfter7d", "price_after_7d") ?? null,
      priceAfter30D: first(input, "priceAfter30D", "priceAfter30d", "price_after_30d") ?? null,
      priceAfter90D: first(input, "priceAfter90D", "priceAfter90d", "price_after_90d") ?? null,
    },
  };
}

export function serializeHistoricalEvent(event: Record<string, unknown>) {
  const decimal = (value: unknown) => value instanceof Prisma.Decimal ? value.toString() : value ?? null;
  const date = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : value ?? null;
  return {
    id: event.id,
    eventDate: date(event.eventDate),
    ticker: event.ticker,
    company: event.companyName ?? null,
    sector: event.sector ?? null,
    industry: event.industry ?? null,
    eventType: event.eventType,
    eventSummary: event.summary ?? event.title ?? null,
    sourceReceipts: event.sourceReceipts ?? [],
    priceBeforeEvent: decimal(event.priceBefore),
    priceAfter1D: decimal(event.priceAfter1d),
    priceAfter3D: decimal(event.priceAfter3d),
    priceAfter7D: decimal(event.priceAfter7d),
    priceAfter30D: decimal(event.priceAfter30d),
    priceAfter90D: decimal(event.priceAfter90d),
    maxGain: decimal(event.maxGain),
    maxDrawdown: decimal(event.maxDrawdown),
    volumeBeforeEvent: decimal(event.volumeBeforeEvent),
    volumeAfterEvent: decimal(event.volumeAfterEvent),
    revenueGrowthAtTime: decimal(event.revenueGrowthAtTime),
    marginTrend: event.marginTrend ?? null,
    cashFlowTrend: event.cashFlowTrend ?? null,
    debtLevel: event.debtLevel ?? null,
    valuationAtTime: event.valuationAtTime ?? null,
    analystChanges: event.analystChanges ?? [],
    insiderActivity: event.insiderActivity ?? null,
    macroSnapshot: event.macroSnapshot ?? {},
    sectorTrend: event.sectorTrend ?? null,
    outcome: event.outcomeLabel ?? "neutral",
    patternTags: event.patternTags ?? [],
    createdAt: event.createdAt instanceof Date ? event.createdAt.toISOString() : event.createdAt ?? null,
    mockPreview: event.notes ? String(event.notes).toLowerCase().includes("mock") : false,
  };
}

export const mockHistoricalEvents: HistoricalEventInput[] = [
  {
    eventDate: "2023-05-24", ticker: "NVDA", company: "NVIDIA", sector: "Technology", industry: "Semiconductors", eventType: "guidance_raise",
    eventSummary: "Mock preview event: AI demand supported a large guidance reset.", sourceReceipts: [{ source: "Mock earnings release", note: "Preview data only" }],
    priceBeforeEvent: 305.38, priceAfter1D: 379.8, priceAfter3D: 389.46, priceAfter7D: 378.34, priceAfter30D: 422.09, priceAfter90D: 471.63,
    maxGain: 0.54, maxDrawdown: -0.04, volumeBeforeEvent: 72100000, volumeAfterEvent: 154000000, revenueGrowthAtTime: 0.19,
    marginTrend: "expanding", cashFlowTrend: "improving", debtLevel: "manageable", valuationAtTime: "premium", analystChanges: [{ action: "upgrades", count: 8 }],
    insiderActivity: "no major preview signal", macroSnapshot: { rates: "elevated", riskMood: "constructive" }, sectorTrend: "AI infrastructure leadership", outcome: "winner", patternTags: ["ai_demand", "guidance_reset", "high_volume"],
  },
  {
    eventDate: "2023-05-01", ticker: "JPM", company: "JPMorgan Chase", sector: "Financials", industry: "Banks", eventType: "sec_filing",
    eventSummary: "Mock preview event: regulatory filing around a bank acquisition had limited sustained follow-through.", sourceReceipts: [{ source: "Mock SEC filing", note: "Preview data only" }],
    priceBeforeEvent: 138.24, priceAfter1D: 141.2, priceAfter3D: 139.89, priceAfter7D: 136.74, priceAfter30D: 135.71, priceAfter90D: 154.32,
    maxGain: 0.12, maxDrawdown: -0.04, volumeBeforeEvent: 12400000, volumeAfterEvent: 23800000, revenueGrowthAtTime: 0.06,
    marginTrend: "stable", cashFlowTrend: "stable", debtLevel: "bank balance sheet", valuationAtTime: "near historical range", analystChanges: [],
    insiderActivity: "none in mock preview", macroSnapshot: { creditConditions: "tight" }, sectorTrend: "regional bank stress", outcome: "neutral", patternTags: ["filing", "banking", "limited_follow_through"],
  },
  {
    eventDate: "2019-03-21", ticker: "BIIB", company: "Biogen", sector: "Health Care", industry: "Biotechnology", eventType: "trial_failure",
    eventSummary: "Mock preview event: late-stage trial failure created a sharp downside reference case.", sourceReceipts: [{ source: "Mock company release", note: "Preview data only" }],
    priceBeforeEvent: 320.59, priceAfter1D: 226.88, priceAfter3D: 224.11, priceAfter7D: 233.18, priceAfter30D: 235.67, priceAfter90D: 234.9,
    maxGain: 0.03, maxDrawdown: -0.31, volumeBeforeEvent: 2100000, volumeAfterEvent: 27600000, revenueGrowthAtTime: -0.01,
    marginTrend: "uncertain", cashFlowTrend: "stable before catalyst", debtLevel: "manageable", valuationAtTime: "pipeline-sensitive", analystChanges: [{ action: "downgrades", count: 12 }],
    insiderActivity: "none in mock preview", macroSnapshot: { defensiveSector: true }, sectorTrend: "binary biotech catalyst risk", outcome: "loser", patternTags: ["trial_failure", "binary_catalyst", "gap_down"],
  },
];
