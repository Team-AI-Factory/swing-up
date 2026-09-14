import Link from "next/link";
import { GrowthAttribution } from "@/components/GrowthAttribution";
export default function PricingPage() {
  return <div className="page launch-page"><GrowthAttribution /><div className="launch-heading"><span className="eyebrow">Help shape the launch</span><h1>Useful research. A clear price.</h1><p>We’re testing demand before building more. Choose the access you would actually use.</p></div>
    <section className="grid two"><article className="card launch-form"><span className="eyebrow">Explore</span><h2>Public research</h2><div className="kpi">Free</div><p>Read provisional stock screens, dated observations and model valuation ranges.</p><Link className="button" href="/research">See the research</Link><Link href="/signup">Join free early access</Link></article>
      <article className="card launch-form launch-premium"><span className="eyebrow">Proposed paid pilot</span><h2>Full signal context</h2><div className="kpi">$19 <small>USD / month</small></div><p>Planned access to deeper reasoning, source context and watchlist research as the full product launches.</p><p>This is a pricing-interest test. The pilot, final features and launch date are not confirmed. No checkout, charge, reservation or subscription starts here.</p><Link className="button primary" href="/signup">Tell us if you’d consider the pilot</Link></article></section>
    <p className="muted" style={{ marginTop: 24 }}>Paying for research does not guarantee better investment results. Swing Up does not provide personalized financial advice.</p>
  </div>;
}
