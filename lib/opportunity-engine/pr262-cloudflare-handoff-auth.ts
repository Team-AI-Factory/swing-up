import crypto from "node:crypto";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";

export const PR262_CLOUDFLARE_HANDOFF_PATH = "/api/internal/combined-opportunity-engine/cloudflare-sensor-handoff";
export const PR262_CLOUDFLARE_HANDOFF_KIND = "pr262_cloudflare_sensor_handoff";
const MAX_SIGNATURE_AGE_SECONDS = 5 * 60;
const MAX_BODY_BYTES = 16_384;

export type Pr262CloudflareHandoff = {
  version: 1;
  kind: typeof PR262_CLOUDFLARE_HANDOFF_KIND;
  owner: "cloudflare_worker";
  scanId: string;
  checkedAt: string;
  stateKey: string;
  stateEtag: string;
  runKey: string;
  runDigest: string;
  newEvents: number;
  pendingEvents: number;
};

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

function hmacInput(timestamp: string, nonce: string, bodyHash: string) {
  return `v1\n${timestamp}\n${nonce}\nPOST\n${PR262_CLOUDFLARE_HANDOFF_PATH}\n${bodyHash}`;
}

function bodyHash(rawBody: string) {
  return crypto.createHash("sha256").update(rawBody).digest("hex");
}

export function signPr262CloudflareHandoffForTest(input: {
  rawBody: string;
  timestamp: string;
  nonce: string;
  secret: string;
}) {
  return `v1=${crypto.createHmac("sha256", input.secret)
    .update(hmacInput(input.timestamp, input.nonce, bodyHash(input.rawBody)))
    .digest("hex")}`;
}

function validInteger(value: unknown, minimum: number, maximum: number) {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function parsePayload(rawBody: string, environment: Record<string, string | undefined>): Pr262CloudflareHandoff {
  let raw: unknown;
  try { raw = JSON.parse(rawBody) as unknown; }
  catch { throw new Error("cloudflare_handoff_invalid_json"); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("cloudflare_handoff_invalid_body");
  const value = raw as Record<string, unknown>;
  if (value.version !== 1 || value.kind !== PR262_CLOUDFLARE_HANDOFF_KIND || value.owner !== "cloudflare_worker") {
    throw new Error("cloudflare_handoff_contract_mismatch");
  }
  const scanId = typeof value.scanId === "string" ? value.scanId : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scanId)) {
    throw new Error("cloudflare_handoff_scan_id_invalid");
  }
  const expectedStateKey = pr262StorageKey("sensor/state-v1.json", environment);
  if (value.stateKey !== expectedStateKey) throw new Error("cloudflare_handoff_state_key_mismatch");
  const runPrefix = pr262StorageKey("sensor/runs/placeholder.json", environment).replace(/placeholder\.json$/, "");
  const runKey = typeof value.runKey === "string" ? value.runKey : "";
  if (!runKey.startsWith(runPrefix) || runKey.includes("..") || !runKey.endsWith(`${scanId}.json`)) {
    throw new Error("cloudflare_handoff_run_key_invalid");
  }
  const checkedAt = typeof value.checkedAt === "string" ? value.checkedAt : "";
  if (!Number.isFinite(Date.parse(checkedAt))) throw new Error("cloudflare_handoff_checked_at_invalid");
  const stateEtag = typeof value.stateEtag === "string" ? value.stateEtag : "";
  if (!/^[A-Za-z0-9"'=_:.-]{8,160}$/.test(stateEtag)) throw new Error("cloudflare_handoff_state_etag_invalid");
  const runDigest = typeof value.runDigest === "string" ? value.runDigest.toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(runDigest)) throw new Error("cloudflare_handoff_run_digest_invalid");
  if (!validInteger(value.newEvents, 0, 500) || !validInteger(value.pendingEvents, 0, 2_500)) {
    throw new Error("cloudflare_handoff_counts_invalid");
  }
  return {
    version: 1,
    kind: PR262_CLOUDFLARE_HANDOFF_KIND,
    owner: "cloudflare_worker",
    scanId,
    checkedAt,
    stateKey: expectedStateKey,
    stateEtag,
    runKey,
    runDigest,
    newEvents: Number(value.newEvents),
    pendingEvents: Number(value.pendingEvents),
  };
}

export function verifyPr262CloudflareHandoff(input: {
  rawBody: string;
  headers: Headers;
  now?: Date;
  environment?: Record<string, string | undefined>;
}) {
  if (Buffer.byteLength(input.rawBody) > MAX_BODY_BYTES) throw new Error("cloudflare_handoff_body_too_large");
  const environment = input.environment ?? process.env;
  const secret = environment.SWING_UP_PR262_HANDOFF_SECRET?.trim() ?? "";
  if (secret.length < 32) throw new Error("cloudflare_handoff_secret_not_configured");
  const timestamp = input.headers.get("x-swing-up-sensor-timestamp")?.trim() ?? "";
  const nonce = input.headers.get("x-swing-up-sensor-nonce")?.trim() ?? "";
  const suppliedSignature = input.headers.get("x-swing-up-sensor-signature")?.trim().toLowerCase() ?? "";
  if (!/^\d{10}$/.test(timestamp)) throw new Error("cloudflare_handoff_timestamp_invalid");
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_SIGNATURE_AGE_SECONDS) throw new Error("cloudflare_handoff_signature_expired");
  const payload = parsePayload(input.rawBody, environment);
  if (!safeEqual(nonce, payload.scanId)) throw new Error("cloudflare_handoff_nonce_mismatch");
  const expectedSignature = signPr262CloudflareHandoffForTest({ rawBody: input.rawBody, timestamp, nonce, secret });
  if (!safeEqual(suppliedSignature, expectedSignature)) throw new Error("cloudflare_handoff_signature_invalid");
  const checkedAtAge = Math.abs((input.now ?? new Date()).getTime() - Date.parse(payload.checkedAt));
  if (checkedAtAge > MAX_SIGNATURE_AGE_SECONDS * 1_000) throw new Error("cloudflare_handoff_payload_expired");
  return payload;
}

export function pr262CloudflareHandoffReceiptKey(payload: Pr262CloudflareHandoff) {
  return pr262StorageKey(`sensor/handoff-receipts/${payload.checkedAt.slice(0, 10)}/${payload.scanId}.json`);
}
