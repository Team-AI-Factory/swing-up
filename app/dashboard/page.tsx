import Link from "next/link";
import { SeriousSignalFeed } from "@/app/serious-signals/SeriousSignalFeed";

export default function DashboardPage() {
  return (
    <div className="page">
      <div className="eyebrow">Dashboard · real data only</div>
      <h1>Command center</h1>
      <section className="card">
        <span className="badge">No mock statistics</span>
        <h2>Open the verified Serious Signal feed</h2>
        <p>The dashboard no longer presents example alert counts as if they were live. Verified Buy, Sell, and Watch Out results are read directly from the protected R2 feed.</p>
        <div className="button-row">
          <Link className="button primary" href="/serious-signals">Open live Serious Signals</Link>
          <Link className="button" href="/alerts">Open published public alerts</Link>
          <Link className="button" href="/source-health">Check source health</Link>
        </div>
      </section>
      <section style={{ marginTop: 24 }}>
        <div className="eyebrow">Latest verified results · rolling 48 hours</div>
        <SeriousSignalFeed compact />
      </section>
    </div>
  );
}
