import Link from "next/link";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

const statusMeanings = [
  ["new", "stored, not reviewed yet"],
  ["queued", "waiting for deeper review"],
  ["filtered", "weak/noisy/duplicate"],
  ["promoted", "serious enough for scoring/pattern matching later"],
  ["rejected", "unusable"],
  ["error", "needs operator review"],
];

export default async function SignalFilterAdminPage() {
  const grouped = await prisma.rawSignal.groupBy({
    by: ["processedStatus"],
    _count: { _all: true },
  });
  const counts = new Map(grouped.map((row) => [row.processedStatus, row._count._all]));
  const pendingCount = (counts.get("new") ?? 0) + (counts.get("queued") ?? 0);

  return (
    <div className="page">
      <div className="raw-signal-header">
        <div>
          <div className="eyebrow">Admin / Signal Filter</div>
          <h1>Rule Filter</h1>
          <p>Simple deterministic screening for raw signals before scoring, pattern matching, or future AI review.</p>
        </div>
        <Link className="button" href="/admin/raw-signals">Open Raw Signal Store</Link>
      </div>

      <section className="card">
        <h2>What this filter does</h2>
        <p>
          Signal Filter v1 reviews recent raw signals with status <strong>new</strong> or <strong>queued</strong>, applies basic safety
          and source rules, and updates only the <strong>processed status</strong>. It does not delete raw signals, create final alerts,
          call AI, or use external APIs.
        </p>
        <div className="button-row">
          <Link className="button primary" href="/api/raw-signals/filter">Rule filter endpoint</Link>
          <Link className="button" href="/admin/raw-signals">Raw Signal Store</Link>
        </div>
      </section>

      <section className="card">
        <h2>Latest filter summary</h2>
        <p>{pendingCount} raw signals are currently eligible for the rule filter.</p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Current count</th>
              </tr>
            </thead>
            <tbody>
              {statusMeanings.map(([status]) => (
                <tr key={status}>
                  <td><span className={`badge status-${status}`}>{status}</span></td>
                  <td>{counts.get(status) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Status meanings</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              {statusMeanings.map(([status, meaning]) => (
                <tr key={status}>
                  <td><span className={`badge status-${status}`}>{status}</span></td>
                  <td>{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
