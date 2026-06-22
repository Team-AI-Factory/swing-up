"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonRecord = { [key: string]: JsonValue };

type StageKey = "initial" | "refresh" | "stage1" | "stage2" | "stage3";

type StageResult = {
  stage: string;
  route: string;
  method: "GET" | "POST";
  status: string;
  result: string;
  signalFound: boolean | null;
  aiCommitteeRan: boolean | null;
  approved: boolean | null;
  published: boolean | null;
  publicAlertUrl: string | null;
  publicLedgerUrl: string | null;
  blockers: string[];
  warnings: string[];
  nextAction: string;
  json: JsonValue | null;
};

const SAFE_HEADERS = { "Content-Type": "application/json" };
const RUN_ROUTE = "/api/internal/run-live-alert-cycle";

const startupChecks: Array<{ key: StageKey; label: string; route: string }> = [
  { key: "initial", label: "Health", route: "/api/health" },
  { key: "initial", label: "Engine readiness", route: "/api/internal/engine-start-readiness" },
  { key: "initial", label: "Pipeline readiness", route: "/api/internal/pipeline-readiness" },
  { key: "initial", label: "AI Committee agents", route: "/api/ai-committee/agents" },
  { key: "initial", label: "Live cycle status", route: "/api/internal/live-alert-cycle-status" },
  { key: "initial", label: "Alerts page", route: "/alerts" },
  { key: "initial", label: "Ledger page", route: "/ledger" },
];

const runPayloads = {
  stage1: {
    dryRun: true,
    confirmRun: false,
    confirmPublish: false,
    confirmSend: false,
    maxAlertsToPublish: 1,
    allowTelegram: false,
  },
  stage2: {
    dryRun: false,
    confirmRun: true,
    confirmPublish: false,
    confirmSend: false,
    maxAlertsToPublish: 1,
    allowTelegram: false,
  },
  stage3: {
    dryRun: false,
    confirmRun: true,
    confirmPublish: true,
    confirmSend: false,
    maxAlertsToPublish: 1,
    allowTelegram: false,
  },
} as const;

function isRecord(value: JsonValue | unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function textList(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).filter(Boolean);
}

function findBoolean(value: JsonValue | null, names: string[]): boolean | null {
  if (!isRecord(value)) return null;
  for (const name of names) {
    if (typeof value[name] === "boolean") return value[name];
  }
  return null;
}

function findString(value: JsonValue | null, names: string[]): string | null {
  if (!isRecord(value)) return null;
  for (const name of names) {
    if (typeof value[name] === "string" && value[name].trim()) return value[name];
  }
  return null;
}

function summarize(stage: string, route: string, method: "GET" | "POST", httpStatus: number | "error", json: JsonValue | null): StageResult {
  const blockers = isRecord(json) ? [...textList(json.blockers), ...textList(json.blockedReasons), ...textList(json.missingRequiredItems)] : [];
  const warnings = isRecord(json) ? [...textList(json.warnings), ...textList(json.missingOptionalItems)] : [];
  const ok = findBoolean(json, ["ok", "readyToStartEngine", "readyForFirstPublicAlert"]);
  const published = findBoolean(json, ["published", "didPublish", "alertPublished"]);
  const approved = findBoolean(json, ["approved", "publishable", "readyForFirstPublicAlert", "approvedForPublish"]);
  const aiCommitteeRan = findBoolean(json, ["aiCommitteeRan", "committeeRan", "ranAICommittee", "aiReviewRan"]);
  const signalFound = findBoolean(json, ["signalFound", "foundSignal", "candidateFound", "hasCandidate", "hasApprovedSignal"]);
  const publicAlertUrl = findString(json, ["publicAlertUrl", "alertUrl"]);
  const publicLedgerUrl = findString(json, ["publicLedgerUrl", "ledgerUrl"]);
  const nextAction = findString(json, ["nextRecommendedAction", "nextAction"]) ?? (blockers.length ? "Resolve blockers before continuing." : "Continue to the next safe stage when ready.");
  const result = httpStatus === "error" ? "Request failed" : ok === false ? "Blocked or not ready" : ok === true ? "OK" : "Loaded";

  return {
    stage,
    route,
    method,
    status: String(httpStatus),
    result,
    signalFound,
    aiCommitteeRan,
    approved,
    published,
    publicAlertUrl,
    publicLedgerUrl,
    blockers,
    warnings,
    nextAction,
    json,
  };
}

async function readResponse(response: Response): Promise<JsonValue> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return (await response.json()) as JsonValue;
  return { ok: response.ok, contentType, note: "Route returned non-JSON content and loaded without crashing." };
}

function yesNo(value: boolean | null) {
  if (value === null) return "—";
  return value ? "yes" : "no";
}

