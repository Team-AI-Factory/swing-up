import crypto from "node:crypto";
import {
  listR2ObjectKeys,
  readVersionedTextFromR2,
  writeVersionedJsonToR2,
  type VersionedR2Object,
} from "@/lib/r2-warehouse";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";
import { isPr262ApprovedPremergeProductionRollout } from "@/lib/opportunity-engine/pr262-runtime";

const PR262_BRANCH = "agent/combined-opportunity-engine";
const ALLOWED_KINDS = new Set([
  "pr262_committee_verified_event_signal",
  "pr262_committee_verified_serious_watch_out",
]);
const OUTBOX_RELATIVE_PREFIXES = [
  "serious-signal/outbox/event-job",
  "serious-signal/outbox/watch-out-v2",
] as const;
const DELIVERY_RELATIVE_PREFIX = "serious-signal/delivery-v2";
const DELIVERY_LEASE_MS = 90_000;
const NO_CHANNEL_RECHECK_MS = 5 * 60_000;
const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_DELIVERY_MAX_AGE_MINUTES = 30;
const DISCOVERY_PAGE_SIZE_PER_PREFIX = 50;
const JOB_SCAN_PAGE_SIZE_MAX = 100;
const STATUS_FEED_PAGE_SIZE_PER_DAY = 100;
const STATUS_FEED_INDEX_CAPACITY = 500;
const LIVE_SENSOR_MAX_AGE_MS = 20 * 60_000;

type Json = Record<string, unknown>;
type DeliveryChannel = "telegram" | "webhook";
type DeliveryJobStatus =
  | "pending"
  | "sending"
  | "retry_scheduled"
  | "delivered"
  | "blocked_no_channel"
  | "preview_blocked"
  | "expired"
  | "dead_letter";
type ChannelStatus = "pending" | "not_configured" | "already_delivered" | "sent" | "failed" | "preview_blocked";

export type ChannelResult = {
  channel: DeliveryChannel;
  configured: boolean;
  sent: boolean;
  status: ChannelStatus;
  error: string | null;
  responseStatus?: number | null;
};

type DeliveryChannelState = {
  status: ChannelStatus;
  attempts: number;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  error: string | null;
  responseStatus: number | null;
};

type DeliveryJob = {
  version: 2;
  kind: "serious_signal_delivery_job";
  outboxKey: string;
  createdAt: string;
  updatedAt: string;
  status: DeliveryJobStatus;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  lease: { ownerId: string; expiresAt: string } | null;
  channels: Record<DeliveryChannel, DeliveryChannelState>;
  guarantee: "at_least_once_with_claim_receipt_and_webhook_idempotency_key";
};

type LoadedJob = { job: DeliveryJob; etag: string; key: string };
type DeliveryControl = { signal?: AbortSignal; deadlineAtMs?: number };
type StatusFeedPointer = {
  createdAt: string;
  outboxKey: string;
  deliveryJobKey: string;
};

function assertDeliveryActive(control: DeliveryControl, minimumRemainingMs = 0) {
  if (control.signal?.aborted) {
    throw control.signal.reason instanceof Error ? control.signal.reason : new Error("serious_signal_delivery_aborted");
  }
  if (Number.isFinite(control.deadlineAtMs) && Date.now() + minimumRemainingMs >= Number(control.deadlineAtMs)) {
    throw new Error("serious_signal_delivery_deadline_reserve");
  }
}

function deliveryRequestSignal(parent?: AbortSignal) {
  const timeout = AbortSignal.timeout(10_000);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function text(value: unknown, maximum = 4_000) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : null;
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateMs(value: unknown) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function integerEnvironment(name: string, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.floor(parsed))) : fallback;
}

function digest(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function normalizedCik(value: unknown) {
  const digits = text(value, 20)?.replace(/\D/g, "") ?? "";
  if (!digits || digits.length > 10 || /^0+$/.test(digits)) return null;
  return digits.replace(/^0+/, "");
}

function deliveryPrefix() {
  return pr262StorageKey(DELIVERY_RELATIVE_PREFIX);
}

function jobKey(outboxKey: string) {
  return `${deliveryPrefix()}/jobs/${digest(outboxKey)}.json`;
}

function receiptKey(outboxKey: string, channel: DeliveryChannel) {
  return `${deliveryPrefix()}/receipts/${channel}/${digest(outboxKey)}.json`;
}

function outboxPrefixes() {
  return OUTBOX_RELATIVE_PREFIXES.map((relative) => `${pr262StorageKey(relative)}/`);
}

function feedKey(outboxKey: string, createdAt: string) {
  const parsed = dateMs(createdAt) ?? Date.now();
  const timestamp = new Date(parsed).toISOString();
  const date = timestamp.slice(0, 10);
  const sortable = timestamp.replace(/[-:.]/g, "");
  return `${deliveryPrefix()}/feed/${date}/${sortable}-${digest(outboxKey)}.json`;
}

function feedIndexKey() {
  return `${deliveryPrefix()}/feed-index-v1.json`;
}

function sensorStateKey() {
  return pr262StorageKey("sensor/state-v1.json");
}

function sensorCadenceKey() {
  return pr262StorageKey("sensor/cadence-v1.json");
}

function blankChannelState(): DeliveryChannelState {
  return {
    status: "pending",
    attempts: 0,
    lastAttemptAt: null,
    deliveredAt: null,
    error: null,
    responseStatus: null,
  };
}

function validatedOutbox(raw: unknown, outboxKey: string) {
  const outbox = object(raw);
  const kind = text(outbox.kind);
  const ticker = text(outbox.ticker)?.toUpperCase();
  const alertType = text(outbox.alertType);
  const candidate = object(outbox.candidate);
  const committee = object(outbox.committee);
  const judge = object(committee.finalJudge);
  const output = object(committee.output);
  const authority = object(outbox.authority);
  const quote = object(candidate.quote);
  const createdAt = text(outbox.createdAt);
  const createdAtMs = dateMs(createdAt);

  if (!kind || !ALLOWED_KINDS.has(kind)) throw new Error("serious_signal_delivery_untrusted_outbox_kind");
  if (!createdAt || createdAtMs === null) throw new Error("serious_signal_delivery_invalid_created_at");
  if (!ticker || !/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) || !["buy", "sell", "watch_out"].includes(alertType ?? "")) {
    throw new Error("serious_signal_delivery_invalid_identity");
  }
  if (text(candidate.ticker, 20)?.toUpperCase() !== ticker
    || normalizedCik(candidate.cik) === null
    || normalizedCik(candidate.cik) !== normalizedCik(outbox.cik)
    || text(candidate.evidenceFingerprint) === null
    || text(outbox.candidateFingerprint) === null
    || candidate.evidenceFingerprint !== outbox.candidateFingerprint) {
    throw new Error("serious_signal_delivery_issuer_or_evidence_mismatch");
  }
  if (candidate.gatePassed !== true
    || Number(candidate.eventTruth) < 80
    || Number(candidate.mappingConfidence) < 95
    || Number(candidate.materiality) < 65
    || Number(candidate.transmissionConfidence) < 70
    || Number(candidate.evidenceIndependence) < 78
    || candidate.rumour === true
    || Number(candidate.contradictionPenalty) >= 50
    || Number(candidate.pricedInPenalty) >= 50) {
    throw new Error("serious_signal_delivery_current_evidence_not_approved");
  }
  const expectedDirection = alertType === "buy" ? "upside" : "downside";
  if (candidate.direction !== expectedDirection) throw new Error("serious_signal_delivery_direction_mismatch");
  const quoteObservedAtMs = dateMs(quote.observedAt);
  if ((finite(quote.price) ?? 0) <= 0
    || quote.actionableForSeriousSignal !== true
    || ["halted", "unknown"].includes(String(quote.marketSession ?? "unknown"))
    || quoteObservedAtMs === null
    || quoteObservedAtMs > createdAtMs + 5 * 60_000
    || createdAtMs - quoteObservedAtMs > 15 * 60_000) {
    throw new Error("serious_signal_delivery_market_state_not_actionable");
  }
  if (authority.exactIssuerMapping !== true
    || authority.currentEvidenceGatesPassed !== true
    || authority.freshQuoteAndHaltStateKnown !== true
    || Number(authority.fullCommitteeAgentsCompleted) !== 14
    || Number(authority.finalJudgePositiveMinimumConfidence) < 80
    || authority.historicalCasesRequired !== false) {
    throw new Error("serious_signal_delivery_authority_missing");
  }
  if (Number(committee.agentsCompleted) !== 14 || Number(committee.agentsFailed) !== 0) throw new Error("serious_signal_delivery_incomplete_committee");
  if (judge.verdict !== "positive" || Number(judge.confidence) < 80 || output.overallRecommendation !== "approve") {
    throw new Error("serious_signal_delivery_committee_not_approved");
  }
  return {
    outboxKey,
    outbox,
    kind,
    ticker,
    createdAt,
    alertType: alertType as "buy" | "sell" | "watch_out",
    candidate,
    committee,
    judge,
    output,
  };
}

