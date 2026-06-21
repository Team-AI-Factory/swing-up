import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db/client";
import { canonicalAlertPath, jsonRecord, safeText } from "@/lib/seo-alerts";
import styles from "./alerts.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Public research alerts | Swing Up",
  description: "Published Swing Up research alerts with proof, risk checks, scores, and public tracking.",
  robots: { index: true, follow: true },
  alternates: { canonical: "/alerts" },
};

function formatDate(value: Date | null) {
  if (!value) return "Not available yet";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(value);
}

async function getPublishedAlerts() {
  if (!process.env.DATABASE_URL) return [];
  try {
    return await prisma.alert.findMany({
      where: { status: { equals: "published", mode: "insensitive" }, publishedAt: { not: null } },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: 50,
      include: {
        scores: { orderBy: { createdAt: "desc" }, take: 1 },
        publicLedger: { orderBy: { createdAt: "desc" }, take: 1 },
        sources: { orderBy: { collectedAt: "desc" }, take: 3 },
      },
    });
  } catch { return []; }
}

function FilterHint({ label }: { label: string }) { return <span className="badge">{label}</span>; }

export default async function AlertsPage() {
  const alerts = await getPublishedAlerts();
  return (
    <div className="page">
      <div className="eyebrow">Public Alert Archive</div>
      <h1>Published research alerts</h1>
      <p>Only published public alerts appear here. Candidate, draft, rejected, mock, preview, private, and admin alerts are not exposed as crawlable public archive items.</p>
      <section className={styles.previewNotice} aria-label="Filters">
        <strong>Simple filters supported by page text</strong>
        <div className="button-row"><FilterHint label="Open" /><FilterHint label="Win" /><FilterHint label="Loss" /><FilterHint label="Watch" /><FilterHint label="Buy Candidate" /><FilterHint label="Avoid" /><FilterHint label="Sector" /><FilterHint label="Ticker" /></div>
      </section>
      {alerts.length === 0 && <section className={styles.emptyState}><span className="badge">No public alerts yet</span><h2>No public alerts yet. Published alerts will appear here once tracking starts.</h2></section>}
      <div className="grid" aria-label="Published alerts">
        {alerts.map((alert) => {
          const score = alert.scores[0];
          const ledger = alert.publicLedger[0];
          const entry = jsonRecord(ledger?.entry);
          const status = safeText(entry.status ?? entry.outcome, ledger ? "Open" : "Tracking pending");
          const latest = safeText(entry.latestPrice ?? entry.currentPrice ?? entry.result, "Latest result pending");
          return (
            <article className="card alert-card" key={alert.id}>
              <div className={styles.cardLabelRow}><span className="badge">Published</span><span className="badge">{status}</span></div>
              <h2>{alert.ticker} — {alert.company}</h2>
              <p><strong>Headline:</strong> {alert.event}</p>
              <p><strong>Action:</strong> {alert.action}</p>
              <p><strong>What happened:</strong> {safeText(entry.whatHappened ?? entry.whatChanged ?? entry.summary, alert.event)}</p>
              <p><strong>Why it matters:</strong> {safeText(entry.whyItMatters ?? entry.explanation, "Full reasoning is available on the public alert page.")}</p>
              <p><strong>Alert date:</strong> {formatDate(alert.publishedAt)}</p>
              <div className="button-row"><span className="badge">{alert.sources?.[0]?.sourceType ?? "Proof pending"}</span><span className="badge">Risk: {score?.riskLevel ?? "Not available yet"}</span></div>
              <div className="grid two">
                <div className="metric"><span>Risk level</span><strong>{score?.riskLevel ?? "Not available yet"}</strong></div>
                <div className="metric"><span>Evidence confidence score</span><strong>{score?.evidenceConfidence ?? "Not available yet"}</strong></div>
                <div className="metric"><span>Tracking status</span><strong>{status}</strong></div>
                <div className="metric"><span>Latest result</span><strong>{latest}</strong></div>
              </div>
              <p><strong>Public tracking:</strong> {status} — {latest}</p>
              <Link className="button primary" href={canonicalAlertPath(alert, ledger?.publicSlug)}>Read full explanation</Link>
            </article>
          );
        })}
      </div>
    </div>
  );
}
