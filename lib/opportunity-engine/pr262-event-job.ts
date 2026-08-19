import crypto from "node:crypto";
import { lookup } from "node:dns/promises";
import * as https from "node:https";
import net from "node:net";
import { Readable } from "node:stream";
import { branchProviderCallRequest } from "@/lib/branch-signal-lab";
import { providerCallBudgetDecision, type ProviderBudgetReservation } from "@/lib/branch-signal-lab-policy";
import { mergeHistoricalSignals } from "@/lib/equity-signal/historical-bootstrap";
import type { HistoricalSignalRecord } from "@/lib/equity-signal/historical-analogs";
import { fetchNasdaqTradeHalts, mergeSecFilingDetails } from "@/lib/equity-signal/event-sources";
import { runEquitySignalLab, type EquityProviderCallRequest, type EquitySignalLabInput } from "@/lib/equity-signal/runner";
import { enrichSecFilingDetails } from "@/lib/equity-signal/sec-filing-details";
import type { EventReceipt, ProviderResult } from "@/lib/equity-signal/types";
import type { EquityUniverseSnapshot } from "@/lib/equity-signal/universe";
import {
  readVersionedTextFromR2,
  writeVersionedJsonToR2,
} from "@/lib/r2-warehouse";
import {
  acknowledgePr262PendingSensorEvent,
  readNextPr262PendingSensorEvent,
  retryPr262PendingSensorEvent,
  type Pr262SensorEvent,
} from "@/lib/opportunity-engine/pr262-change-sensor";
import {
  readPr262ResolvedSensorCompany,
  type Pr262ResolvedSensorCompany,
} from "@/lib/opportunity-engine/pr262-company-directory";
import { refreshUsValueCompany, type UsValueCompanyAnalysis } from "@/lib/opportunity-engine/us-value-investing-engine";

const STATE_KEY = "branch-labs/pr-262/event-job/state-v1.json";
const LATEST_KEY = "branch-labs/pr-262/event-job/latest.json";
const RUN_PREFIX = "branch-labs/pr-262/event-job/runs";
const OUTBOX_PREFIX = "branch-labs/pr-262/serious-signal/outbox/event-job";
const HISTORY_KEY = "branch-labs/pr-262/serious-signal/equity-history-v1.json";
const VALUE_REFRESH_PREFIX = "branch-labs/pr-262/value-investing/event-refresh";
const LEASE_MS = 2 * 60 * 60_000;
const COMMITTEE_WINDOW_MS = 24 * 60 * 60_000;
const EVIDENCE_REVIEW_COOLDOWN_MS = 12 * 60 * 60_000;
const MAX_COMMITTEE_CALLS_PER_DAY = 20;
const MAX_STATE_RUNS = 200;
const MAX_HISTORY_RECORDS = 50_000;
const PROVIDER_RESERVATION_RETENTION_MS = 2 * 24 * 60 * 60_000;
const FULL_SOURCE_MAX_BYTES = 500_000;
const FULL_SOURCE_MAX_REDIRECTS = 3;
const FULL_SOURCE_ABSOLUTE_TIMEOUT_MS = 15_000;

type Json = Record<string, unknown>;
type CommitteeReservation = {
  eventId: string;
  candidateFingerprint: string;
  reservedAt: string;
  ticker: string;
  direction: "upside" | "downside";
};
type ProviderReservation = ProviderBudgetReservation & {
  provider: string;
  rollingWindowMs: number;
  maximumCallsInWindow: number;
  minimumIntervalMs: number;
};
type FullSourceTransport = (url: URL, validatedAddresses: string[]) => Promise<Response>;
type EventLease = { eventId: string; ownerId: string; acquiredAt: string; expiresAt: string };
type EventJobState = {
  version: 1;
  updatedAt: string;
  lease: EventLease | null;
  committeeReservations: CommitteeReservation[];
  providerReservations: ProviderReservation[];
  runs: Json[];
};

export type Pr262EventJobInput = {
  now?: Date;
  fetchImpl?: typeof fetch;
  allowOpenAi?: boolean;
  beforeOpenAiCall?: NonNullable<EquitySignalLabInput["beforeOpenAiCall"]>;
  resolveHost?: (hostname: string) => Promise<string[]>;
  fullSourceTransport?: FullSourceTransport;
  clock?: () => Date;
};

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedCik(value: unknown) {
  const digits = text(value)?.replace(/\D/g, "") ?? "";
  return digits ? digits.replace(/^0+/, "") || "0" : null;
}

function safeSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "event";
}

function eventResultKey(event: Pr262SensorEvent) {
  const day = Number.isFinite(Date.parse(event.observedAt)) ? event.observedAt.slice(0, 10) : "undated";
  const digest = crypto.createHash("sha256").update(event.id).digest("hex").slice(0, 16);
  return `${RUN_PREFIX}/${day}/${safeSegment(event.id)}-${digest}.json`;
}

function emptyState(): EventJobState {
  return { version: 1, updatedAt: new Date(0).toISOString(), lease: null, committeeReservations: [], providerReservations: [], runs: [] };
}

function normalizeState(value: unknown, now: Date): EventJobState {
  const item = object(value);
  const rawLease = object(item.lease);
  const lease = typeof rawLease.eventId === "string"
    && typeof rawLease.ownerId === "string"
    && typeof rawLease.expiresAt === "string"
    && Date.parse(rawLease.expiresAt) > now.getTime()
    ? rawLease as EventLease
    : null;
  const reservations = Array.isArray(item.committeeReservations)
    ? item.committeeReservations.filter((raw): raw is CommitteeReservation => {
        const reservation = object(raw);
        return typeof reservation.eventId === "string"
          && typeof reservation.candidateFingerprint === "string"
          && typeof reservation.reservedAt === "string"
          && typeof reservation.ticker === "string"
          && (reservation.direction === "upside" || reservation.direction === "downside")
          && now.getTime() - Date.parse(reservation.reservedAt) < 31 * 24 * 60 * 60_000;
      })
    : [];
  const providerReservations = Array.isArray(item.providerReservations)
    ? item.providerReservations.filter((raw): raw is ProviderReservation => {
        const reservation = object(raw);
        return typeof reservation.provider === "string"
          && typeof reservation.quotaKey === "string"
          && typeof reservation.cadenceKey === "string"
          && typeof reservation.reservedAt === "string"
          && Number.isFinite(Date.parse(reservation.reservedAt))
          && now.getTime() - Date.parse(reservation.reservedAt) < PROVIDER_RESERVATION_RETENTION_MS
          && Number(reservation.rollingWindowMs) > 0
          && Number(reservation.maximumCallsInWindow) > 0
          && Number(reservation.minimumIntervalMs) >= 0;
      })
    : [];
  return {
    version: 1,
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date(0).toISOString(),
    lease,
    committeeReservations: reservations,
    providerReservations,
    runs: Array.isArray(item.runs) ? item.runs.map(object).filter((run) => Object.keys(run).length > 0).slice(-MAX_STATE_RUNS) : [],
  };
}

