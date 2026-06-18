"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type FrankfurterHealth = {
  status?: string;
  lastChecked?: string | null;
  lastSuccess?: string | null;
  responseTimeMs?: number | null;
  lastError?: string | null;
  notes?: string | null;
  cooldownActive?: boolean;
};

type FrankfurterRunResult = {
  ok: boolean;
  dryRun: boolean;
  skipped: boolean;
  skipReason: string | null;
  base: string;
  date: string | null;
  pairsChecked: number;
  signalsCreated: number;
  strongMoves: number;
  referenceUpdates: number;
  rateLimited: boolean;
  errors: string[];
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

export default function FrankfurterAdminPage() {
  const [health, setHealth] = useState<FrankfurterHealth | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [force, setForce] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<FrankfurterRunResult | null>(null);

  const dryRunTestHref = useMemo(() => "/api/ears/frankfurter/run?dryRun=true", []);

  useEffect(() => {
    let isMounted = true;

    async function loadStatus() {
      try {
        const response = await fetch("/api/ears/frankfurter/status", { cache: "no-store" });
        const data = await response.json();
        if (!isMounted) return;

        if (!response.ok || !data.ok) {
          setStatusError(data.error ?? "Unable to load Frankfurter FX status.");
          return;
        }

        setHealth(data.health);
        setStatusError(null);
      } catch {
        if (isMounted) setStatusError("Unable to load Frankfurter FX status.");
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

    const params = new URLSearchParams({ dryRun: String(dryRun), force: String(force) });

    try {
      const response = await fetch(`/api/ears/frankfurter/run?${params.toString()}`, { method: "POST" });
      const data = await response.json();
      setRunResult(data);
    } catch {
      setRunResult({
        ok: false,
        dryRun,
        skipped: false,
        skipReason: null,
        base: "EUR",
        date: null,
        pairsChecked: 0,
        signalsCreated: 0,
        strongMoves: 0,
        referenceUpdates: 0,
        rateLimited: false,
        errors: ["Unable to run Frankfurter FX ear from the admin page."],
      });
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="page">
      <div className="raw-signal-header">
        <div>
          <div className="eyebrow">Admin / Frankfurter FX</div>
          <h1>Frankfurter FX Ear</h1>
          <p>
            Frankfurter FX provides public latest exchange rates with no API key. Swing Up stores useful FX context only;
            this ear does not create final alerts.
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
        <p><strong>Notes:</strong> {health?.notes ?? "Frankfurter FX has not been checked yet."}</p>
        {health?.cooldownActive ? <p className="muted">Cooldown is active to avoid excessive public API calls.</p> : null}
        <div className="button-row">
          <Link className="button" href="/api/ears/frankfurter/status">Open status JSON</Link>
        </div>
      </section>

      <section className="card trust-section">
        <h2>Safe manual run panel</h2>
        <p>
          Dry run checks Frankfurter latest FX rates and Source Health without writing raw signals. FX is market context,
          not a direct stock alert, and no final alerts are generated yet.
        </p>
        <form className="form" onSubmit={handleRun}>
          <label className="metric">
            <span>Dry run mode</span>
            <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
          </label>
          <label className="metric">
            <span>Bypass cooldown for operator test</span>
            <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
          </label>
          <button className="button primary" type="submit" disabled={isRunning}>{isRunning ? "Running…" : "Run Frankfurter FX ear"}</button>
        </form>
        <div className="button-row">
          <Link className="button" href={dryRunTestHref}>Open dry-run test link</Link>
        </div>
        {runResult ? (
          <div className="card trust-section">
            <h3>Run result summary</h3>
            {runResult.errors.length ? <p className="source-health-warning">{runResult.errors.join("; ")}</p> : null}
            {runResult.skipped ? <p className="muted">Skipped: {runResult.skipReason}</p> : null}
            {runResult.rateLimited ? <p className="muted">Frankfurter FX is degraded by rate limiting.</p> : null}
            <div className="grid two">
              <div className="metric"><span>Base</span><strong>{runResult.base}</strong></div>
              <div className="metric"><span>Rate date</span><strong>{runResult.date ?? "—"}</strong></div>
              <div className="metric"><span>Pairs checked</span><strong>{runResult.pairsChecked}</strong></div>
              <div className="metric"><span>Signals created</span><strong>{runResult.signalsCreated}</strong></div>
              <div className="metric"><span>Strong moves</span><strong>{runResult.strongMoves}</strong></div>
              <div className="metric"><span>Reference updates</span><strong>{runResult.referenceUpdates}</strong></div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
