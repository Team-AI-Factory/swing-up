import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

function formatMoney(value: Prisma.Decimal | null) {
  return value ? `$${value.toFixed(2)}` : "—";
}

function notesPreview(notes: string | null) {
  if (!notes) return "—";
  return notes.length > 110 ? `${notes.slice(0, 110)}…` : notes;
}

export default async function HistoricalEventsAdminPage() {
  const events = await prisma.historicalEvent.findMany({
    orderBy: [{ eventDate: "desc" }, { createdAt: "desc" }],
    take: 50,
  });

  return (
    <div className="page">
      <div className="raw-signal-header">
        <div>
          <div className="eyebrow">Admin / Historical Event Library</div>
          <h1>Historical Event Library</h1>
          <p>Inspect database-backed historical market events before future pattern matching is added.</p>
        </div>
        <div className="button-row">
          <Link className="button primary" href="/api/historical-events/seed">Seed mock events</Link>
          <Link className="button" href="/api/historical-events?limit=25">View JSON</Link>
          <Link className="button" href="/admin">Back to admin</Link>
        </div>
      </div>

      <section className="card trust-section risk-callout">
        <h2>What this stores</h2>
        <p>
          Historical Event Library is Swing Up’s memory bank. It stores past market events and their later price
          reactions so future signals can be compared against similar situations.
        </p>
      </section>

      <section className="card trust-section">
        <div className="raw-signal-header">
          <div>
            <h2>Outcome labels</h2>
            <p>Labels are descriptive only. No advanced pattern matching, scoring, AI calls, or paid market APIs run here.</p>
          </div>
        </div>
        <div className="button-row">
          {(["positive", "negative", "neutral", "mixed", "unknown"] as const).map((label) => (
            <span className={`badge outcome-${label}`} key={label}>{label}</span>
          ))}
        </div>
      </section>

      <section className="card raw-signal-card trust-section">
        <div className="raw-signal-header">
          <div>
            <h2>Recent historical events</h2>
            <p>{events.length} most recent entries from PostgreSQL.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table historical-event-table">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Company</th>
                <th>Sector</th>
                <th>Event type</th>
                <th>Event date</th>
                <th>Title & summary</th>
                <th>Source</th>
                <th>Price before</th>
                <th>1D result</th>
                <th>7D result</th>
                <th>30D result</th>
                <th>Outcome</th>
                <th>Source URL</th>
                <th>Notes preview</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td><strong>{event.ticker}</strong></td>
                  <td>{event.companyName ?? "—"}</td>
                  <td>{event.sector ?? "—"}</td>
                  <td>{event.eventType}</td>
                  <td>{formatDate(event.eventDate)}</td>
                  <td><strong>{event.title ?? "Untitled event"}</strong><br />{event.summary ?? "—"}</td>
                  <td>{event.source ?? "—"}</td>
                  <td>{formatMoney(event.priceBefore)}</td>
                  <td>{formatMoney(event.priceAfter1d)}</td>
                  <td>{formatMoney(event.priceAfter7d)}</td>
                  <td>{formatMoney(event.priceAfter30d)}</td>
                  <td><span className={`badge outcome-${event.outcomeLabel}`}>{event.outcomeLabel}</span></td>
                  <td>{event.sourceUrl ? <a className="ledger-link" href={event.sourceUrl}>{event.sourceUrl}</a> : "—"}</td>
                  <td>{notesPreview(event.notes)}</td>
                </tr>
              ))}
              {events.length === 0 ? (
                <tr>
                  <td colSpan={14}>No historical events yet. Use /api/historical-events/seed to add mock library entries.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