function messageFor(input: ReturnType<typeof validatedOutbox>) {
  const event = text(input.candidate.eventHeadline) ?? text(input.candidate.whatHappened) ?? "Material event confirmed";
  const why = text(input.output.SwingUpView) ?? text(input.candidate.whatHappened) ?? "Current evidence passed the Serious Signal review.";
  const quote = object(input.candidate.quote);
  const price = finite(quote.price);
  const confidence = Number(input.judge.confidence);
  const label = input.alertType === "watch_out" ? "SERIOUS WATCH OUT" : `SERIOUS ${input.alertType.toUpperCase()}`;
  return [
    `Swing Up — ${label}`,
    `${input.ticker}${price !== null ? ` @ ${price}` : ""}`,
    "",
    event,
    "",
    why,
    "",
    `Final Judge confidence: ${Number.isFinite(confidence) ? confidence : "n/a"}/100`,
    "14/14 committee roles completed; current evidence gates passed.",
    "",
    "This is an automated Swing Up market alert, not a guarantee of outcome.",
  ].join("\n").slice(0, 3900);
}

function parseJob(value: unknown, expectedOutboxKey: string): DeliveryJob {
  const raw = object(value);
  if (raw.version !== 2 || raw.kind !== "serious_signal_delivery_job" || raw.outboxKey !== expectedOutboxKey) {
    throw new Error("serious_signal_delivery_job_invalid");
  }
  const rawChannels = object(raw.channels);
  const channel = (name: DeliveryChannel): DeliveryChannelState => {
    const stored = object(rawChannels[name]);
    const status = text(stored.status);
    return {
      status: (["pending", "not_configured", "already_delivered", "sent", "failed", "preview_blocked"].includes(status ?? "")
        ? status
        : "pending") as ChannelStatus,
      attempts: Math.max(0, Number(stored.attempts) || 0),
      lastAttemptAt: text(stored.lastAttemptAt),
      deliveredAt: text(stored.deliveredAt),
      error: text(stored.error),
      responseStatus: finite(stored.responseStatus),
    };
  };
  const rawLease = object(raw.lease);
  const lease = text(rawLease.ownerId) && text(rawLease.expiresAt)
    ? { ownerId: text(rawLease.ownerId) as string, expiresAt: text(rawLease.expiresAt) as string }
    : null;
  const rawStatus = text(raw.status);
  const validStatuses: DeliveryJobStatus[] = [
    "pending", "sending", "retry_scheduled", "delivered", "blocked_no_channel", "preview_blocked", "expired", "dead_letter",
  ];
  return {
    version: 2,
    kind: "serious_signal_delivery_job",
    outboxKey: expectedOutboxKey,
    createdAt: text(raw.createdAt) ?? new Date().toISOString(),
    updatedAt: text(raw.updatedAt) ?? new Date().toISOString(),
    status: validStatuses.includes(rawStatus as DeliveryJobStatus) ? rawStatus as DeliveryJobStatus : "pending",
    attempts: Math.max(0, Number(raw.attempts) || 0),
    nextAttemptAt: text(raw.nextAttemptAt),
    lastError: text(raw.lastError),
    lease,
    channels: { telegram: channel("telegram"), webhook: channel("webhook") },
    guarantee: "at_least_once_with_claim_receipt_and_webhook_idempotency_key",
  };
}

async function loadJob(key: string, expectedOutboxKey: string): Promise<LoadedJob | null> {
  const stored = await readVersionedTextFromR2(key);
  if (!stored.found || !stored.text || !stored.etag) return null;
  return { key, etag: stored.etag, job: parseJob(JSON.parse(stored.text), expectedOutboxKey) };
}

function parseFeedPointer(value: unknown): StatusFeedPointer | null {
  const raw = object(value);
  const createdAt = text(raw.createdAt, 64);
  const outboxKey = text(raw.outboxKey, 1_000);
  const deliveryJobKey = text(raw.deliveryJobKey, 1_000);
  if (!createdAt || dateMs(createdAt) === null || !outboxKey || !deliveryJobKey) return null;
  return { createdAt, outboxKey, deliveryJobKey };
}

