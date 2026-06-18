"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

const defaultTerms = "AAPL, NVDA, Federal Reserve, FDA approval, earnings guidance";

type GdeltHealth = {
  status?: string;
  lastChecked?: string | null;
  lastSuccess?: string | null;
  responseTimeMs?: number | null;
  lastError?: string | null;
};

type GdeltRunResult = {
  ok: boolean;
  termsChecked: number;
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
  const [terms, setTerms] = useState(defaultTerms);
  const [limit, setLimit] = useState("3");
  const [dryRun, setDryRun] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<GdeltRunResult | null>(null);

  const dryRunTestHref = useMemo(
    () => `/api/ears/gdelt/run?terms=${encodeURIComponent("NVDA,Federal Reserve")}&limit=3&dryRun=true`,
    [],
  );
  const browserQueryHref = useMemo(() => `/api/ears/gdelt/run?q=${encodeURIComponent("Nvidia")}&limit=2&dryRun=true`, []);

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

    const params = new URLSearchParams({ terms, limit, dryRun: String(dryRun) });

    try {
      const response = await fetch(`/api/ears/gdelt/run?${params.toString()}`, { method: "POST" });
      const data = await response.json();
      setRunResult(data);
    } catch {
      setRunResult({
        ok: false,
        termsChecked: 0,
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
          <h1>GDELT Public News Ear</h1>
          <p>
            GDELT is the second real public ear. It reads small recent public news/event searches and stores matching
            headlines in Raw Signal Store without scoring, AI review, paid market APIs, or final alerts.
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
          Dry run checks GDELT and duplicate detection without creating raw signals. If no EAR_RUN_TOKEN is configured,
          the API allows only a small capped test run for safety.
        </p>
        <form className="form" onSubmit={handleRun}>
          <label>
            <span className="eyebrow">Terms</span>
            <input className="input" value={terms} onChange={(event) => setTerms(event.target.value)} placeholder={defaultTerms} />
          </label>
          <label>
            <span className="eyebrow">Limit per term</span>
            <input className="input" value={limit} onChange={(event) => setLimit(event.target.value)} placeholder="3" inputMode="numeric" />
          </label>
          <label className="metric">
            <span>Dry run mode</span>
            <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
          </label>
          <button className="button primary" type="submit" disabled={isRunning}>{isRunning ? "Running…" : "Run GDELT ear"}</button>
        </form>
        <div className="button-row">
          <Link className="button" href={dryRunTestHref}>Open dry-run test link</Link>
          <Link className="button" href={browserQueryHref}>Open q=Nvidia test link</Link>
        </div>
        {runResult ? (
          <div className="card trust-section">
            <h3>Run result summary</h3>
            {runResult.error ? <p className="source-health-warning">{runResult.error}</p> : null}
            {runResult.capped ? <p className="muted">Unauthenticated runs are capped for safety.</p> : null}
            <div className="grid two">
              <div className="metric"><span>Terms checked</span><strong>{runResult.termsChecked}</strong></div>
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
          <li>GDELT article headlines are saved as raw news_event signals.</li>
          <li>Duplicate URLs or titles are skipped.</li>
          <li>Signal Filter can review the raw signals later.</li>
          <li>No scoring, real AI calls, or final alerts happen in this ear.</li>
          <li>No cron is configured yet; runs are manual only.</li>
        </ol>
      </section>
    </div>
  );
}
