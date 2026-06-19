import Link from "next/link";
import { AlertCard } from "@/components/AlertCard";
import { getPublicAlertDetail } from "@/lib/public-alert-detail";

export const dynamic = "force-dynamic";

export default async function PublicAlertPage({ params }: { params: Promise<{ id: string }> }) {
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

  return (
    <div className="page">
      <Link className="button" href="/alerts">← Back to alerts</Link>
      <section className="card">
        <span className="badge">{detail.label}</span>
        <h1>{detail.alert.ticker} public alert</h1>
        <p>{detail.summary}</p>
        {detail.sourceMode !== "live" && <p className="muted">Preview examples are mock data and are not live, current, or personalized market alerts.</p>}
      </section>
      <AlertCard alert={detail.alert} />
    </div>
  );
}
