import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

const NOT_AVAILABLE = "Not available yet";
const RAW_SIGNAL_COLUMNS = [
  "id",
  "source",
  "ticker",
  "signal_type",
  "title",
  "summary",
  "payload",
  "received_at",
  "processed_status",
  "importance_hint",
  "source_url",
  "created_at",
] as const;

type RawSignalColumn = (typeof RAW_SIGNAL_COLUMNS)[number];
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type RawSignalRow = Partial<Record<RawSignalColumn, unknown>>;

type ReviewSignal = {
  id: string;
  source: string;
  ticker: string;
  summary: string;
  receivedAt: string;
  sourceUrl: string;
  duplicateStatus: string;
  rejectionReason: string;
  ruleFilterStatus: string;
  miniAiScanStatus: string;
  scorePreview: string;
  runLabel: string;
  status: string;
  payloadPreview: string;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function cleanFilter(value: string | string[] | undefined) {
  return firstParam(value)?.trim() ?? "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, fallback = NOT_AVAILABLE) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function labelFromStatus(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes("reject")) return "Rejected";
  if (normalized.includes("filter")) return "Duplicate";
  if (normalized.includes("promoted")) return "Candidate";
  if (normalized.includes("queued")) return "Needs AI Scan";
  if (normalized === "new") return "New";
  return status === NOT_AVAILABLE ? NOT_AVAILABLE : status;
}

function formatDate(value: unknown) {
  if (!value) return NOT_AVAILABLE;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return NOT_AVAILABLE;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

function inferDuplicateStatus(status: string, payload: Record<string, unknown>) {
  const explicit = text(payload.duplicate_status ?? payload.duplicateStatus, "");
  if (explicit) return explicit;
  return status.toLowerCase().includes("duplicate") || status.toLowerCase() === "filtered" ? "Duplicate" : "New";
}

function inferRuleFilterStatus(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "promoted" || normalized === "queued") return "Passed Rule Filter";
  if (normalized === "new") return "New";
  if (normalized === "rejected") return "Rejected";
  if (normalized === "filtered") return "Duplicate";
  return status === NOT_AVAILABLE ? NOT_AVAILABLE : status;
}

function inferRunLabel(payload: Record<string, unknown>) {
  const runMode = text(payload.run_mode ?? payload.runMode ?? payload.mode, "").toLowerCase();
  if (runMode.includes("live")) return "Live run";
  if (runMode.includes("dry")) return "Dry run";
  const isDryRun = payload.dry_run ?? payload.dryRun;
  if (typeof isDryRun === "boolean") return isDryRun ? "Dry run" : "Live run";
  return NOT_AVAILABLE;
}

function getScorePreview(payload: Record<string, unknown>, importanceHint: string) {
  const explicit = payload.score_preview ?? payload.scorePreview ?? payload.score;
  if (typeof explicit === "number") return String(explicit);
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  return importanceHint === NOT_AVAILABLE ? NOT_AVAILABLE : `Importance: ${importanceHint}`;
}

function toReviewSignal(row: RawSignalRow): ReviewSignal {
  const payload = asRecord(row.payload);
  const status = text(row.processed_status, NOT_AVAILABLE);
  const title = optionalText(row.title);
  const summary = text(row.summary || title, NOT_AVAILABLE);
  const importanceHint = text(row.importance_hint, NOT_AVAILABLE);

  return {
    id: text(row.id, crypto.randomUUID()),
    source: text(row.source),
    ticker: text(row.ticker ?? payload.ticker ?? payload.company ?? payload.companyName),
    summary,
    receivedAt: formatDate(row.received_at ?? row.created_at),
    sourceUrl: text(row.source_url ?? payload.source_url ?? payload.sourceUrl),
    duplicateStatus: inferDuplicateStatus(status, payload),
    rejectionReason: text(payload.rejection_reason ?? payload.rejectionReason, status.toLowerCase() === "rejected" ? "Rejected by rule filter" : NOT_AVAILABLE),
    ruleFilterStatus: inferRuleFilterStatus(status),
    miniAiScanStatus: text(payload.mini_ai_scan_status ?? payload.miniAiScanStatus, status.toLowerCase() === "queued" ? "Needs AI Scan" : NOT_AVAILABLE),
    scorePreview: getScorePreview(payload, importanceHint),
    runLabel: inferRunLabel(payload),
    status: labelFromStatus(status),
    payloadPreview: JSON.stringify(payload, null, 2).slice(0, 420),
  };
}

async function getExistingColumns() {
  try {
    const rows = await prisma.$queryRaw<Array<{ column_name: RawSignalColumn }>>`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'raw_signals'
    `;
    return new Set(rows.map((row) => row.column_name));
  } catch {
    return new Set<RawSignalColumn>();
  }
}

async function getRawSignals() {
  const existingColumns = await getExistingColumns();
  if (!existingColumns.size) return [];

  const selectedColumns = RAW_SIGNAL_COLUMNS.filter((column) => existingColumns.has(column));
  if (!selectedColumns.length) return [];

  const selectSql = Prisma.join(selectedColumns.map((column) => Prisma.raw(`"${column}"`)));
  const orderColumn = existingColumns.has("received_at") ? "received_at" : existingColumns.has("created_at") ? "created_at" : "id";

  try {
    return await prisma.$queryRaw<RawSignalRow[]>(Prisma.sql`
      select ${selectSql}
      from raw_signals
      order by ${Prisma.raw(`"${orderColumn}"`)} desc
      limit 50
    `);
  } catch {
    return [];
  }
}

function matchesFilter(signal: ReviewSignal, key: string, expected: string) {
  if (!expected) return true;
  return signal[key as keyof ReviewSignal].toLowerCase().includes(expected.toLowerCase());
}

export default async function RawSignalsAdminPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const source = cleanFilter(params.source);
  const status = cleanFilter(params.status);
  const ticker = cleanFilter(params.ticker);
  const mode = cleanFilter(params.mode);

  const allSignals = (await getRawSignals()).map(toReviewSignal);
  const signals = allSignals.filter((signal) => {
    if (!matchesFilter(signal, "source", source)) return false;
    if (!matchesFilter(signal, "status", status) && !matchesFilter(signal, "ruleFilterStatus", status)) return false;
    if (!matchesFilter(signal, "ticker", ticker)) return false;
    if (mode === "rejected" && signal.status !== "Rejected") return false;
    if (mode === "accepted" && signal.status === "Rejected") return false;
    if (mode === "dry" && signal.runLabel !== "Dry run") return false;
    if (mode === "live" && signal.runLabel !== "Live run") return false;
    return true;
  });

  return (
    <div className="page admin-raw-page">
      <div className="raw-signal-header">
        <div>
          <div className="eyebrow">Admin / Control room</div>
          <h1>Raw Signal Review</h1>
          <p>Read-only inspection of raw market signals before alerts, scoring, approvals, or publishing.</p>
        </div>
        <div className="button-row"><Link className="button" href="/admin">Back to admin</Link><Link className="button" href="/source-health">Source Health</Link><Link className="button" href="/ai-input-contract">AI Brain Input Contract</Link></div>
      </div>

      <section className="card raw-signal-filter-card">
        <h2>Filters</h2>
        <form className="raw-signal-filters">
          <input className="input" name="source" placeholder="Source" defaultValue={source} />
          <input className="input" name="status" placeholder="Status" defaultValue={status} />
          <input className="input" name="ticker" placeholder="Ticker or company" defaultValue={ticker} />
          <select className="input" name="mode" defaultValue={mode}>
            <option value="">All signals</option>
            <option value="rejected">Rejected only</option>
            <option value="accepted">Accepted only</option>
            <option value="dry">Dry-run only</option>
            <option value="live">Live only</option>
          </select>
          <button className="button primary" type="submit">Apply filters</button>
          <Link className="button" href="/admin/raw-signals">Reset</Link>
        </form>
      </section>

      <section className="card raw-signal-card">
        <div className="raw-signal-header">
          <div>
            <h2>Latest raw signals</h2>
            <p>{signals.length ? `${signals.length} visible of ${allSignals.length} latest entries.` : "No raw signals match the current view."}</p>
          </div>
          <span className="badge">Read-only</span>
        </div>

        {signals.length === 0 ? (
          <div className="raw-signal-empty">
            <span className="badge">Not Available Yet</span>
            <h3>No raw signals to review yet</h3>
            <p>The inbox is empty or the selected filters have no matches. Missing database fields are intentionally shown as “Not available yet” when records arrive.</p>
          </div>
        ) : (
          <div className="raw-signal-review-list">
            {signals.map((signal) => (
              <article className="raw-signal-review-item" key={signal.id}>
                <div className="raw-signal-review-topline">
                  <span className={`badge status-${signal.status.toLowerCase().replaceAll(" ", "-")}`}>{signal.status}</span>
                  <span className="badge">{signal.runLabel}</span>
                </div>
                <h3>{signal.ticker}</h3>
                <p>{signal.summary}</p>
                <div className="raw-signal-fields">
                  <div><span>Source</span><strong>{signal.source}</strong></div>
                  <div><span>Received</span><strong>{signal.receivedAt}</strong></div>
                  <div><span>Duplicate status</span><strong>{signal.duplicateStatus}</strong></div>
                  <div><span>Rule filter</span><strong>{signal.ruleFilterStatus}</strong></div>
                  <div><span>Mini AI scan</span><strong>{signal.miniAiScanStatus}</strong></div>
                  <div><span>Score preview</span><strong>{signal.scorePreview}</strong></div>
                  <div><span>Rejection reason</span><strong>{signal.rejectionReason}</strong></div>
                  <div><span>Source URL</span><strong>{signal.sourceUrl === NOT_AVAILABLE ? NOT_AVAILABLE : <a href={signal.sourceUrl}>{signal.sourceUrl}</a>}</strong></div>
                </div>
                <details>
                  <summary>Payload preview</summary>
                  <pre className="payload-preview">{signal.payloadPreview || "{}"}</pre>
                </details>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
