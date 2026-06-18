import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCard } from "@/components/AlertCard";
import { getPublicLedgerEntries, getPublicLedgerEntry } from "@/lib/public-ledger";
import styles from "../ledger.module.css";

export function generateStaticParams() {
  return getPublicLedgerEntries().map((entry) => ({ id: entry.id }));
}

export default async function LedgerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = getPublicLedgerEntry(id);

  if (!entry) {
    notFound();
  }

  return (
    <div className={`page ${styles.detailGrid}`}>
      <div>
        <Link className={styles.ledgerLink} href="/ledger">← Back to public ledger</Link>
      </div>
      <section className="card">
        <div className="badge">Mock preview ledger detail</div>
        <h1>{entry.ticker} ledger detail</h1>
        <p>{entry.event}</p>
        <div className="grid three">
          <div className="metric"><span>Alert date</span><strong>{entry.date}</strong></div>
          <div className="metric"><span>Tracked result</span><strong>{entry.result}</strong></div>
          <div className="metric"><span>Price at alert</span><strong>{entry.alertPrice}</strong></div>
        </div>
      </section>
      <section className={`card ${styles.disclaimer}`}>
        <h2>Investment disclaimer</h2>
        <p>
          Swing Up provides research and educational information only. It is not financial, investment, legal, tax, or trading advice. Markets involve risk, past or preview performance does not guarantee future results, and you are responsible for your own decisions.
        </p>
      </section>
      <AlertCard alert={entry.alert} />
    </div>
  );
}
