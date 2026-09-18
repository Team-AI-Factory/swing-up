import Link from "next/link";
import { GrowthAttribution } from "@/components/GrowthAttribution";
import { ResearchCard } from "@/components/ResearchCard";
import { latestResearch } from "@/lib/growth/public-records";
import { compareSignalPotential } from "@/lib/signal-outlook";
import { snapshotOutlook } from "@/lib/growth/research";
export const dynamic = "force-dynamic";
export const metadata = { title: "Research history · Swing Up" };
export default async function ResearchPage() {
  const research = await latestResearch(30);
  const ranked = [...research.rows].sort((left, right) => compareSignalPotential({ ...left.snapshot, outlook: snapshotOutlook(left.snapshot) }, { ...right.snapshot, outlook: snapshotOutlook(right.snapshot) }));
  return <div className="page launch-page"><GrowthAttribution /><div className="launch-heading"><span className="eyebrow">The public record</span><h1>Every screen has a story. Read it.</h1><p>Original, dated snapshots from Swing Up’s provisional valuation research. Prices here describe the observation time and may have changed. This history is not a verified performance track record.</p><Link className="button primary" href="/signup">Get early-bird access</Link></div>
    <p className="muted">These latest 30 dated snapshots show Buy opportunities first, then Sell opportunities, ranked by their original potential move to base value. <Link href="/serious-signals#live-alerts">See the latest live opportunities →</Link></p>
    <div className="research-grid">{ranked.map((row) => <ResearchCard key={row.id} id={row.id} snapshot={row.snapshot} />)}</div>
    {!research.rows.length && <p className="card">{research.available ? "The first fresh research snapshots are being prepared." : "We couldn’t load the research. Please try again shortly."}</p>}
    {research.rows.length > 0 && <section className="card growth-scroll" style={{ marginTop: 36 }}><h2>Publication history</h2><p className="muted">A prepared card is not a published social post. Links appear only when the publishing provider confirms them.</p><table className="growth-table"><thead><tr><th>Snapshot</th><th>Created</th><th>Channel status</th></tr></thead><tbody>{research.rows.map((row) => <tr key={row.id}><td><Link href={`/research/${row.id}`}>{row.snapshot.ticker} · {row.snapshot.label}</Link></td><td>{new Date(row.snapshot.capturedAt).toISOString().slice(0, 16).replace("T", " ")} UTC</td><td>{row.deliveries.map((delivery) => <div key={delivery.channel}>{delivery.channel}: {delivery.externalUrl ? <a href={delivery.externalUrl} rel="noopener noreferrer">{delivery.status}</a> : delivery.status.replaceAll("_", " ")}</div>)}</td></tr>)}</tbody></table></section>}
  </div>;
}
