"use client";
import { useEffect } from "react";
export function readAttribution() {
  try { return JSON.parse(sessionStorage.getItem("swing-up-source") || "{}") as { source?: string; content?: string }; } catch { return {}; }
}
export function GrowthAttribution() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.has("utm_source")) sessionStorage.setItem("swing-up-source", JSON.stringify({ source: params.get("utm_source"), content: params.get("utm_content") || "" }));
      const session = sessionStorage.getItem("swing-up-session") || crypto.randomUUID();
      sessionStorage.setItem("swing-up-session", session);
      void fetch("/api/growth/visit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session, ...readAttribution() }) }).catch(() => {});
    } catch { /* Signup still works with browser storage disabled. */ }
  }, []);
  return null;
}