async function loadState(now: Date) {
  const current = await readVersionedTextFromR2(STATE_KEY);
  if (!current.found || !current.text) return { state: emptyState(), etag: current.etag };
  return { state: normalizeState(JSON.parse(current.text), now), etag: current.etag };
}

async function claimEvent(eventId: string, now: Date) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const loaded = await loadState(now);
    const prior = loaded.state.runs.find((run) => run.eventId === eventId);
    if (prior) return { status: "already_completed" as const, prior, ownerId: null };
    if (loaded.state.lease) return { status: "busy" as const, prior: null, ownerId: null, lease: loaded.state.lease };
    const ownerId = crypto.randomUUID();
    const lease: EventLease = {
      eventId,
      ownerId,
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + LEASE_MS).toISOString(),
    };
    const next: EventJobState = { ...loaded.state, updatedAt: now.toISOString(), lease };
    const written = await writeVersionedJsonToR2(
      STATE_KEY,
      next,
      loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true },
    );
    if (!written.conflict) return { status: "claimed" as const, prior: null, ownerId };
  }
  throw new Error("pr262_event_job_claim_conflict");
}

async function releaseLease(eventId: string, ownerId: string, now: Date) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const loaded = await loadState(now);
    if (!loaded.state.lease || loaded.state.lease.eventId !== eventId || loaded.state.lease.ownerId !== ownerId) return;
    const next: EventJobState = { ...loaded.state, updatedAt: now.toISOString(), lease: null };
    const written = await writeVersionedJsonToR2(STATE_KEY, next, loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true });
    if (!written.conflict) return;
  }
  throw new Error("pr262_event_job_release_conflict");
}

async function renewLease(eventId: string, ownerId: string, now: Date) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const loaded = await loadState(now);
    if (!loaded.state.lease || loaded.state.lease.eventId !== eventId || loaded.state.lease.ownerId !== ownerId) {
      throw new Error("pr262_event_job_lease_lost");
    }
    const next: EventJobState = {
      ...loaded.state,
      updatedAt: now.toISOString(),
      lease: { ...loaded.state.lease, expiresAt: new Date(now.getTime() + LEASE_MS).toISOString() },
    };
    const written = await writeVersionedJsonToR2(STATE_KEY, next, loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true });
    if (!written.conflict) return;
  }
  throw new Error("pr262_event_job_renew_conflict");
}

class ProviderBudgetError extends Error {
  constructor(public readonly nextRetryAt: string | null, message: string) {
    super(message);
    this.name = "ProviderBudgetError";
  }
}

class RetryAtError extends Error {
  constructor(public readonly nextRetryAt: string | null, message: string) {
    super(message);
    this.name = "RetryAtError";
  }
}

async function reserveProviderCall(input: {
  eventId: string;
  ownerId: string;
  now: Date;
  request: EquityProviderCallRequest;
}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const loaded = await loadState(input.now);
    if (loaded.state.lease?.eventId !== input.eventId || loaded.state.lease.ownerId !== input.ownerId) {
      throw new Error("pr262_event_job_lease_lost");
    }
    const decision = providerCallBudgetDecision(loaded.state.providerReservations, input.request, input.now.getTime());
    if (!decision.allowed) {
      throw new ProviderBudgetError(decision.nextRetryAt, `${input.request.provider}_${decision.reason}`);
    }
    const reservation: ProviderReservation = {
      provider: input.request.provider,
      quotaKey: input.request.quotaKey,
      cadenceKey: input.request.cadenceKey,
      reservedAt: input.now.toISOString(),
      rollingWindowMs: input.request.rollingWindowMs,
      maximumCallsInWindow: input.request.maximumCallsInWindow,
      minimumIntervalMs: input.request.minimumIntervalMs,
      reservationUnits: input.request.reservationUnits,
    };
    const retained = loaded.state.providerReservations.filter((item) =>
      input.now.getTime() - Date.parse(item.reservedAt) < PROVIDER_RESERVATION_RETENTION_MS);
    const next: EventJobState = {
      ...loaded.state,
      updatedAt: input.now.toISOString(),
      lease: { ...loaded.state.lease, expiresAt: new Date(input.now.getTime() + LEASE_MS).toISOString() },
      providerReservations: [...retained, reservation],
    };
    const written = await writeVersionedJsonToR2(STATE_KEY, next, loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true });
    if (!written.conflict) return;
  }
  throw new Error("pr262_event_job_provider_reservation_conflict");
}

async function reserveCommitteeCall(input: {
  eventId: string;
  ownerId: string;
  now: Date;
  reservation: { candidateFingerprint: string; ticker: string; direction: "upside" | "downside" };
}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const loaded = await loadState(input.now);
    if (loaded.state.lease?.eventId !== input.eventId || loaded.state.lease.ownerId !== input.ownerId) return { allowed: false as const, nextRetryAt: null };
    const recent = loaded.state.committeeReservations.filter((item) => input.now.getTime() - Date.parse(item.reservedAt) < COMMITTEE_WINDOW_MS);
    const sameEvidence = recent.find((item) => item.candidateFingerprint === input.reservation.candidateFingerprint
      && input.now.getTime() - Date.parse(item.reservedAt) < EVIDENCE_REVIEW_COOLDOWN_MS);
    if (sameEvidence) {
      return { allowed: false as const, nextRetryAt: new Date(Date.parse(sameEvidence.reservedAt) + EVIDENCE_REVIEW_COOLDOWN_MS).toISOString() };
    }
    if (recent.length >= MAX_COMMITTEE_CALLS_PER_DAY) {
      const oldest = [...recent].sort((left, right) => Date.parse(left.reservedAt) - Date.parse(right.reservedAt))[0];
      return { allowed: false as const, nextRetryAt: new Date(Date.parse(oldest.reservedAt) + COMMITTEE_WINDOW_MS).toISOString() };
    }
    const next: EventJobState = {
      ...loaded.state,
      updatedAt: input.now.toISOString(),
      lease: { ...loaded.state.lease, expiresAt: new Date(input.now.getTime() + LEASE_MS).toISOString() },
      committeeReservations: [...recent, { eventId: input.eventId, reservedAt: input.now.toISOString(), ...input.reservation }],
    };
    const written = await writeVersionedJsonToR2(STATE_KEY, next, loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true });
    if (!written.conflict) return { allowed: true as const, nextRetryAt: null };
  }
  return { allowed: false as const, nextRetryAt: null };
}

