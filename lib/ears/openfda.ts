import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { writeRawSignal, type RawSignalImportanceHint } from "@/lib/raw-signal-writer";

export const OPENFDA_SOURCE = "openFDA";

const OPENFDA_BASE_URL = "https://api.fda.gov";
const DEFAULT_LIMIT_PER_ENDPOINT = 3;
const MAX_LIMIT_PER_ENDPOINT = 5;
const REQUEST_TIMEOUT_MS = 10_000;

type OpenFdaRecord = Record<string, unknown>;
type OpenFdaResponse = { results?: OpenFdaRecord[] };
type SourceHealthStatus = "connected" | "degraded" | "error";

type OpenFdaEndpoint = {
  key: string;
  path: string;
  sourceType: "regulatory";
  eventType: string;
  usefulLabel: string;
  sort?: string;
  search?: string;
};

type NormalizedOpenFdaEvent = {
  endpointKey: string;
  eventType: string;
  title: string;
  summary: string;
  sourceUrl: string;
  detectedAt: string | null;
  company: string | null;
  product: string | null;
  ticker: null;
  importanceHint: RawSignalImportanceHint;
  raw: OpenFdaRecord;
};

export type OpenFdaRunOptions = { dryRun?: boolean; limit?: number };
export type OpenFdaRunResult = {
  ok: boolean;
  source: typeof OPENFDA_SOURCE;
  dryRun: boolean;
  apiKeyConfigured: boolean;
  recordsChecked: number;
  rawSignalsCreated: number;
  duplicatesSkipped: number;
  rejected: number;
  errors: string[];
  sourceHealthStatus: SourceHealthStatus;
  responseTimeMs: number;
  applicationsChecked: number;
  signalsCreated: number;
};

const ENDPOINTS: OpenFdaEndpoint[] = [
  { key: "drug_enforcement", path: "/drug/enforcement.json", sourceType: "regulatory", eventType: "fda_drug_recall", usefulLabel: "FDA drug recall", sort: "report_date:desc" },
  { key: "device_enforcement", path: "/device/enforcement.json", sourceType: "regulatory", eventType: "fda_device_recall", usefulLabel: "FDA device recall", sort: "report_date:desc" },
  { key: "drug_event", path: "/drug/event.json", sourceType: "regulatory", eventType: "fda_drug_safety_event", usefulLabel: "FDA drug adverse event", sort: "receivedate:desc" },
  { key: "device_event", path: "/device/event.json", sourceType: "regulatory", eventType: "fda_device_safety_event", usefulLabel: "FDA device adverse event", sort: "date_received:desc" },
  { key: "drugsfda", path: "/drug/drugsfda.json", sourceType: "regulatory", eventType: "fda_regulatory_catalyst", usefulLabel: "FDA drug approval or submission", sort: "submissions.submission_status_date:desc" },
];

function capLimit(limit?: number) {
  if (!Number.isFinite(limit) || !limit || limit < 1) return DEFAULT_LIMIT_PER_ENDPOINT;
  return Math.min(Math.floor(limit), MAX_LIMIT_PER_ENDPOINT);
}

function clean(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => clean(item)).filter(Boolean) : [];
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return null;
}

function isRateLimitError(message: string) {
  return /\b(429|rate limit|too many requests)\b/i.test(message);
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message.split("\n")[0]?.slice(0, 180) || "openFDA request failed" : "openFDA request failed";
}

function objectAt(record: OpenFdaRecord, key: string) {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as OpenFdaRecord) : null;
}

