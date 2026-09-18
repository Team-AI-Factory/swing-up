import Link from "next/link";
import { COLORS, snapshotOutlook, timestamp, type ResearchSnapshot } from "@/lib/growth/research";
import { SignalPriceOutlook } from "@/components/SignalPriceOutlook";
export function ResearchCard({ id, snapshot }: { id: string; snapshot: ResearchSnapshot }) {
  return <article className="card research-card"><span className="research-badge" style={{ color: COLORS[snapshot.action] }}>{snapshot.label} · Provisional</span><div><h2>{snapshot.ticker}</h2><p className="muted">{snapshot.company}</p></div><h3>{snapshot.title}</h3>
    <p>{snapshot.companyDoes ?? "The company description is still being collected."}</p>
    <SignalPriceOutlook outlook={snapshotOutlook(snapshot)} action={snapshot.action} />
    <div><p style={{ fontSize: 13 }}>Model confidence <strong>{snapshot.confidence}/100</strong></p><div className="research-confidence"><span style={{ width: `${snapshot.confidence}%` }} /></div><small className="muted">Not the probability of profit</small></div>
    <small className="muted">Price collected {timestamp(snapshot.priceObservedAt)}. Snapshot; prices may have changed.</small><Link className="button" href={`/research/${id}`}>Read the reasoning →</Link>
  </article>;
}
