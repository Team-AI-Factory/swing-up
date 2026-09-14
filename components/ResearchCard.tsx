import Link from "next/link";
import { COLORS, money, timestamp, type ResearchSnapshot } from "@/lib/growth/research";
export function ResearchCard({ id, snapshot }: { id: string; snapshot: ResearchSnapshot }) {
  return <article className="card research-card"><span className="research-badge" style={{ color: COLORS[snapshot.action] }}>{snapshot.label} · Provisional</span><div><h2>{snapshot.ticker}</h2><p className="muted">{snapshot.company}</p></div><h3>{snapshot.title}</h3>
    <div className="research-metrics"><div><span>Latest recorded</span><strong>{money(snapshot.currentPrice)}</strong></div><div><span>Model target · no horizon</span><strong>{money(snapshot.targetPrice)}</strong></div></div>
    <div><p style={{ fontSize: 13 }}>Model confidence <strong>{snapshot.confidence}/100</strong></p><div className="research-confidence"><span style={{ width: `${snapshot.confidence}%` }} /></div><small className="muted">Not the probability of profit</small></div>
    <small className="muted">Price collected {timestamp(snapshot.priceObservedAt)}. Snapshot; prices may have changed.</small><Link className="button" href={`/research/${id}`}>Read the reasoning →</Link>
  </article>;
}