function receiptChannel(event: Pr262SensorEvent): EventReceipt["channel"] {
  if (event.source === "sec") return "sec_current_filings";
  if (event.source === "company_news") return "google_news_rss";
  if (event.source === "market_price") return "market_price_sensor";
  if (event.kind === "fed") return "federal_reserve";
  if (event.kind === "bls") return "bls";
  if (event.kind === "sec_press") return "sec_press_release";
  return "federal_register";
}

function eventReceipt(event: Pr262SensorEvent, company: string, ticker: string): EventReceipt {
  const sec = event.source === "sec";
  return {
    id: event.id,
    title: event.title,
    summary: event.reason,
    url: event.canonicalSecIndexUrl ?? event.url,
    publisher: sec ? "U.S. Securities and Exchange Commission" : event.sourceProvider,
    publishedAt: event.observedAt,
    channel: receiptChannel(event),
    official: sec || event.source === "official",
    primarySource: sec || event.source === "official",
    scheduled: false,
    symbolHints: sec ? [] : [ticker],
    companyHints: sec && event.cik ? [`CIK${event.cik}`] : [company],
    rawEventType: event.form ?? event.kind,
  };
}

function assertSecEventIdentity(event: Pr262SensorEvent) {
  if (event.source !== "sec") return;
  if (!event.cik || !event.accession || !event.canonicalSecIndexUrl || event.identityMethod !== "official_sec_archive_link") {
    throw new Error("pr262_event_sec_identity_incomplete");
  }
  let url: URL;
  try {
    url = new URL(event.canonicalSecIndexUrl);
  } catch {
    throw new Error("pr262_event_sec_canonical_url_invalid");
  }
  const match = url.pathname.match(/^\/Archives\/edgar\/data\/(\d+)\/(\d{18})\/(\d{10}-\d{2}-\d{6})-index\.html$/i);
  const expectedCik = event.cik.replace(/^0+/, "") || "0";
  const expectedAccessionDigits = event.accession.replace(/-/g, "");
  if ((url.hostname !== "www.sec.gov" && url.hostname !== "sec.gov")
    || !match
    || (match[1].replace(/^0+/, "") || "0") !== expectedCik
    || match[2] !== expectedAccessionDigits
    || match[3] !== event.accession) {
    throw new Error("pr262_event_sec_identity_url_mismatch");
  }
}

function cleanSourceText(raw: string) {
  return raw
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function privateOrNonRoutableAddress(address: string) {
  const normalized = address.toLowerCase().split("%")[0];
  const kind = net.isIP(normalized);
  if (kind === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && [0, 168].includes(b))
      || (a === 198 && [18, 19, 51].includes(b))
      || (a === 203 && b === 0)
      || a >= 224;
  }
  if (kind === 6) {
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("::ffff:")) return privateOrNonRoutableAddress(normalized.slice(7));
    return /^(?:fc|fd|fe[89ab]|ff)/.test(normalized) || normalized.startsWith("2001:db8:");
  }
  return true;
}

async function validatedPublicHttpsUrl(raw: string, resolveHost: (hostname: string) => Promise<string[]>) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("full_source_url_invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("full_source_url_not_public_https");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || /\.(?:localhost|local|internal|home|lan)$/.test(hostname)) {
    throw new Error("full_source_host_blocked");
  }
  const addresses = net.isIP(hostname) ? [hostname] : await resolveHost(hostname);
  if (!addresses.length || addresses.some(privateOrNonRoutableAddress)) throw new Error("full_source_address_blocked");
  return { url, addresses: [...new Set(addresses)].slice(0, 4) };
}

async function defaultResolveHost(hostname: string) {
  return (await lookup(hostname, { all: true, verbatim: true })).map((item) => item.address);
}

