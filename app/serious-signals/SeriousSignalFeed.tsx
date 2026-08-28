"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type LiveAlert = {
  id: string;
  createdAt: string;
  ticker: string;
  alertType: "buy" | "sell" | "watch_out";
  eventHeadline: string;
  whyItMatters: string | null;
  price: number | null;
  finalJudgeConfidence: number;
  committee: { completed: number; failed: number; recommendation: string };
  evidence: Array<{ source: string | null; url: string }>;
  delivery: {
    status: string;
    attempts?: number;
    nextAttemptAt?: string | null;
    channels?: { webFeed?: string; telegram?: string; webhook?: string };
  };
};

type LiveFeed = {
  ok: true;
  generatedAt: string;
  window: { hours: number; from: string; to: string };
  summary: {
    total: number;
    buy: number;
    sell: number;
    watchOut: number;
    delivered: number;
    deliveryAttentionNeeded: number;
  };
  alerts: LiveAlert[];
  truncated: boolean;
  sanitized: true;
  sensor: {
    verifiedLive: boolean;
    coverageVerified: boolean;
    owner: "cloudflare_worker" | "railway" | null;
    lastScanAt: string | null;
    ageMinutes: number | null;
    reason: string | null;
    coverageReason: string | null;
  };
  emptyResultVerified: boolean;
};

type ValuationWatchlistItem = {
  id: string;
  anchor: string;
  observedAt: string;
  ticker: string;
  company: string;
  sector: string | null;
  industry: string | null;
  action: "buy_research" | "sell_research" | "watch_out_research" | "price_watch";
  currentPrice: number | null;
  priceObservedAt: string;
  livePriceFresh: boolean;
  livePriceAlert: { threshold: string | null; changePercent: number | null; relativeVolume: number | null } | null;
  fairValue: {
    conservative: number | null;
    base: number | null;
    optimistic: number | null;
    buyBelow: number | null;
    trimAbove: number | null;
    upsideToBasePercent: number | null;
  };
  scores: { quality: number | null; risk: number | null; evidence: number | null; fairValueConfidence: number | null };
  reasons: string[];
  blockers: string[];
  specialistModelApplied: boolean;
  publicationStatus: "provisional_research_only";
  userAlertEligible: false;
  committeeApproved: false;
  links: Array<{ label: string; url: string }>;
};

type ValuationWatchlist = {
  ok: true;
  generatedAt: string;
  foundation: {
    available: boolean;
    complete: boolean;
    cycleId: string | null;
    completedAt: string | null;
    sourceCheckedAt: string | null;
    coverage: { companies: number | null; totalCompanies: number | null; percent: number | null } | null;
  };
  livePricing: { available: boolean; checkedAt: string | null; ageMinutes: number | null; source: string | null };
  summary: {
    total: number;
    buyResearch: number;
    sellResearch: number;
    watchOutResearch: number;
    priceWatch: number;
    specialistModelApplied: number;
  };
  candidates: ValuationWatchlistItem[];
  truncated: boolean;
  sanitized: true;
  provisionalResearchOnly: true;
  userAlertEligible: false;
};

const TOKEN_STORAGE_KEY = "swing_up_serious_signal_read_token";

function formatTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(parsed);
}

function alertLabel(value: LiveAlert["alertType"]) {
  if (value === "watch_out") return "SERIOUS WATCH OUT";
  return `SERIOUS ${value.toUpperCase()}`;
}

function deliveryLabel(value: string) {
  if (value === "delivered") return "Delivered";
  if (value === "pending_registration" || value === "pending") return "Pending delivery";
  if (value === "retry_scheduled") return "Delivery retry scheduled";
  if (value === "blocked_no_channel") return "No delivery channel configured";
  if (value === "expired") return "Notification window expired";
  if (value === "dead_letter") return "Delivery needs manual attention";
  return value.replaceAll("_", " ");
}

function watchlistLabel(value: ValuationWatchlistItem["action"]) {
  if (value === "buy_research") return "PROVISIONAL BUY RESEARCH";
  if (value === "sell_research") return "PROVISIONAL SELL RESEARCH";
  if (value === "watch_out_research") return "PROVISIONAL RISK WATCH";
  return "PRICE WATCH";
}

