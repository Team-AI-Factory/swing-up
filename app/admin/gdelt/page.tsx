"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

const defaultQuery = "";

type GdeltHealth = {
  status?: string;
  lastChecked?: string | null;
  lastSuccess?: string | null;
  responseTimeMs?: number | null;
  lastError?: string | null;
};

type GdeltRunResult = {
  ok: boolean;
  mode: "firehose" | "single_query";
  articlesChecked: number;
  companyMatches: number;
  macroSignals: number;
  signalsCreated: number;
  duplicatesSkipped: number;
  errors: string[];
  dryRun: boolean;
  capped?: boolean;
  error?: string;
};

function formatDate(value?: string | null) {
  if (!value) return "Not checked yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

export default function GdeltAdminPage() {
  const [health, setHealth] = useState<GdeltHealth | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [query, setQuery] = useState(defaultQuery);
  const [limit, setLimit] = useState("25");
  const [dryRun, setDryRun] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<GdeltRunResult | null>(null);

  const dryRunTestHref = useMemo(
    () => "/api/ears/gdelt/run?limit=25&dryRun=true",
    [],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadStatus() {
      try {
        const response = await fetch("/api/ears/gdelt/status", { cache: "no-store" });
        const data = await response.json();
        if (!isMounted) return;

        if (!response.ok || !data.ok) {
          setStatusError(data.error ?? "Unable to load GDELT status.");
          return;
        }

        setHealth(data.health);
        setStatusError(null);
      } catch {
        if (isMounted) setStatusError("Unable to load GDELT status.");
      }
    }

    loadStatus();
    return () => {
      isMounted = false;
    };
  }, []);

  async function handleRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsRunning(true);
    setRunResult(null);

    const params = new URLSearchParams({ limit, dryRun: String(dryRun) });
    if (query.trim()) params.set("q", query.trim());

    try {
      const response = await fetch(`/api/ears/gdelt/run?${params.toString()}`, { method: "POST" });
      const data = await response.json();
      setRunResult(data);
    } catch {
      setRunResult({
        ok: false,
        mode: query.trim() ? "single_query" : "firehose",
        articlesChecked: 0,
        companyMatches: 0,
        macroSignals: 0,
        signalsCreated: 0,
        duplicatesSkipped: 0,
        errors: ["Unable to run GDELT ear from the admin page."],
        dryRun,
      });
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="page">
      <div className="raw-signal-header">
        <div>
          <div className="eyebrow">Admin / GDELT</div>
          <h1>GDELT Market-Wide Firehose</h1>
          <p>
            GDELT now runs as a broad market-wide firehose. Swing Up makes one small public news request, scans results locally for watched companies, and saves matched items into Raw Signal Store.
          </p>
        </div>
        <div className="button-row">
          <Link className="button" href="/admin">Back to admin</Link>
          <Link className="button" href="/admin/raw-signals">Raw Signal Store</Link>
        </div>
      </div>

      <section className="card trust-section">
        <h2>Current status</h2>
        {statusError ? <p className="source-health-warning">{statusError}</p> : null}
        <div className="grid two">
          <div className="metric"><span>Status</span><strong><span className={`badge status-${health?.status ?? "stubbed"}`}>{health?.status ?? "loading"}</span></strong></div>
          <div className="metric"><span>Last checked</span><strong>{formatDate(health?.lastChecked)}</strong></div>
          <div className="metric"><span>Last success</span><strong>{formatDate(health?.lastSuccess)}</strong></div>
          <div className="metric"><span>Response time</span><strong>{health?.responseTimeMs == null ? "—" : `${health.responseTimeMs} ms`}</strong></div>
        </div>
        <p><strong>Latest error:</strong> {health?.lastError ?? "None reported."}</p>
        <div className="button-row">
          <Link className="button" href="/api/ears/gdelt/status">Open status JSON</Link>
        </div>
      </section>

      <section className="card trust-section">
        <h2>Safe manual run panel</h2>
        <p>
          Dry run checks the broad firehose and duplicate detection without creating raw signals. If EAR_RUN_TOKEN is configured and a token is missing, the API allows only capped dry-run tests. GDELT updates around every 15 minutes, so this is near-real-time public news, not paid tick-by-tick news.
        </p>
        <form className="form" onSubmit={handleRun}>
          <label>
            <span className="eyebrow">Optional single manual query</span>
            <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Leave blank for market-wide firehose" />
          </label>
          <label>
            <span className="eyebrow">Max articles</span>
            <input className="input" value={limit} onChange={(event) => setLimit(event.target.value)} placeholder="25" inputMode="numeric" />
          </label>
          <label className="metric">
            <span>Dry run mode</span>
            <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
          </label>
          <button className="button primary" type="submit" disabled={isRunning}>{isRunning ? "Running…" : "Run GDELT ear"}</button>
        </form>
        <div className="button-row">
          <Link className="button" href={dryRunTestHref}>Firehose dry-run test</Link>
          <Link className="button" href="/api/ears/gdelt/run?limit=25">Firehose run link</Link>
          <Link className="button" href="/api/ears/gdelt/run?q=Nvidia&limit=25&dryRun=true">Single-query manual test</Link>
        </div>
        {runResult ? (
          <div className="card trust-section">
            <h3>Run result summary</h3>
            {runResult.error ? <p className="source-health-warning">{runResult.error}</p> : null}
            {runResult.capped ? <p className="muted">Unauthenticated runs are capped and forced to dry run for safety.</p> : null}
            <div className="grid two">
              <div className="metric"><span>Mode</span><strong>{runResult.mode}</strong></div>
              <div className="metric"><span>Articles checked</span><strong>{runResult.articlesChecked}</strong></div>
              <div className="metric"><span>Company matches</span><strong>{runResult.companyMatches}</strong></div>
              <div className="metric"><span>Macro signals</span><strong>{runResult.macroSignals}</strong></div>
              <div className="metric"><span>Signals created</span><strong>{runResult.signalsCreated}</strong></div>
              <div className="metric"><span>Duplicates skipped</span><strong>{runResult.duplicatesSkipped}</strong></div>
              <div className="metric"><span>Errors</span><strong>{runResult.errors?.length ?? 0}</strong></div>
            </div>
            {runResult.errors?.length ? <p>{runResult.errors.join("; ")}</p> : <p>No errors reported.</p>}
          </div>
        ) : null}
      </section>

      <section className="card trust-section">
        <h2>What happens after ingestion</h2>
        <ol className="receipts">
          <li>One broad GDELT request returns recent market-moving public news.</li>
          <li>Swing Up scans titles, snippets, sources, and URLs locally for watched tickers and company names.</li>
          <li>Matched company or clearly market-wide news becomes raw signals.</li>
          <li>Signal Filter reviews them.</li>
          <li>Pattern Match checks similar past events.</li>
          <li>Scoring and AI review come later.</li>
          <li>Final alerts are not created yet.</li>
        </ol>
      </section>

      <section className="card trust-section risk-callout">
        <h2>Safety note</h2>
        <p>
          This ear uses public GDELT endpoints without API keys. It avoids querying one stock at a time, does not score signals, does not call AI, and does not create final alerts.
        </p>
      </section>
    </div>
  );
}