async function pinnedHttpsTransport(url: URL, validatedAddresses: string[]) {
  let lastError: unknown = null;
  for (const address of validatedAddresses) {
    try {
      return await new Promise<Response>((resolve, reject) => {
        const family = net.isIP(address);
        if (family !== 4 && family !== 6) {
          reject(new Error("full_source_address_invalid"));
          return;
        }
        const request = https.request(url, {
          method: "GET",
          headers: { Accept: "text/html,application/xhtml+xml,text/plain,application/xml", "user-agent": "SwingUp/1.0 support@swingup.app" },
          servername: url.hostname,
          lookup: (_hostname, _options, callback) => callback(null, address, family),
        }, (incoming) => {
          const clearAbsoluteDeadline = () => clearTimeout(absoluteDeadline);
          incoming.once("end", clearAbsoluteDeadline);
          incoming.once("close", clearAbsoluteDeadline);
          const headers = new Headers();
          for (const [key, value] of Object.entries(incoming.headers)) {
            if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
            else if (value !== undefined) headers.set(key, value);
          }
          const body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
          resolve(new Response(body, { status: incoming.statusCode ?? 502, headers }));
        });
        const absoluteDeadline = setTimeout(
          () => request.destroy(new Error("full_source_timeout")),
          FULL_SOURCE_ABSOLUTE_TIMEOUT_MS,
        );
        request.once("error", (error) => {
          clearTimeout(absoluteDeadline);
          reject(error);
        });
        request.end();
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("full_source_transport_failed");
}

async function limitedResponseText(response: Response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > FULL_SOURCE_MAX_BYTES) throw new Error("full_source_body_too_large");
  if (!response.body) throw new Error("full_source_body_unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > FULL_SOURCE_MAX_BYTES) {
      await reader.cancel().catch(() => null);
      throw new Error("full_source_body_too_large");
    }
    chunks.push(next.value);
  }
  return { raw: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"), bytes: total };
}

function normalizedEvidenceText(value: string) {
  return value.toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(incorporated|inc|corporation|corp|company|co|limited|ltd|plc|holdings|holding|group)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fullSourceEvidenceConfirmed(sourceText: string, event: Pr262SensorEvent, company: string, ticker: string) {
  const normalizedSource = normalizedEvidenceText(sourceText);
  const normalizedCompany = normalizedEvidenceText(company);
  const escapedTicker = ticker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const issuerConfirmed = (normalizedCompany.length >= 4 && normalizedSource.includes(normalizedCompany))
    || (ticker.length >= 2 && new RegExp(`(?:\\$${escapedTicker}\\b|\\(${escapedTicker}\\)|(?:NASDAQ|NYSE|AMEX)\\s*:\\s*${escapedTicker}\\b)`, "i").test(sourceText));
  const materialTerms = [
    "earnings", "guidance", "acquisition", "merger", "contract", "recall", "investigation",
    "offering", "bankrupt", "approval", "fda", "cyber", "tariff", "sanction", "product launch",
    "buyback", "dividend", "chief executive", "chief financial", "clinical trial",
  ].filter((term) => event.title.toLowerCase().includes(term));
  const eventConfirmed = materialTerms.length > 0 && materialTerms.some((term) => normalizedSource.includes(normalizedEvidenceText(term)));
  return { issuerConfirmed, eventConfirmed, materialTerms };
}

function officialHostPreserved(receipt: EventReceipt, finalUrl: URL) {
  if (!receipt.official && !receipt.primarySource) return false;
  const host = finalUrl.hostname.toLowerCase();
  return host.endsWith(".gov") || host === "sec.gov" || host === "www.sec.gov";
}

async function fetchFullSource(
  receipt: EventReceipt,
  event: Pr262SensorEvent,
  company: string,
  ticker: string,
  fetchImpl: typeof fetch,
  now: Date,
  resolveHost: (hostname: string) => Promise<string[]>,
  transport?: FullSourceTransport,
) {
  const startedAt = Date.now();
  try {
    let validated = await validatedPublicHttpsUrl(receipt.url, resolveHost);
    let current = validated.url;
    let response: Response | null = null;
    let redirects = 0;
    while (true) {
      response = transport
        ? await transport(current, validated.addresses)
        : await fetchImpl(current, {
            headers: { Accept: "text/html,application/xhtml+xml,text/plain,application/xml", "user-agent": "SwingUp/1.0 support@swingup.app" },
            cache: "no-store",
            redirect: "manual",
            signal: AbortSignal.timeout(15_000),
          });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      if (redirects >= FULL_SOURCE_MAX_REDIRECTS) throw new Error("full_source_too_many_redirects");
      const location = response.headers.get("location");
      if (!location) throw new Error("full_source_redirect_missing_location");
      await response.body?.cancel().catch(() => null);
      validated = await validatedPublicHttpsUrl(new URL(location, current).toString(), resolveHost);
      current = validated.url;
      redirects += 1;
    }
    if (!response.ok) throw new Error(`full_source_http_${response.status}`);
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!/^(?:text\/(?:html|plain|xml)|application\/(?:xhtml\+xml|xml))(?:;|$)/.test(contentType)) {
      throw new Error("full_source_content_type_unsupported");
    }
    const { raw, bytes } = await limitedResponseText(response);
    const sourceText = cleanSourceText(raw).slice(0, 80_000);
    if (sourceText.length < 200) throw new Error("full_source_text_too_short");
    const evidence = fullSourceEvidenceConfirmed(sourceText, event, company, ticker);
    if (!evidence.issuerConfirmed || !evidence.eventConfirmed) throw new Error("full_source_issuer_or_event_unconfirmed");
    const officialPreserved = officialHostPreserved(receipt, current);
    const enriched: EventReceipt = {
      ...receipt,
      url: current.toString(),
      official: receipt.official && officialPreserved,
      primarySource: receipt.primarySource && officialPreserved,
      summary: `${receipt.summary ?? receipt.title} Full source content: ${sourceText.slice(0, 12_000)}`,
    };
    const provider: ProviderResult = {
      provider: `pr262_full_source_${safeSegment(receipt.publisher)}`,
      status: "connected",
      checkedAt: now.toISOString(),
      nextRetryAt: null,
      sourceUrls: [current.toString()],
      receipts: [enriched],
      recordsRead: 1,
      error: null,
      entitlementVerified: true,
      cached: false,
      responseTimeMs: Date.now() - startedAt,
    };
    return { receipts: [enriched], providers: [provider], decisionGrade: true, diagnostics: { sourceTextBytes: bytes, sourceTextCharacters: sourceText.length, redirects, finalUrl: current.toString(), ...evidence, officialPreserved } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "full_source_failed";
    const provider: ProviderResult = {
      provider: `pr262_full_source_${safeSegment(receipt.publisher)}`,
      status: /429|rate/i.test(message) ? "rate_limited" : "temporarily_unavailable",
      checkedAt: now.toISOString(),
      nextRetryAt: null,
      sourceUrls: [receipt.url],
      receipts: [],
      recordsRead: 0,
      error: message.slice(0, 240),
      entitlementVerified: false,
      cached: false,
      responseTimeMs: Date.now() - startedAt,
    };
    return { receipts: [receipt], providers: [provider], decisionGrade: false, diagnostics: { sourceTextBytes: 0, sourceTextCharacters: 0 } };
  }
}

async function readDecisionGradeSource(
  receipt: EventReceipt,
  event: Pr262SensorEvent,
  company: string,
  ticker: string,
  fetchImpl: typeof fetch,
  now: Date,
  resolveHost: (hostname: string) => Promise<string[]>,
  fullSourceTransport: FullSourceTransport,
) {
  if (event.source !== "sec") {
    if (event.source === "market_price") {
      const provider: ProviderResult = {
        provider: event.sourceProvider,
        status: "connected",
        checkedAt: event.observedAt,
        nextRetryAt: null,
        sourceUrls: [event.sourceUrl],
        receipts: [receipt],
        recordsRead: 1,
        error: null,
        entitlementVerified: true,
        cached: false,
      };
      return { receipts: [receipt], providers: [provider], decisionGrade: false, diagnostics: { reason: "price_threshold_is_not_event_evidence" } };
    }
    return fetchFullSource(receipt, event, company, ticker, fetchImpl, now, resolveHost, fullSourceTransport);
  }
  const details = await enrichSecFilingDetails([receipt], fetchImpl, now);
  const receipts = mergeSecFilingDetails([receipt], details.details);
  const selected = details.details.find((detail) => detail.receipt.id === receipt.id) ?? null;
  const decisionGrade = Boolean(selected && selected.textLength >= 200 && !selected.eventExhibitMissing);
  const provider: ProviderResult = { ...details.provider, receipts: [] };
  return { receipts, providers: [provider], decisionGrade, diagnostics: details.diagnostics };
}

function exactIssuerUniverse(resolved: Pr262ResolvedSensorCompany, now: Date): EquityUniverseSnapshot {
  const entry = resolved.directoryEntry;
  return {
    version: 1,
    scope: "active_us_exchange_listed_common_equities_and_adrs",
    constructionMode: "nasdaq_plus_sec",
    refreshedAt: entry.universeRefreshedAt,
    entries: [{
      ticker: entry.ticker,
      name: entry.company,
      exchange: entry.exchange,
      cik: entry.cik,
      aliases: [entry.company],
      securityType: entry.securityType ?? "common_stock",
      sourceNames: ["PR #262 authoritative cached U.S. universe", "exact stored company analysis"],
    }],
    coverage: {
      nasdaqRows: 0,
      otherExchangeRows: 0,
      eligibleEquities: 1,
      cikMapped: entry.cik ? 1 : 0,
      cikMappedPercent: entry.cik ? 100 : 0,
      adrCount: entry.securityType === "adr" ? 1 : 0,
      excludedByReason: {},
    },
    sources: [{
      name: "PR #262 authoritative cached U.S. universe",
      url: "https://www.sec.gov/files/company_tickers_exchange.json",
      status: Date.parse(entry.universeRefreshedAt) <= now.getTime() ? "connected" : "invalid_future_timestamp",
      records: 1,
      error: null,
    }],
  };
}

function valueRefreshKey(eventId: string, ticker: string) {
  const digest = crypto.createHash("sha256").update(eventId).digest("hex").slice(0, 16);
  return `${VALUE_REFRESH_PREFIX}/${ticker.toUpperCase()}/events/${safeSegment(eventId)}-${digest}.json`;
}

function validatedValueRefresh(value: unknown, eventId: string, ticker: string) {
  const payload = object(value);
  const analysis = object(payload.analysis);
  if (payload.kind !== "pr262_affected_company_value_refresh"
    || payload.eventId !== eventId
    || String(payload.ticker ?? "").toUpperCase() !== ticker.toUpperCase()
    || String(analysis.ticker ?? "").toUpperCase() !== ticker.toUpperCase()) {
    throw new Error("pr262_event_value_refresh_invalid");
  }
  return { payload, analysis: analysis as unknown as UsValueCompanyAnalysis };
}

async function writeMonotonicLatest(key: string, payload: Json, candidateAt: string, currentTimestamp: (value: Json) => string | null) {
  const candidateMs = Date.parse(candidateAt);
  if (!Number.isFinite(candidateMs)) throw new Error("pr262_latest_candidate_time_invalid");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await readVersionedTextFromR2(key);
    if (current.found && current.text) {
      const value = object(JSON.parse(current.text));
      const currentAt = currentTimestamp(value);
      const currentMs = currentAt ? Date.parse(currentAt) : Number.NaN;
      if (Number.isFinite(currentMs) && currentMs >= candidateMs) return { written: false, newerOrEqualExists: true };
    }
    const written = await writeVersionedJsonToR2(
      key,
      payload,
      current.etag ? { expectedEtag: current.etag } : { createOnly: true },
    );
    if (!written.conflict) return { written: true, newerOrEqualExists: false };
  }
  throw new Error("pr262_latest_write_conflict");
}

async function refreshAffectedCompany(input: {
  event: Pr262SensorEvent;
  resolved: Pr262ResolvedSensorCompany;
  fetchImpl: typeof fetch;
  now: Date;
  beforeFetch: () => Promise<void>;
}) {
  const ticker = input.resolved.directoryEntry.ticker;
  const immutableKey = valueRefreshKey(input.event.id, ticker);
  const latestKey = `${VALUE_REFRESH_PREFIX}/${ticker}/latest.json`;
  const existing = await readVersionedTextFromR2(immutableKey);
  let persisted: { payload: Json; analysis: UsValueCompanyAnalysis };
  if (existing.found && existing.text) {
    persisted = validatedValueRefresh(JSON.parse(existing.text), input.event.id, ticker);
  } else {
    await input.beforeFetch();
    const analysis = await refreshUsValueCompany({
      tradingViewSymbol: input.resolved.directoryEntry.tradingViewSymbol,
      ticker,
      fetchImpl: input.fetchImpl,
      now: input.now,
    });
    const payload = {
      version: 1,
      kind: "pr262_affected_company_value_refresh",
      eventId: input.event.id,
      eventObservedAt: input.event.observedAt,
      refreshedAt: input.now.toISOString(),
      ticker,
      cik: input.resolved.directoryEntry.cik,
      priorValueCycleId: input.resolved.directoryEntry.valueCycleId,
      analysis,
      safety: { databaseWrites: false, publishing: false, notifications: false, trades: false },
    };
    const created = await writeVersionedJsonToR2(immutableKey, payload, { createOnly: true });
    if (created.conflict) {
      const concurrent = await readVersionedTextFromR2(immutableKey);
      if (!concurrent.found || !concurrent.text) throw new Error("pr262_event_value_refresh_conflict_read_failed");
      persisted = validatedValueRefresh(JSON.parse(concurrent.text), event.id, ticker);
    } else {
      persisted = validatedValueRefresh(payload, input.event.id, ticker);
    }
  }
  await writeMonotonicLatest(
    latestKey,
    persisted.payload,
    text(persisted.payload.refreshedAt) ?? input.now.toISOString(),
    (value) => text(value.refreshedAt),
  );
  return { analysis: persisted.analysis, immutableKey, latestKey, recovered: existing.found };
}

function isHistoricalRecord(value: unknown): value is HistoricalSignalRecord {
  const item = object(value);
  return typeof item.id === "string"
    && typeof item.eventKey === "string"
    && typeof item.ticker === "string"
    && typeof item.eventFamily === "string"
    && (item.direction === "upside" || item.direction === "downside")
    && (item.relationship === "direct" || item.relationship === "second_order" || item.relationship === "third_order")
    && Array.isArray(item.causalChain)
    && Array.isArray(item.macroRegime)
    && typeof item.signalObservedAt === "string"
    && typeof item.featuresAsOf === "string"
    && item.checkpoints !== null
    && typeof item.checkpoints === "object"
    && !Array.isArray(item.checkpoints);
}

async function loadHistoricalLibrary() {
  const current = await readVersionedTextFromR2(HISTORY_KEY);
  if (!current.found || !current.text) return { records: [] as HistoricalSignalRecord[], etag: current.etag };
  const parsed = object(JSON.parse(current.text));
  const records = Array.isArray(parsed.records) ? parsed.records.filter(isHistoricalRecord) : [];
  return { records: mergeHistoricalSignals(records).slice(-MAX_HISTORY_RECORDS), etag: current.etag };
}

function trackedFinding(report: Json): HistoricalSignalRecord | null {
  const candidate = object(report.selectedCandidate);
  const direction = candidate.direction === "upside" || candidate.direction === "downside" ? candidate.direction : null;
  const relationship = candidate.relationship === "direct" || candidate.relationship === "second_order" || candidate.relationship === "third_order" ? candidate.relationship : null;
  const ticker = text(candidate.ticker)?.toUpperCase() ?? null;
  const eventFamily = text(candidate.eventFamily);
  const checkedAt = text(report.checkedAt);
  const eventKey = text(candidate.evidenceFingerprint) ?? text(report.candidateFingerprint);
  if (!direction || !relationship || !ticker || !eventFamily || !checkedAt || !eventKey) return null;
  const receipts = Array.isArray(candidate.receipts) ? candidate.receipts.map(object) : [];
  const primary = receipts.find((receipt) => receipt.primarySource === true) ?? receipts[0] ?? {};
  return {
    id: `${eventKey}:${checkedAt}`,
    eventKey,
    ticker,
    eventFamily,
    direction,
    relationship,
    causalChain: Array.isArray(candidate.causalChain) ? candidate.causalChain.filter((item): item is string => typeof item === "string") : [],
    macroRegime: Array.isArray(object(report.macroContext).regime) ? object(report.macroContext).regime as string[] : [],
    signalObservedAt: checkedAt,
    featuresAsOf: checkedAt,
    dataQuality: "real",
    provenance: {
      origin: "swing_up_tracked_finding",
      eventPublisher: text(primary.publisher) ?? "decision-grade public source",
      eventSourceUrl: text(primary.url) ?? "unavailable",
      priceSource: text(candidate.marketSource) ?? text(object(candidate.quote).source) ?? "live public-equity quote fallback chain",
      benchmarkSource: text(candidate.benchmarkSource) ?? "live SPY benchmark quote",
      methodologyVersion: "pr262_targeted_event_job_v1",
    },
    checkpoints: {},
  };
}

async function persistTrackedFinding(report: Json, now: Date) {
  const addition = trackedFinding(report);
  if (!addition) return { persisted: false, reason: "no_qualified_finding" };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const loaded = await loadHistoricalLibrary();
    const records = mergeHistoricalSignals(loaded.records, [addition]).slice(-MAX_HISTORY_RECORDS);
    const payload = { version: 1, records, updatedAt: now.toISOString() };
    const written = await writeVersionedJsonToR2(HISTORY_KEY, payload, loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true });
    if (!written.conflict) return { persisted: true, recordId: addition.id, totalRecords: records.length };
  }
  throw new Error("pr262_event_history_write_conflict");
}

function committeeApproved(report: Json, pointer: Json) {
  const committee = object(report.committee);
  const judge = object(committee.finalJudge);
  const output = object(committee.output);
  const candidate = object(report.selectedCandidate);
  const quote = object(candidate.quote);
  const halt = object(report.tradingHaltSafety);
  const pilot = object(report.historicalPilot);
  const officialEvidence = Array.isArray(candidate.receipts) && candidate.receipts.map(object).some((receipt) =>
    receipt.official === true || receipt.primarySource === true || receipt.channel === "sec_current_filings");
  const candidateTicker = text(candidate.ticker)?.toUpperCase() ?? null;
  const pointerTicker = text(pointer.ticker)?.toUpperCase() ?? null;
  const candidateCik = normalizedCik(candidate.cik);
  const pointerCik = normalizedCik(pointer.cik);
  return report.seriousSignalFound === true
    && report.actionableSignalFound === true
    && (report.alertType === "buy" || report.alertType === "sell")
    && candidateTicker !== null
    && candidateTicker === pointerTicker
    && candidateCik !== null
    && candidateCik === pointerCik
    && candidate.evidenceFingerprint === report.candidateFingerprint
    && candidate.gatePassed === true
    && Number(candidate.eventTruth) >= 80
    && Number(candidate.mappingConfidence) >= 95
    && Number(candidate.materiality) >= 65
    && Number(candidate.transmissionConfidence) >= 70
    && Number(candidate.evidenceIndependence) >= 78
    && candidate.rumour !== true
    && Number(candidate.contradictionPenalty) < 50
    && Number(candidate.pricedInPenalty) < 50
    && quote.actionableForSeriousSignal === true
    && !["halted", "unknown"].includes(String(quote.marketSession ?? "unknown"))
    && halt.currentStateKnown === true
    && pilot.passed === true
    && officialEvidence
    && committee.ok === true
    && committee.agentsCompleted === 14
    && committee.agentsFailed === 0
    && judge.verdict === "positive"
    && Number(judge.confidence) >= 80
    && output.overallRecommendation === "approve";
}

function stateRun(eventId: string, resultKey: string, report: Json) {
  return {
    eventId,
    resultKey,
    checkedAt: report.checkedAt,
    status: report.status,
    seriousSignalFound: report.seriousSignalFound === true,
    actionableSignalFound: report.actionableSignalFound === true,
    alertType: report.alertType ?? null,
    openAiCalled: report.openAiCalled === true,
    candidateFingerprint: report.candidateFingerprint ?? null,
    selectedCandidate: report.selectedCandidate ?? null,
    rankedCandidates: [],
    historicalPilot: report.historicalPilot ?? null,
    tradingHaltSafety: report.tradingHaltSafety ?? null,
    committee: report.committee ?? null,
  };
}

async function completeState(eventId: string, ownerId: string, resultKey: string, report: Json, now: Date) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const loaded = await loadState(now);
    if (loaded.state.runs.some((run) => run.eventId === eventId)) return;
    if (loaded.state.lease?.eventId !== eventId || loaded.state.lease.ownerId !== ownerId) throw new Error("pr262_event_job_lease_lost");
    const next: EventJobState = {
      ...loaded.state,
      updatedAt: now.toISOString(),
      lease: null,
      runs: [...loaded.state.runs, stateRun(eventId, resultKey, report)].slice(-MAX_STATE_RUNS),
    };
    const written = await writeVersionedJsonToR2(STATE_KEY, next, loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true });
    if (!written.conflict) return;
  }
  throw new Error("pr262_event_job_complete_conflict");
}