function livePriceAlertLabel(value: NonNullable<ValuationWatchlistItem["livePriceAlert"]>) {
  if (value.threshold === "strong_buy_price_crossed") return "LIVE STRONG-BUY PRICE CROSS";
  if (value.threshold === "buy_price_crossed") return "LIVE BUY PRICE CROSS";
  if (value.threshold === "trim_price_crossed") return "LIVE TRIM PRICE CROSS";
  return "LIVE UNUSUAL PRICE / VOLUME";
}

function money(value: number | null) {
  return value === null ? "—" : `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function SeriousSignalFeed({ compact = false }: { compact?: boolean }) {
  const [token, setToken] = useState("");
  const [draftToken, setDraftToken] = useState("");
  const [feed, setFeed] = useState<LiveFeed | null>(null);
  const [watchlist, setWatchlist] = useState<ValuationWatchlist | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);

  const load = useCallback(async (readToken: string, background = false) => {
    if (!readToken) return;
    if (!background) setLoading(true);
    try {
      const headers = { "x-swing-up-serious-signal-read-token": readToken };
      const [response, watchlistResponse] = await Promise.all([
        fetch("/api/internal/serious-signal-status?hours=48&limit=100", { headers, cache: "no-store" }),
        fetch("/api/internal/valuation-watchlist-status?limit=60", { headers, cache: "no-store" }),
      ]);
      if (response.status === 404) throw new Error("The read-only access key was not accepted.");
      if (!response.ok) throw new Error("The live alert store is temporarily unavailable.");
      const payload = await response.json() as LiveFeed;
      if (!payload.ok || payload.sanitized !== true || !Array.isArray(payload.alerts)) {
        throw new Error("The live alert response failed its safety check.");
      }
      setFeed(payload);
      setError(null);
      if (watchlistResponse.ok) {
        const watchlistPayload = await watchlistResponse.json() as ValuationWatchlist;
        if (watchlistPayload.ok
          && watchlistPayload.sanitized === true
          && watchlistPayload.provisionalResearchOnly === true
          && Array.isArray(watchlistPayload.candidates)) {
          setWatchlist(watchlistPayload);
          setWatchlistError(null);
        } else {
          setWatchlistError("The Valuation Watchlist response failed its safety check.");
        }
      } else {
        setWatchlistError("The Valuation Watchlist is temporarily unavailable.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load live Serious Signals.");
    } finally {
      if (!background) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const saved = window.sessionStorage.getItem(TOKEN_STORAGE_KEY)?.trim() ?? "";
    if (!saved) return;
    setToken(saved);
    setDraftToken(saved);
    void load(saved);
  }, [load]);

  useEffect(() => {
    if (!token) return;
    const timer = window.setInterval(() => void load(token, true), 60_000);
    return () => window.clearInterval(timer);
  }, [load, token]);

  function connect(event: FormEvent) {
    event.preventDefault();
    const next = draftToken.trim();
    if (!next) {
      setError("Enter the read-only alert access key.");
      return;
    }
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, next);
    setToken(next);
    void load(next);
  }

  function disconnect() {
    window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken("");
    setDraftToken("");
    setFeed(null);
    setWatchlist(null);
    setError(null);
    setWatchlistError(null);
  }

  if (!token) {
    return (
      <section className="card" aria-label="Connect to live Serious Signals">
        <span className="badge">Real data only</span>
        <h2>Connect the live Serious Signal feed</h2>
        <p>This screen never substitutes examples or test alerts. The read-only key unlocks sanitized, Committee-approved results from R2.</p>
        <form className="form" onSubmit={connect}>
          <label htmlFor="serious-signal-read-token"><strong>Read-only access key</strong></label>
          <input
            id="serious-signal-read-token"
            className="input"
            type="password"
            autoComplete="off"
            value={draftToken}
            onChange={(event) => setDraftToken(event.target.value)}
            placeholder="Enter access key"
          />
          <button className="button primary" type="submit">Open live alerts</button>
        </form>
        {error ? <p role="alert"><strong>Unable to connect:</strong> {error}</p> : null}
      </section>
    );
  }

  return (
    <section aria-live="polite" aria-busy={loading}>
      <div className="button-row">
        <button className="button" type="button" onClick={() => void load(token)} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh now"}
        </button>
        <button className="button" type="button" onClick={disconnect}>Lock feed</button>
        <span className="badge">Auto-refreshes every minute</span>
      </div>

      {error ? <section className="card"><strong>Live feed unavailable:</strong> {error} The previous verified result is kept on screen if available.</section> : null}

      {feed ? (
        <>
          <div className="grid three" style={{ marginTop: 18 }}>
            <div className="card"><span className="muted">Verified alerts · 48h</span><div className="kpi">{feed.summary.total}</div></div>
            <div className="card"><span className="muted">Buy / Sell / Watch Out</span><div className="kpi">{feed.summary.buy} / {feed.summary.sell} / {feed.summary.watchOut}</div></div>
            <div className="card"><span className="muted">Delivered / Needs attention</span><div className="kpi">{feed.summary.delivered} / {feed.summary.deliveryAttentionNeeded}</div></div>
          </div>
          <p className="muted">Last checked {formatTime(feed.generatedAt)} Bangkok time. Window begins {formatTime(feed.window.from)}.</p>
          <p className="muted">
            Sensor: {feed.sensor.verifiedLive
              ? `live via ${feed.sensor.owner === "cloudflare_worker" ? "Cloudflare" : "Railway"}${feed.sensor.lastScanAt ? ` · last scan ${formatTime(feed.sensor.lastScanAt)}` : ""}`
              : `not freshly verified${feed.sensor.reason ? ` · ${feed.sensor.reason.replaceAll("_", " ")}` : ""}`}.
            {feed.sensor.verifiedLive && !feed.sensor.coverageVerified
              ? ` Critical coverage is incomplete${feed.sensor.coverageReason ? ` · ${feed.sensor.coverageReason.replaceAll("_", " ")}` : ""}.`
              : ""}
          </p>

          {feed.alerts.length === 0 ? (
            <section className="card">
              <span className="badge">{feed.emptyResultVerified ? "Verified live result" : "Live scan proof needed"}</span>
              <h2>{feed.emptyResultVerified
                ? "No Committee-approved Serious Signal was found in the latest 48 hours."
                : feed.sensor.verifiedLive
                  ? "The alert feed is empty, but critical source or baseline coverage is incomplete."
                  : "The alert feed is empty, but the sensor is not freshly verified."}</h2>
              <p>{feed.emptyResultVerified
                ? "This is a confirmed empty result from the live R2 feed—not a missing-data fallback."
                : "Do not interpret this as zero alerts until a fresh production scan has complete critical-source, universe, and exposure coverage."}</p>
            </section>
          ) : (
            <div className="grid">
              {feed.alerts.slice(0, compact ? 3 : 100).map((alert) => (
                <article className="card alert-card" key={alert.id}>
                  <div className="button-row">
                    <span className="badge">{alertLabel(alert.alertType)}</span>
                    <span className="badge">Judge {alert.finalJudgeConfidence}/100</span>
                    <span className="badge">{deliveryLabel(alert.delivery.status)}</span>
                  </div>
                  <h2>{alert.ticker} {alert.price !== null ? `· $${alert.price.toLocaleString("en-US")}` : ""}</h2>
                  <p><strong>What happened:</strong> {alert.eventHeadline}</p>
                  <p><strong>Why it matters:</strong> {alert.whyItMatters ?? "The full verified explanation is not available in the sanitized feed."}</p>
                  <p><strong>Detected:</strong> {formatTime(alert.createdAt)} Bangkok time</p>
                  <p><strong>Committee:</strong> {alert.committee.completed}/14 completed, {alert.committee.failed} failed, recommendation {alert.committee.recommendation}.</p>
                  {alert.evidence.length ? (
                    <div className="button-row">
                      {alert.evidence.slice(0, 4).map((evidence, index) => (
                        <a className="button" href={evidence.url} key={evidence.url} rel="noreferrer" target="_blank">
                          {evidence.source ?? `Evidence ${index + 1}`}
                        </a>
                      ))}
                    </div>
                  ) : <p className="muted">No public evidence link is available in the sanitized feed.</p>}
                </article>
              ))}
            </div>
          )}
          {feed.truncated ? <p className="muted">More verified records exist than this page currently displays.</p> : null}

          {!compact ? (
            <section id="valuation-watchlist" style={{ marginTop: 36 }}>
              <div className="eyebrow">Live foundation research · not a Serious Signal</div>
              <h2>Valuation Watchlist</h2>
              <p>
                These are apparent valuation opportunities from the daily foundation screen. They are shown immediately for research,
                but they have not passed current-event evidence, all 14 Committee roles, or the Final Judge.
              </p>
              <p className="muted">
                Permanent link: <a href="/serious-signals#valuation-watchlist">/serious-signals#valuation-watchlist</a> · refreshes within one minute of new R2 foundation or live-price data.
              </p>
              {watchlistError ? <section className="card"><strong>Watchlist unavailable:</strong> {watchlistError}</section> : null}
              {watchlist ? (
                <>
                  <div className="grid three">
                    <div className="card"><span className="muted">Provisional Buy / Sell / Risk</span><div className="kpi">{watchlist.summary.buyResearch} / {watchlist.summary.sellResearch} / {watchlist.summary.watchOutResearch}</div></div>
                    <div className="card"><span className="muted">Quality price watches</span><div className="kpi">{watchlist.summary.priceWatch}</div></div>
                    <div className="card"><span className="muted">Specialist sector model</span><div className="kpi">{watchlist.summary.specialistModelApplied}</div></div>
                  </div>
                  <p className="muted">
                    Foundation {watchlist.foundation.complete ? "complete" : "still building"}
                    {watchlist.foundation.completedAt ? ` · completed ${formatTime(watchlist.foundation.completedAt)}` : ""}
                    {watchlist.foundation.coverage?.percent !== null && watchlist.foundation.coverage?.percent !== undefined ? ` · ${watchlist.foundation.coverage.percent}% coverage` : ""}.
                    {watchlist.livePricing.available && watchlist.livePricing.checkedAt ? ` Live prices checked ${formatTime(watchlist.livePricing.checkedAt)}.` : ""}
                  </p>
                  {watchlist.candidates.length === 0 ? (
                    <section className="card"><h3>No provisional valuation candidate is available in the latest complete foundation run.</h3></section>
                  ) : (
                    <div className="grid">
                      {watchlist.candidates.map((item) => (
                        <article className="card alert-card" id={item.anchor} key={item.id}>
                          <div className="button-row">
                            <span className="badge">{watchlistLabel(item.action)}</span>
                            <span className="badge">Not Committee approved</span>
                            {item.specialistModelApplied ? <span className="badge">Sector specialist</span> : null}
                            {item.livePriceAlert ? <span className="badge">{livePriceAlertLabel(item.livePriceAlert)}</span> : null}
                          </div>
                          <h3>{item.ticker} · {item.company}</h3>
                          <p><strong>Current / conservative / base / optimistic:</strong> {money(item.currentPrice)} / {money(item.fairValue.conservative)} / {money(item.fairValue.base)} / {money(item.fairValue.optimistic)}</p>
                          <p className="muted">Price checked {formatTime(item.priceObservedAt)}{item.livePriceFresh ? " · live sensor snapshot" : " · latest foundation snapshot"}.</p>
                          {item.livePriceAlert ? <p><strong>Live market move:</strong> {item.livePriceAlert.changePercent !== null ? `${item.livePriceAlert.changePercent.toFixed(1)}%` : "change unavailable"}{item.livePriceAlert.relativeVolume !== null ? ` · ${item.livePriceAlert.relativeVolume.toFixed(1)}x relative volume` : ""}. This remains provisional research until current evidence and the Committee approve it.</p> : null}
                          <p><strong>Quality / risk / evidence:</strong> {item.scores.quality ?? "—"} / {item.scores.risk ?? "—"} / {item.scores.evidence ?? "—"}</p>
                          {item.reasons.length ? <p><strong>Why it reached the watchlist:</strong> {item.reasons.join(" ")}</p> : null}
                          {item.blockers.length ? <p><strong>Why it is not a Serious Signal:</strong> {item.blockers.join(" ")}</p> : null}
                          <div className="button-row">
                            <a className="button" href={`/serious-signals#${item.anchor}`}>Link to this item</a>
                            {item.links.map((link) => <a className="button" href={link.url} key={link.url} rel="noreferrer" target="_blank">{link.label}</a>)}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                  {watchlist.truncated ? <p className="muted">More research candidates exist than this screen currently displays.</p> : null}
                </>
              ) : loading ? <section className="card">Loading the Valuation Watchlist…</section> : null}
            </section>
          ) : null}
        </>
      ) : loading ? <section className="card">Loading the verified R2 feed…</section> : null}
    </section>
  );
}
