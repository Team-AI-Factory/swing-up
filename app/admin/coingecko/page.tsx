"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type CoinGeckoHealth = {
  status: string;
  lastChecked: string | null;
  lastSuccess: string | null;
  responseTimeMs: number | null;
  lastError: string | null;
  usage: string | null;
  notes: string | null;
  mode: "demo_public" | "api_key";
};

type CoinGeckoRunResult = {
  ok: boolean;
  dryRun: boolean;
  mode: "demo_public" | "api_key";
  assetsChecked: number;
  signalsCreated: number;
  duplicatesSkipped: number;
  rateLimited: boolean;
  cooldownUntil: string | null;
  responseTimeMs: number;
  errors: string[];
  quotes: { ticker: string; usdPrice: number | null; change24h: number | null; importanceHint: string }[];
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Not checked yet";
}

function formatNumber(value: number | null) {
  return typeof value === "number" ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "n/a";
}

export default function CoinGeckoAdminPage() {
  const [health, setHealth] = useState<CoinGeckoHealth | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<CoinGeckoRunResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [limit, setLimit] = useState("10");
  const [dryRun, setDryRun] = useState(true);

  const dryRunUrl = useMemo(() => `/api/ears/coingecko/run?limit=${encodeURIComponent(limit)}&dryRun=true`, [limit]);

  async function loadStatus() {
    try {
      const response = await fetch("/api/ears/coingecko/status", { cache: "no-store" });
      const data = await response.json();
      if (data.ok) {
        setHealth(data.health);
        setStatusError(null);
      } else {
        setStatusError(data.error ?? "Unable to load CoinGecko status.");
      }
    } catch {
      setStatusError("Unable to load CoinGecko status.");
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  async function runEar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsRunning(true);
    setRunResult(null);
    try {
      const params = new URLSearchParams({ limit, dryRun: String(dryRun) });
      const response = await fetch(`/api/ears/coingecko/run?${params.toString()}`, { method: "POST" });
      const data = await response.json();
      setRunResult(data);
      await loadStatus();
    } catch {
      setRunResult({ ok: false, dryRun, mode: "demo_public", assetsChecked: 0, signalsCreated: 0, duplicatesSkipped: 0, rateLimited: false, cooldownUntil: null, responseTimeMs: 0, errors: ["Unable to run CoinGecko ear from the admin page."], quotes: [] });
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Admin / CoinGecko</div>
          <h1>CoinGecko Crypto Price Ear</h1>
          <p>
            CoinGecko helps Swing Up measure crypto risk appetite by checking major crypto assets for sharp 24h price moves,
            volume context, and market-cap context before any later signal filter or research workflow.
          </p>
          <p className="muted">This ear creates raw crypto_market receipts only. It does not create final alerts, paid API calls, AI calls, Telegram messages, or Stripe events.</p>
        </div>
        <div className="card">
          <div className="metric"><span>Status</span><strong>{health?.status ?? "Loading"}</strong></div>
          <div className="metric"><span>Mode</span><strong>{health?.mode === "api_key" ? "API key" : "Demo/public"}</strong></div>
          <div className="metric"><span>Last checked</span><strong>{formatDate(health?.lastChecked ?? null)}</strong></div>
          <div className="metric"><span>Last success</span><strong>{formatDate(health?.lastSuccess ?? null)}</strong></div>
        </div>
      </section>

      <section className="grid two trust-section">
        <article className="card">
          <h2>Run or test</h2>
          <p>Use dry-run first to verify the public simple price endpoint without saving raw signals.</p>
          <form onSubmit={runEar}>
            <label>
              Asset limit
              <input value={limit} onChange={(event) => setLimit(event.target.value)} inputMode="numeric" />
            </label>
            <label>
              <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} /> Dry run only
            </label>
            <div className="button-row">
              <button className="button primary" type="submit" disabled={isRunning}>{isRunning ? "Running…" : "Run CoinGecko ear"}</button>
              <Link className="button" href={dryRunUrl}>Dry-run JSON</Link>
              <Link className="button" href="/api/ears/coingecko/status">Status JSON</Link>
              <Link className="button" href="/admin">Back to admin</Link>
            </div>
          </form>
        </article>

        <article className="card">
          <h2>Source Health</h2>
          {statusError ? <p className="error-text">{statusError}</p> : null}
          <p><strong>Usage:</strong> {health?.usage ?? "Public CoinGecko crypto market ear"}</p>
          <p><strong>Notes:</strong> {health?.notes ?? "Waiting for first check."}</p>
          <p><strong>Last error:</strong> {health?.lastError ?? "None"}</p>
          <p><strong>Response:</strong> {health?.responseTimeMs ? `${health.responseTimeMs}ms` : "n/a"}</p>
        </article>
      </section>

      {runResult ? (
        <section className="card trust-section">
          <div className="eyebrow">Latest run result</div>
          <h2>{runResult.ok ? "CoinGecko run completed" : "CoinGecko run failed"}</h2>
          <div className="grid three">
            <div className="metric"><span>Assets checked</span><strong>{runResult.assetsChecked}</strong></div>
            <div className="metric"><span>Signals created</span><strong>{runResult.signalsCreated}</strong></div>
            <div className="metric"><span>Duplicates skipped</span><strong>{runResult.duplicatesSkipped}</strong></div>
            <div className="metric"><span>Rate limited</span><strong>{runResult.rateLimited ? "Yes" : "No"}</strong></div>
            <div className="metric"><span>Cooldown until</span><strong>{formatDate(runResult.cooldownUntil)}</strong></div>
            <div className="metric"><span>Response</span><strong>{runResult.responseTimeMs}ms</strong></div>
          </div>
          {runResult.errors.length ? <p className="error-text">{runResult.errors.join(" ")}</p> : null}
          <div className="grid three">
            {runResult.quotes.map((quote) => (
              <div className="metric" key={quote.ticker}>
                <span>{quote.ticker}</span>
                <strong>${formatNumber(quote.usdPrice)}</strong>
                <span>{formatNumber(quote.change24h)}% 24h · {quote.importanceHint}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
