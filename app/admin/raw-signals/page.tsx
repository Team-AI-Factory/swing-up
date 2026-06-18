import Link from "next/link";

import { listRawSignals, rawSignalImportanceHints, rawSignalStatuses, type SerializedRawSignal } from "@/lib/raw-signals";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
}

function previewPayload(payload: unknown) {
  return JSON.stringify(payload, null, 2).slice(0, 420);
}

export default async function RawSignalsAdminPage() {
  const payload = process.env.DATABASE_URL
    ? await listRawSignals(50)
        .then((signals): { ok: boolean; signals: SerializedRawSignal[] } => ({ ok: true, signals }))
        .catch((): { ok: boolean; signals: SerializedRawSignal[] } => ({ ok: false, signals: [] }))
    : { ok: false, signals: [] as SerializedRawSignal[] };

  return (
    <div className="page">
      <div className="eyebrow">Admin</div>
      <h1>Raw Signal Store</h1>

      <div className="grid two raw-signal-actions">
        <div className="card explanation-box">
          <h2>Inbox layer</h2>
          <p>
            Raw Signal Store is the inbox for market data. Signals are stored first, then later filtered, scored, matched
            against history, and reviewed by AI.
          </p>
          <div className="button-row">
            <Link className="button" href="/admin">Back to admin</Link>
            <Link className="button primary" href="/api/raw-signals?limit=25">View API JSON</Link>
          </div>
        </div>

        <div className="card">
          <h2>Labels</h2>
          <p>Status labels: {rawSignalStatuses.join(", ")}.</p>
          <p>Importance labels: {rawSignalImportanceHints.join(", ")}.</p>
          {!payload.ok ? <p className="source-health-warning">Raw signals could not be loaded from the database.</p> : null}
        </div>
      </div>

      <div className="card raw-signals-card">
        <table className="table raw-signals-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Ticker</th>
              <th>Signal type</th>
              <th>Title / summary</th>
              <th>Received</th>
              <th>Status</th>
              <th>Importance</th>
              <th>Source URL</th>
              <th>Payload preview</th>
            </tr>
          </thead>
          <tbody>
            {payload.signals.map((signal) => (
              <tr key={signal.id}>
                <td>{signal.source}</td>
                <td>{signal.ticker ?? "—"}</td>
                <td>{signal.signal_type}</td>
                <td><strong>{signal.title}</strong><p>{signal.summary ?? "—"}</p></td>
                <td>{formatDate(signal.received_at)}</td>
                <td><span className={`badge raw-status-${signal.processed_status}`}>{signal.processed_status}</span></td>
                <td><span className={`badge raw-importance-${signal.importance_hint}`}>{signal.importance_hint}</span></td>
                <td>{signal.source_url ? <a className="text-link" href={signal.source_url} target="_blank" rel="noreferrer">Open</a> : "—"}</td>
                <td><pre className="payload-preview">{previewPayload(signal.payload)}</pre></td>
              </tr>
            ))}
            {!payload.signals.length ? <tr><td colSpan={9}>No raw signals are stored yet. Use /api/raw-signals/seed to add mock inbox rows.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