export default function EngineControlPanel() {
  const [secret, setSecret] = useState("");
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rows, setRows] = useState<StageResult[]>([]);
  const [message, setMessage] = useState("Load the startup status, then run stages in order. Nothing here sends Telegram.");

  const stage2Approved = useMemo(() => rows.some((row) => row.stage === "Stage 2 real AI review, no publish" && row.approved === true && row.published !== true), [rows]);

  function headers() {
    return secret.trim() ? { ...SAFE_HEADERS, "x-internal-api-secret": secret.trim() } : SAFE_HEADERS;
  }

  async function callGet(label: string, route: string) {
    try {
      const response = await fetch(route, { method: "GET", headers: headers(), cache: "no-store" });
      const json = await readResponse(response);
      return summarize(label, route, "GET", response.status, json);
    } catch (error) {
      return summarize(label, route, "GET", "error", { ok: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  async function loadStartup() {
    setBusy("startup");
    setMessage("Checking live app routes from this browser session…");
    const nextRows = await Promise.all(startupChecks.map((check) => callGet(check.label, check.route)));
    setRows((current) => [...nextRows, ...current.filter((row) => !startupChecks.some((check) => check.label === row.stage))]);
    setMessage("Startup status loaded. Missing optional routes are reported without crashing.");
    setBusy(null);
  }

  async function refreshReadiness() {
    setBusy("refresh");
    const row = await callGet("Refresh engine readiness", "/api/internal/engine-start-readiness");
    setRows((current) => [row, ...current.filter((item) => item.stage !== row.stage)]);
    setMessage("Engine readiness refreshed.");
    setBusy(null);
  }

  async function runStage(stage: "stage1" | "stage2" | "stage3") {
    const labels = {
      stage1: "Stage 1 dry run",
      stage2: "Stage 2 real AI review, no publish",
      stage3: "Stage 3 publish one approved website alert",
    } as const;
    setBusy(stage);
    try {
      const response = await fetch(RUN_ROUTE, { method: "POST", headers: headers(), body: JSON.stringify(runPayloads[stage]), cache: "no-store" });
      if (response.status === 404) {
        const row = summarize(labels[stage], RUN_ROUTE, "POST", 404, { ok: false, blockers: ["Live alert cycle route is missing."], nextRecommendedAction: "A backend route is required before this browser control can run the live alert cycle." });
        setRows((current) => [row, ...current.filter((item) => item.stage !== row.stage)]);
        setMessage("Live alert cycle route is missing. A backend route is required.");
      } else {
        const json = await readResponse(response);
        const row = summarize(labels[stage], RUN_ROUTE, "POST", response.status, json);
        setRows((current) => [row, ...current.filter((item) => item.stage !== row.stage)]);
        setMessage(stage === "stage3" ? "Publish request completed. Confirm returned public URLs before sharing." : "Safe stage completed without publish/send permissions.");
      }
    } catch (error) {
      const row = summarize(labels[stage], RUN_ROUTE, "POST", "error", { ok: false, error: error instanceof Error ? error.message : "Unknown error" });
      setRows((current) => [row, ...current.filter((item) => item.stage !== row.stage)]);
      setMessage("Request failed in the browser. No fake route or fake alert was created.");
    }
    setBusy(null);
  }

  async function copyJson(row: StageResult) {
    await navigator.clipboard.writeText(JSON.stringify(row.json, null, 2));
  }

  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <p style={styles.eyebrow}>Internal ops · first real website alert control</p>
        <h1 style={styles.title}>Founder Engine Control Panel</h1>
        <p style={styles.subtitle}>Browser-only controls for checking readiness and running one safe website alert cycle from the deployed app. This page is noindex, unlinked, and never grants Telegram send permission.</p>
        <div style={styles.notice}>{message}</div>
      </section>

      <section style={styles.card}>
        <label style={styles.label}>
          Internal secret
          <input style={styles.input} type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="Sent only as a request header; not stored or displayed" autoComplete="off" />
        </label>
        <div style={styles.links}><Link href="/alerts">Open /alerts</Link><Link href="/ledger">Open /ledger</Link></div>
      </section>

      <section style={styles.actions}>
        <button style={styles.button} disabled={busy !== null} onClick={loadStartup}>Load current status</button>
        <button style={styles.button} disabled={busy !== null} onClick={refreshReadiness}>Refresh Engine Readiness</button>
        <button style={styles.button} disabled={busy !== null} onClick={() => runStage("stage1")}>Stage 1 Dry Run</button>
        <button style={styles.button} disabled={busy !== null} onClick={() => runStage("stage2")}>Stage 2 Real AI Review, No Publish</button>
        <label style={styles.checkbox}><input type="checkbox" checked={confirmPublish} onChange={(event) => setConfirmPublish(event.target.checked)} /> I understand this will publish at most 1 approved alert to the public website.</label>
        <button style={{ ...styles.button, ...styles.danger }} disabled={busy !== null || !stage2Approved || !confirmPublish} onClick={() => runStage("stage3")}>Stage 3 Publish One Approved Website Alert</button>
      </section>

      <section style={styles.card}>
        <h2 style={styles.heading}>Run table</h2>
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead><tr>{["stage", "route", "HTTP status", "result", "signal found", "AI Committee ran", "approved", "published", "public alert URL", "public ledger URL", "blockers", "warnings", "next action"].map((head) => <th key={head} style={styles.th}>{head}</th>)}</tr></thead>
            <tbody>{rows.map((row) => <tr key={`${row.stage}-${row.route}`}><td style={styles.td}>{row.stage}</td><td style={styles.td}>{row.method} {row.route}</td><td style={styles.td}>{row.status}</td><td style={styles.td}>{row.result}</td><td style={styles.td}>{yesNo(row.signalFound)}</td><td style={styles.td}>{yesNo(row.aiCommitteeRan)}</td><td style={styles.td}>{yesNo(row.approved)}</td><td style={styles.td}>{yesNo(row.published)}</td><td style={styles.td}>{row.publicAlertUrl ? <a href={row.publicAlertUrl}>{row.publicAlertUrl}</a> : "—"}</td><td style={styles.td}>{row.publicLedgerUrl ? <a href={row.publicLedgerUrl}>{row.publicLedgerUrl}</a> : "—"}</td><td style={styles.td}>{row.blockers.join(" | ") || "—"}</td><td style={styles.td}>{row.warnings.join(" | ") || "—"}</td><td style={styles.td}>{row.nextAction}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section style={styles.jsonGrid}>{rows.map((row) => <details key={`${row.stage}-json`} style={styles.details}><summary>{row.stage} JSON <button style={styles.copy} onClick={(event) => { event.preventDefault(); void copyJson(row); }}>Copy JSON</button></summary><pre style={styles.pre}>{JSON.stringify(row.json, null, 2)}</pre></details>)}</section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", padding: "32px 18px 56px", background: "#071014", color: "#e5f3f1", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" },
  hero: { maxWidth: 1180, margin: "0 auto 20px" },
  eyebrow: { color: "#7dd3fc", fontSize: 12, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase" },
  title: { margin: 0, fontSize: "clamp(2.2rem, 7vw, 4.6rem)", letterSpacing: "-0.06em" },
  subtitle: { maxWidth: 880, color: "#b6c9c6", lineHeight: 1.6 },
  notice: { border: "1px solid rgba(125,211,252,.3)", borderRadius: 18, padding: 16, background: "rgba(14,116,144,.16)" },
  card: { maxWidth: 1180, margin: "0 auto 18px", border: "1px solid rgba(148,163,184,.22)", borderRadius: 24, padding: 18, background: "rgba(15,23,42,.72)" },
  label: { display: "grid", gap: 8, color: "#cbd5e1", fontWeight: 800 },
  input: { maxWidth: 520, borderRadius: 12, border: "1px solid rgba(148,163,184,.32)", padding: 12, background: "#020617", color: "#e5f3f1" },
  links: { display: "flex", gap: 14, flexWrap: "wrap", marginTop: 14 },
  actions: { maxWidth: 1180, margin: "0 auto 18px", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" },
  button: { border: "1px solid rgba(45,212,191,.36)", borderRadius: 999, padding: "11px 15px", background: "#0f766e", color: "white", fontWeight: 800, cursor: "pointer" },
  danger: { background: "#991b1b", borderColor: "rgba(252,165,165,.5)" },
  checkbox: { color: "#fef3c7", display: "flex", gap: 8, alignItems: "center" },
  heading: { marginTop: 0 },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", minWidth: 1400, borderCollapse: "collapse" },
  th: { textAlign: "left", padding: 10, borderBottom: "1px solid rgba(148,163,184,.28)", color: "#93c5fd", fontSize: 12, textTransform: "uppercase" },
  td: { verticalAlign: "top", padding: 10, borderBottom: "1px solid rgba(148,163,184,.16)", color: "#dbeafe", fontSize: 13 },
  jsonGrid: { maxWidth: 1180, margin: "0 auto", display: "grid", gap: 12 },
  details: { border: "1px solid rgba(148,163,184,.2)", borderRadius: 18, padding: 14, background: "rgba(2,6,23,.76)" },
  copy: { marginLeft: 10, borderRadius: 999, padding: "4px 9px" },
  pre: { overflowX: "auto", whiteSpace: "pre-wrap", color: "#bbf7d0" },
};
