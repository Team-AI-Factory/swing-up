import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCard } from "@/components/AlertCard";
import { displayAction, getPublicAlertDetail } from "@/lib/public-alert-detail";
import { absoluteUrl } from "@/lib/seo-alerts";

export const dynamic = "force-dynamic";

function metadataDescription(detail: Awaited<ReturnType<typeof getPublicAlertDetail>>) {
  if (!detail.alert) return "No published public alert matches this slug. Unpublished candidate alerts are not exposed publicly.";
  return `Swing Up research alert for ${detail.alert.company}/${detail.alert.ticker}: ${detail.alert.event}. Includes proof, risk checks, scores, and public tracking.`;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const detail = await getPublicAlertDetail(id);
  const title = detail.alert ? `${detail.alert.ticker} ${displayAction(detail.alert.action)}: ${detail.alert.event} | Swing Up Public Alert` : "Public alert unavailable | Swing Up";
  const description = metadataDescription(detail);
  const url = detail.canonicalUrl ?? absoluteUrl(`/alerts/${id}`);

  return {
    title,
    description,
    alternates: { canonical: url },
    robots: detail.noindex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: { title, description, url, siteName: "Swing Up", type: "article", images: ["/icon-512.svg"] },
    twitter: { card: "summary", title, description, images: ["/icon-512.svg"] },
  };
}

function TrackingGrid({ tracking }: { tracking: NonNullable<Awaited<ReturnType<typeof getPublicAlertDetail>>["tracking"]> }) {
  const rows = [
    ["Alert date/time", tracking.alertDate], ["Action label", tracking.action], ["Price at alert", tracking.priceAtAlert],
    ["Latest tracked price", tracking.latestTrackedPrice], ["1D result", tracking.oneDay], ["3D result", tracking.threeDay],
    ["7D result", tracking.sevenDay], ["30D result", tracking.thirtyDay], ["90D result", tracking.ninetyDay],
    ["Max gain", tracking.maxGain], ["Max drawdown", tracking.maxDrawdown], ["Final outcome", tracking.finalOutcome], ["Status", tracking.status],
  ];
  return <div className="grid two">{rows.map(([label, value]) => <div className="metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>;
}

function ShareTools({ url, text }: { url: string; text: string }) {
  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(text);
  return (
    <section className="card" aria-label="Share tools">
      <h2>Share this research alert</h2>
      <p className="muted">Use compliant, research-only wording when sharing this public page.</p>
      <div className="button-row">
        <button type="button" className="button" data-copy-url={url}>Copy link</button>
        <a className="button" href={`https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`}>Share to X/Twitter</a>
        <a className="button" href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`}>Share to LinkedIn</a>
        <a className="button" href={`https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`}>Share to Telegram</a>
      </div>
      <pre className="copy-block">{text}</pre>
    </section>
  );
}

export default async function AlertDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getPublicAlertDetail(id);

  if (!detail.alert) notFound();

  const isLive = detail.sourceMode === "live";
  const url = detail.canonicalUrl ?? absoluteUrl(`/alerts/${id}`);
  const shareText = detail.shareText ?? `Swing Up research alert: ${detail.alert.ticker}/${detail.alert.company} — ${detail.alert.event}. Includes proof, risk checks, scores, and public tracking.`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", name: "Swing Up", url: absoluteUrl("/") },
      { "@type": "WebPage", name: `${detail.alert.ticker} ${displayAction(detail.alert.action)}: ${detail.alert.event}`, description: metadataDescription(detail), url, datePublished: detail.publishedAt?.toISOString(), dateModified: detail.updatedAt?.toISOString() },
      { "@type": "Article", headline: `${detail.alert.ticker} ${displayAction(detail.alert.action)}: ${detail.alert.event}`, description: metadataDescription(detail), datePublished: detail.publishedAt?.toISOString(), dateModified: detail.updatedAt?.toISOString(), author: { "@type": "Organization", name: "Swing Up" }, publisher: { "@type": "Organization", name: "Swing Up" } },
      { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Alerts", item: absoluteUrl("/alerts") }, { "@type": "ListItem", position: 2, name: detail.alert.ticker, item: url }] },
    ],
  };

  return (
    <div className="page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Link className="button" href="/alerts">← Back to alerts</Link>
      <section className="card">
        <span className="badge">{detail.label}</span>
        <h1>{detail.alert.ticker} {displayAction(detail.alert.action)}: {detail.alert.event}</h1>
        <p>{detail.summary}</p>
        <p className="muted">Source health/freshness: {detail.sourceHealthLabel ?? "Not available yet"}</p>
        {!isLive && <p className="muted">Mock/example content is labelled, noindex, and should not be treated as a current market alert.</p>}
      </section>
      <AlertCard alert={detail.alert} />
      <section className="card" aria-label="Public tracking ledger embed">
        <h2>Public Tracking — Win or Lose</h2>
        {!detail.tracking?.exists && <p>Tracking pending. This alert will be updated publicly.</p>}
        {detail.tracking && <TrackingGrid tracking={detail.tracking} />}
        <p className="muted">Public tracking is not hidden when results are unfavorable and does not create fake performance.</p>
        <div className="button-row"><Link className="button" href="/ledger">View full Public Ledger</Link><Link className="button" href="/methodology">View methodology</Link><Link className="button" href="/alerts">View more alerts</Link></div>
      </section>
      <ShareTools url={url} text={shareText} />
      <section className="card"><h2>Want fresh alert cards before the public page updates?</h2><p>Join Swing Up to follow market alerts, watchlists, proof checks, risk scores, and public tracking.</p><div className="button-row"><Link className="button primary" href="/signup">Join Swing Up</Link><Link className="button" href="/public-ledger">View Public Ledger</Link><Link className="button" href="/dashboard">Open your dashboard</Link></div></section>
    </div>
  );
}
