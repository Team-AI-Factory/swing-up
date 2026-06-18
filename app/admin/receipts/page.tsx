import Link from "next/link";
import { prisma } from "@/lib/db/client";
import styles from "./receipts.module.css";

export const dynamic = "force-dynamic";

const NOT_AVAILABLE = "Not available yet";

type SourceReceipt = {
  id: string;
  sourceType: string;
  receiptUrl: string;
  summary: string;
  collectedAt: string;
  ticker: string;
  company: string;
  alertStatus: string;
  previewLabel: string;
};

function formatDate(value: Date | string | null | undefined) {
  if (!value) return NOT_AVAILABLE;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return NOT_AVAILABLE;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

function text(value: string | null | undefined) {
  return value?.trim() || NOT_AVAILABLE;
}

function formatStatus(value: string | null | undefined) {
  const cleaned = value?.trim();
  if (!cleaned) return NOT_AVAILABLE;
  return cleaned
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function getSourceReceipts(): Promise<SourceReceipt[]> {
  try {
    const sources = await prisma.alertSource.findMany({
      orderBy: [{ collectedAt: "desc" }, { id: "desc" }],
      take: 50,
      include: {
        alert: true,
      },
    });

    return sources.map((source) => ({
      id: source.id,
      sourceType: formatStatus(source.sourceType),
      receiptUrl: text(source.receiptUrl),
      summary: text(source.summary),
      collectedAt: formatDate(source.collectedAt),
      ticker: text(source.alert?.ticker),
      company: text(source.alert?.company),
      alertStatus: formatStatus(source.alert?.status),
      previewLabel: source.receiptUrl ? "Existing source receipt" : "Existing source receipt without URL",
    }));
  } catch {
    return [];
  }
}

export default async function ReceiptsLibraryAdminPage() {
  const receipts = await getSourceReceipts();
  const receiptsWithUrls = receipts.filter((receipt) => receipt.receiptUrl !== NOT_AVAILABLE).length;

  return (
    <div className="page">
      <section className={`hero trust-hero ${styles.libraryHeader}`}>
        <div>
          <div className="eyebrow">Admin / Receipts Library</div>
          <h1>Receipts Library</h1>
          <p>
            Read-only library of source receipts already attached to alert records. Operators can inspect source type,
            summary, linked alert context, and receipt URLs without changing backend data.
          </p>
          <p className="muted">
            This page does not create, edit, delete, approve, publish, score, notify, or call AI. It only displays existing source receipts.
          </p>
          <div className="button-row">
            <Link className="button" href="/admin">Back to admin</Link>
            <Link className="button" href="/admin/raw-signals">Raw Signal Store</Link>
            <Link className="button" href="/methodology">Methodology</Link>
          </div>
        </div>
        <div className="card">
          <div className="metric"><span>Mode</span><strong>Read-only</strong></div>
          <div className="metric"><span>Source receipts</span><strong>{receipts.length}</strong></div>
          <div className="metric"><span>With receipt URL</span><strong>{receiptsWithUrls}</strong></div>
        </div>
      </section>

      <section className={`grid three trust-section ${styles.summaryGrid}`}>
        <article className="card">
          <span className="badge">Existing data</span>
          <h2>Source receipts</h2>
          <p>Shows rows from the existing alert source receipt records when they are available.</p>
        </article>
        <article className="card">
          <span className="badge">No writes</span>
          <h2>Safe admin preview</h2>
          <p>No admin action on this page changes alert, score, ledger, notification, or source records.</p>
        </article>
        <article className="card">
          <span className="badge">Empty state</span>
          <h2>Clean fallback</h2>
          <p>If the database has no source receipts yet, operators see guidance instead of mock data.</p>
        </article>
      </section>

      <section className="card trust-section">
        <div className="eyebrow">Library</div>
        <h2>Available source receipts</h2>
        <p>{receipts.length ? `${receipts.length} source receipt${receipts.length === 1 ? "" : "s"} found.` : "No source receipts exist yet."}</p>

        {receipts.length === 0 ? (
          <div className={styles.emptyState}>
            <span className="badge">Empty state</span>
            <h3>No source receipts available yet</h3>
            <p>
              Source receipts will appear here after upstream ingestion or alert preparation attaches source records to alerts.
              Until then, use the Raw Signal Store to review incoming market signals and their raw context.
            </p>
            <div className="button-row">
              <Link className="button" href="/admin/raw-signals">Open Raw Signal Store</Link>
              <Link className="button" href="/source-health">Check Source Health</Link>
            </div>
          </div>
        ) : (
          <div className={styles.receiptList}>
            {receipts.map((receipt) => (
              <article className={styles.receiptCard} key={receipt.id}>
                <div className={styles.receiptTopline}>
                  <span className="badge">{receipt.sourceType}</span>
                  <span className="badge">{receipt.previewLabel}</span>
                </div>
                <h3>{receipt.ticker} · {receipt.company}</h3>
                <p>{receipt.summary}</p>
                <div className={styles.receiptMeta}>
                  <div><span>Collected</span><strong>{receipt.collectedAt}</strong></div>
                  <div><span>Alert status</span><strong>{receipt.alertStatus}</strong></div>
                  <div className={styles.receiptUrl}><span>Receipt URL</span><strong>{receipt.receiptUrl}</strong></div>
                </div>
                <span className={styles.previewLabel}>Read-only preview</span>
                <p className={styles.previewBox}>{receipt.summary}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
