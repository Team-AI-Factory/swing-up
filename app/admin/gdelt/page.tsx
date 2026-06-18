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
  cooldownActive?: boolean;
  cooldownUntil?: string | null;
  currentTarget?: number;
  notes?: string | null;
};

type GdeltRunResult = {
  ok: boolean;
  mode: "firehose" | "single_query";
  articlesChecked: number;
  companyMatches: number;
  themeMatches: number;
  articlesRejectedByRules: number;
  futureAiCandidates: number;
  skipped: boolean;
  skipReason: string | null;
  maxrecordsTarget: number;
  maxrecordsRequested: number;
  maxrecordsUsed: number | null;
  cooldownActive: boolean;
  cooldownUntil: string | null;
  timespan: string;
  rateLimited: boolean;
  fallbackUsed: boolean;
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
  const [limit, setLimit] = useState("250");
  const [dryRun, setDryRun] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<GdeltRunResult | null>(null);

  const dryRunTestLinks = useMemo(
    () => [
      { label: "Status JSON", href: "/api/ears/gdelt/status" },
      {
        label: "Dry-run 250 JSON",
        href: "/api/ears/gdelt/run?limit=250&dryRun=true",
      },
      {
        label: "Dry-run 100 JSON",
        href: "/api/ears/gdelt/run?limit=100&dryRun=true",
      },
      {
        label: "Dry-run 50 JSON",
        href: "/api/ears/gdelt/run?limit=50&dryRun=true",
      },
    ],
    [],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadStatus() {
      try {
        const response = await fetch("/api/ears/gdelt/status", {
          cache: "no-store",
        });
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
      const response = await fetch(`/api/ears/gdelt/run?${params.toString()}`, {
        method: "POST",
      });
      const data = await response.json();
      setRunResult(data);
    } catch {
      setRunResult({
        ok: false,
        mode: query.trim() ? "single_query" : "firehose",
        articlesChecked: 0,
        companyMatches: 0,
        themeMatches: 0,
        articlesRejectedByRules: 0,
        futureAiCandidates: 0,
        skipped: false,
        skipReason: null,
        maxrecordsTarget: Number(limit) || 250,
        maxrecordsRequested: Number(limit) || 250,
        maxrecordsUsed: Number(limit) || 250,
        cooldownActive: false,
        cooldownUntil: null,
        timespan: "15min",
        rateLimited: false,
        fallbackUsed: false,
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
            Swing Up tries the maximum public GDELT pull, but backs off
            automatically if GDELT rate-limits the server. It keeps one broad
            DOC API firehose pull with timespan=15min, mode=artlist,
            format=json, sort=datedesc, and adaptive maxrecords of 250, 100, or
            50.
          </p>
        </div>
        <div className="button-row">
          <Link className="button" href="/admin">
            Back to admin
          </Link>
          <Link className="button" href="/admin/raw-signals">
            Raw Signal Store
          </Link>
        </div>
      </div>

      <section className="card trust-section">
        <h2>Current status</h2>
        {statusError ? (
          <p className="source-health-warning">{statusError}</p>
        ) : null}
        <div className="grid two">
          <div className="metric">
            <span>Status</span>
            <strong>
              <span className={`badge status-${health?.status ?? "stubbed"}`}>
                {health?.status ?? "loading"}
              </span>
            </strong>
          </div>
          <div className="metric">
            <span>Last checked</span>
            <strong>{formatDate(health?.lastChecked)}</strong>
          </div>
          <div className="metric">
            <span>Last success</span>
            <strong>{formatDate(health?.lastSuccess)}</strong>
          </div>
          <div className="metric">
            <span>Response time</span>
            <strong>
              {health?.responseTimeMs == null
                ? "—"
                : `${health.responseTimeMs} ms`}
            </strong>
          </div>
          <div className="metric">
            <span>Cooldown</span>
            <strong>{health?.cooldownActive ? "active" : "inactive"}</strong>
          </div>
          <div className="metric">
            <span>Cooldown until</span>
            <strong>{formatDate(health?.cooldownUntil)}</strong>
          </div>
          <div className="metric">
            <span>Current target batch</span>
            <strong>{health?.currentTarget ?? 250}</strong>
          </div>
        </div>
        <p>
          <strong>Latest error:</strong> {health?.lastError ?? "None reported."}
        </p>
        <p>
          <strong>Notes:</strong> {health?.notes ?? "No notes reported."}
        </p>
        <p className="source-health-warning">
          Repeated manual testing can trigger public-source rate limits.
        </p>
        <div className="button-row">
          {dryRunTestLinks.map((link) => (
            <Link className="button" href={link.href} key={link.href}>
              {link.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="card trust-section">
        <h2>Safe manual run panel</h2>
        <p>
          Dry run checks the broad firehose, local rules, duplicate detection,
          and future-AI candidate tagging without creating raw signals. If
          EAR_RUN_TOKEN is configured and a token is missing, the API allows
          dry-run tests only. When cooldown is active, manual runs return a safe
          skipped response without calling GDELT.
        </p>
        <form className="form" onSubmit={handleRun}>
          <label>
            <span className="eyebrow">Optional single manual query</span>
            <input
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Leave blank for market-wide firehose"
            />
          </label>
          <label>
            <span className="eyebrow">Max articles</span>
            <input
              className="input"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              placeholder="250"
              inputMode="numeric"
            />
          </label>
          <label className="metric">
            <span>Dry run mode</span>
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(event) => setDryRun(event.target.checked)}
            />
          </label>
          <button className="button primary" type="submit" disabled={isRunning}>
            {isRunning ? "Running…" : "Run GDELT ear"}
          </button>
        </form>
        <div className="button-row">
          {dryRunTestLinks.map((link) => (
            <Link className="button" href={link.href} key={link.href}>
              {link.label}
            </Link>
          ))}
        </div>
        {runResult ? (
          <div className="card trust-section">
            <h3>Run result summary</h3>
            {runResult.error ? (
              <p className="source-health-warning">{runResult.error}</p>
            ) : null}
            {runResult.capped ? (
              <p className="muted">
                Unauthenticated runs are capped and forced to dry run for
                safety.
              </p>
            ) : null}
            <div className="grid two">
              <div className="metric">
                <span>Mode</span>
                <strong>{runResult.mode}</strong>
              </div>
              <div className="metric">
                <span>Articles checked</span>
                <strong>{runResult.articlesChecked}</strong>
              </div>
              <div className="metric">
                <span>Company matches</span>
                <strong>{runResult.companyMatches}</strong>
              </div>
              <div className="metric">
                <span>Theme matches</span>
                <strong>{runResult.themeMatches}</strong>
              </div>
              <div className="metric">
                <span>Rejected by rules</span>
                <strong>{runResult.articlesRejectedByRules}</strong>
              </div>
              <div className="metric">
                <span>Future AI candidates</span>
                <strong>{runResult.futureAiCandidates}</strong>
              </div>
              <div className="metric">
                <span>Target batch</span>
                <strong>{runResult.maxrecordsTarget}</strong>
              </div>
              <div className="metric">
                <span>Maxrecords used</span>
                <strong>{runResult.maxrecordsUsed ?? "—"}</strong>
              </div>
              <div className="metric">
                <span>Timespan</span>
                <strong>{runResult.timespan}</strong>
              </div>
              <div className="metric">
                <span>Skipped</span>
                <strong>{runResult.skipped ? "yes" : "no"}</strong>
              </div>
              <div className="metric">
                <span>Skip reason</span>
                <strong>{runResult.skipReason ?? "—"}</strong>
              </div>
              <div className="metric">
                <span>Cooldown active</span>
                <strong>{runResult.cooldownActive ? "yes" : "no"}</strong>
              </div>
              <div className="metric">
                <span>Cooldown until</span>
                <strong>{formatDate(runResult.cooldownUntil)}</strong>
              </div>
              <div className="metric">
                <span>Fallback used</span>
                <strong>{runResult.fallbackUsed ? "yes" : "no"}</strong>
              </div>
              <div className="metric">
                <span>Signals created</span>
                <strong>{runResult.signalsCreated}</strong>
              </div>
              <div className="metric">
                <span>Duplicates skipped</span>
                <strong>{runResult.duplicatesSkipped}</strong>
              </div>
              <div className="metric">
                <span>Errors</span>
                <strong>{runResult.errors?.length ?? 0}</strong>
              </div>
            </div>
            {runResult.errors?.length ? (
              <p>{runResult.errors.join("; ")}</p>
            ) : (
              <p>No errors reported.</p>
            )}
          </div>
        ) : null}
      </section>

      <section className="card trust-section">
        <h2>What happens after ingestion</h2>
        <ol className="receipts">
          <li>
            One broad GDELT request returns up to the adaptive target of 250,
            100, or 50 recent public articles from the last 15 minutes.
          </li>
          <li>
            Swing Up scans titles, snippets, sources, and URLs locally for
            watched tickers, company names, and market themes.
          </li>
          <li>
            Rules filter first; only useful matched articles are saved as raw
            signals.
          </li>
          <li>Signal Filter reviews them.</li>
          <li>Pattern Match checks similar past events.</li>
          <li>
            The strongest approximate top 5% are marked for future AI review,
            but no AI is called yet.
          </li>
          <li>Final alerts are not created yet.</li>
        </ol>
      </section>

      <section className="card trust-section risk-callout">
        <h2>Safety note</h2>
        <p>
          This ear uses public GDELT endpoints without API keys. It avoids
          querying one stock at a time, uses deterministic local rule scores
          only, does not call AI, and does not create final alerts.
        </p>
      </section>
    </div>
  );
}
