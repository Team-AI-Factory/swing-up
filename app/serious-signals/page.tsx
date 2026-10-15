import { isSimpleAlertPilot } from "@/lib/simple-alert-pilot-runtime";
import { PublicSignalFeed } from "@/components/PublicSignalFeed";
import type { Metadata } from "next";
import { SeriousSignalFeed } from "./SeriousSignalFeed";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Serious Signals and Research Watch | Swing Up",
  description: "Research candidates and separately verified Serious Signals, with evidence gaps and review status.",
  robots: { index: false, follow: false },
};

export default function SeriousSignalsPage() {
  const restrictedBeta = isSimpleAlertPilot();
  return (
    <div className="page">
      <div className="eyebrow">{restrictedBeta ? "Restricted beta" : "Live opportunities · Approval status shown"}</div>
      <h1>Serious Signals</h1>
      <p>{restrictedBeta ? "Investment accuracy is not yet established. Research Watch candidates are not approved Serious Alerts or evidence of an executable opportunity. Release checks and live delivery proof remain required." : "Follow provisional opportunities while the AI Committee reviews the evidence. Approved Serious Signals are identified by their approval badge."}</p>
      {!restrictedBeta ? <PublicSignalFeed /> : null}
      <p><a href="#valuation-watchlist">{restrictedBeta ? "Jump to Research Watch" : "Jump to the provisional Valuation Watchlist"}</a></p>
      <SeriousSignalFeed restrictedBeta={restrictedBeta} />
    </div>
  );
}
