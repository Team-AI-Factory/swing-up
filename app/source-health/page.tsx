const databaseStatus = process.env.DATABASE_URL ? "Connected / Error" : "Missing DATABASE_URL";

const sources = [
  ["Database", databaseStatus, "Last checked placeholder", "Railway PostgreSQL via Prisma"],
  ["Filings ear", "Healthy", "99.2%", "Mock SEC ingestion boundary"],
  ["Pattern engine", "Degraded", "87.4%", "Historical matcher stub"],
  ["Telegram", "Stubbed", "—", "No integration configured"],
];

export default function SourceHealthPage() {
  return (
    <div className="page">
      <div className="eyebrow">Source Health</div>
      <h1>Signal reliability</h1>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Status</th>
              <th>Uptime</th>
              <th>Boundary</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((row) => (
              <tr key={row[0]}>
                {row.map((cell) => (
                  <td key={cell}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