async function updateFeedIndex(pointer: StatusFeedPointer) {
  const key = feedIndexKey();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const stored = await readVersionedTextFromR2(key);
    let prior: Json = {};
    if (stored.found && stored.text) {
      try { prior = object(JSON.parse(stored.text)); }
      catch {
        // Preserve an explicit incompleteness marker. The immutable daily
        // pointers remain the recovery source; a corrupt compact index must
        // never be replaced by an apparently complete one-item index.
        prior = { truncated: true };
      }
    }
    const priorPointers = Array.isArray(prior.pointers)
      ? prior.pointers.map(parseFeedPointer).filter((item): item is StatusFeedPointer => item !== null)
      : [];
    const merged = new Map(priorPointers.map((item) => [item.outboxKey, item]));
    const indexed = merged.get(pointer.outboxKey);
    if (indexed?.createdAt === pointer.createdAt && indexed.deliveryJobKey === pointer.deliveryJobKey) return;
    merged.set(pointer.outboxKey, pointer);
    const ordered = [...merged.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const payload = {
      version: 1,
      kind: "serious_signal_status_feed_index",
      updatedAt: new Date().toISOString(),
      capacity: STATUS_FEED_INDEX_CAPACITY,
      truncated: prior.truncated === true || ordered.length > STATUS_FEED_INDEX_CAPACITY,
      pointers: ordered.slice(0, STATUS_FEED_INDEX_CAPACITY),
    };
    const written = await writeVersionedJsonToR2(
      key,
      payload,
      stored.etag ? { expectedEtag: stored.etag } : { createOnly: true },
    );
    if (!written.conflict) return;
  }
  throw new Error("serious_signal_status_feed_index_conflict");
}

async function writeFeedPointer(validated: ReturnType<typeof validatedOutbox>, key: string) {
  const pointer: StatusFeedPointer = {
    createdAt: validated.createdAt,
    outboxKey: validated.outboxKey,
    deliveryJobKey: key,
  };
  await writeVersionedJsonToR2(feedKey(validated.outboxKey, validated.createdAt), {
    version: 1,
    kind: "serious_signal_status_feed_pointer",
    ...pointer,
  }, { createOnly: true });
  await updateFeedIndex(pointer);
}

async function ensureDeliveryJob(validated: ReturnType<typeof validatedOutbox>, now: Date) {
  const key = jobKey(validated.outboxKey);
  const existing = await loadJob(key, validated.outboxKey);
  if (existing) {
    await writeFeedPointer(validated, key);
    return existing;
  }
  const initial: DeliveryJob = {
    version: 2,
    kind: "serious_signal_delivery_job",
    outboxKey: validated.outboxKey,
    createdAt: validated.createdAt,
    updatedAt: now.toISOString(),
    status: "pending",
    attempts: 0,
    nextAttemptAt: now.toISOString(),
    lastError: null,
    lease: null,
    channels: { telegram: blankChannelState(), webhook: blankChannelState() },
    guarantee: "at_least_once_with_claim_receipt_and_webhook_idempotency_key",
  };
  await writeVersionedJsonToR2(key, initial, { createOnly: true });
  const loaded = await loadJob(key, validated.outboxKey);
  if (!loaded) throw new Error("serious_signal_delivery_job_create_read_failed");
  await writeFeedPointer(validated, key);
  return loaded;
}

function terminalStatus(status: DeliveryJobStatus) {
  return ["delivered", "preview_blocked", "expired", "dead_letter"].includes(status);
}

async function claimDeliveryJob(loaded: LoadedJob, now: Date, ownerId: string) {
  if (terminalStatus(loaded.job.status)) return null;
  const leaseExpiresAt = dateMs(loaded.job.lease?.expiresAt);
  if (loaded.job.status === "sending" && leaseExpiresAt !== null && leaseExpiresAt > now.getTime()) return null;
  const dueAt = dateMs(loaded.job.nextAttemptAt);
  if (dueAt !== null && dueAt > now.getTime()) return null;
  const next: DeliveryJob = {
    ...loaded.job,
    updatedAt: now.toISOString(),
    status: "sending",
    lease: { ownerId, expiresAt: new Date(now.getTime() + DELIVERY_LEASE_MS).toISOString() },
  };
  const written = await writeVersionedJsonToR2(loaded.key, next, { expectedEtag: loaded.etag });
  if (written.conflict || !written.etag) return null;
  return { key: loaded.key, etag: written.etag, job: next } satisfies LoadedJob;
}

async function persistClaimedJob(loaded: LoadedJob, job: DeliveryJob) {
  const written = await writeVersionedJsonToR2(loaded.key, job, { expectedEtag: loaded.etag });
  if (written.conflict || !written.etag) throw new Error("serious_signal_delivery_job_state_conflict");
  return { key: loaded.key, etag: written.etag, job } satisfies LoadedJob;
}

async function alreadyDelivered(key: string) {
  const current = await readVersionedTextFromR2(key);
  if (!current.found || !current.text) return false;
  try { return object(JSON.parse(current.text)).status === "sent"; }
  catch { return false; }
}

async function recordDelivery(input: {
  key: string;
  outboxKey: string;
  channel: DeliveryChannel;
  destination: string;
  responseStatus: number;
}) {
  const payload = {
    version: 2,
    kind: "serious_signal_delivery_receipt",
    status: "sent",
    deliveredAt: new Date().toISOString(),
    outboxKey: input.outboxKey,
    channel: input.channel,
    destination: input.destination,
    responseStatus: input.responseStatus,
    idempotencyKey: digest(input.outboxKey),
  };
  const written = await writeVersionedJsonToR2(input.key, payload, { createOnly: true });
  if (written.conflict && !await alreadyDelivered(input.key)) throw new Error("serious_signal_delivery_receipt_conflict");
}

function telegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_SERIOUS_SIGNAL_CHAT_ID?.trim());
}

function webhookConfigured() {
  return Boolean(process.env.SWING_UP_SERIOUS_SIGNAL_WEBHOOK_URL?.trim());
}

async function sendTelegram(outboxKey: string, message: string, signal?: AbortSignal): Promise<ChannelResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_SERIOUS_SIGNAL_CHAT_ID?.trim();
  if (!token || !chatId) return { channel: "telegram", configured: false, sent: false, status: "not_configured", error: null };
  const key = receiptKey(outboxKey, "telegram");
  if (await alreadyDelivered(key)) return { channel: "telegram", configured: true, sent: false, status: "already_delivered", error: null };
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true }),
      signal: deliveryRequestSignal(signal),
    });
    if (!response.ok) return { channel: "telegram", configured: true, sent: false, status: "failed", error: `telegram_http_${response.status}`, responseStatus: response.status };
    await recordDelivery({ key, outboxKey, channel: "telegram", destination: "configured_chat", responseStatus: response.status });
    return { channel: "telegram", configured: true, sent: true, status: "sent", error: null, responseStatus: response.status };
  } catch (error) {
    return {
      channel: "telegram",
      configured: true,
      sent: false,
      status: "failed",
      error: error instanceof Error ? error.message.replace(/bot[^/\s]+/gi, "bot[redacted]").slice(0, 160) : "telegram_send_failed",
    };
  }
}

