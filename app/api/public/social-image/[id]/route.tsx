import { ImageResponse } from "next/og";
import { prisma } from "@/lib/db/client";
import { BRAND_LINE, COLORS, money, publicResearchSnapshot, timestamp } from "@/lib/growth/research";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9]{20,40}$/.test(id)) return new Response("Not found", { status: 404 });
  const row = await prisma.socialSignal.findUnique({ where: { id } });
  if (!row) return new Response("Not found", { status: 404 });
  const s = publicResearchSnapshot(row.snapshot);
  if (!s) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const accent = COLORS[s.action];
  return new ImageResponse(<div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: "#07111F", color: "#F4F7FB", padding: 52, fontFamily: "sans-serif" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 34, fontWeight: 700, color: "#22C7B8" }}><svg width="32" height="32" viewBox="0 0 32 32"><path d="M7 25L25 7M8 7H25V24" fill="none" stroke="#22C7B8" strokeWidth="3" /></svg>Swing Up</div><span style={{ color: "#A7B3C5", fontSize: 19 }}>PROVISIONAL RESEARCH</span></div>
    <div style={{ display: "flex", fontSize: 23, marginTop: 12, color: "#A7B3C5" }}>{BRAND_LINE}</div>
    <div style={{ display: "flex", flexDirection: "column", padding: 34, marginTop: 30, border: "1px solid #22324A", borderRadius: 26, background: "#101B2D", flex: 1 }}>
      <div style={{ display: "flex", color: accent, fontSize: 21, fontWeight: 700, letterSpacing: 2 }}>{s.label.toUpperCase()}</div><div style={{ display: "flex", alignItems: "baseline", gap: 24, marginTop: 14 }}><span style={{ fontSize: 68, fontWeight: 700 }}>{s.ticker}</span><span style={{ color: "#A7B3C5", fontSize: 22 }}>{s.company.slice(0, 47)}</span></div>
      <div style={{ display: "flex", fontSize: 33, fontWeight: 700, lineHeight: 1.2, marginTop: 10 }}>{s.title}</div>
      <div style={{ display: "flex", gap: 55, marginTop: 24, paddingTop: 22, paddingBottom: 22, borderTop: "1px solid #22324A", borderBottom: "1px solid #22324A" }}><div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: "#A7B3C5", fontSize: 18 }}>LATEST RECORDED · USD</span><span style={{ fontSize: 42, fontWeight: 700 }}>{money(s.currentPrice)}</span></div><div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: "#A7B3C5", fontSize: 18 }}>MODEL TARGET · NO HORIZON</span><span style={{ fontSize: 42, fontWeight: 700, color: accent }}>{money(s.targetPrice)}</span></div></div>
      <div style={{ display: "flex", marginTop: 18, justifyContent: "space-between", fontSize: 20 }}><span>Model confidence {s.confidence}/100</span><span style={{ color: "#A7B3C5" }}>Not the probability of profit</span></div><div style={{ display: "flex", height: 7, background: "#22324A", borderRadius: 4, marginTop: 10 }}><div style={{ display: "flex", width: `${s.confidence}%`, background: "#22C7B8", borderRadius: 4 }} /></div>
      <div style={{ display: "flex", marginTop: 20, fontSize: 18, color: "#A7B3C5" }}>Model range {money(s.low)}–{money(s.high)} · Risk {s.riskScore ?? "?"}/100 (higher = more risk)</div>
      <div style={{ display: "flex", marginTop: 24, fontSize: 18, color: "#22C7B8", fontWeight: 700 }}>WHY IT IS ON THE SCREEN</div><div style={{ display: "flex", marginTop: 8, fontSize: 22, lineHeight: 1.35 }}>{s.why}</div>
      <div style={{ display: "flex", marginTop: 22, fontSize: 18, color: accent, fontWeight: 700 }}>THE SCENARIO TO WATCH</div><div style={{ display: "flex", marginTop: 8, fontSize: 22, lineHeight: 1.35 }}>{s.expected}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: "auto", paddingTop: 22, color: "#A7B3C5", fontSize: 17 }}><span>Price collected: {timestamp(s.priceObservedAt)}</span><span>Screen observed: {timestamp(s.observedAt)} · News event time: not established</span></div>
    </div><div style={{ display: "flex", marginTop: 24, fontSize: 25, color: "#22C7B8", fontWeight: 700 }}>Join early-bird access → use the post link</div><div style={{ display: "flex", marginTop: 10, color: "#A7B3C5", fontSize: 17 }}>Full signal context at launch. General research, not personal advice. No guaranteed returns.</div>
  </div>, { width: 1080, height: 1350, headers: { "Cache-Control": "no-store" } });
}
