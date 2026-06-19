import { AlertCard } from "@/components/AlertCard";
import { prisma } from "@/lib/db/client";
import { mockAlerts, type Alert } from "@/lib/mock-alerts";

export const dynamic = "force-dynamic";

function formatDate(value: Date | null) {
  if (!value) return undefined;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(value);
}

async function getPublishedAlerts(): Promise<Alert[]> {
  if (!process.env.DATABASE_URL) return [];

  try {
    const alerts = await prisma.alert.findMany({
      where: { status: { equals: "published", mode: "insensitive" } },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: 20,
      include: {
        scores: { orderBy: { createdAt: "desc" }, take: 1 },
        sources: { orderBy: { collectedAt: "desc" }, take: 10 },
        targetPrices: { take: 1 },
      },
    });

    return alerts.map((alert) => {
      const score = alert.scores[0];
      const targetPrice = alert.targetPrices[0];
      return {
        id: alert.id,
        action: /avoid/i.test(alert.action) ? "AVOID" : /watch|no action|sell review|speculative/i.test(alert.action) ? "WATCH" : "BUY",
        ticker: alert.ticker,
        company: alert.company,
        event: alert.event,
        eventDate: formatDate(alert.publishedAt),
        currentPrice: "Price not available yet",
        targetRange: targetPrice?.lowPrice && targetPrice?.highPrice ? `$${targetPrice.lowPrice.toString()}–$${targetPrice.highPrice.toString()}` : "Target not available yet",
        potentialMove: "Tracked after publication",
        profitScore: score?.profitPotential ?? 0,
        confidenceScore: score?.evidenceConfidence ?? 0,
        riskLevel: (score?.riskLevel as Alert["riskLevel"]) ?? "Medium",
        pricedInCheck: score?.pricedInCheck ?? "Priced-in check not available yet",
        patternMatch: "Pattern match not available yet",
        explanation: "Published after final review. Swing Up research is not financial advice.",
        rippleEffect: "Ripple effect review not available yet.",
        risks: [score?.riskLevel ? `Risk level: ${score.riskLevel}` : "Risk review not available yet"],
        receipts: alert.sources.map((source) => source.summary || source.receiptUrl || source.sourceType).filter(Boolean),
        publicTrackingResult: "Public ledger tracking is handled in a later workflow.",
      };
    });
  } catch {
    return [];
  }
}

export default async function AlertsPage() {
  const publishedAlerts = await getPublishedAlerts();
  const alerts = publishedAlerts.length > 0 ? publishedAlerts : mockAlerts;
  const description = publishedAlerts.length > 0
    ? "Reviewed alerts that passed final safety checks. Research only; not financial advice."
    : "Mock data powers the first product pass while integrations remain stubbed.";

  return <div className="page"><div className="eyebrow">Alert Feed</div><h1>Verified alerts</h1><p>{description}</p><div className="grid">{alerts.map((alert) => <AlertCard key={alert.id} alert={alert} compact />)}</div></div>;
}