async function sendWebhook(outboxKey: string, payload: Json, signal?: AbortSignal): Promise<ChannelResult> {
  const raw = process.env.SWING_UP_SERIOUS_SIGNAL_WEBHOOK_URL?.trim();
  if (!raw) return { channel: "webhook", configured: false, sent: false, status: "not_configured", error: null };
  let url: URL;
  try { url = new URL(raw); }
  catch { return { channel: "webhook", configured: true, sent: false, status: "failed", error: "webhook_url_invalid" }; }
  if (url.protocol !== "https:") return { channel: "webhook", configured: true, sent: false, status: "failed", error: "webhook_https_required" };
  const key = receiptKey(outboxKey, "webhook");
  if (await alreadyDelivered(key)) return { channel: "webhook", configured: true, sent: false, status: "already_delivered", error: null };
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `swing-up-${digest(outboxKey)}`,
        "x-swing-up-alert-id": digest(outboxKey),
      },
      body: JSON.stringify(payload),
      signal: deliveryRequestSignal(signal),
    });
    if (!response.ok) return { channel: "webhook", configured: true, sent: false, status: "failed", error: `webhook_http_${response.status}`, responseStatus: response.status };
    await recordDelivery({ key, outboxKey, channel: "webhook", destination: url.hostname, responseStatus: response.status });
    return { channel: "webhook", configured: true, sent: true, status: "sent", error: null, responseStatus: response.status };
  } catch (error) {
    return { channel: "webhook", configured: true, sent: false, status: "failed", error: error instanceof Error ? error.message.slice(0, 160) : "webhook_send_failed" };
  }
}

function stateFromResult(previous: DeliveryChannelState, result: ChannelResult, attemptedAt: string): DeliveryChannelState {
  const delivered = result.status === "sent" || result.status === "already_delivered";
  return {
    status: result.status,
    attempts: previous.attempts + (result.configured && result.status !== "already_delivered" ? 1 : 0),
    lastAttemptAt: result.configured ? attemptedAt : previous.lastAttemptAt,
    deliveredAt: delivered ? previous.deliveredAt ?? attemptedAt : previous.deliveredAt,
    error: result.error,
    responseStatus: result.responseStatus ?? previous.responseStatus,
  };
}

function retryDelayMs(attempt: number) {
  return Math.min(6 * 60 * 60_000, 60_000 * (2 ** Math.min(8, Math.max(0, attempt - 1))));
}

function responseFromJob(
  job: DeliveryJob,
  validated: ReturnType<typeof validatedOutbox>,
  message: string,
  channelResults: ChannelResult[] = [],
) {
  return {
    ok: job.status === "delivered",
    outboxKey: validated.outboxKey,
    seriousSignal: true,
    ticker: validated.ticker,
    alertType: validated.alertType,
    message,
    deliveryStatus: job.status,
    attempts: job.attempts,
    nextAttemptAt: job.nextAttemptAt,
    lastError: job.lastError,
    channels: channelResults,
    deliveryGuarantee: job.guarantee,
    exactlyOnceExternallyGuaranteed: false,
  };
}

