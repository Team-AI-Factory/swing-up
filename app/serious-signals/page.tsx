import { PublicSignalFeed } from "@/components/PublicSignalFeed";
import type { Metadata } from "next";
import { SeriousSignalFeed } from "./SeriousSignalFeed";

export const metadata: Metadata = {
  title: "Live Serious Signals and Valuation Watchlist | Swing Up",
  description: "Live provisional opportunities and Committee-approved Serious Signals with plain-English explanations.",
  robots: { index: false, follow: false },
};

export default function SeriousSignalsPage() {
  return (
    <div className="page">
      <div className="eyebrow">Live opportunities · Approval status shown</div>
      <h1>Serious Signals</h1>
      <p>Follow provisional opportunities while the AI Committee reviews the evidence. Approved Serious Signals are identified by their approval badge.</p>
      <PublicSignalFeed />
      <p><a href="#valuation-watchlist">Jump to the provisional Valuation Watchlist</a></p>
      <SeriousSignalFeed />
    </div>
  );
}
