import Link from "next/link";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date);
}

function featuresText(value: unknown) {
  return Array.isArray(value) ? value.join(", ") : "—";
}

export default async function PatternMatchesAdminPage() {
  const matches = await prisma.patternMatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      rawSignal: { select: { title: true, source: true } },
      historicalEvent: { select: { title: true, ticker: true, eventType: true } },
    },
  });

  return (
    <div className="page">
      <div className="raw-signal-header">
        <div>
          <div className="eyebrow">Admin / Historical Pattern Match</div>
          <h1>Historical Pattern Match</h1>
          <p>Review rule-based comparisons between promoted raw signals and historical market events.</p>
        </div>
        <div className="button-row">
          <Link className="button primary" href="/api/pattern-matches/run">Run endpoint</Link>
          <Link className="button" href="/api/pattern-matches?limit=25">View JSON</Link>
          <Link className="button" href="/admin">Back to admin</Link>
        </div>
      </div>

      <section className="card trust-section risk-callout">
        <h2>Research clue only</h2>
        <p>
          Pattern Match checks whether a new market signal looks similar to past events and how those past events later behaved.
          It is a research clue, not a guarantee.
        </p>
      </section>

      <section className="card raw-signal-card trust-section">
        <div className="raw-signal-header">
          <div>
            <h2>Recent pattern matches</h2>
            <p>{matches.length} most recent rule-based matches from PostgreSQL.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Raw signal title</th>
                <th>Raw signal source</th>
                <th>Ticker</th>
                <th>Matched historical event</th>
                <th>Event type</th>
                <th>Match score</th>
                <th>Confidence</th>
                <th>Match reason</th>
                <th>Matched features</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((match) => (
                <tr key={match.id}>
                  <td>{match.rawSignal?.title ?? "—"}</td>
                  <td>{match.rawSignal?.source ?? "—"}</td>
                  <td><strong>{match.ticker ?? match.historicalEvent?.ticker ?? "—"}</strong></td>
                  <td>{match.historicalEvent?.title ?? "—"}</td>
                  <td>{match.historicalEvent?.eventType ?? "—"}</td>
                  <td>{match.matchScore?.toFixed(0) ?? match.similarity.toFixed(0)}</td>
                  <td><span className={`badge status-${match.confidenceLabel}`}>{match.confidenceLabel}</span></td>
                  <td>{match.matchReason ?? "—"}</td>
                  <td>{featuresText(match.matchedFeatures)}</td>
                  <td>{formatDate(match.createdAt)}</td>
                </tr>
              ))}
              {matches.length === 0 ? (
                <tr><td colSpan={10}>No pattern matches yet. POST to /api/pattern-matches/run after signals are queued or promoted.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
