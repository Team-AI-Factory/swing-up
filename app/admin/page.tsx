import Link from "next/link";

export default function AdminPage() {
  return (
    <div className="page">
      <div className="eyebrow">Admin</div>
      <h1>Operator panel</h1>
      <div className="grid two">
        <div className="card">
          <h2>Queues</h2>
          <p>Review raw signals, failed receipts, moderation, and cost logs.</p>
          <div className="button-row">
            <Link className="button primary" href="/admin/raw-signals">Open Raw Signal Store</Link>
          </div>
        </div>
        <div className="card">
          <h2>Controls</h2>
          <p>Future admin actions are audited in the PostgreSQL-ready schema.</p>
        </div>
      </div>
    </div>
  );
}
