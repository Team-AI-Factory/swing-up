import type { Metadata } from "next";
import { SeriousSignalFeed } from "./SeriousSignalFeed";

export const metadata: Metadata = {
  title: "Live Serious Signals and Valuation Watchlist | Swing Up",
  description: "A protected real-data view of Committee-approved Serious Signals and clearly separated provisional valuation research.",
  robots: { index: false, follow: false },
};

export default function SeriousSignalsPage() {
  return (
    <div className="page">
      <div className="eyebrow">Live · Committee approved · No mock fallback</div>
      <h1>Serious Signals</h1>
      <p>Only Buy, Sell, or Watch Out results that completed all 14 Committee roles and received Final Judge approval appear here.</p>
      <p><a href="#valuation-watchlist">Jump to the provisional Valuation Watchlist</a></p>
      <SeriousSignalFeed />
    </div>
  );
}
