import { Prisma, PrismaClient } from "@prisma/client";

import { normalizeHistoricalEvent, serializeHistoricalEvent, type HistoricalEventInput } from "@/lib/historical-events";

type HistoricalBackfillCandidate = HistoricalEventInput & { backfillKey: string };

export type HistoricalBackfillRejected = {
  key: string;
  reason: string;
};

export type HistoricalBackfillDuplicate = {
  key: string;
  existingId: string;
};

export type HistoricalBackfillCreated = {
  key: string;
  event: ReturnType<typeof serializeHistoricalEvent>;
};

export type HistoricalBackfillSummary = {
  dryRun: boolean;
  batchSize: number;
  eventsConsidered: number;
  eventsCreated: number;
  duplicatesSkipped: number;
  rejectedEvents: HistoricalBackfillRejected[];
  warnings: string[];
  nextRecommendedAction: string;
  created: HistoricalBackfillCreated[];
  duplicates: HistoricalBackfillDuplicate[];
};

const MAX_BATCH_SIZE = 10;
const DEFAULT_BATCH_SIZE = 5;

const CURATED_BACKFILL_EVENTS: HistoricalBackfillCandidate[] = [
  {
    backfillKey: "nvda-2023-05-24-guidance-raise",
    eventDate: "2023-05-24",
    ticker: "NVDA",
    company: "NVIDIA",
    sector: "Technology",
    industry: "Semiconductors",
    eventType: "guidance_raise",
    title: "NVIDIA reports fiscal Q1 2024 results and raises data-center guidance",
    eventSummary: "NVIDIA reported quarterly results and substantially higher revenue guidance, citing demand tied to accelerated computing and generative AI.",
    source: "NVIDIA Investor Relations",
    sourceUrl: "https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-first-quarter-fiscal-2024",
    sourceReceipts: [{ source: "NVIDIA Investor Relations", sourceUrl: "https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-first-quarter-fiscal-2024" }],
    marginTrend: "expanding",
    cashFlowTrend: "improving",
    sectorTrend: "AI infrastructure demand",
    outcome: "neutral",
    patternTags: ["guidance_raise", "ai_demand", "earnings"],
    notes: "Curated factual backfill. Forward performance fields intentionally omitted until verified market data is attached.",
  },
  {
    backfillKey: "biib-2019-03-21-trial-failure",
    eventDate: "2019-03-21",
    ticker: "BIIB",
    company: "Biogen",
    sector: "Health Care",
    industry: "Biotechnology",
    eventType: "trial_failure",
    title: "Biogen and Eisai discontinue aducanumab Phase 3 trials after futility analysis",
    eventSummary: "Biogen and Eisai announced they would discontinue two Phase 3 trials for aducanumab after an interim futility analysis.",
    source: "Biogen press release",
    sourceUrl: "https://investors.biogen.com/news-releases/news-release-details/biogen-and-eisai-discontinue-phase-3-engage-and-emerge-trials",
    sourceReceipts: [{ source: "Biogen press release", sourceUrl: "https://investors.biogen.com/news-releases/news-release-details/biogen-and-eisai-discontinue-phase-3-engage-and-emerge-trials" }],
    marginTrend: "uncertain",
    cashFlowTrend: "stable before catalyst",
    sectorTrend: "binary biotech catalyst risk",
    outcome: "neutral",
    patternTags: ["trial_failure", "binary_catalyst", "biotech"],
    notes: "Curated factual backfill. Forward performance fields intentionally omitted until verified market data is attached.",
  },
  {
    backfillKey: "pfe-2021-08-23-fda-approval",
    eventDate: "2021-08-23",
    ticker: "PFE",
    company: "Pfizer",
    sector: "Health Care",
    industry: "Pharmaceuticals",
    eventType: "fda_approval",
    title: "FDA approves first COVID-19 vaccine",
    eventSummary: "The FDA approved the Pfizer-BioNTech COVID-19 vaccine, a regulatory milestone after emergency authorization.",
    source: "U.S. Food and Drug Administration",
    sourceUrl: "https://www.fda.gov/news-events/press-announcements/fda-approves-first-covid-19-vaccine",
    sourceReceipts: [{ source: "U.S. Food and Drug Administration", sourceUrl: "https://www.fda.gov/news-events/press-announcements/fda-approves-first-covid-19-vaccine" }],
    sectorTrend: "vaccine regulatory milestone",
    outcome: "neutral",
    patternTags: ["fda_approval", "regulatory", "vaccine"],
    notes: "Curated factual backfill. Forward performance fields intentionally omitted until verified market data is attached.",
  },
  {
    backfillKey: "meta-2022-10-26-guidance-cut",
    eventDate: "2022-10-26",
    ticker: "META",
    company: "Meta Platforms",
    sector: "Communication Services",
    industry: "Internet Content & Information",
    eventType: "guidance_cut",
    title: "Meta reports Q3 2022 results amid slower growth and elevated expense outlook",
    eventSummary: "Meta reported quarterly results with investor focus on slower revenue growth, expense plans, and Reality Labs investment.",
    source: "Meta Investor Relations",
    sourceUrl: "https://investor.fb.com/investor-news/press-release-details/2022/Meta-Reports-Third-Quarter-2022-Results/default.aspx",
    sourceReceipts: [{ source: "Meta Investor Relations", sourceUrl: "https://investor.fb.com/investor-news/press-release-details/2022/Meta-Reports-Third-Quarter-2022-Results/default.aspx" }],
    marginTrend: "contracting",
    cashFlowTrend: "pressured",
    sectorTrend: "digital advertising slowdown",
    outcome: "neutral",
    patternTags: ["guidance_cut", "earnings", "expense_pressure"],
    notes: "Curated factual backfill. Forward performance fields intentionally omitted until verified market data is attached.",
  },
  {
    backfillKey: "jpm-2023-05-01-bank-acquisition",
    eventDate: "2023-05-01",
    ticker: "JPM",
    company: "JPMorgan Chase",
    sector: "Financials",
    industry: "Banks",
    eventType: "acquisition",
    title: "JPMorgan Chase assumes deposits and assets of First Republic Bank",
    eventSummary: "JPMorgan Chase acquired substantial assets and assumed deposits of First Republic Bank after regulators closed the bank.",
    source: "FDIC press release",
    sourceUrl: "https://www.fdic.gov/news/press-releases/2023/pr23034.html",
    sourceReceipts: [{ source: "FDIC press release", sourceUrl: "https://www.fdic.gov/news/press-releases/2023/pr23034.html" }],
    debtLevel: "bank balance sheet",
    sectorTrend: "regional bank stress",
    outcome: "neutral",
    patternTags: ["acquisition", "banking", "regulatory_resolution"],
    notes: "Curated factual backfill. Forward performance fields intentionally omitted until verified market data is attached.",
  },
];