function validatedResultPayload(value: unknown, eventId: string, resultKey: string) {
  const payload = object(value);
  const storedEvent = object(payload.event);
  const report = object(payload.report);
  const pointer = object(payload.companyPointer);
  if (payload.kind !== "pr262_targeted_event_job_result"
    || storedEvent.id !== eventId
    || typeof pointer.ticker !== "string"
    || (pointer.cik !== null && typeof pointer.cik !== "string")
    || !text(report.checkedAt)) {
    throw new Error(`pr262_event_result_invalid:${resultKey}`);
  }
  return { payload, report, pointer };
}

async function readExistingResult(resultKey: string, eventId: string) {
  const existing = await readVersionedTextFromR2(resultKey);
  if (!existing.found || !existing.text) return null;
  return validatedResultPayload(JSON.parse(existing.text), eventId, resultKey);
}

async function finalizePersistedResult(input: {
  eventId: string;
  ownerId: string;
  resultKey: string;
  payload: Json;
  now: Date;
  clock: () => Date;
}) {
  const validated = validatedResultPayload(input.payload, input.eventId, input.resultKey);
  const report = validated.report;
  const pointer = validated.pointer;
  const checkedAt = text(report.checkedAt) ?? input.now.toISOString();
  await writeMonotonicLatest(
    LATEST_KEY,
    validated.payload,
    checkedAt,
    (value) => text(object(value.report).checkedAt),
  );
  const historyWrite = await persistTrackedFinding(report, input.now);
  let outboxKey: string | null = null;
  if (committeeApproved(report, pointer)) {
    const alertType = String(report.alertType);
    const fingerprint = text(report.candidateFingerprint) ?? safeSegment(input.eventId);
    outboxKey = `${OUTBOX_PREFIX}/${alertType}/${String(pointer.ticker).toUpperCase()}/${safeSegment(fingerprint)}.json`;
    const outboxPayload = {
      version: 1,
      kind: "pr262_committee_verified_event_signal",
      createdAt: checkedAt,
      eventId: input.eventId,
      resultKey: input.resultKey,
      ticker: String(pointer.ticker).toUpperCase(),
      cik: text(pointer.cik),
      alertType,
      candidate: report.selectedCandidate,
      historicalPilot: report.historicalPilot,
      committee: report.committee,
      delivery: { enabled: false, published: false, notified: false, traded: false },
    };
    const written = await writeVersionedJsonToR2(outboxKey, outboxPayload, { createOnly: true });
    if (written.conflict) {
      const existing = await readVersionedTextFromR2(outboxKey);
      const value = existing.found && existing.text ? object(JSON.parse(existing.text)) : {};
      if (value.eventId !== input.eventId || value.resultKey !== input.resultKey) throw new Error("pr262_event_outbox_conflict");
    }
  }
  await renewLease(input.eventId, input.ownerId, input.clock());
  await completeState(input.eventId, input.ownerId, input.resultKey, report, input.clock());
  await acknowledgePr262PendingSensorEvent(input.eventId).catch(() => null);
  return { report, checkedAt, historyWrite, outboxKey, pointer };
}