async function processDeliveryJobKey(
  key: string,
  outboxKey: string,
  options: { now?: Date; ownerId?: string } & DeliveryControl = {},
) {
  assertDeliveryActive(options, 2_000);
  const now = options.now ?? new Date();
  const ownerId = options.ownerId ?? `delivery-${crypto.randomUUID()}`;
  const storedOutbox = await readVersionedTextFromR2(outboxKey);
  if (!storedOutbox.found || !storedOutbox.text) throw new Error("serious_signal_delivery_outbox_missing");
  const validated = validatedOutbox(JSON.parse(storedOutbox.text), outboxKey);
  const message = messageFor(validated);
  const current = await loadJob(key, outboxKey) ?? await ensureDeliveryJob(validated, now);
  const claimed = await claimDeliveryJob(current, now, ownerId);
  if (!claimed) return responseFromJob(current.job, validated, message);

  if (process.env.RAILWAY_GIT_BRANCH?.trim() === PR262_BRANCH
    && !isPr262ApprovedPremergeProductionRollout()) {
    const previewJob: DeliveryJob = {
      ...claimed.job,
      updatedAt: now.toISOString(),
      status: "preview_blocked",
      nextAttemptAt: null,
      lastError: "serious_signal_delivery_preview_blocked",
      lease: null,
      channels: {
        telegram: { ...claimed.job.channels.telegram, status: "preview_blocked", error: null },
        webhook: { ...claimed.job.channels.webhook, status: "preview_blocked", error: null },
      },
    };
    const persisted = await persistClaimedJob(claimed, previewJob);
    return responseFromJob(persisted.job, validated, message, [
      { channel: "telegram", configured: telegramConfigured(), sent: false, status: "preview_blocked", error: null },
      { channel: "webhook", configured: webhookConfigured(), sent: false, status: "preview_blocked", error: null },
    ]);
  }

  const createdAtMs = dateMs(validated.createdAt) as number;
  // The authenticated web feed keeps 48 hours of history, but a notification
  // must still be timely. Never recover an old queue item as though its stored
  // quote and priced-in check were current.
  const maxAgeMs = integerEnvironment(
    "SWING_UP_SERIOUS_SIGNAL_DELIVERY_MAX_AGE_MINUTES",
    DEFAULT_DELIVERY_MAX_AGE_MINUTES,
    5,
    120,
  ) * 60_000;
  if (now.getTime() - createdAtMs > maxAgeMs || createdAtMs > now.getTime() + 5 * 60_000) {
    const expired: DeliveryJob = {
      ...claimed.job,
      updatedAt: now.toISOString(),
      status: "expired",
      nextAttemptAt: null,
      lastError: createdAtMs > now.getTime() + 5 * 60_000
        ? "serious_signal_delivery_created_at_in_future"
        : "serious_signal_delivery_window_expired",
      lease: null,
    };
    const persisted = await persistClaimedJob(claimed, expired);
    return responseFromJob(persisted.job, validated, message);
  }

  const configured = telegramConfigured() || webhookConfigured();
  if (!configured) {
    const blocked: DeliveryJob = {
      ...claimed.job,
      updatedAt: now.toISOString(),
      status: "blocked_no_channel",
      nextAttemptAt: new Date(now.getTime() + NO_CHANNEL_RECHECK_MS).toISOString(),
      lastError: "serious_signal_delivery_no_channel_configured",
      lease: null,
      channels: {
        telegram: { ...claimed.job.channels.telegram, status: "not_configured", error: null },
        webhook: { ...claimed.job.channels.webhook, status: "not_configured", error: null },
      },
    };
    const persisted = await persistClaimedJob(claimed, blocked);
    return responseFromJob(persisted.job, validated, message, [
      { channel: "telegram", configured: false, sent: false, status: "not_configured", error: null },
      { channel: "webhook", configured: false, sent: false, status: "not_configured", error: null },
    ]);
  }

  const notificationPayload = {
    version: 2,
    kind: "swing_up_serious_signal_notification",
    alertId: digest(outboxKey),
    createdAt: validated.createdAt,
    ticker: validated.ticker,
    alertType: validated.alertType,
    eventHeadline: text(validated.candidate.eventHeadline) ?? text(validated.candidate.whatHappened),
    finalJudgeConfidence: Number(validated.judge.confidence),
    message,
  };
  let persisted = claimed;
  const results: ChannelResult[] = [];
  const channelSenders: Array<[DeliveryChannel, () => Promise<ChannelResult>]> = [
    ["telegram", () => sendTelegram(outboxKey, message, options.signal)],
    ["webhook", () => sendWebhook(outboxKey, notificationPayload, options.signal)],
  ];
  for (const [channel, send] of channelSenders) {
    assertDeliveryActive(options, 12_000);
    const prior = persisted.job.channels[channel];
    if (prior.status === "sent" || prior.status === "already_delivered") continue;
    const result = await send();
    results.push(result);
    const updated: DeliveryJob = {
      ...persisted.job,
      updatedAt: now.toISOString(),
      channels: {
        ...persisted.job.channels,
        [channel]: stateFromResult(prior, result, now.toISOString()),
      },
    };
    persisted = await persistClaimedJob(persisted, updated);
  }

  const configuredStates = (["telegram", "webhook"] as DeliveryChannel[])
    .filter((channel) => channel === "telegram" ? telegramConfigured() : webhookConfigured())
    .map((channel) => persisted.job.channels[channel]);
  const failures = configuredStates.filter((channel) => channel.status === "failed");
  const allDelivered = configuredStates.length > 0 && configuredStates.every((channel) => channel.status === "sent" || channel.status === "already_delivered");
  const attempts = persisted.job.attempts + (results.some((result) => result.configured && result.status !== "already_delivered") ? 1 : 0);
  const maxAttempts = integerEnvironment("SWING_UP_SERIOUS_SIGNAL_DELIVERY_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS, 1, 20);
  const status: DeliveryJobStatus = allDelivered ? "delivered" : attempts >= maxAttempts ? "dead_letter" : "retry_scheduled";
  const lastError = failures.map((failure) => failure.error).filter(Boolean).join("; ") || (allDelivered ? null : "serious_signal_delivery_incomplete");
  const finalized: DeliveryJob = {
    ...persisted.job,
    updatedAt: now.toISOString(),
    status,
    attempts,
    nextAttemptAt: status === "retry_scheduled" ? new Date(now.getTime() + retryDelayMs(attempts)).toISOString() : null,
    lastError,
    lease: null,
  };
  persisted = await persistClaimedJob(persisted, finalized);
  return responseFromJob(persisted.job, validated, message, results);
}

async function listKeysBounded(prefix: string, maximum: number) {
  const keys: string[] = [];
  let continuationToken: string | null = null;
  let truncated = false;
  do {
    const remaining = maximum - keys.length;
    if (remaining <= 0) break;
    const page = await listR2ObjectKeys(prefix, { limit: Math.min(1_000, remaining), continuationToken });
    keys.push(...page.keys);
    truncated = page.isTruncated;
    continuationToken = page.nextContinuationToken;
  } while (truncated && continuationToken && keys.length < maximum);
  return { keys, truncated: truncated && keys.length >= maximum };
}

type DeliveryCursor = {
  version: 1;
  kind: "serious_signal_delivery_cursor";
  updatedAt: string;
  tokens: Record<string, string | null>;
};

async function loadCursor(name: "outbox" | "jobs") {
  const key = `${deliveryPrefix()}/cursors/${name}-v1.json`;
  const stored = await readVersionedTextFromR2(key);
  if (!stored.found || !stored.text) {
    return {
      key,
      etag: null,
      cursor: { version: 1, kind: "serious_signal_delivery_cursor", updatedAt: new Date(0).toISOString(), tokens: {} } satisfies DeliveryCursor,
    };
  }
  const raw = object(JSON.parse(stored.text));
  const rawTokens = object(raw.tokens);
  const tokens = Object.fromEntries(Object.entries(rawTokens).map(([tokenName, value]) => [tokenName, text(value)]));
  return {
    key,
    etag: stored.etag,
    cursor: { version: 1, kind: "serious_signal_delivery_cursor", updatedAt: text(raw.updatedAt) ?? new Date(0).toISOString(), tokens } satisfies DeliveryCursor,
  };
}

async function saveCursor(
  loaded: Awaited<ReturnType<typeof loadCursor>>,
  tokens: Record<string, string | null>,
  now: Date,
) {
  const next: DeliveryCursor = {
    version: 1,
    kind: "serious_signal_delivery_cursor",
    updatedAt: now.toISOString(),
    tokens,
  };
  const written = await writeVersionedJsonToR2(
    loaded.key,
    next,
    loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true },
  );
  return { written: written.written, conflict: written.conflict };
}

async function listCursorPage(prefix: string, limit: number, continuationToken: string | null) {
  try {
    return await listR2ObjectKeys(prefix, { limit, continuationToken });
  } catch (error) {
    if (!continuationToken) throw error;
    // R2 continuation tokens are opaque and may expire. Resetting only this
    // bounded page safely restarts the circular scan without dropping work.
    return listR2ObjectKeys(prefix, { limit });
  }
}

async function readAndValidateOutbox(outboxKey: string) {
  const stored = await readVersionedTextFromR2(outboxKey);
  if (!stored.found || !stored.text) throw new Error("serious_signal_delivery_outbox_missing");
  return validatedOutbox(JSON.parse(stored.text), outboxKey);
}

