"use client";
import { useEffect, useState } from "react";
import { CompanyFacts } from "@/components/CompanyFacts";
import type { assembleRestrictedResearchWatch } from "@/lib/restricted-research-watch";
import type { CompanyCardFacts } from "@/lib/company-card-facts";
import { SignalPriceOutlook } from "@/components/SignalPriceOutlook";
import { compareSignalPotential, type PriceOutlook } from "@/lib/signal-outlook";
type Signal = { id: string; ticker: string; company: string; action: string; currentPrice: number | null; priceObservedAt?: string | null; fairValue: number | null;
  outlook: PriceOutlook; eventObservedAt?: string | null; industry: string;
  committeeApproved: boolean; committeeStatus: string; createdAt: string; confidence?: number | null; confidenceBasis?: string | null;
  explanation: { companyFacts?: CompanyCardFacts; companyDoes: string; whatHappened: string; whyItMatters: string; whatCouldHappen: string; whatCouldGoWrong: string; missingInformation: string[] };
  sources: Array<{ label: string; url: string }> };
function researchDate(value: string | null) {
  return value ? `${new Date(value).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })} Bangkok time` : "unavailable";
}

type ParkedResearch = ReturnType<typeof assembleRestrictedResearchWatch>[number];

export function PublicSignalFeed({ restrictedBeta = false, readToken = "" }: { restrictedBeta?: boolean; readToken?: string }) {
  const [researchWatch, setResearchWatch] = useState<ParkedResearch[]>([]);
  const [visibleCount, setVisibleCount] = useState(20);
  const [coverage, setCoverage] = useState<{ companies: number; companiesWithFairValue: number | null; companiesWithoutFairValue: number | null } | null>(null);
  const [quality, setQuality] = useState<{ available: boolean; averageCompletenessPercent?: number; averageMinutesToFirstReview?: number | null; uniqueEvents?: number } | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]), [error, setError] = useState(""), [filter, setFilter] = useState("all");
  useEffect(() => {
    if (restrictedBeta && !readToken) return;
    let active = true;
    const load = async () => { try { const response = await fetch(`/api/public/signals?action=${encodeURIComponent(filter)}`, { cache: "no-store", headers: readToken ? { "x-swing-up-serious-signal-read-token": readToken } : undefined }); const body = await response.json();
      if (!response.ok || !body.ok || !body.sanitized || !Array.isArray(body.alerts) || (restrictedBeta && !Array.isArray(body.researchWatch))) throw new Error("Live alerts are temporarily unavailable.");
      if (active) { setResearchWatch(restrictedBeta ? body.researchWatch : []); setSignals(body.alerts); setCoverage(body.coverage); setQuality(body.dataQuality); setError(""); }
    } catch { if (active) { if (restrictedBeta) { setResearchWatch([]); setSignals([]); setCoverage(null); setQuality(null); } setError(restrictedBeta ? "Research Watch is unavailable. Check the read-only access key or try again shortly." : "Live alerts are temporarily unavailable. Please try again shortly."); } } };
    void load(); const timer = setInterval(load, 60000); return () => { active = false; clearInterval(timer); };
  }, [filter, restrictedBeta, readToken]);
  const visible = signals.filter(s => filter === "all" || (filter === "approved" ? s.committeeApproved : s.action === filter)).sort(compareSignalPotential);
  return <section id="live-alerts"><h2>{restrictedBeta ? "Research Watch · event and valuation candidates" : "Live opportunities and risk alerts"}</h2>
    <p>{restrictedBeta ? "Candidates only. These are not approved Serious Alerts or evidence of an executable opportunity. Investment accuracy is not yet established. Verified Serious Alerts and their delivery status appear separately above." : "Provisional alerts are available while research continues. The approval badge shows whether the AI Committee has approved a Serious Signal."}</p>
    <p className="muted">Buy and Sell opportunities are ranked together, largest potential percentage move first, using the displayed price and base estimate. Sell percentages show the potential price decline. Alerts without a supported target follow, then Watch Out alerts.</p>
    {coverage ? <p>{coverage.companies} companies processed. {coverage.companiesWithFairValue != null ? `${coverage.companiesWithFairValue} have a model value; ${coverage.companiesWithoutFairValue ?? "unknown"} still need valuation inputs.` : "Valuation completeness has not yet been reported."}</p> : null}
    {quality?.available ? <details><summary>How complete is the evidence?</summary><p>Across {quality.uniqueEvents} tracked events today, {quality.averageCompletenessPercent} out of 100 evidence checks passed on average. Checks cover company identity, business and industry, source documents, financial facts, current prices, valuation scenarios, direction and trading-halt status.</p>{quality.averageMinutesToFirstReview != null ? <p>Average time from the recorded event to its first Committee review: {quality.averageMinutesToFirstReview} minutes.</p> : <p>No Committee review time has been recorded in this sample yet.</p>}</details> : null}
    <label>Show <select value={filter} onChange={e => { setFilter(e.target.value); setVisibleCount(20); }} aria-label="Filter signals"><option value="all">{restrictedBeta ? "All research candidates" : "All alerts"}</option><option value="buy">{restrictedBeta ? "Buy research" : "Buy opportunities"}</option><option value="sell">{restrictedBeta ? "Sell research" : "Sell opportunities"}</option><option value="watch_out">{restrictedBeta ? "Risk research" : "Watch out"}</option><option value="approved">{restrictedBeta ? "Committee review recorded" : "Committee approved"}</option></select></label>
    {error ? <p role="status">{error}</p> : null}
    {!error && !visible.length && (!restrictedBeta || !researchWatch.length) ? <p>{restrictedBeta ? "No matching Research Watch candidate is currently available. This does not verify an empty Serious Alert feed." : "No matching live alert is currently available."}</p> : null}
    <div className="grid">{visible.slice(0, visibleCount).map(s => <article className="card alert-card" key={s.id}>
      <div className="button-row"><span className="badge">{restrictedBeta ? "RESEARCH WATCH" : s.committeeApproved ? "SERIOUS SIGNAL" : "PROVISIONAL ALERT"} · {s.action.replaceAll("_", " ").toUpperCase()}</span><span className="badge">{restrictedBeta ? (s.committeeApproved ? "Committee review recorded · delivery unverified here" : `Review: ${s.committeeStatus.replaceAll("_", " ")}`) : s.committeeApproved ? "Committee approved" : ["approved", "approved_pending_checks"].includes(s.committeeStatus) ? "Positive review · final checks pending" : s.committeeStatus === "rejected" ? "Committee rejected" : s.committeeStatus === "needs_more_data" ? "Collecting more information" : "Awaiting Committee review"}</span></div>
      <h3>{s.ticker} — {s.company}</h3>
      <p><strong>Industry:</strong> {s.industry}</p>
      <CompanyFacts facts={s.explanation.companyFacts} />
      {restrictedBeta ? <p><strong>Historical price snapshot; current trade-time freshness is unverified.</strong> Research scenarios are not executable quotes.</p> : null}
      {s.outlook ? <SignalPriceOutlook outlook={s.outlook} action={s.action} /> : null}
      <p><strong>What is happening:</strong> {s.explanation.whatHappened}</p>
      <p><strong>Why this matters:</strong> {s.explanation.whyItMatters}</p>
      <p><strong>What could happen:</strong> {s.explanation.whatCouldHappen}</p>
      <p><strong>What could go wrong:</strong> {s.explanation.whatCouldGoWrong}</p>
      {s.explanation.missingInformation?.length ? <p><strong>Still needed:</strong> {s.explanation.missingInformation.join(" ")}</p> : restrictedBeta ? <p><strong>Still needed:</strong> Current Serious Alert eligibility and a saved live delivery receipt are not verified in this research view.</p> : null}
      {s.priceObservedAt ? <p className="muted">Price recorded: {new Date(s.priceObservedAt).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })} Bangkok time</p> : null}
      {typeof s.confidence === "number" ? <p>{s.confidenceBasis === "historical_committee_review" ? "Historical Committee confidence" : s.confidenceBasis === "committee_review" ? "Committee confidence" : "Model confidence"}: {s.confidence}/100. This is not the probability of making a profit.</p> : <p className="muted">Committee confidence is unavailable without a completed review of this assessment.</p>}
      <p className="muted">Updated: {new Date(s.createdAt).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })} Bangkok time</p>
      {s.eventObservedAt ? <p className="muted">Event recorded: {new Date(s.eventObservedAt).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })} Bangkok time</p> : null}
      {restrictedBeta ? <p className="muted">Source publication dates are not supplied by this view; the event and research timestamps above are not publication dates.</p> : null}
      <details><summary>Sources</summary><div className="button-row">{s.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label || "Evidence"}</a>)}</div></details>
    </article>)}</div>
    {restrictedBeta && researchWatch.length ? <section aria-label="Parked Research Watch candidates">
      <h3>Parked Research Watch candidates</h3>
      <p>These cases are waiting for the named evidence gaps to be resolved. They are not approved Serious Alerts. Prices and targets are omitted.</p>
      <div className="grid">{researchWatch.map(item => <article className="card" key={item.id}>
        <span className="badge">RESEARCH WATCH · PARKED</span>
        <h4>{item.ticker} · {item.company}</h4>
        {item.headline ? <p>{item.headline}</p> : null}
        <p><strong>Still needed:</strong> {item.missingInformation.join(" ")}</p>
        <p className="muted">Event observed: {researchDate(item.sourceDates.eventObservedAt)}. Company filing date: {researchDate(item.sourceDates.companyFilingDate)}. The event observation time is not a document publication date.</p>
        <p className="muted">Research updated: {researchDate(item.updatedAt)}.</p>
        <p>{item.notice}</p><p className="muted">{item.reopening}</p>
        {item.sources.length ? <details><summary>Sources and publication dates</summary>{item.sources.map(source => <p key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.label || "Evidence"}</a> · Published: {researchDate(source.publishedAt)}</p>)}</details> : <p className="muted">No verified public source link is available in this view.</p>}
      </article>)}</div>
    </section> : null}
    {visible.length > visibleCount ? <button className="button" onClick={() => setVisibleCount(value => value + 20)}>{restrictedBeta ? "Show 20 more candidates" : "Show 20 more alerts"}</button> : null}
  </section>;
}
