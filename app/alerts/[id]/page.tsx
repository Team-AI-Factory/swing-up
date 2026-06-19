import Link from "next/link";
import { AlertCard } from "@/components/AlertCard";
import { getPublicAlertDetail } from "@/lib/public-alert-detail";

export const dynamic = "force-dynamic";

export default async function AlertDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getPublicAlertDetail(id);

  if (!detail.alert) {
    return (
      <div className="page">
        <Link className="button" href="/alerts">← Back to alerts</Link>
        <section className="card">
          <span className="badge">{detail.label}</span>
          <h1>Public alert unavailable</h1>
          <p>{detail.summary}</p>
        </section>
      </div>
    );
  }

  const isLive = detail.sourceMode === "live";

  return (
    <div className="page">
      <Link className="button" href="/alerts">← Back to alerts</Link>
      <section className="card">
        <span className="badge">{detail.label}</span>
        <h1>{detail.alert.ticker} alert detail</h1>
        <p>{detail.summary}</p>
        {!isLive && <p className="muted">Mock/example content is labelled and should not be treated as a current market alert.</p>}
      </section>
      <AlertCard alert={detail.alert} />
    </div>
  );
}