export async function discoverSeriousSignalDeliveries(options: { now?: Date } & DeliveryControl = {}) {
  assertDeliveryActive(options, 5_000);
  const now = options.now ?? new Date();
  const outboxKeys: string[] = [];
  let truncated = false;
  const loadedCursor = await loadCursor("outbox");
  const nextTokens = { ...loadedCursor.cursor.tokens };
  for (const [index, prefix] of outboxPrefixes().entries()) {
    assertDeliveryActive(options, 5_000);
    const tokenName = `outbox_${index}`;
    const page = await listCursorPage(prefix, DISCOVERY_PAGE_SIZE_PER_PREFIX, loadedCursor.cursor.tokens[tokenName] ?? null);
    outboxKeys.push(...page.keys.filter((key) => key.endsWith(".json")));
    truncated ||= page.isTruncated;
    nextTokens[tokenName] = page.isTruncated ? page.nextContinuationToken : null;
  }
  let jobsCreatedOrConfirmed = 0;
  const errors: string[] = [];
  for (const outboxKey of [...new Set(outboxKeys)]) {
    assertDeliveryActive(options, 5_000);
    try {
      const validated = await readAndValidateOutbox(outboxKey);
      await ensureDeliveryJob(validated, now);
      jobsCreatedOrConfirmed += 1;
    } catch (error) {
      errors.push(error instanceof Error ? error.message.slice(0, 160) : "serious_signal_delivery_discovery_failed");
    }
  }
  const cursor = await saveCursor(loadedCursor, nextTokens, now);
  return {
    outboxesFound: outboxKeys.length,
    jobsCreatedOrConfirmed,
    truncated,
    maximumOutboxesInspectedPerCycle: DISCOVERY_PAGE_SIZE_PER_PREFIX * OUTBOX_RELATIVE_PREFIXES.length,
    maximumOutboxObjectReadsPerCycle: DISCOVERY_PAGE_SIZE_PER_PREFIX * OUTBOX_RELATIVE_PREFIXES.length * 3,
    cursor,
    errors: errors.slice(0, 20),
  };
}

/**
 * Durable delivery consumer. Invoke once per Railway analysis cycle. It first
 * discovers committee-approved outboxes, then claims and retries due jobs.
 */
export async function processPendingSeriousSignalDeliveries(options: {
  maxJobs?: number;
  now?: Date;
  ownerId?: string;
} & DeliveryControl = {}) {
  assertDeliveryActive(options, 15_000);
  const now = options.now ?? new Date();
  const ownerId = options.ownerId ?? `delivery-consumer-${crypto.randomUUID()}`;
  const maximumJobs = Math.max(1, Math.min(25, Math.floor(options.maxJobs ?? 8)));
  const discovery = await discoverSeriousSignalDeliveries({ now, signal: options.signal, deadlineAtMs: options.deadlineAtMs });
  assertDeliveryActive(options, 10_000);
  const loadedJobCursor = await loadCursor("jobs");
  const jobPageSize = Math.max(25, Math.min(JOB_SCAN_PAGE_SIZE_MAX, maximumJobs * 4));
  const listed = await listCursorPage(
    `${deliveryPrefix()}/jobs/`,
    jobPageSize,
    loadedJobCursor.cursor.tokens.jobs ?? null,
  );
  const due: Array<{ key: string; job: DeliveryJob }> = [];
  let deadLetterVisible = 0;
  let blockedNoChannelVisible = 0;
  for (const key of listed.keys.filter((value) => value.endsWith(".json"))) {
    assertDeliveryActive(options, 10_000);
    const stored = await readVersionedTextFromR2(key);
    if (!stored.found || !stored.text) continue;
    const raw = object(JSON.parse(stored.text));
    const outboxKey = text(raw.outboxKey);
    if (!outboxKey) continue;
    const job = parseJob(raw, outboxKey);
    if (job.status === "dead_letter") deadLetterVisible += 1;
    if (job.status === "blocked_no_channel") blockedNoChannelVisible += 1;
    if (terminalStatus(job.status)) continue;
    const leaseUntil = dateMs(job.lease?.expiresAt);
    if (job.status === "sending" && leaseUntil !== null && leaseUntil > now.getTime()) continue;
    const dueAt = dateMs(job.nextAttemptAt);
    if (dueAt !== null && dueAt > now.getTime()) continue;
    due.push({ key, job });
  }
  due.sort((left, right) => (dateMs(left.job.nextAttemptAt) ?? 0) - (dateMs(right.job.nextAttemptAt) ?? 0));
  const results: Array<Awaited<ReturnType<typeof processDeliveryJobKey>>> = [];
  const errors: string[] = [];
  for (const item of due.slice(0, maximumJobs)) {
    assertDeliveryActive(options, 12_000);
    try {
      results.push(await processDeliveryJobKey(item.key, item.job.outboxKey, {
        now,
        ownerId,
        signal: options.signal,
        deadlineAtMs: options.deadlineAtMs,
      }));
    } catch (error) {
      errors.push(error instanceof Error ? error.message.slice(0, 180) : "serious_signal_delivery_consumer_failed");
    }
  }
  const jobCursorToken = due.length > maximumJobs
    ? loadedJobCursor.cursor.tokens.jobs ?? null
    : listed.isTruncated ? listed.nextContinuationToken : null;
  const jobCursor = await saveCursor(loadedJobCursor, { ...loadedJobCursor.cursor.tokens, jobs: jobCursorToken }, now);
  return {
    ok: errors.length === 0 && discovery.errors.length === 0 && deadLetterVisible === 0 && blockedNoChannelVisible === 0,
    checkedAt: now.toISOString(),
    discovery,
    queuePageTruncated: listed.isTruncated,
    maximumJobStateReadsPerCycle: jobPageSize,
    jobCursor,
    dueJobs: due.length,
    jobsAttempted: results.length,
    delivered: results.filter((result) => result.deliveryStatus === "delivered").length,
    retryScheduled: results.filter((result) => result.deliveryStatus === "retry_scheduled").length,
    blockedNoChannel: results.filter((result) => result.deliveryStatus === "blocked_no_channel").length,
    expired: results.filter((result) => result.deliveryStatus === "expired").length,
    deadLetterVisible: deadLetterVisible + results.filter((result) => result.deliveryStatus === "dead_letter").length,
    blockedNoChannelVisible,
    errors,
    deliveryGuarantee: "at_least_once_with_claim_receipt_and_webhook_idempotency_key",
    exactlyOnceExternallyGuaranteed: false,
  };
}

