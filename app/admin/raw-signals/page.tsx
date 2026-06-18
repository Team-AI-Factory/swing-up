import Link from "next/link";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

function formatPayload(payload: unknown) {
  return JSON.stringify(payload, null, 2).slice(0, 700);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

export default async function RawSignalsAdminPage() {
  const signals = await prisma.rawSignal.findMany({
    orderBy: { receivedAt: "desc" },
    take: 50,
  });

  return (
    <div className="page">
      <div className="raw-signal-header">
        <div>
          <div className="eyebrow">Admin / Raw Signal Store</div>
          <h1>Raw Signal Store</h1>
          <p>Review the latest market-data inbox entries before downstream filtering and scoring.</p>
        </div>
        <Link className="button" href="/admin">Back to admin</Link>
      </div>

      <section className="card">
        <h2>What this stores</h2>
        <p>
          Raw Signal Store is the inbox for market data. Signals are stored first, then later filtered,
          scored, matched against history, and reviewed by AI.
        </p>
      </section>

      <section className="card raw-signal-card">
        <div className="raw-signal-header">
          <div>
            <h2>Recent raw signals</h2>
            <p>{signals.length} most recent entries from PostgreSQL.</p>
          </div>
          <Link className="button" href="/api/raw-signals?limit=25">View JSON</Link>
        </div>
        <div className="table-wrap">
          <table className="table raw-signal-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Ticker</th>
                <th>Signal type</th>
                <th>Title & summary</th>
                <th>Received</th>
                <th>Status</th>
                <th>Importance</th>
                <th>Source URL</th>
                <th>Payload preview</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((signal) => (
                <tr key={signal.id}>
                  <td>{signal.source}</td>
                  <td><strong>{signal.ticker ?? "—"}</strong></td>
                  <td>{signal.signalType}</td>
                  <td><strong>{signal.title}</strong><br />{signal.summary}</td>
                  <td>{formatDate(signal.receivedAt)}</td>
                  <td><span className={`badge raw-signal-status status-${signal.processedStatus}`}>{signal.processedStatus}</span></td>
                  <td><span className={`badge raw-signal-importance importance-${signal.importanceHint}`}>{signal.importanceHint}</span></td>
                  <td>{signal.sourceUrl ? <a href={signal.sourceUrl}>{signal.sourceUrl}</a> : "—"}</td>
                  <td><pre className="payload-preview">{formatPayload(signal.payload)}</pre></td>
                </tr>
              ))}
              {signals.length === 0 ? (
                <tr>
                  <td colSpan={9}>No raw signals yet. Use /api/raw-signals/seed to add mock inbox entries.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
