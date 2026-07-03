import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { getR2OperationalStatus, saveJsonToR2 } from "@/lib/r2-warehouse";
import { redactSecrets } from "@/lib/redact-secrets";

export type BenzingaSafeError = "missing_api_key" | "rate_limited" | "plan_restricted" | "provider_error" | "malformed_response" | "empty_response" | "unknown" | "endpoint_needs_verification";
type JsonRecord = Record<string, unknown>;
type Contract = { name: string; path: string | null; sourceType: string; eventType: string; verified: boolean; needsSymbol?: boolean };

const BASE = "https://api.benzinga.com/api/v2.1";
const DAY = () => new Date().toISOString().slice(0, 10);
const hash = (v: string) => crypto.createHash("sha256").update(v.trim().toLowerCase()).digest("hex");
const text = (v: unknown) => typeof v === "string" ? v : v == null ? "" : String(v);
const array = (v: unknown) => Array.isArray(v) ? v.map(String).filter(Boolean) : [];

export const benzingaEndpointContracts: Contract[] = [
  { name: "benzinga_news", path: "/news", sourceType: "live_market_news", eventType: "news", verified: true },
  { name: "benzinga_live_conference_call_transcripts", path: "/calendar/conference-calls/transcripts", sourceType: "live_transcript", eventType: "conference_call_transcript", verified: true },
  { name: "benzinga_conference_call_calendar", path: "/calendar/conference-calls", sourceType: "calendar", eventType: "conference_call_calendar", verified: true },
  { name: "benzinga_why_is_it_moving", path: "/news/wiim", sourceType: "why_is_it_moving", eventType: "why_is_it_moving", verified: false, needsSymbol: true },
  { name: "benzinga_corporate_guidance", path: "/calendar/guidance", sourceType: "corporate_guidance", eventType: "guidance", verified: true },
  { name: "benzinga_fda_calendar", path: "/calendar/fda", sourceType: "fda_calendar", eventType: "fda", verified: true },
  { name: "benzinga_analyst_ratings", path: "/calendar/ratings", sourceType: "analyst_ratings", eventType: "analyst_action", verified: true },
  { name: "benzinga_price_targets", path: "/calendar/price-targets", sourceType: "price_targets", eventType: "price_target", verified: true },
  { name: "benzinga_sec_filings", path: "/calendar/sec", sourceType: "sec_filings", eventType: "sec_filing", verified: false },
  { name: "benzinga_squawk_placeholder", path: null, sourceType: "squawk", eventType: "squawk", verified: false },
];

function safeErrorFrom(status: number, body: string): BenzingaSafeError {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 402 || status === 403 || /permission|plan|subscription|entitlement|unauthor/i.test(body)) return "plan_restricted";
  if (status >= 500) return "provider_error";
  return "unknown";
}

async function fetchContract(c: Contract, input: { symbols: string[]; keywords: string[]; maxItems: number; timeoutMs: number }) {
  const key = process.env.BENZINGA_API_KEY?.trim();
  if (!key) return { contract: c, attempted: false, safeErrorCategory: "missing_api_key" as BenzingaSafeError, items: [] as unknown[], httpStatus: null };
  if (!c.path || !c.verified) return { contract: c, attempted: false, safeErrorCategory: "endpoint_needs_verification" as BenzingaSafeError, items: [] as unknown[], httpStatus: null };
  const url = new URL(`${BASE}${c.path}`);
  url.searchParams.set("token", key);
  url.searchParams.set("pagesize", String(input.maxItems));
  url.searchParams.set("displayOutput", "full");
  if (input.symbols.length) url.searchParams.set("tickers", input.symbols.join(","));
  if (c.needsSymbol && input.symbols[0]) url.searchParams.set("symbol", input.symbols[0]);
  if (c.name === "benzinga_news" && input.keywords[0]) url.searchParams.set("search", input.keywords.join(" OR "));
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), input.timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: ac.signal, headers: { accept: "application/json", "user-agent": "SwingUpBenzingaEar/1.0" } });
    const body = await res.text();
    if (!res.ok) return { contract: c, attempted: true, safeErrorCategory: safeErrorFrom(res.status, body), items: [] as unknown[], httpStatus: res.status };
    let json: unknown;
    try { json = JSON.parse(body || "{}"); } catch { return { contract: c, attempted: true, safeErrorCategory: "malformed_response" as BenzingaSafeError, items: [], httpStatus: res.status }; }
    const root = json as JsonRecord;
    const rows = Array.isArray(json) ? json : Array.isArray(root.data) ? root.data : Array.isArray(root.result) ? root.result : Array.isArray(root.results) ? root.results : [];
    if (!rows.length) return { contract: c, attempted: true, safeErrorCategory: "empty_response" as BenzingaSafeError, items: [], httpStatus: res.status };
    return { contract: c, attempted: true, safeErrorCategory: null, items: rows.slice(0, input.maxItems), httpStatus: res.status };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { contract: c, attempted: true, safeErrorCategory: /abort|timeout/i.test(msg) ? "provider_error" as const : "unknown" as const, items: [] as unknown[], httpStatus: null };
  } finally { clearTimeout(t); }
}

