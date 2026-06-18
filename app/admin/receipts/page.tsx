import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import styles from "./receipts.module.css";

export const dynamic = "force-dynamic";

const NOT_AVAILABLE = "Not available yet";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type ReceiptRow = {
  id: string;
  sourceName: string;
  sourceType: string;
  ticker: string;
  company: string;
  linkedRecord: string;
  sourceUrl: string;
  summary: string;
  reliabilityScore: string;
  capturedAt: string;
  usedInAlert: boolean;
  publicReceipt: boolean;
  isMock: boolean;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function clean(value: string | string[] | undefined) {
  return firstParam(value)?.trim() ?? "";
}

function text(value: unknown, fallback = NOT_AVAILABLE) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boolParam(value: string) {
  return value === "yes" ? true : value === "no" ? false : null;
}

function formatDate(value: unknown) {
  if (!value) return NOT_AVAILABLE;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return NOT_AVAILABLE;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function jsonArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item) => Object.keys(item).length) : [];
}

async function tableExists(tableName: string) {
  try {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
      select exists (
        select 1 from information_schema.tables where table_schema = 'public' and table_name = ${tableName}
      ) as exists
    `);
    return rows[0]?.exists ?? false;
  } catch {
    return false;
  }
}

async function getAlertSourceReceipts(): Promise<ReceiptRow[]> {
  if (!(await tableExists("alert_sources"))) return [];
  try {
    const rows = await prisma.alertSource.findMany({
      include: { alert: { include: { publicLedger: true } } },
      orderBy: { collectedAt: "desc" },
      take: 75,
    });
    return rows.map((row) => ({
      id: `alert-source-${row.id}`,
      sourceName: row.alert?.company ?? row.sourceType,
      sourceType: row.sourceType,
      ticker: row.alert?.ticker ?? NOT_AVAILABLE,
      company: row.alert?.company ?? NOT_AVAILABLE,
      linkedRecord: row.alert ? `Alert: ${row.alert.event}` : NOT_AVAILABLE,
      sourceUrl: row.receiptUrl ?? NOT_AVAILABLE,
      summary: row.summary ?? NOT_AVAILABLE,
      reliabilityScore: NOT_AVAILABLE,
      capturedAt: formatDate(row.collectedAt),
      usedInAlert: Boolean(row.alertId),
      publicReceipt: Boolean(row.alert?.publicLedger.length),
      isMock: false,
    }));
  } catch {
    return [];
  }
}

async function getRawSignalReceipts(): Promise<ReceiptRow[]> {
  if (!(await tableExists("raw_signals"))) return [];
  try {
    const rows = await prisma.rawSignal.findMany({ orderBy: { receivedAt: "desc" }, take: 75 });
    return rows.map((row) => {
      const payload = asRecord(row.payload);
      return {
        id: `raw-signal-${row.id}`,
        sourceName: row.source,
        sourceType: row.signalType,
        ticker: row.ticker ?? text(payload.ticker, NOT_AVAILABLE),
        company: text(payload.company ?? payload.companyName, NOT_AVAILABLE),
        linkedRecord: `Raw signal: ${row.title}`,
        sourceUrl: row.sourceUrl ?? text(payload.sourceUrl ?? payload.source_url, NOT_AVAILABLE),
        summary: row.summary || row.title || NOT_AVAILABLE,
        reliabilityScore: text(payload.reliabilityScore ?? payload.reliability_score ?? payload.sourceReliability, NOT_AVAILABLE),
        capturedAt: formatDate(row.receivedAt),
        usedInAlert: false,
        publicReceipt: false,
        isMock: false,
      };
    });
  } catch {
    return [];
  }
}

async function getHistoricalEventReceipts(): Promise<ReceiptRow[]> {
  if (!(await tableExists("historical_events"))) return [];
  try {
    const events = await prisma.historicalEvent.findMany({ orderBy: { eventDate: "desc" }, take: 50 });
    return events.flatMap((event) => {
      const receipts = jsonArray(event.sourceReceipts);
      const base = receipts.length ? receipts : [{ source: event.source, sourceUrl: event.sourceUrl, summary: event.summary }];
      return base.map((receipt, index) => ({
        id: `historical-${event.id}-${index}`,
        sourceName: text(receipt.source ?? receipt.label ?? event.source, NOT_AVAILABLE),
        sourceType: "historical_event",
        ticker: event.ticker,
        company: event.companyName ?? NOT_AVAILABLE,
        linkedRecord: `Historical event: ${event.title ?? event.eventType}`,
        sourceUrl: text(receipt.sourceUrl ?? receipt.source_url ?? event.sourceUrl, NOT_AVAILABLE),
        summary: text(receipt.summary ?? receipt.note ?? event.summary, NOT_AVAILABLE),
        reliabilityScore: text(receipt.reliabilityScore ?? receipt.reliability_score, NOT_AVAILABLE),
        capturedAt: formatDate(event.createdAt),
        usedInAlert: false,
        publicReceipt: true,
        isMock: text(receipt.note, "").toLowerCase().includes("mock") || text(event.summary, "").toLowerCase().includes("mock preview"),
      }));
    });
  } catch {
    return [];
  }
}

async function getMacroReceipts(): Promise<ReceiptRow[]> {
  if (!(await tableExists("macro_sentiment_snapshots"))) return [];
  try {
    const snapshots = await prisma.macroSentimentSnapshot.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
    return snapshots.flatMap((snapshot) => jsonArray(snapshot.sourceReceipts).map((receipt, index) => ({
      id: `macro-${snapshot.id}-${index}`,
      sourceName: text(receipt.source ?? receipt.label, NOT_AVAILABLE),
      sourceType: snapshot.snapshotType,
      ticker: text(receipt.ticker, NOT_AVAILABLE),
      company: NOT_AVAILABLE,
      linkedRecord: `Market sentiment snapshot: ${snapshot.status}`,
      sourceUrl: text(receipt.sourceUrl ?? receipt.source_url, NOT_AVAILABLE),
      summary: text(receipt.title ?? receipt.label ?? snapshot.summary, NOT_AVAILABLE),
      reliabilityScore: text(receipt.reliabilityScore ?? receipt.reliability_score, NOT_AVAILABLE),
      capturedAt: formatDate(receipt.receivedAt ?? receipt.date ?? snapshot.createdAt),
      usedInAlert: false,
      publicReceipt: false,
      isMock: false,
    })));
  } catch {
    return [];
  }
}

function matches(receipt: ReceiptRow, params: Record<string, string>) {
  const used = boolParam(params.used);
  const pub = boolParam(params.public);
  const haystack = (value: string, needle: string) => !needle || value.toLowerCase().includes(needle.toLowerCase());
  if (!haystack(receipt.sourceName, params.source)) return false;
  if (!haystack(receipt.sourceType, params.type)) return false;
  if (!haystack(receipt.ticker, params.ticker)) return false;
  if (!haystack(receipt.reliabilityScore, params.reliability)) return false;
  if (used !== null && receipt.usedInAlert !== used) return false;
  if (pub !== null && receipt.publicReceipt !== pub) return false;
  if (params.from && receipt.capturedAt !== NOT_AVAILABLE && new Date(receipt.capturedAt) < new Date(params.from)) return false;
  if (params.to && receipt.capturedAt !== NOT_AVAILABLE && new Date(receipt.capturedAt) > new Date(`${params.to}T23:59:59Z`)) return false;
  return true;
}

function valueLabel(value: boolean) {
  return value ? "Yes" : "No";
}

function display(value: string) {
  return value === NOT_AVAILABLE ? <span className={styles.notAvailable}>{NOT_AVAILABLE}</span> : value;
}

function ReceiptMobileCard({ receipt }: { receipt: ReceiptRow }) {
  return <article className={styles.receiptCard}>
    <div><span className="badge">{receipt.isMock ? "Mock preview data" : receipt.sourceType}</span><h3>{display(receipt.sourceName)}</h3><p>{display(receipt.summary)}</p></div>
    <div className={styles.receiptMeta}>
      <div><span>Ticker / company</span><strong>{display(`${receipt.ticker}${receipt.company !== NOT_AVAILABLE ? ` / ${receipt.company}` : ""}`)}</strong></div>
      <div><span>Linked record</span><strong>{display(receipt.linkedRecord)}</strong></div>
      <div><span>Reliability</span><strong>{display(receipt.reliabilityScore)}</strong></div>
      <div><span>Captured</span><strong>{display(receipt.capturedAt)}</strong></div>
      <div><span>Used / public</span><strong>{valueLabel(receipt.usedInAlert)} / {valueLabel(receipt.publicReceipt)}</strong></div>
      <div><span>Source URL</span>{receipt.sourceUrl === NOT_AVAILABLE ? display(receipt.sourceUrl) : <a className="ledger-link" href={receipt.sourceUrl}>{receipt.sourceUrl}</a>}</div>
    </div>
  </article>;
}

export default async function ReceiptsAdminPage({ searchParams }: { searchParams: SearchParams }) {
  const rawParams = await searchParams;
  const params = {
    source: clean(rawParams.source), type: clean(rawParams.type), ticker: clean(rawParams.ticker), reliability: clean(rawParams.reliability),
    used: clean(rawParams.used), public: clean(rawParams.public), from: clean(rawParams.from), to: clean(rawParams.to),
  };
  const allReceipts = [...await getAlertSourceReceipts(), ...await getRawSignalReceipts(), ...await getHistoricalEventReceipts(), ...await getMacroReceipts()];
  const receipts = allReceipts.filter((receipt) => matches(receipt, params));

  return <div className={`page ${styles.receiptsPage}`}>
    <section className="hero trust-hero">
      <div><div className="eyebrow">Admin / Receipts Library</div><h1>Receipts Library</h1><p>Read-only source receipts used by alerts, signals, ledger records, market snapshots, and historical events. Weak and incomplete receipts remain visible for inspection.</p><div className="button-row"><Link className="button" href="/admin">Back to admin</Link><Link className="button" href="/ledger">Ledger</Link><Link className="button" href="/admin/raw-signals">Raw signals</Link></div></div>
      <div className={`card ${styles.heroCard}`}><div className="metric"><span>Receipts found</span><strong>{allReceipts.length}</strong></div><div className="metric"><span>Filtered view</span><strong>{receipts.length}</strong></div><div className="metric"><span>Mode</span><strong>Read only</strong></div></div>
    </section>

    <section className={`card ${styles.filterCard}`}><h2>Filters</h2><form className={styles.filters}>
      <input className="input" name="source" placeholder="Source name" defaultValue={params.source} />
      <input className="input" name="type" placeholder="Source type" defaultValue={params.type} />
      <input className="input" name="ticker" placeholder="Ticker" defaultValue={params.ticker} />
      <input className="input" name="reliability" placeholder="Reliability score" defaultValue={params.reliability} />
      <select className="input" name="used" defaultValue={params.used}><option value="">Used in alert: all</option><option value="yes">Used in alert: yes</option><option value="no">Used in alert: no</option></select>
      <select className="input" name="public" defaultValue={params.public}><option value="">Public receipt: all</option><option value="yes">Public receipt: yes</option><option value="no">Public receipt: no</option></select>
      <input className="input" name="from" type="date" defaultValue={params.from} />
      <input className="input" name="to" type="date" defaultValue={params.to} />
      <button className="button primary" type="submit">Apply filters</button>
    </form></section>

    {receipts.length === 0 ? <section className={styles.emptyState}><span className="badge">Empty state</span><h2>No source receipts available yet</h2><p>{allReceipts.length === 0 ? "No receipts exist in the current data stores yet. When alerts, raw signals, market snapshots, or historical events attach receipts, they will appear here." : "No receipts match the current filters. Clear filters to inspect the full receipt library."}</p></section> : <section className={`card ${styles.tableCard}`}><div><h2>Source receipts</h2><p>Missing fields show “{NOT_AVAILABLE}” so incomplete evidence is not hidden.</p></div><div className={styles.mobileCards}>{receipts.map((receipt) => <ReceiptMobileCard key={receipt.id} receipt={receipt} />)}</div><div className={`${styles.tableWrap} ${styles.desktopOnly}`}><table className={`table ${styles.receiptsTable}`}><thead><tr><th>Source name</th><th>Type</th><th>Ticker/company</th><th>Linked record</th><th>Source URL</th><th>Captured summary</th><th>Reliability</th><th>Captured time</th><th>Used in alert</th><th>Public receipt</th></tr></thead><tbody>{receipts.map((receipt) => <tr key={receipt.id}><td><strong>{display(receipt.sourceName)}</strong>{receipt.isMock ? <><br /><span className="badge">Mock preview data</span></> : null}</td><td>{display(receipt.sourceType)}</td><td>{display(receipt.ticker)}<br />{display(receipt.company)}</td><td>{display(receipt.linkedRecord)}</td><td className={styles.urlCell}>{receipt.sourceUrl === NOT_AVAILABLE ? display(receipt.sourceUrl) : <a className="ledger-link" href={receipt.sourceUrl}>{receipt.sourceUrl}</a>}</td><td className={styles.summaryCell}>{display(receipt.summary)}</td><td>{display(receipt.reliabilityScore)}</td><td>{display(receipt.capturedAt)}</td><td>{valueLabel(receipt.usedInAlert)}</td><td>{valueLabel(receipt.publicReceipt)}</td></tr>)}</tbody></table></div></section>}
  </div>;
}