function arrayAt(record: OpenFdaRecord, key: string) {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function normalizeDate(value: unknown) {
  const text = clean(value);
  if (!text) return null;
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T00:00:00Z`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00Z`;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function productsFromOpenFda(record: OpenFdaRecord) {
  const openfda = objectAt(record, "openfda");
  if (!openfda) return [];
  return [...stringArray(openfda.brand_name), ...stringArray(openfda.generic_name), ...stringArray(openfda.device_name)].filter(Boolean);
}

function companiesFromOpenFda(record: OpenFdaRecord) {
  const openfda = objectAt(record, "openfda");
  if (!openfda) return [];
  return [...stringArray(openfda.manufacturer_name), ...stringArray(openfda.sponsor_name)].filter(Boolean);
}

function normalizeDrugsFda(record: OpenFdaRecord, endpoint: OpenFdaEndpoint): NormalizedOpenFdaEvent | null {
  const products = arrayAt(record, "products").filter((item): item is OpenFdaRecord => typeof item === "object" && item !== null && !Array.isArray(item));
  const submissions = arrayAt(record, "submissions").filter((item): item is OpenFdaRecord => typeof item === "object" && item !== null && !Array.isArray(item));
  const latestSubmission = submissions.sort((left, right) => clean(right.submission_status_date).localeCompare(clean(left.submission_status_date)))[0];
  const applicationNumber = clean(record.application_number);
  const company = firstString(record.sponsor_name);
  const product = firstString(products[0]?.brand_name, products[0]?.drug_name) ?? "Unknown drug product";
  const status = firstString(latestSubmission?.submission_status, latestSubmission?.submission_type) ?? "FDA submission update";
  if (!applicationNumber || !company) return null;

  return {
    endpointKey: endpoint.key,
    eventType: endpoint.eventType,
    title: `${company} ${product} ${status}`.slice(0, 240),
    summary: `${endpoint.usefulLabel}: ${company} has Drugs@FDA application ${applicationNumber} for ${product} with latest status ${status}. Raw regulatory signal only; ticker mapping and review required.`,
    sourceUrl: `${OPENFDA_BASE_URL}${endpoint.path}?search=application_number:${encodeURIComponent(applicationNumber)}`,
    detectedAt: normalizeDate(latestSubmission?.submission_status_date),
    company,
    product,
    ticker: null,
    importanceHint: clean(status).toLowerCase().includes("approved") ? "high" : "medium",
    raw: record,
  };
}

function normalizeRecord(record: OpenFdaRecord, endpoint: OpenFdaEndpoint): NormalizedOpenFdaEvent | null {
  if (endpoint.key === "drugsfda") return normalizeDrugsFda(record, endpoint);

  const company = firstString(record.recalling_firm, record.firm_name, record.manufacturer_d_name, ...companiesFromOpenFda(record));
  const product = firstString(record.product_description, record.product_type, record.mdr_text?.toString(), ...productsFromOpenFda(record)) ?? endpoint.usefulLabel;
  const reason = firstString(record.reason_for_recall, record.event_type, record.classification, record.patient?.toString()) ?? endpoint.usefulLabel;
  const id = firstString(record.recall_number, record.event_id, record.safetyreportid, record.report_number) ?? `${endpoint.key}-${clean(record.report_date) || clean(record.receivedate) || clean(record.date_received)}`;
  const detectedAt = normalizeDate(firstString(record.report_date, record.recall_initiation_date, record.receivedate, record.date_received));
  if (!id || (!company && !product && !reason)) return null;

  const classification = clean(record.classification);
  const titleParts = [company, product, classification || endpoint.usefulLabel].filter(Boolean);
  return {
    endpointKey: endpoint.key,
    eventType: endpoint.eventType,
    title: titleParts.join(" — ").slice(0, 240),
    summary: `${endpoint.usefulLabel}: ${[reason, classification].filter(Boolean).join("; ")}. Company/ticker mapping may be unavailable; this is a raw regulatory signal only.`,
    sourceUrl: `${OPENFDA_BASE_URL}${endpoint.path}?search=${encodeURIComponent(id)}`,
    detectedAt,
    company,
    product,
    ticker: null,
    importanceHint: classification.toLowerCase().includes("class i") || endpoint.key.includes("event") ? "high" : "medium",
    raw: record,
  };
}

async function fetchEndpoint(endpoint: OpenFdaEndpoint, limit: number, apiKey: string | null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = new URL(`${OPENFDA_BASE_URL}${endpoint.path}`);
  url.searchParams.set("limit", String(limit));
  if (endpoint.sort) url.searchParams.set("sort", endpoint.sort);
  if (endpoint.search) url.searchParams.set("search", endpoint.search);
  if (apiKey) url.searchParams.set("api_key", apiKey);

  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`${endpoint.key} failed with status ${response.status}`);
    const body = (await response.json()) as OpenFdaResponse;
    return (body.results ?? []).map((record) => normalizeRecord(record, endpoint)).filter((event): event is NormalizedOpenFdaEvent => Boolean(event));
  } finally {
    clearTimeout(timeout);
  }
}

