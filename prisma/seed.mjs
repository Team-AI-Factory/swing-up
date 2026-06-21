import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const now = new Date();

const defaultSources = [
  {
    source: "Database",
    status: "connected",
    lastSuccessAt: now,
    responseTimeMs: null,
    usage: "Railway PostgreSQL connection check",
    notes: "Railway PostgreSQL connection is available.",
  },
  {
    source: "SEC EDGAR",
    status: "stubbed",
    usage: "Public filings source placeholder",
    notes: "SEC EDGAR integration is stubbed until filing ingestion is added.",
  },
  { source: "FMP", status: "not_configured", usage: "Paid market API placeholder", notes: "API key not configured yet." },
  { source: "GDELT", status: "stubbed", usage: "Public events/news placeholder", notes: "GDELT ingestion is stubbed until background jobs are added." },
  { source: "FRED", status: "not_configured", usage: "Macro data key placeholder", notes: "API key not configured yet." },
  { source: "openFDA", status: "degraded", usage: "Required public openFDA regulatory ear", notes: "Real openFDA adapter is wired; live API checks update this row with connected/degraded/failed status. OPENFDA_API_KEY is used when configured." },
  { source: "ClinicalTrials.gov", status: "stubbed", usage: "Public trials API placeholder", notes: "ClinicalTrials.gov integration is stubbed for future trial status changes." },
  { source: "Google News RSS", status: "degraded", usage: "Required public Google News RSS ear", notes: "Real Google News RSS adapter is wired; live RSS checks update this row with connected/degraded/failed status. No API key required." },
  { source: "CoinGecko", status: "stubbed", usage: "Public crypto API placeholder", notes: "CoinGecko integration is stubbed for crypto market context." },
  { source: "Frankfurter FX", status: "stubbed", usage: "Public FX API placeholder", notes: "Frankfurter FX integration is stubbed for foreign exchange context." },
  { source: "AI Committee", status: "stubbed", usage: "No real AI calls", notes: "AI Committee is stubbed and does not call AI providers." },
  { source: "Telegram", status: "not_configured", usage: "Notification integration placeholder", notes: "Notification integration not connected yet." },
  { source: "Stripe Managed Payments", status: "not_configured", usage: "Payments provider placeholder", notes: "Payment integration will be added last." },
];

async function main() {
  for (const sourceHealth of defaultSources) {
    await prisma.sourceHealth.upsert({
      where: { source: sourceHealth.source },
      update: {
        status: sourceHealth.status,
        checkedAt: now,
        lastSuccessAt: sourceHealth.lastSuccessAt,
        responseTimeMs: sourceHealth.responseTimeMs,
        errorMessage: null,
        usage: sourceHealth.usage,
        notes: sourceHealth.notes,
      },
      create: {
        ...sourceHealth,
        checkedAt: now,
        errorMessage: null,
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log(`Seeded ${defaultSources.length} source health rows safely.`);
  })
  .catch(async (error) => {
    console.error("Source health seed failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
