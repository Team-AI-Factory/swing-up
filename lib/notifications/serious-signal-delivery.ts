import crypto from "node:crypto";
import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";

const PR262_BRANCH = "agent/combined-opportunity-engine";
const DELIVERY_PREFIX = "branch-labs/pr-262/serious-signal/delivery-v1";
const ALLOWED_KINDS = new Set([
  "pr262_committee_verified_event_signal",
  "pr262_committee_verified_serious_watch_out",
]);

type Json = Record<string, unknown>;

type ChannelResult = {
  channel: "telegram" | "webhook";
  configured: boolean;
  sent: boolean;
  status: "preview_blocked" | "not_configured" | "already_delivered" | "sent" | "failed";
  error: string | null;
};

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function digest(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function deliveryKey(outboxKey: string, channel: ChannelResult["channel"]) {
  return `${DELIVERY_PREFIX}/${channel}/${digest(outboxKey)}.json`;
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

  if (!kind || !ALLOWED_KINDS.has(kind)) throw new Error("serious_signal_delivery_untrusted_outbox_kind");
  if (!ticker || !["buy", "sell", "watch_out"].includes(alertType ?? "")) throw new Error("serious_signal_delivery_invalid_identity");
  if (Number(committee.agentsCompleted) !== 14 || Number(committee.agentsFailed) !== 0) throw new Error("serious_signal_delivery_incomplete_committee");
  if (judge.verdict !== "positive" || Number(judge.confidence) < 80 || output.overallRecommendation !== "approve") {
    throw new Error("serious_signal_delivery_committee_not_approved");
  }

  return { outboxKey, outbox, kind, ticker, alertType: alertType as "buy" | "sell" | "watch_out", candidate, committee, judge, output };
}

function messageFor(input: ReturnType<typeof validatedOutbox>) {
  const event = text(input.candidate.eventHeadline) ?? text(input.candidate.whatHappened) ?? "Material event confirmed";
  const why = text(input.candidate.whatHappened) ?? text(input.output.SwingUpView) ?? "Current evidence passed the Serious Signal review.";
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

async function alreadyDelivered(key: string) {
  const current = await readVersionedTextFromR2(key);
  if (!current.found || !current.text) return false;
  try { return object(JSON.parse(current.text)).status === "sent"; }
  catch { return false; }
}

async function recordDelivery(input: { key: string; outboxKey: string; channel: ChannelResult["channel"]; destination: string | null; responseStatus?: number | null }) {
  const payload = {
    version: 1,
    kind: "serious_signal_delivery_receipt",
    status: "sent",
    deliveredAt: new Date().toISOString(),
    outboxKey: input.outboxKey,
    channel: input.channel,
    destination: input.destination,
    responseStatus: input.responseStatus ?? null,
  };
  const written = await writeVersionedJsonToR2(input.key, payload, { createOnly: true });
  if (written.conflict && !await alreadyDelivered(input.key)) throw new Error("serious_signal_delivery_receipt_conflict");
}

async function sendTelegram(outboxKey: string, message: string): Promise<ChannelResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_SERIOUS_SIGNAL_CHAT_ID?.trim() || process.env.TELEGRAM_TEST_CHAT_ID?.trim();
  const configured = Boolean(token && chatId);
  if (process.env.RAILWAY_GIT_BRANCH?.trim() === PR262_BRANCH) return { channel: "telegram", configured, sent: false, status: "preview_blocked", error: null };
  if (!token || !chatId) return { channel: "telegram", configured: false, sent: false, status: "not_configured", error: null };

  const key = deliveryKey(outboxKey, "telegram");
  if (await alreadyDelivered(key)) return { channel: "telegram", configured: true, sent: false, status: "already_delivered", error: null };
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { channel: "telegram", configured: true, sent: false, status: "failed", error: `telegram_http_${response.status}` };
    await recordDelivery({ key, outboxKey, channel: "telegram", destination: "configured_chat", responseStatus: response.status });
    return { channel: "telegram", configured: true, sent: true, status: "sent", error: null };
  } catch (error) {
    return { channel: "telegram", configured: true, sent: false, status: "failed", error: error instanceof Error ? error.message.slice(0, 160) : "telegram_send_failed" };
  }
}

async function sendWebhook(outboxKey: string, payload: Json): Promise<ChannelResult> {
  const raw = process.env.SWING_UP_SERIOUS_SIGNAL_WEBHOOK_URL?.trim();
  if (process.env.RAILWAY_GIT_BRANCH?.trim() === PR262_BRANCH) return { channel: "webhook", configured: Boolean(raw), sent: false, status: "preview_blocked", error: null };
  if (!raw) return { channel: "webhook", configured: false, sent: false, status: "not_configured", error: null };
  let url: URL;
  try { url = new URL(raw); } catch { return { channel: "webhook", configured: true, sent: false, status: "failed", error: "webhook_url_invalid" }; }
  if (url.protocol !== "https:") return { channel: "webhook", configured: true, sent: false, status: "failed", error: "webhook_https_required" };

  const key = deliveryKey(outboxKey, "webhook");
  if (await alreadyDelivered(key)) return { channel: "webhook", configured: true, sent: false, status: "already_delivered", error: null };
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { channel: "webhook", configured: true, sent: false, status: "failed", error: `webhook_http_${response.status}` };
    await recordDelivery({ key, outboxKey, channel: "webhook", destination: url.hostname, responseStatus: response.status });
    return { channel: "webhook", configured: true, sent: true, status: "sent", error: null };
  } catch (error) {
    return { channel: "webhook", configured: true, sent: false, status: "failed", error: error instanceof Error ? error.message.slice(0, 160) : "webhook_send_failed" };
  }
}

export async function deliverSeriousSignalOutbox(outboxKey: string | null | undefined) {
  if (!outboxKey) return { ok: true, outboxKey: null, seriousSignal: false, channels: [] as ChannelResult[] };
  const stored = await readVersionedTextFromR2(outboxKey);
  if (!stored.found || !stored.text) throw new Error("serious_signal_delivery_outbox_missing");
  const validated = validatedOutbox(JSON.parse(stored.text), outboxKey);
  const message = messageFor(validated);
  const sanitizedPayload = {
    version: 1,
    kind: "swing_up_serious_signal_notification",
    createdAt: text(validated.outbox.createdAt) ?? new Date().toISOString(),
    ticker: validated.ticker,
    alertType: validated.alertType,
    eventHeadline: text(validated.candidate.eventHeadline) ?? text(validated.candidate.whatHappened),
    finalJudgeConfidence: Number(validated.judge.confidence),
    message,
  };
  const [telegram, webhook] = await Promise.all([
    sendTelegram(outboxKey, message),
    sendWebhook(outboxKey, sanitizedPayload),
  ]);
  return {
    ok: ![telegram, webhook].some((item) => item.configured && item.status === "failed"),
    outboxKey,
    seriousSignal: true,
    ticker: validated.ticker,
    alertType: validated.alertType,
    message,
    channels: [telegram, webhook],
  };
}