async function updateOpenFdaHealth(status: SourceHealthStatus, startedAt: number, errorMessage: string | null, notes: string) {
  if (!process.env.DATABASE_URL) return;
  const now = new Date();
  await prisma.sourceHealth.upsert({
    where: { source: OPENFDA_SOURCE },
    create: { source: OPENFDA_SOURCE, status, checkedAt: now, lastSuccessAt: status === "error" ? null : now, responseTimeMs: Date.now() - startedAt, errorMessage, usage: "Public openFDA regulatory ear; optional API key supported", notes },
    update: { status, checkedAt: now, lastSuccessAt: status === "error" ? undefined : now, responseTimeMs: Date.now() - startedAt, errorMessage, usage: "Public openFDA regulatory ear; optional API key supported", notes },
  });
}

export async function runOpenFdaIngestion(options: OpenFdaRunOptions = {}): Promise<OpenFdaRunResult> {
  const startedAt = Date.now();
  const dryRun = options.dryRun !== false;
  const apiKey = process.env.OPENFDA_API_KEY?.trim() || null;
  const errors: string[] = [];
  let recordsChecked = 0;
  let rawSignalsCreated = 0;
  let duplicatesSkipped = 0;
  let rejected = 0;

  for (const endpoint of ENDPOINTS) {
    try {
      const events = await fetchEndpoint(endpoint, capLimit(options.limit), apiKey);
      recordsChecked += events.length;
      for (const event of events) {
        const rawPayload = JSON.parse(JSON.stringify({ ...event, noFinalAlerts: true, requiresTickerMapping: true })) as Prisma.InputJsonObject;
        const result = await writeRawSignal({
          sourceName: OPENFDA_SOURCE,
          sourceType: "regulatory",
          eventType: event.eventType,
          title: event.title,
          summary: event.summary,
          url: event.sourceUrl,
          ticker: event.ticker,
          company: event.company,
          detectedAt: event.detectedAt,
          duplicateKey: `${OPENFDA_SOURCE}|${event.endpointKey}|${event.sourceUrl}|${event.title}`,
          dryRun,
          qualityHints: { useful: true, importanceHint: event.importanceHint, confidence: 0.74, sourceQuality: "high", reasons: ["openFDA public API", "raw regulatory event", event.product ? `product:${event.product}` : "product unavailable"] },
          rawPayload,
        });
        if (result.status === "saved") rawSignalsCreated += 1;
        if (result.status === "skipped" && result.reason === "duplicate") duplicatesSkipped += 1;
        if (result.status === "rejected") rejected += 1;
      }
    } catch (error) {
      errors.push(safeError(error));
    }
  }

  const allRequestsFailed = errors.length === ENDPOINTS.length;
  const allFailuresWereRateLimits = allRequestsFailed && errors.every(isRateLimitError);
  const sourceHealthStatus: SourceHealthStatus = allRequestsFailed && !allFailuresWereRateLimits ? "error" : errors.length || recordsChecked === 0 ? "degraded" : "connected";
  await updateOpenFdaHealth(sourceHealthStatus, startedAt, errors[0] ?? null, `Checked ${recordsChecked} small-batch openFDA records across recalls, adverse events, and Drugs@FDA approvals/submissions; no alerts published.`);

  return { ok: sourceHealthStatus !== "error", source: OPENFDA_SOURCE, dryRun, apiKeyConfigured: Boolean(apiKey), recordsChecked, rawSignalsCreated, duplicatesSkipped, rejected, errors, sourceHealthStatus, responseTimeMs: Date.now() - startedAt, applicationsChecked: recordsChecked, signalsCreated: rawSignalsCreated };
}
