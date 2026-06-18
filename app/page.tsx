import Link from "next/link";
import { AlertCard } from "@/components/AlertCard";
import { mockAlerts } from "@/lib/mock-alerts";

export default function LandingPage() {
  return <div className="page">
    <section className="hero"><div><div className="eyebrow">Receipt-first swing intelligence</div><h1>Catch the move before Wall Street reprices it.</h1><p>Swing Up turns messy market signals into scored alerts with evidence confidence, risk context, historical pattern matching, and public tracking.</p><div style={{display:"flex", gap:12, flexWrap:"wrap"}}><Link className="button primary" href="/signup">Start with mock alerts</Link><Link className="button" href="/public/alerts/shop-margin-reset">View public alert</Link></div></div><AlertCard alert={mockAlerts[0]} compact /></section>
    <section className="grid three"><Link className="card" href="/methodology"><h3>Methodology</h3><p>See how signals are filtered, scored, checked against history, and supported with receipts.</p></Link><Link className="card" href="/public-ledger"><h3>Public ledger</h3><p>Review placeholder public tracking for research alerts, including status and tracked result fields.</p></Link><Link className="card" href="/risk-disclaimer"><h3>Risk disclaimer</h3><p>Understand that Swing Up is research support, not guaranteed investment advice.</p></Link></section>
    <section className="grid three" style={{marginTop: 16}}><div className="card"><h3>Ears boundary</h3><p>Future ingestion module for filings, supply chain, options, social, and price signals.</p></div><div className="card"><h3>AI Committee boundary</h3><p>Stubbed scoring interface for future multi-model debate. No real AI calls yet.</p></div><div className="card"><h3>Payments & notifications</h3><p>Stripe, Telegram, and email remain cleanly stubbed behind future modules.</p></div></section>
  </div>;
}
