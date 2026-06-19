import { AlertCard } from "@/components/AlertCard";
import { prisma } from "@/lib/db/client";
import { mockAlerts, type Alert } from "@/lib/mock-alerts";
import styles from "./alerts.module.css";

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

function StateCard({ label, value, description, active = false }: { label: string; value: string; description: string; active?: boolean }) {
  return (
    <div className={`${styles.stateCard} ${active ? styles.activeState : ""}`}>
      <span className="badge">{label}</span>
      <strong>{value}</strong>
      <p className="muted">{description}</p>
    </div>
  );
}

export default async function AlertsPage() {
  const publishedAlerts = await getPublishedAlerts();
  const hasLiveAlerts = publishedAlerts.length > 0;
  const alerts = hasLiveAlerts ? publishedAlerts : mockAlerts;

  return (
    <div className="page">
      <div className="eyebrow">Alert Feed</div>
      <h1>Alert status</h1>
      <p>
        This feed separates published research alerts from preview examples and delayed access states. Alerts are research context only, not financial advice.
      </p>

      <section className={styles.statusGrid} aria-label="Alert feed status summary">
        <StateCard
          label="Live alerts available"
          value={hasLiveAlerts ? `${publishedAlerts.length} live` : "None currently"}
          description={hasLiveAlerts ? "Published alerts passed final review and are visible below." : "No published alerts are available in this environment yet."}
          active={hasLiveAlerts}
        />
        <StateCard
          label="No live alerts yet"
          value={hasLiveAlerts ? "Not active" : "Active state"}
          description="When no reviewed alerts are published, the feed says so instead of presenting examples as live alerts."
          active={!hasLiveAlerts}
        />
        <StateCard
          label="Preview examples only"
          value={hasLiveAlerts ? "Hidden" : "Shown below"}
          description="Example cards use mock data for UX review and must not be treated as current market alerts."
          active={!hasLiveAlerts}
        />
        <StateCard
          label="Paid/delayed alert locked"
          value="Labelled"
          description="Restricted or delayed alert access is explained without creating urgency or promising outcomes."
        />
      </section>

      {!hasLiveAlerts && (
        <section className={styles.emptyState} aria-label="No live alerts yet">
          <span className="badge">No live alerts yet</span>
          <h2>No reviewed live alerts are available</h2>
          <p>
            Swing Up has not published a reviewed live alert to this feed yet. The cards below are preview examples only, built from mock data to show layout and readability.
          </p>
        </section>
      )}

      {!hasLiveAlerts && (
        <section className={styles.previewNotice} aria-label="Preview examples only">
          <span className="badge">Preview examples only</span>
          <strong>Mock examples are not live alerts.</strong>
          <p className="muted">Dates, prices, scores, receipts, and outcomes in the preview cards are sample content for product testing.</p>
        </section>
      )}

      <section className={styles.lockedState} aria-label="Paid or delayed alert locked">
        <span className="badge">Paid/delayed alert locked</span>
        <strong>Some alerts may be restricted or delayed based on access level.</strong>
        <p className="muted">Locked alerts should be treated as unavailable until released; this page does not imply hidden alerts are profitable, urgent, or suitable for any user.</p>
      </section>

      <div className="grid" aria-label={hasLiveAlerts ? "Live alerts" : "Preview alert examples"}>
        {alerts.map((alert) => (
          <div className={styles.cardFrame} key={alert.id}>
            <div className={styles.cardLabel}>
              <div className={styles.cardLabelRow}>
                <span className="badge">{hasLiveAlerts ? "Live alert" : "Preview example"}</span>
                {!hasLiveAlerts && <span className="badge">Mock data</span>}
              </div>
              <p className="muted">
                {hasLiveAlerts ? "Published research alert. Review risks and receipts before making any decision." : "Example only — not a live, current, or personalized market alert."}
              </p>
            </div>
            <AlertCard alert={alert} compact />
          </div>
        ))}
      </div>
    </div>
  );
}
