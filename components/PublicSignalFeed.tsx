"use client";
import { useEffect, useState } from "react";
import { SignalPriceOutlook } from "@/components/SignalPriceOutlook";
import type { PriceOutlook } from "@/lib/signal-outlook";
type Signal = { id: string; ticker: string; company: string; action: string; currentPrice: number | null; priceObservedAt?: string | null; fairValue: number | null;
  outlook: PriceOutlook; eventObservedAt?: string | null; industry: string;
  committeeApproved: boolean; committeeStatus: string; createdAt: string; confidence?: number | null;
  explanation: { companyDoes: string; whatHappened: string; whyItMatters: string; whatCouldHappen: string; whatCouldGoWrong: string; missingInformation: string[] };
  sources: Array<{ label: string; url: string }> };
export function PublicSignalFeed() {
  const [visibleCount, setVisibleCount] = useState(20);
  const [coverage, setCoverage] = useState<{ companies: number; companiesWithFairValue: number | null; companiesWithoutFairValue: number | null } | null>(null);
  const [quality, setQuality] = useState<{ available: boolean; averageCompletenessPercent?: number; averageMinutesToFirstReview?: number | null; uniqueEvents?: number } | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]), [error, setError] = useState(""), [filter, setFilter] = useState("all");
  useEffect(() => {
    let active = true;
    const load = async () => { try { const response = await fetch(`/api/public/signals?action=${encodeURIComponent(filter)}`); const body = await response.json();
      if (!response.ok || !body.ok || !body.sanitized || !Array.isArray(body.alerts)) throw new Error("Live alerts are temporarily unavailable.");
      if (active) { setSignals(body.alerts); setCoverage(body.coverage); setQuality(body.dataQuality); setError(""); }
    } catch { if (active) setError("Live alerts are temporarily unavailable. Please try again shortly."); } };
    void load(); const timer = setInterval(load, 60000); return () => { active = false; clearInterval(timer); };
  }, [filter]);
  const visible = signals.filter(s => filter === "all" || (filter === "approved" ? s.committeeApproved : s.action === filter));
  return <section id="live-alerts"><h2>Live opportunities and risk alerts</h2>
    <p>Provisional alerts are available while research continues. The approval badge shows whether the AI Committee has approved a Serious Signal.</p>
    <p className="muted">Buy opportunities first, then Sell opportunities. Each group is ordered by the largest potential move to its base estimate, using the displayed price. Company details and price comparisons are checked before an alert appears.</p>
    {coverage ? <p>{coverage.companies} companies processed. {coverage.companiesWithFairValue != null ? `${coverage.companiesWithFairValue} have a model value; ${coverage.companiesWithoutFairValue ?? "unknown"} still need valuation inputs.` : "Valuation completeness has not yet been reported."}</p> : null}
    {quality?.available ? <details><summary>How complete is the evidence?</summary><p>Across {quality.uniqueEvents} tracked events today, {quality.averageCompletenessPercent} out of 100 evidence checks passed on average. Checks cover company identity, business and industry, source documents, financial facts, current prices, valuation scenarios, direction and trading-halt status.</p>{quality.averageMinutesToFirstReview != null ? <p>Average time from the recorded event to its first Committee review: {quality.averageMinutesToFirstReview} minutes.</p> : <p>No Committee review time has been recorded in this sample yet.</p>}</details> : null}
    <label>Show <select value={filter} onChange={e => { setFilter(e.target.value); setVisibleCount(20); }} aria-label="Filter signals"><option value="all">All alerts</option><option value="buy">Buy opportunities</option><option value="sell">Sell opportunities</option><option value="watch_out">Watch out</option><option value="approved">Committee approved</option></select></label>
    {error ? <p role="status">{error}</p> : null}
    {!error && !visible.length ? <p>No matching live alert is currently available.</p> : null}
    <div className="grid">{visible.slice(0, visibleCount).map(s => <article className="card alert-card" key={s.id}>
      <div className="button-row"><span className="badge">{s.committeeApproved ? "SERIOUS SIGNAL" : "PROVISIONAL ALERT"} · {s.action.replaceAll("_", " ").toUpperCase()}</span><span className="badge">{s.committeeApproved ? "Committee approved" : s.committeeStatus === "approved_pending_checks" ? "Positive review · final checks pending" : s.committeeStatus === "needs_more_data" ? "Collecting more information" : "Awaiting Committee review"}</span></div>
      <h3>{s.ticker} — {s.company}</h3>
      <p><strong>Industry:</strong> {s.industry}</p>
      <p><strong>What the company does:</strong> {s.explanation.companyDoes}</p>
      {s.outlook ? <SignalPriceOutlook outlook={s.outlook} action={s.action} /> : null}
      <p><strong>What is happening:</strong> {s.explanation.whatHappened}</p>
      <p><strong>Why this matters:</strong> {s.explanation.whyItMatters}</p>
      <p><strong>What could happen:</strong> {s.explanation.whatCouldHappen}</p>
      <p><strong>What could go wrong:</strong> {s.explanation.whatCouldGoWrong}</p>
      {s.explanation.missingInformation?.length ? <p><strong>Still needed:</strong> {s.explanation.missingInformation.join(" ")}</p> : null}
      {s.priceObservedAt ? <p className="muted">Price recorded: {new Date(s.priceObservedAt).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })} Bangkok time</p> : null}
      {typeof s.confidence === "number" ? <p>Model confidence: {s.confidence}/100. This is not the probability of making a profit.</p> : null}
      <p className="muted">Updated: {new Date(s.createdAt).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })} Bangkok time</p>
      {s.eventObservedAt ? <p className="muted">Event recorded: {new Date(s.eventObservedAt).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })} Bangkok time</p> : null}
      <details><summary>Sources</summary><div className="button-row">{s.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label || "Evidence"}</a>)}</div></details>
    </article>)}</div>
    {visible.length > visibleCount ? <button className="button" onClick={() => setVisibleCount(value => value + 20)}>Show 20 more alerts</button> : null}
  </section>;
}