function retryDelay(event: Pr262SensorEvent) {
  return Math.min(6 * 60 * 60_000, 5 * 60_000 * (2 ** Math.min(6, event.queueAttempts)));
}

function retryableReport(report: Json, allowOpenAi: boolean) {
  const status = text(report.status) ?? "";
  const committee = object(report.committee);
  const selected = object(report.selectedCandidate);
  const quote = object(selected.quote);
  const halt = object(report.tradingHaltSafety);
  if (report.openAiCalled === true
    && (committee.ok !== true || Number(committee.agentsCompleted) !== 14 || Number(committee.agentsFailed) !== 0)) return true;
  if (status === "qualified_event_market_quote_unavailable") return true;
  if (status === "qualified_event_watch_only"
    && (halt.currentStateKnown !== true || quote.actionableForSeriousSignal !== true)) return true;
  if (!allowOpenAi && status === "qualified_signal_openai_not_requested") return true;
  return [
    "configuration_blocker",
    "qualified_signal_openai_reservation_denied",
    "source_temporarily_unavailable",
    "technical_failure",
  ].includes(status);
}

export async function runPr262EventJob(input: Pr262EventJobInput = {}) {
  const clock = input.clock ?? (input.now ? () => input.now! : () => new Date());
  const now = input.now ?? clock();
  const fetchImpl = input.fetchImpl ?? fetch;
  const allowOpenAi = input.allowOpenAi ?? process.env.SWING_UP_PR262_EVENT_JOB_OPENAI_ENABLED === "true";
  const event = await readNextPr262PendingSensorEvent({ now, minimumPriority: 80 });
  if (!event) {
    return { ok: true, mode: "pr262_targeted_event_job", status: "idle", checkedAt: now.toISOString(), eventsProcessed: 0, aiCalls: 0 };
  }
  const claim = await claimEvent(event.id, now);
  if (claim.status === "already_completed") {
    await acknowledgePr262PendingSensorEvent(event.id).catch(() => null);
    return { ok: true, mode: "pr262_targeted_event_job", status: "already_completed", checkedAt: now.toISOString(), eventsProcessed: 0, prior: claim.prior };
  }
  if (claim.status === "busy" || !claim.ownerId) {
    return { ok: true, mode: "pr262_targeted_event_job", status: "busy", checkedAt: now.toISOString(), eventsProcessed: 0, lease: claim.lease };
  }
  const ownerId = claim.ownerId;
  const resultKey = eventResultKey(event);
  try {
    const recovered = await readExistingResult(resultKey, event.id);
    if (recovered) {
      const finalized = await finalizePersistedResult({ eventId: event.id, ownerId, resultKey, payload: recovered.payload, now, clock });
      return {
        ok: true,
        mode: "pr262_targeted_event_job",
        status: text(finalized.report.status) ?? "completed",
        checkedAt: finalized.checkedAt,
        eventsProcessed: 0,
        recoveredPersistedResult: true,
        ticker: String(finalized.pointer.ticker),
        cik: text(finalized.pointer.cik),
        sourceDecisionGrade: recovered.payload.sourceDecisionGrade === true,
        openAiCalled: finalized.report.openAiCalled === true,
        seriousSignalFound: finalized.report.seriousSignalFound === true,
        actionableSignalFound: finalized.report.actionableSignalFound === true,
        alertType: finalized.report.alertType ?? null,
        resultKey,
        outboxKey: finalized.outboxKey,
        historyWrite: finalized.historyWrite,
        safety: { databaseWrites: false, publishing: false, notifications: false, trades: false },
      };
    }

    const resolved = await readPr262ResolvedSensorCompany(event.id);
    if (!resolved) throw new Error("pr262_event_exact_company_not_resolved");
    assertSecEventIdentity(resolved.event);
    if (event.source === "sec" && (!event.cik || resolved.directoryEntry.cik !== event.cik)) {
      throw new Error("pr262_event_sec_cik_mismatch");
    }
    const quotaAwareFetch: typeof fetch = async (request, init) => {
      const budget = branchProviderCallRequest(request, now);
      if (budget) await reserveProviderCall({ eventId: event.id, ownerId, now, request: budget });
      return fetchImpl(request, init);
    };
    if (!["sec", "market_price"].includes(resolved.event.source)) {
      await reserveProviderCall({
        eventId: event.id,
        ownerId,
        now,
        request: {
          provider: "pr262_full_source",
          quotaKey: "pr262_full_source_reads",
          cadenceKey: `pr262_full_source:${event.id}`,
          checkedAt: now.toISOString(),
          rollingWindowMs: 24 * 60 * 60_000,
          maximumCallsInWindow: 100,
          minimumIntervalMs: EVIDENCE_REVIEW_COOLDOWN_MS,
        },
      });
    }
    const baseReceipt = eventReceipt(resolved.event, resolved.directoryEntry.company, resolved.directoryEntry.ticker);
    const [source, haltProvider, history] = await Promise.all([
      readDecisionGradeSource(
        baseReceipt,
        resolved.event,
        resolved.directoryEntry.company,
        resolved.directoryEntry.ticker,
        quotaAwareFetch,
        now,
        input.resolveHost ?? defaultResolveHost,
        input.fullSourceTransport ?? pinnedHttpsTransport,
      ),
      fetchNasdaqTradeHalts(quotaAwareFetch, now),
      loadHistoricalLibrary(),
    ]);
    const eventAgeMs = Math.max(0, now.getTime() - Date.parse(event.observedAt));
    const sourceExpiredWithoutEvidence = !source.decisionGrade
      && event.source !== "market_price"
      && eventAgeMs > 7 * 24 * 60 * 60_000;
    if (!source.decisionGrade && event.source !== "market_price" && !sourceExpiredWithoutEvidence) {
      throw new RetryAtError(null, "pr262_event_full_source_incomplete");
    }
    const companyRefresh = source.decisionGrade && !sourceExpiredWithoutEvidence
      ? await refreshAffectedCompany({
          event: resolved.event,
          resolved,
          fetchImpl: quotaAwareFetch,
          now,
          beforeFetch: () => reserveProviderCall({
            eventId: event.id,
            ownerId,
            now,
            request: {
              provider: "tradingview_targeted_value",
              quotaKey: "pr262_targeted_value_refresh",
              cadenceKey: `pr262_targeted_value:${resolved.directoryEntry.ticker}`,
              checkedAt: now.toISOString(),
              rollingWindowMs: 24 * 60 * 60_000,
              maximumCallsInWindow: 100,
              minimumIntervalMs: 15 * 60_000,
            },
          }),
        })
      : null;
    await renewLease(event.id, ownerId, clock());
    const eventReceipts = [...source.receipts, ...haltProvider.receipts];
    let committeeRetryAt: string | null = null;
    const beforeOpenAiCall: NonNullable<EquitySignalLabInput["beforeOpenAiCall"]> = async (reservation) => {
      if (input.beforeOpenAiCall && !await input.beforeOpenAiCall(reservation)) return false;
      const decision = await reserveCommitteeCall({ eventId: event.id, ownerId, now, reservation });
      committeeRetryAt = decision.nextRetryAt;
      return decision.allowed;
    };
    const effectiveAllowOpenAi = allowOpenAi && source.decisionGrade && !sourceExpiredWithoutEvidence;
    const report = sourceExpiredWithoutEvidence
      ? object({
          ok: true,
          checkedAt: now.toISOString(),
          status: "source_evidence_expired_unread",
          seriousSignalFound: false,
          actionableSignalFound: false,
          alertType: null,
          openAiCalled: false,
          candidateFingerprint: null,
          selectedCandidate: null,
          historicalPilot: null,
          tradingHaltSafety: { currentStateKnown: false },
          committee: null,
          blockers: ["The full decision-grade source remained unavailable for seven days. The discovery item was archived without analysis, history admission, or serious-signal authority."],
        })
      : object(await runEquitySignalLab({
          allowOpenAi: effectiveAllowOpenAi,
          fetchImpl: quotaAwareFetch,
          now,
          historicalSignals: history.records,
          requirePilotBeforeOpenAi: true,
          beforeOpenAiCall,
          targetedContext: {
            universe: exactIssuerUniverse(resolved, now),
            receipts: eventReceipts,
            providers: [...source.providers, haltProvider],
            secFilingDetails: object(source.diagnostics),
            historicalSignalsComplete: true,
            storedCompanyAnalysis: object(companyRefresh?.analysis ?? resolved.valueAnalysis),
          },
        }));
    const retryClassificationAllowsAi = event.source === "market_price" ? allowOpenAi : effectiveAllowOpenAi;
    if (retryableReport(report, retryClassificationAllowsAi) && eventAgeMs <= 7 * 24 * 60 * 60_000) {
      throw new RetryAtError(committeeRetryAt, `pr262_event_report_retry:${text(report.status) ?? "unknown"}`);
    }
    const resultPayload = {
      version: 1,
      kind: "pr262_targeted_event_job_result",
      event: resolved.event,
      companyPointer: {
        ticker: resolved.directoryEntry.ticker,
        cik: resolved.directoryEntry.cik,
        batchKey: resolved.directoryEntry.batchKey,
        analysisIndex: resolved.directoryEntry.analysisIndex,
        valueCycleId: resolved.directoryEntry.valueCycleId,
      },
      sourceDecisionGrade: source.decisionGrade,
      sourceDiagnostics: source.diagnostics,
      companyRefresh: companyRefresh ? {
        immutableKey: companyRefresh.immutableKey,
        latestKey: companyRefresh.latestKey,
        recovered: companyRefresh.recovered,
        analysis: companyRefresh.analysis,
      } : null,
      report,
      safety: { databaseWrites: false, publishing: false, notifications: false, trades: false, productionWrites: false },
    };
    await renewLease(event.id, ownerId, clock());
    const created = await writeVersionedJsonToR2(resultKey, resultPayload, { createOnly: true });
    const persisted = created.conflict
      ? await readExistingResult(resultKey, event.id)
      : validatedResultPayload(resultPayload, event.id, resultKey);
    if (!persisted) throw new Error("pr262_event_result_conflict_read_failed");
    const finalized = await finalizePersistedResult({ eventId: event.id, ownerId, resultKey, payload: persisted.payload, now, clock });
    return {
      ok: true,
      mode: "pr262_targeted_event_job",
      status: text(finalized.report.status) ?? "completed",
      checkedAt: finalized.checkedAt,
      eventsProcessed: 1,
      recoveredPersistedResult: created.conflict,
      ticker: String(finalized.pointer.ticker),
      cik: text(finalized.pointer.cik),
      sourceDecisionGrade: persisted.payload.sourceDecisionGrade === true,
      openAiCalled: finalized.report.openAiCalled === true,
      seriousSignalFound: finalized.report.seriousSignalFound === true,
      actionableSignalFound: finalized.report.actionableSignalFound === true,
      alertType: finalized.report.alertType ?? null,
      resultKey,
      outboxKey: finalized.outboxKey,
      historyWrite: finalized.historyWrite,
      costControl: {
        companiesOpened: 1,
        fullCompanyWarehouseRebuilds: 0,
        broadEventFeedPolls: 0,
        affectedCompanyValuationRefreshes: companyRefresh ? 1 : 0,
        maximumCommitteeCallsPer24Hours: MAX_COMMITTEE_CALLS_PER_DAY,
        pilotGateRunsBeforeCommittee: true,
        durableProviderBudgets: true,
      },
      safety: { databaseWrites: false, publishing: false, notifications: false, trades: false },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 240) : "pr262_event_job_failed";
    await releaseLease(event.id, ownerId, clock()).catch(() => null);
    const requestedRetryAt = error instanceof ProviderBudgetError || error instanceof RetryAtError ? Date.parse(error.nextRetryAt ?? "") : Number.NaN;
    const nextRetryAt = new Date(Number.isFinite(requestedRetryAt) && requestedRetryAt > now.getTime()
      ? requestedRetryAt
      : now.getTime() + retryDelay(event)).toISOString();
    await retryPr262PendingSensorEvent({ eventId: event.id, error: message, nextRetryAt, attemptedAt: now }).catch(() => null);
    throw new Error(`${message}; next_retry_at=${nextRetryAt}`);
  }
}

export const PR262_EVENT_JOB_KEYS = { STATE_KEY, LATEST_KEY, RUN_PREFIX, OUTBOX_PREFIX, HISTORY_KEY } as const;