export function historicalBackfillBatchSize(value: unknown) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_BATCH_SIZE), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_BATCH_SIZE;
  return Math.min(parsed, MAX_BATCH_SIZE, CURATED_BACKFILL_EVENTS.length);
}

export function historicalBackfillCandidates(limit: number) {
  return CURATED_BACKFILL_EVENTS.slice(0, historicalBackfillBatchSize(limit));
}

export async function runHistoricalEventBackfill(options: { dryRun?: boolean; limit?: number; prisma: Pick<PrismaClient, "historicalEvent"> }): Promise<HistoricalBackfillSummary> {
  const dryRun = options.dryRun !== false;
  const batchSize = historicalBackfillBatchSize(options.limit);
  const warnings = [
    "Backfill uses curated factual event metadata only; forward performance fields are intentionally left blank until verified market data is attached.",
    "Existing historical events are never overwritten by this runner.",
  ];
  const created: HistoricalBackfillCreated[] = [];
  const duplicates: HistoricalBackfillDuplicate[] = [];
  const rejectedEvents: HistoricalBackfillRejected[] = [];

  for (const candidate of historicalBackfillCandidates(batchSize)) {
    let data: Prisma.HistoricalEventCreateInput;
    try {
      data = normalizeHistoricalEvent(candidate);
    } catch (error) {
      rejectedEvents.push({ key: candidate.backfillKey, reason: error instanceof Error ? error.message : "Unable to normalize candidate." });
      continue;
    }

    const duplicateChecks: Prisma.HistoricalEventWhereInput[] = [
      { ticker: data.ticker, eventType: data.eventType, eventDate: data.eventDate, title: data.title },
    ];
    if (data.sourceUrl) duplicateChecks.push({ sourceUrl: data.sourceUrl });

    const existing = await options.prisma.historicalEvent.findFirst({
      where: { OR: duplicateChecks },
      select: { id: true },
    });

    if (existing) {
      duplicates.push({ key: candidate.backfillKey, existingId: existing.id });
      continue;
    }

    if (dryRun) continue;

    const event = await options.prisma.historicalEvent.create({ data });
    created.push({ key: candidate.backfillKey, event: serializeHistoricalEvent(event) });
  }

  const remaining = CURATED_BACKFILL_EVENTS.length - batchSize;
  return {
    dryRun,
    batchSize,
    eventsConsidered: batchSize,
    eventsCreated: created.length,
    duplicatesSkipped: duplicates.length,
    rejectedEvents,
    warnings: remaining > 0 ? [...warnings, `${remaining} curated events remain after this controlled batch.`] : warnings,
    nextRecommendedAction: dryRun
      ? "Review warnings and duplicates, then POST with {\"dryRun\":false,\"limit\":5} only after Build 101 is merged and healthchecked."
      : "Run another small dry run before creating the next batch; verify /api/historical-events?limit=20 after each batch.",
    created,
    duplicates,
  };
}
