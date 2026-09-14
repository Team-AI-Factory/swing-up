"use client";
import { FormEvent, useState } from "react";
import Link from "next/link";
import { readAttribution } from "@/components/GrowthAttribution";
export function EarlyAccessForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ message: string; manageUrl: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/early-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        email: data.get("email"), goal: data.get("goal"), website: data.get("website"), planIntent: data.get("planIntent"), consent: data.get("consent") === "on", ...readAttribution(),
      }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Please try again.");
      setResult(payload);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Please try again."); }
    finally { setBusy(false); }
  }
  if (result) return <div className="card launch-form" role="status">
    <span className="eyebrow">Request received</span><h2>You’re on the list.</h2><p>{result.message}</p>
    <p>We haven’t sent an email or created a product account. Keep your private link to remove a new signup later. If you already joined, keep using your original private link.</p>
    <a className="button" href={result.manageUrl}>Your private deletion link — save this</a>
    <Link className="button primary" href="/research">Explore the research</Link>
  </div>;
  return <form className="card launch-form" onSubmit={submit}>
    <h2>Get early-bird access</h2><p>Join the launch list and help shape what comes next.</p>
    <label htmlFor="email">Email address</label><input className="input" id="email" name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@example.com" />
    <fieldset><legend>Which option would you choose?</legend>
      <label className="launch-choice"><input name="planIntent" type="radio" value="free" required /><span><strong>Free early access</strong><small>Preview the research and follow the launch.</small></span></label>
      <label className="launch-choice"><input name="planIntent" type="radio" value="paid_pilot" required /><span><strong>I’d consider $19 USD/month</strong><small>Invite me to a paid pilot with full signal context. Proposed price only; no charge or commitment today.</small></span></label>
    </fieldset>
    <label htmlFor="goal">What would make this worth using? <span className="muted">Optional</span></label><textarea className="input" id="goal" name="goal" maxLength={240} rows={3} placeholder="For example: help me understand the risk behind a stock I’m watching." />
    <div className="launch-honeypot" aria-hidden="true"><label>Website<input name="website" type="text" tabIndex={-1} autoComplete="off" /></label></div>
    <label className="launch-consent"><input name="consent" type="checkbox" required /><span>I agree to receive Swing Up early-access and launch updates. I can withdraw using my private link. <Link href="/privacy">Privacy details</Link>.</span></label>
    {error && <p className="launch-error" role="alert">{error}</p>}
    <button className="button primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Join early access"}</button>
    <small className="muted">No card required. No payment taken. Research access does not guarantee investment returns.</small>
  </form>;
}