function normalize(c: Contract, raw: unknown, receivedAt: string, fallbackSymbols: string[]) {
  const r = raw as JsonRecord;
  const title = text(r.title || r.headline || r.subject || r.event_name || r.company_name || c.name).slice(0, 240);
  const summary = text(r.summary || r.teaser || r.body || r.description || r.notes || r.guidance || r.transcript).replace(/<[^>]+>/g, " ").slice(0, 900);
  const url = text(r.url || r.article_url || r.link || r.source_url) || null;
  const publishedAt = text(r.created || r.updated || r.published_at || r.date || r.time || r.event_date || r.report_date) || null;
  const symbols = [...new Set(array(r.tickers).concat(array(r.symbols), text(r.ticker || r.symbol).split(",")).map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const companies = [...new Set(array(r.companies).concat(text(r.company_name || r.company).split(",")).map((s) => s.trim()).filter(Boolean))];
  const externalId = text(r.id || r.uuid || r.news_id || r.accession_number) || null;
  const storyHash = hash([c.name, externalId, title, publishedAt, symbols.join(",")].join("|"));
  const transcriptText = text(r.transcript || r.transcript_text || r.body);
  return { sourceName: "Benzinga", sourceType: c.sourceType, title, summary, url, publishedAt, receivedAt, symbols: symbols.length ? symbols : fallbackSymbols.filter((s) => `${title} ${summary}`.toUpperCase().includes(s)), companies, eventType: c.eventType, transcriptTextAvailable: c.sourceType === "live_transcript" && transcriptText.trim().length > 100, transcriptSpeakerMetadataAvailable: Array.isArray(r.speakers) || Array.isArray(r.participants), transcriptProofAvailable: c.sourceType === "live_transcript" && transcriptText.trim().length > 100, liveTranscript: Boolean(r.live || r.is_live || r.status === "live" || r.status === "current"), guidanceAvailable: c.eventType === "guidance", fdaCalendarAvailable: c.eventType === "fda", analystActionAvailable: c.eventType === "analyst_action" || c.eventType === "price_target", storyHash, articleUrlHash: url ? hash(url) : null, rawStorageRef: null as string | null, externalId, raw: redactSecrets(raw) };
}

export async function runBenzingaEar(input: { dryRun?: boolean; confirmRun?: boolean; symbols?: string[]; keywords?: string[]; maxItemsPerEndpoint?: number; timeoutMs?: number }) {
  const dryRun = input.dryRun !== false;
  const runId = crypto.randomUUID();
  const symbols = (input.symbols?.length ? input.symbols : ["NVDA", "AMD", "MSFT", "GOOGL"]).map((s) => s.toUpperCase());
  const keywords = input.keywords?.length ? input.keywords : ["guidance", "earnings", "FDA", "product launch", "lawsuit", "investigation"];
  const maxItems = Math.min(Math.max(Number(input.maxItemsPerEndpoint ?? 20), 1), 50);
  const receivedAt = new Date().toISOString();
  const r2 = await getR2OperationalStatus().catch(() => null);
  const diagnostics = [] as JsonRecord[];
  const byHash = new Map<string, ReturnType<typeof normalize>>();
  let rawStoredInR2Count = 0;
  for (const c of benzingaEndpointContracts) {
    const result = await fetchContract(c, { symbols, keywords, maxItems, timeoutMs: input.timeoutMs ?? 8000 });
    const normalized = result.items.map((item) => normalize(c, item, receivedAt, symbols));
    for (const sig of normalized) {
      const key = sig.articleUrlHash || sig.externalId || sig.storyHash;
      if (!byHash.has(key)) byHash.set(key, sig);
      if (r2?.writeAvailable) {
        const r2Key = `raw/benzinga/${c.name}/${DAY()}/${runId}/${sig.storyHash}.json`;
        const ref = await saveJsonToR2(r2Key, sig.raw, { source: "benzinga", sourceId: c.name, dataType: c.sourceType, runId }).then((x) => x?.r2Key ?? r2Key).catch(() => null);
        if (ref) { sig.rawStorageRef = ref; rawStoredInR2Count++; }
      }
    }
    diagnostics.push({ endpoint: c.name, attempted: result.attempted, httpStatus: result.httpStatus, safeErrorCategory: result.safeErrorCategory, resultCount: normalized.length });
  }
  const signals = [...byHash.values()];
  if (!dryRun && process.env.DATABASE_URL) for (const sig of signals) {
    const existing = await prisma.rawSignal.findFirst({ where: { OR: [{ sourceUrl: sig.url ?? undefined }, { source: "Benzinga", title: sig.title }] } });
    if (!existing) await prisma.rawSignal.create({ data: { source: "Benzinga", ticker: sig.symbols[0] ?? null, signalType: sig.eventType, title: sig.title || "Untitled Benzinga signal", summary: sig.summary, sourceUrl: sig.url, importanceHint: "high", payload: redactSecrets(sig) as Prisma.InputJsonValue } });
  }
  const count = (kind: string) => signals.filter((s) => s.eventType === kind || s.sourceType === kind).length;
  return { ok: true, dryRun, confirmRun: input.confirmRun === true, runId, benzingaKeyDetected: Boolean(process.env.BENZINGA_API_KEY?.trim()), endpointsAttempted: diagnostics.filter((d) => d.attempted).map((d) => d.endpoint), benzingaEndpointSummary: diagnostics, rawSignals: signals.map((s) => ({ ...s, raw: undefined })), rawSignalCount: signals.length, benzingaLiveTranscriptCount: signals.filter((s) => s.transcriptTextAvailable).length, benzingaNewsSignalCount: count("news"), benzingaGuidanceSignalCount: count("guidance"), benzingaFdaSignalCount: count("fda"), benzingaAnalystSignalCount: signals.filter((s) => s.analystActionAvailable).length, rawStoredInR2Count, rawDataStored: rawStoredInR2Count > 0, benzingaFailures: diagnostics.filter((d) => d.safeErrorCategory && d.safeErrorCategory !== "empty_response"), noOpenAI: true, noPublish: true, noTelegram: true, secretsRedacted: true };
}
