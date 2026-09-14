"use client";
import Link from "next/link";
import { FormEvent, useState } from "react";
type Report = {
  periodDays: number; schedulerEnabled: boolean; paymentsCollected: number; verifiedEmails: number;
  configuration: { ready: boolean; missing: string[]; enabled: boolean };
  runtime: { status: string; detail: string; checkedAt: string } | null;
  leads: { source: string; planIntent: string; _count: number }[];
  visits: { source: string; _count: number }[];
  recent: { id: string; ticker: string; scheduledAt: string; deliveries: { channel: string; status: string; failure: string | null; caption: string; externalUrl: string | null }[] }[];
  limitations: string[];
};
export default function GrowthAdminPage() {
  const [report, setReport] = useState<Report | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const token = String(new FormData(event.currentTarget).get("token") || "");
    try {
      const response = await fetch("/api/internal/growth", { headers: { "x-swing-up-serious-signal-read-token": token }, cache: "no-store" }); const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load report"); setReport(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load report"); }
    finally { setBusy(false); }
  }
  const total = report?.leads.reduce((sum, row) => sum + row._count, 0) || 0;
  const interested = report?.leads.filter((row) => row.planIntent === "paid_pilot").reduce((sum, row) => sum + row._count, 0) || 0;
  return <div className="page launch-page"><div className="launch-heading"><span className="eyebrow">Owner dashboard</span><h1>Is Swing Up earning interest?</h1><p>Fourteen-day signup, pricing-interest and publication report. No subscriber email addresses are exposed here.</p></div>
    <form className="card launch-form" onSubmit={load}><label htmlFor="token">Owner research access key</label><input className="input" id="token" name="token" type="password" autoComplete="off" required /><button className="button primary" disabled={busy}>{busy ? "Loading…" : "Load report"}</button>{error && <p role="alert">{error}</p>}</form>
    {report && <><section className="grid three" style={{ marginTop: 26 }}><article className="card"><span className="eyebrow">Unverified signups</span><div className="kpi">{total}</div></article><article className="card"><span className="eyebrow">Would consider $19/month</span><div className="kpi">{interested}</div></article><article className="card"><span className="eyebrow">Payments collected</span><div className="kpi">{report.paymentsCollected}</div></article></section>
      <section className="card" style={{ marginTop: 26 }}><h2>Publishing status</h2><p><strong>{report.runtime?.status.replaceAll("_", " ") || "Waiting for first scheduler check"}</strong></p><p>{report.runtime?.detail}</p><p>Schedule: 09:00, 17:00 and 23:00 Bangkok / 02:00, 10:00 and 16:00 UTC, every day. One research item per slot, shared to Facebook, Instagram and X.</p><p>Last check: {report.runtime?.checkedAt || "Not recorded"}. Scheduler {report.schedulerEnabled ? "enabled" : "disabled"}.</p>{!report.configuration.ready && <p>To finish automatic publishing, connect the three Swing Up accounts in Buffer and configure the publisher connection. Missing: {report.configuration.missing.join(", ") || "publishing enable switch"}.</p>}<p>Instagram profile link: <Link href="/go/instagram">/go/instagram</Link></p></section>
      <section className="card growth-scroll" style={{ marginTop: 26 }}><h2>Acquisition by channel</h2><table className="growth-table"><thead><tr><th>Channel</th><th>Visits</th><th>Signups</th><th>$19 pilot interest</th></tr></thead><tbody>{["facebook", "instagram", "x", "direct"].map((channel) => <tr key={channel}><td>{channel}</td><td>{report.visits.find((row) => row.source === channel)?._count || 0}</td><td>{report.leads.filter((row) => row.source === channel).reduce((sum, row) => sum + row._count, 0)}</td><td>{report.leads.filter((row) => row.source === channel && row.planIntent === "paid_pilot").reduce((sum, row) => sum + row._count, 0)}</td></tr>)}</tbody></table></section>
      <section style={{ marginTop: 28 }}><h2>Recent cards and post copies</h2>{report.recent.map((row) => <article className="card" key={row.id} style={{ marginBottom: 18 }}><h3><Link href={`/research/${row.id}`}>{row.ticker} · {row.scheduledAt}</Link></h3><a className="button" href={`/api/public/social-image/${row.id}`} target="_blank" rel="noopener noreferrer">Open social card</a>{row.deliveries.map((delivery) => <details key={delivery.channel} style={{ marginTop: 18 }}><summary>{delivery.channel} · {delivery.status.replaceAll("_", " ")}</summary>{delivery.failure && <p className="launch-error">{delivery.failure}</p>}<pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, lineHeight: 1.7 }}>{delivery.caption}</pre>{delivery.externalUrl && <a href={delivery.externalUrl}>View published post</a>}</details>)}</article>)}</section>
      <section className="card"><h2>How to interpret this</h2><ul>{report.limitations.map((line) => <li key={line}>{line}</li>)}</ul><p>Use the first 14 days to find which channel brings people who want the product. Before building more, invite interested users to a concrete paid pilot and measure actual payment and repeat use. Those steps are not proven by a signup count.</p></section></>}
  </div>;
}
