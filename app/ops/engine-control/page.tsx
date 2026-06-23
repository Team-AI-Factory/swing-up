import { checkR2Health, getRawWarehouseStatus } from "@/lib/r2-warehouse";
import { getSourceHealth } from "@/lib/source-health";
import EngineControlPanel from "./EngineControlPanel";

export const dynamic = "force-dynamic";

export default async function EngineControlPage() {
  const [r2, w, sourceHealth] = await Promise.all([
    checkR2Health(false),
    getRawWarehouseStatus(),
    getSourceHealth(),
  ]);
  return (
    <>
      <EngineControlPanel />
      <section style={{ padding: 24, fontFamily: "system-ui", lineHeight: 1.5 }}>
        <h2>Raw Warehouse</h2>
        <ul>
          <li>
            R2 connected: <strong>{String(r2.connected)}</strong>
          </li>
          <li>
            Bucket: <strong>{r2.bucket ?? "not configured"}</strong>
          </li>
          <li>
            Can read/write/delete:{" "}
            <strong>
              {String(r2.canRead)}/{String(r2.canWrite)}/{String(r2.canDelete)}
            </strong>
          </li>
          <li>
            Raw write status:{" "}
            <strong>
              {r2.canWrite && r2.canDelete
                ? "available"
                : "write/delete unavailable"}
            </strong>
          </li>
          <li>
            R2 suspected cause: <strong>{r2.suspectedCause ?? "none"}</strong>
          </li>
          <li>
            R2 next action: <strong>{r2.nextAction ?? "none"}</strong>
          </li>
          <li>
            raw_data_objects count: <strong>{w.count}</strong>
          </li>
          <li>
            Latest saved raw object path:{" "}
            <code>{w.latest?.r2Key ?? "none"}</code>
          </li>
          <li>
            Asset universe snapshots saved: <strong>{w.snapshots}</strong>
          </li>
          <li>
            Stage 1 mode:{" "}
            <strong>
              {r2.canWrite && r2.canDelete
                ? "R2 raw warehouse"
                : "PostgreSQL summary only; rawDataStored=false"}
            </strong>
          </li>
        </ul>
        {r2.missingEnvVars.length ? (
          <p>Missing R2 env vars: {r2.missingEnvVars.join(", ")}</p>
        ) : null}
        <p>
          <a href="/api/internal/history-capability-status">History status</a> ·{" "}
          <a href="/api/internal/asset-universe-status">
            Asset universe status
          </a>
        </p>
      </section>
      <section>
        <h2>Source Health</h2>
        <p>{sourceHealth.message}</p>
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Status</th>
              <th>Aliases</th>
              <th>Diagnosis</th>
              <th>Next action</th>
            </tr>
          </thead>
          <tbody>
            {sourceHealth.sources.map((source) => (
              <tr key={source.id}>
                <td>{source.source}</td>
                <td>{source.status}</td>
                <td>{source.aliases?.join(", ") || "—"}</td>
                <td>{source.diagnosis ?? "—"}</td>
                <td>{source.nextAction ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
