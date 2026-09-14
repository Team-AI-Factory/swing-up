"use client";
import { useState } from "react";
export default function ManageSignupPage() {
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      const token = window.location.hash.slice(1);
      const response = await fetch("/api/early-access/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const data = await response.json(); setMessage(data.message || data.error);
      if (response.ok) window.history.replaceState(null, "", window.location.pathname);
    } catch { setMessage("Unable to complete deletion. Please try again."); }
    finally { setBusy(false); }
  }
  return <div className="page launch-page"><article className="card launch-narrow"><span className="eyebrow">Your preferences</span><h1>Leave the early-access list</h1><p>This deletes the signup associated with your private link, including your email and pricing preference, and withdraws permission for launch updates.</p><button className="button" onClick={remove} disabled={busy}>{busy ? "Deleting…" : "Delete my signup"}</button>{message && <p role="status">{message}</p>}</article></div>;
}
