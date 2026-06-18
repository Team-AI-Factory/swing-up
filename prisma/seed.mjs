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
    notes: "Primary operational database for Swing Up.",
  },
  {
    source: "SEC EDGAR",
    status: "not_configured",
    usage: "API key / user agent placeholder",
    notes: "Future filings ear for public company disclosures.",
  },
  { source: "FMP", status: "not_configured", usage: "Paid market API placeholder", notes: "No real paid market API calls are enabled." },
  { source: "GDELT", status: "stubbed", usage: "Public events/news placeholder", notes: "Stubbed until ingestion jobs are added." },
  { source: "FRED", status: "not_configured", usage: "Macro data key placeholder", notes: "Future macro indicator source." },
  { source: "openFDA", status: "stubbed", usage: "Public health API placeholder", notes: "Stubbed source for regulatory and medical event signals." },
  { source: "ClinicalTrials.gov", status: "stubbed", usage: "Public trials API placeholder", notes: "Stubbed source for clinical trial status changes." },
  { source: "Google News RSS", status: "stubbed", usage: "RSS polling placeholder", notes: "Stubbed source for broad news monitoring." },
  { source: "CoinGecko", status: "stubbed", usage: "Public crypto API placeholder", notes: "Stubbed source for crypto market context." },
  { source: "Frankfurter FX", status: "stubbed", usage: "Public FX API placeholder", notes: "Stubbed source for foreign exchange context." },
  { source: "AI Committee", status: "stubbed", usage: "No real AI calls", notes: "Committee logic is a placeholder and does not call AI providers." },
  { source: "Telegram", status: "not_configured", usage: "Bot token placeholder", notes: "No Telegram integration is configured." },
  { source: "Stripe Managed Payments", status: "not_configured", usage: "Payments provider placeholder", notes: "Stripe is intentionally not added in Source Health v1." },
];

async function main() {
  for (const sourceHealth of defaultSources) {
    const existing = await prisma.sourceHealth.findFirst({ where: { source: sourceHealth.source } });

    if (existing) {
      await prisma.sourceHealth.update({
        where: { id: existing.id },
        data: {
          status: sourceHealth.status,
          checkedAt: now,
          lastSuccessAt: sourceHealth.lastSuccessAt ?? existing.lastSuccessAt,
          responseTimeMs: sourceHealth.responseTimeMs ?? existing.responseTimeMs,
          errorMessage: null,
          usage: sourceHealth.usage,
          notes: sourceHealth.notes,
        },
      });
    } else {
      await prisma.sourceHealth.create({
        data: {
          ...sourceHealth,
          checkedAt: now,
          errorMessage: null,
        },
      });
    }
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