export async function deliverSeriousSignalOutbox(
  outboxKey: string | null | undefined,
  options: { now?: Date; ownerId?: string } & DeliveryControl = {},
) {
  if (!outboxKey) return {
    ok: true,
    outboxKey: null,
    seriousSignal: false,
    channels: [] as ChannelResult[],
    deliveryGuarantee: "not_applicable",
    exactlyOnceExternallyGuaranteed: false,
  };
  assertDeliveryActive(options, 12_000);
  const now = options.now ?? new Date();
  const validated = await readAndValidateOutbox(outboxKey);
  const job = await ensureDeliveryJob(validated, now);
  return processDeliveryJobKey(job.key, outboxKey, {
    now,
    ownerId: options.ownerId,
    signal: options.signal,
    deadlineAtMs: options.deadlineAtMs,
  });
}

function safeEvidenceUrls(candidate: Json) {
  const receipts = Array.isArray(candidate.receipts) ? candidate.receipts : [];
  const urls: Array<{ source: string | null; url: string }> = [];
  for (const item of receipts.slice(0, 8)) {
    const receipt = object(item);
    const rawUrl = text(receipt.url) ?? text(receipt.sourceUrl) ?? text(receipt.receiptUrl);
    if (!rawUrl) continue;
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== "https:" || url.username || url.password) continue;
      for (const key of [...url.searchParams.keys()]) {
        if (/(?:api.?key|token|secret|signature|authorization|credential|password)/i.test(key)) url.searchParams.delete(key);
      }
      url.hash = "";
      urls.push({ source: text(receipt.publisher) ?? text(receipt.source), url: url.toString() });
    } catch { continue; }
    if (urls.length >= 3) break;
  }
  return urls;
}

