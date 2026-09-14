import { EarlyAccessForm } from "./EarlyAccessForm";
import { GrowthAttribution } from "@/components/GrowthAttribution";
export const metadata = { title: "Early access · Swing Up" };
export default function SignupPage() {
  return <div className="page launch-page"><GrowthAttribution /><section className="launch-split">
    <div><span className="eyebrow">Swing Up · Early access</span><h1>Know your moves before the market does.</h1><p className="launch-intro">Stock research that shows the price, the reasoning and the risk. Join early-bird access for the full signal experience when Swing Up launches.</p>
      <div className="launch-points"><p><strong>Understand the setup.</strong><br />Opportunity, sell research and watch-out screens with an explanation you can inspect.</p><p><strong>See what could change.</strong><br />Model valuation ranges, uncertainty and the assumptions behind each scenario.</p><p><strong>Check the record.</strong><br />Dated research snapshots and links to market data and company filings.</p></div>
      <p className="muted">Public research is provisional. A model estimate is not a promise, and our confidence score is not your probability of profit.</p>
    </div><EarlyAccessForm />
  </section></div>;
}
