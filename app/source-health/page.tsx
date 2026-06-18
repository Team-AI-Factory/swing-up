import { getSourceHealth } from "@/lib/source-health";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const statusLabels: Record<string, string> = {
  connected: "Connected",
  not_configured: "Not configured",
  stubbed: "Stubbed",
  degraded: "Degraded",
  error: "Error",
};

function formatDate(value: string | null) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

export default async function SourceHealthPage() {
  const sourceHealth = await getSourceHealth();

  return (
    <div className="page">
      <div className="eyebrow">Source Health</div>
      <h1>Signal reliability</h1>

      <div className="grid two source-health-actions">
        <div className="card">
          <h2>Control room</h2>
          <p>
            Source Health shows whether each data ear is working, missing keys, stubbed, rate-limited, or broken.
          </p>
          {!sourceHealth.ok ? (
            <p className="source-health-warning">
              Source health is temporarily unavailable. {sourceHealth.message}
            </p>
          ) : (
            <p>{sourceHealth.message}</p>
          )}
        </div>

        <div className="card admin-placeholder">
          <div className="eyebrow">Admin placeholders</div>
          <h3>Manual operations</h3>
          <p>These controls are placeholders for future authenticated admin workflows.</p>
          <div className="button-row">
            <button className="button" type="button" disabled>
              Refresh checks
            </button>
            <button className="button" type="button" disabled>
              View error logs
            </button>
          </div>
        </div>
      </div>

      <div className="card source-health-card">
        <table className="table source-health-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Status</th>
              <th>Last checked</th>
              <th>Last success</th>
              <th>Response</th>
              <th>Usage / limit</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {sourceHealth.sources.map((source) => (
              <tr key={source.id}>
                <td>{source.source}</td>
                <td>
                  <span className={`badge status-${source.status}`}>{statusLabels[source.status] ?? source.status}</span>
                </td>
                <td>{formatDate(source.lastChecked)}</td>
                <td>{formatDate(source.lastSuccess)}</td>
                <td>{source.responseTimeMs === null ? "—" : `${source.responseTimeMs} ms`}</td>
                <td>{source.usage ?? "—"}</td>
                <td>{source.notes ?? source.errorMessage ?? "—"}</td>
              </tr>
            ))}
            {!sourceHealth.sources.length ? (
              <tr>
                <td colSpan={7}>No source health rows are available yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
