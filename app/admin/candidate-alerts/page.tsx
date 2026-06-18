import Link from "next/link";
import { prisma } from "@/lib/db/client";
import styles from "./candidate-alerts.module.css";

export const dynamic = "force-dynamic";

const NOT_AVAILABLE = "Not available yet";
const candidateStatuses = ["candidate", "draft", "queued", "review", "ready_for_review"];

type CandidateAlert = {
  id: string;
  ticker: string;
  company: string;
  action: string;
  event: string;
  status: string;
  publishedAt: string;
  score: string;
  riskLevel: string;
  pricedInCheck: string;
  receipts: string[];
};

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "Unpublished";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Unpublished";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

function formatStatus(status: string) {
  return status
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || NOT_AVAILABLE;
}

async function getCandidateAlerts(): Promise<CandidateAlert[]> {
  try {
    const alerts = await prisma.alert.findMany({
      where: {
        OR: candidateStatuses.map((status) => ({ status: { equals: status, mode: "insensitive" } })),
      },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: 25,
      include: {
        scores: { orderBy: { createdAt: "desc" }, take: 1 },
        sources: { orderBy: { collectedAt: "desc" }, take: 3 },
      },
    });

    return alerts.map((alert) => {
      const latestScore = alert.scores[0];
      return {
        id: alert.id,
        ticker: alert.ticker,
        company: alert.company,
        action: formatStatus(alert.action),
        event: alert.event,
        status: formatStatus(alert.status),
        publishedAt: formatDate(alert.publishedAt),
        score: latestScore ? `${latestScore.profitPotential} profit / ${latestScore.evidenceConfidence} confidence` : NOT_AVAILABLE,
        riskLevel: latestScore?.riskLevel ?? NOT_AVAILABLE,
        pricedInCheck: latestScore?.pricedInCheck ?? NOT_AVAILABLE,
        receipts: alert.sources.map((source) => source.summary || source.receiptUrl || source.sourceType).filter(Boolean),
      };
    });
  } catch {
    return [];
  }
}

export default async function CandidateAlertsAdminPage() {
  const alerts = await getCandidateAlerts();

  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Admin / Candidate Alerts</div>
          <h1>Candidate Alerts Review</h1>
          <p>
            Read-only operator review for alert candidates before approval, publishing, notifications, or public ledger tracking.
          </p>
          <p className="muted">
            This page intentionally does not approve, reject, publish, call AI, send notifications, or change database records.
          </p>
          <div className="button-row">
            <Link className="button" href="/admin">Back to admin</Link>
            <Link className="button" href="/admin/raw-signals">Raw Signal Store</Link>
          </div>
        </div>
        <div className="card">
          <div className="metric"><span>Mode</span><strong>Read-only</strong></div>
          <div className="metric"><span>Candidate rows</span><strong>{alerts.length}</strong></div>
          <div className="metric"><span>Actions</span><strong>Disabled placeholders</strong></div>
        </div>
      </section>

      <section className={`card trust-section ${styles.reviewCard}`}>
        <div className={styles.reviewHeader}>
          <div>
            <div className="eyebrow">Review queue</div>
            <h2>Existing candidate alerts</h2>
            <p>{alerts.length ? `${alerts.length} candidate alert${alerts.length === 1 ? "" : "s"} found.` : "No candidate alerts are available yet."}</p>
          </div>
          <span className="badge">Read-only</span>
        </div>

        {alerts.length === 0 ? (
          <div className={styles.emptyState}>
            <span className="badge">Empty state</span>
            <h3>No candidate alerts to review yet</h3>
            <p>
              Candidate alerts will appear here after upstream filtering and scoring create rows with a review status. Until then,
              operators can use the Raw Signal Store to inspect incoming receipts.
            </p>
            <div className="button-row">
              <Link className="button" href="/admin/raw-signals">Open Raw Signal Store</Link>
              <button className="button" type="button" disabled>Approve selected</button>
              <button className="button" type="button" disabled>Reject selected</button>
            </div>
          </div>
        ) : (
          <div className={styles.alertList}>
            {alerts.map((alert) => (
              <article className={styles.alertItem} key={alert.id}>
                <div className={styles.alertTopline}>
                  <span className="badge">{alert.status}</span>
                  <span className="badge">{alert.action}</span>
                </div>
                <h3>{alert.ticker} · {alert.company}</h3>
                <p>{alert.event}</p>
                <div className={styles.alertFields}>
                  <div><span>Published status</span><strong>{alert.publishedAt}</strong></div>
                  <div><span>Score preview</span><strong>{alert.score}</strong></div>
                  <div><span>Risk level</span><strong>{alert.riskLevel}</strong></div>
                  <div><span>Priced-in check</span><strong>{alert.pricedInCheck}</strong></div>
                </div>
                <div className={styles.receipts}>
                  <span>Receipts</span>
                  {alert.receipts.length ? (
                    <ul>{alert.receipts.map((receipt) => <li key={receipt}>{receipt}</li>)}</ul>
                  ) : (
                    <p>{NOT_AVAILABLE}</p>
                  )}
                </div>
                <div className="button-row">
                  <button className="button" type="button" disabled>Approve placeholder</button>
                  <button className="button" type="button" disabled>Reject placeholder</button>
                  <button className="button" type="button" disabled>Publish placeholder</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