function utcDates(start: Date, end: Date) {
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  while (cursor.getTime() <= last && dates.length < 8) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

async function readJson(stored: VersionedR2Object) {
  return stored.found && stored.text ? object(JSON.parse(stored.text)) : null;
}

async function readStatusFeedPointers(start: Date, now: Date) {
  const indexed = await readVersionedTextFromR2(feedIndexKey());
  if (indexed.found && indexed.text) {
    try {
      const raw = object(JSON.parse(indexed.text));
      if (raw.version === 1
        && raw.kind === "serious_signal_status_feed_index"
        && raw.truncated !== true
        && Array.isArray(raw.pointers)) {
        const pointers = raw.pointers
          .map(parseFeedPointer)
          .filter((item): item is StatusFeedPointer => item !== null)
          .filter((item) => {
            const created = dateMs(item.createdAt);
            return created !== null && created >= start.getTime() && created <= now.getTime() + 5 * 60_000;
          });
        return { pointers, truncated: false, source: "bounded_feed_index" as const };
      }
    } catch {
      // Fall back to immutable daily pointers so a damaged index cannot turn
      // a real alert window into a false empty result.
    }
  }

  const pointers: StatusFeedPointer[] = [];
  let truncated = false;
  for (const date of utcDates(start, now)) {
    const listed = await listKeysBounded(`${deliveryPrefix()}/feed/${date}/`, STATUS_FEED_PAGE_SIZE_PER_DAY);
    truncated ||= listed.truncated;
    for (const key of listed.keys.filter((value) => value.endsWith(".json"))) {
      try {
        const pointer = parseFeedPointer(await readJson(await readVersionedTextFromR2(key)));
        if (pointer) pointers.push(pointer);
      } catch { continue; }
    }
  }
  return { pointers, truncated, source: "immutable_pointer_fallback" as const };
}

async function liveSensorStatus(now: Date) {
  try {
    const [stored, storedCadence] = await Promise.all([
      readVersionedTextFromR2(sensorStateKey()),
      readVersionedTextFromR2(sensorCadenceKey()),
    ]);
    if ((!stored.found || !stored.text) && (!storedCadence.found || !storedCadence.text)) {
      return { verifiedLive: false, coverageVerified: false, stateFound: false, owner: null, lastScanAt: null, ageMinutes: null, reason: "sensor_state_missing", coverageReason: "sensor_state_missing", sourceStatusCounts: {}, criticalSources: {}, readiness: null };
    }
    let state = stored.found && stored.text
      ? object(JSON.parse(stored.text))
      : { version: 2, updatedAt: new Date(0).toISOString(), sourceHealth: {}, sensorReadiness: {}, cloudflareSensor: null };
    if (state.version !== 2) {
      return { verifiedLive: false, coverageVerified: false, stateFound: true, owner: null, lastScanAt: null, ageMinutes: null, reason: "sensor_state_contract_invalid", coverageReason: "sensor_state_contract_invalid", sourceStatusCounts: {}, criticalSources: {}, readiness: null };
    }
    const cloudflare = object(state.cloudflareSensor);
    const cloudflareOwner = text(cloudflare.owner, 64);
    if (cloudflareOwner && cloudflareOwner !== "cloudflare_worker") {
      return { verifiedLive: false, coverageVerified: false, stateFound: true, owner: null, lastScanAt: null, ageMinutes: null, reason: "sensor_owner_invalid", coverageReason: "sensor_owner_invalid", sourceStatusCounts: {}, criticalSources: {}, readiness: null };
    }
    if (!cloudflareOwner && storedCadence.found && storedCadence.text) {
      const cadence = object(JSON.parse(storedCadence.text));
      if (cadence.version === 1) {
        state = {
          ...state,
          updatedAt: cadence.updatedAt ?? state.updatedAt,
          sourceHealth: cadence.sourceHealth ?? state.sourceHealth,
          sensorReadiness: cadence.sensorReadiness ?? state.sensorReadiness,
        };
      }
    }
    const sourceHealth = object(state.sourceHealth);
    const readinessRaw = object(state.sensorReadiness);
    const readiness = {
      universeReady: readinessRaw.version === 1 && readinessRaw.universeReady === true && Number(readinessRaw.universeEntries) > 0,
      universeEntries: Math.max(0, Number(readinessRaw.universeEntries) || 0),
      exposureReady: readinessRaw.version === 1 && readinessRaw.exposureReady === true && Number(readinessRaw.exposureEntries) > 0,
      exposureEntries: Math.max(0, Number(readinessRaw.exposureEntries) || 0),
    };
    const owner = cloudflareOwner === "cloudflare_worker" ? "cloudflare_worker" : "railway";
    // Analysis acknowledgements also update the shared state object. They are
    // not sensor scans, so a Cloudflare-owned deployment must be dated only by
    // the Worker's explicit heartbeat. Otherwise Railway recovery work could
    // make a stopped Worker appear freshly live.
    const ownerTimestamp = owner === "cloudflare_worker"
      ? text(cloudflare.checkedAt, 64)
      : text(state.updatedAt, 64);
    const timestamps = [ownerTimestamp].flatMap((value) => {
      const parsed = dateMs(value);
      return parsed === null || parsed > now.getTime() + 5 * 60_000 ? [] : [parsed];
    });
    const latestMs = timestamps.length ? Math.max(...timestamps) : null;
    const ageMs = latestMs === null ? null : Math.max(0, now.getTime() - latestMs);
    const sourceStatusCounts = Object.values(sourceHealth).reduce<Record<string, number>>((counts, item) => {
      const status = text(object(item).status, 64) ?? "unknown";
      counts[status] = (counts[status] ?? 0) + 1;
      return counts;
    }, {});
    const criticalKeys = owner === "cloudflare_worker"
      ? ["cf_sec_broad", "cf_sec_urgent", "cf_google_news", "cf_trade_halts"]
      : ["v3_sec_broad", "v3_sec_urgent", "v3_google_news", "v3_trade_halts"];
    const criticalSources = Object.fromEntries(criticalKeys.map((key) => {
      const lane = object(sourceHealth[key]);
      const successAt = dateMs(lane.lastSuccessAt) ?? (["connected", "partial"].includes(String(lane.status)) ? dateMs(lane.checkedAt) : null);
      // Partial feeds may still produce candidates, but they cannot prove an
      // empty 48-hour window. Zero-alert certification requires every critical
      // lane to complete the current scan without invalid records.
      const currentScanSucceeded = lane.status === "connected"
        && lane.attemptedThisCycle === true;
      const fresh = currentScanSucceeded
        && successAt !== null
        && successAt <= now.getTime() + 5 * 60_000
        && now.getTime() - successAt <= LIVE_SENSOR_MAX_AGE_MS;
      return [key, { fresh, currentScanSucceeded, lastSuccessAt: successAt === null ? null : new Date(successAt).toISOString() }];
    }));
    const criticalCoverageReady = Object.values(criticalSources).every((lane) => lane.fresh);
    const verifiedLive = ageMs !== null && ageMs <= LIVE_SENSOR_MAX_AGE_MS;
    const coverageVerified = verifiedLive
      && readiness.universeReady
      && readiness.exposureReady
      && criticalCoverageReady;
    const coverageReason = !verifiedLive
      ? "sensor_scan_stale_or_missing"
      : !readiness.universeReady ? "sensor_universe_not_ready"
        : !readiness.exposureReady ? "sensor_exposure_not_ready"
          : !criticalCoverageReady ? "critical_source_coverage_not_fresh"
            : null;
    return {
      verifiedLive,
      coverageVerified,
      stateFound: true,
      owner,
      lastScanAt: latestMs === null ? null : new Date(latestMs).toISOString(),
      ageMinutes: ageMs === null ? null : Math.round(ageMs / 6_000) / 10,
      reason: latestMs === null || ageMs === null ? "sensor_scan_timestamp_missing" : ageMs <= LIVE_SENSOR_MAX_AGE_MS ? null : "sensor_scan_stale",
      coverageReason,
      sourceStatusCounts,
      criticalSources,
      readiness,
    };
  } catch {
    return { verifiedLive: false, coverageVerified: false, stateFound: true, owner: null, lastScanAt: null, ageMinutes: null, reason: "sensor_state_invalid", coverageReason: "sensor_state_invalid", sourceStatusCounts: {}, criticalSources: {}, readiness: null };
  }
}

/** Returns only sanitized fields intended for an authenticated web/app view. */
export async function getSeriousSignalStatus(options: { hours?: number; limit?: number; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const hours = Math.max(1, Math.min(168, Math.floor(options.hours ?? 48)));
  const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 100)));
  const start = new Date(now.getTime() - hours * 60 * 60_000);
  const [statusFeed, sensor] = await Promise.all([
    readStatusFeedPointers(start, now),
    liveSensorStatus(now),
  ]);

  const alerts: Array<Record<string, unknown>> = [];
  for (const pointer of statusFeed.pointers) {
    try {
      const outboxKey = text(pointer.outboxKey);
      const deliveryJobKey = text(pointer.deliveryJobKey);
      if (!outboxKey || !deliveryJobKey) continue;
      const validated = await readAndValidateOutbox(outboxKey);
      const created = dateMs(validated.createdAt);
      if (created === null || created < start.getTime() || created > now.getTime() + 5 * 60_000) continue;
      const storedJob = await readJson(await readVersionedTextFromR2(deliveryJobKey));
      const job = storedJob ? parseJob(storedJob, outboxKey) : null;
      const quote = object(validated.candidate.quote);
      alerts.push({
        id: digest(outboxKey),
        createdAt: validated.createdAt,
        ticker: validated.ticker,
        alertType: validated.alertType,
        eventHeadline: text(validated.candidate.eventHeadline) ?? text(validated.candidate.whatHappened) ?? "Material event confirmed",
        whyItMatters: text(validated.output.SwingUpView) ?? text(validated.candidate.whatHappened),
        price: finite(quote.price),
        finalJudgeConfidence: Number(validated.judge.confidence),
        committee: { completed: 14, failed: 0, recommendation: "approve" },
        evidence: safeEvidenceUrls(validated.candidate),
        delivery: job ? {
          status: job.status,
          attempts: job.attempts,
          nextAttemptAt: job.nextAttemptAt,
          channels: {
            telegram: job.channels.telegram.status,
            webhook: job.channels.webhook.status,
          },
        } : { status: "pending_registration" },
      });
    } catch { continue; }
  }
  alerts.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  const selected = alerts.slice(0, limit);
  return {
    ok: true,
    generatedAt: now.toISOString(),
    window: { hours, from: start.toISOString(), to: now.toISOString() },
    summary: {
      total: alerts.length,
      buy: alerts.filter((alert) => alert.alertType === "buy").length,
      sell: alerts.filter((alert) => alert.alertType === "sell").length,
      watchOut: alerts.filter((alert) => alert.alertType === "watch_out").length,
      delivered: alerts.filter((alert) => object(alert.delivery).status === "delivered").length,
      deliveryAttentionNeeded: alerts.filter((alert) => ["retry_scheduled", "blocked_no_channel", "expired", "dead_letter"].includes(String(object(alert.delivery).status))).length,
    },
    alerts: selected,
    returned: selected.length,
    truncated: statusFeed.truncated || alerts.length > limit,
    feedSource: statusFeed.source,
    sensor,
    emptyResultVerified: alerts.length === 0
      && !statusFeed.truncated
      && sensor.verifiedLive
      && sensor.coverageVerified,
    sanitized: true,
    secretsIncluded: false,
    deliveryGuarantee: "at_least_once_with_claim_receipt_and_webhook_idempotency_key",
  };
}
