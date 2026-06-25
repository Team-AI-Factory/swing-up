import crypto from "node:crypto";
import { prisma } from "@/lib/db/client";
import { redactSecrets } from "@/lib/redact-secrets";

export type R2SourceOfTruth = "recent_write_test" | "runtime_write_check" | "read_only_get_check" | "route_did_not_receive_confirmWrite";

export type R2OperationalStatus = {
  configured: boolean;
  connected: boolean;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  writeAvailable: boolean;
  storageMode: "r2_raw_storage" | "postgresql_summary_only";
  lastConfirmedWriteAt: string | null;
  lastConfirmedDeleteAt: string | null;
  sourceOfTruth: R2SourceOfTruth;
  rawHealth: R2Health;
};

type RecentR2WriteTest = { writeAt: string; deleteAt: string; regionUsed: string | null; testObjectKey: string | null };
const R2_WRITE_TEST_FRESH_MS = 24 * 60 * 60 * 1000;
const globalR2State = globalThis as typeof globalThis & { __swingUpRecentR2WriteTest?: RecentR2WriteTest };

export type R2Health = {
  connected: boolean;
  configured: boolean;
  bucket: string | null;
  endpointHost: string | null;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  storageMode: "r2_raw_storage" | "postgresql_summary_only";
  lastConfirmedWriteAt: string | null;
  lastConfirmedDeleteAt: string | null;
  sourceOfTruth: R2SourceOfTruth;
  lastChecked: string;
  missingEnvVars: string[];
  errorCategory: string | null;
  errorMessageSafe: string | null;
  writeErrorCategory: string | null;
  writeErrorMessageSafe: string | null;
  deleteErrorCategory: string | null;
  deleteErrorMessageSafe: string | null;
  suspectedCause: string | null;
  nextAction: string | null;
  writeAttempted: boolean;
  readAfterWriteAttempted: boolean;
  deleteAttempted: boolean;
  testObjectKey: string | null;
  writeAwsStatusCode: number | null;
  writeAwsErrorName: string | null;
  writeAwsErrorMessageSafe: string | null;
  deleteAwsStatusCode: number | null;
  deleteAwsErrorName: string | null;
  deleteAwsErrorMessageSafe: string | null;
  endpointUsedHost: string | null;
  bucketUsed: string | null;
  regionUsed: string | null;
  forcePathStyleUsed: boolean;
  accessKeyIdFingerprint: string | null;
  detectedEnvNames: string[];
  envLoadedAtRuntime: boolean;
  runtimeVariableSource: "Railway env";
  regionFallbackAttempted: boolean;
  regionFallbackUsed: string | null;
  writeTestNotRun: boolean;
  message: string | null;
  secretsRedacted: true;
};
const R2_ENV_NAMES = [
  "R2_BUCKET",
  "R2_ENDPOINT",
  "R2_REGION",
  "R2_FORCE_PATH_STYLE",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "CLOUDFLARE_R2_BUCKET",
  "CLOUDFLARE_R2_ENDPOINT",
  "CLOUDFLARE_R2_REGION",
  "CLOUDFLARE_R2_ACCESS_KEY_ID",
  "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
  "CLOUDFLARE_R2_ACCOUNT_ID",
] as const;
function env(name: string) { return process.env[name]?.trim() || ""; }
function envFirst(preferred: string, legacy: string) { return env(preferred) || env(legacy); }
function boolEnv(v: string, fallback: boolean) { if (!v) return fallback; return /^(1|true|yes)$/i.test(v); }
export function getR2Config(regionOverride?: string) {
  const accountId = env("CLOUDFLARE_R2_ACCOUNT_ID");
  const endpoint = (
    envFirst("R2_ENDPOINT", "CLOUDFLARE_R2_ENDPOINT") ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "")
  ).replace(/\/$/, "");
  const region = regionOverride ?? (envFirst("R2_REGION", "CLOUDFLARE_R2_REGION") || "auto");
  const accessKeyId = envFirst("R2_ACCESS_KEY_ID", "CLOUDFLARE_R2_ACCESS_KEY_ID");
  const secretAccessKey = envFirst("R2_SECRET_ACCESS_KEY", "CLOUDFLARE_R2_SECRET_ACCESS_KEY");
  const bucket = envFirst("R2_BUCKET", "CLOUDFLARE_R2_BUCKET");
  const missingEnvVars = [
    accessKeyId ? null : "R2_ACCESS_KEY_ID or CLOUDFLARE_R2_ACCESS_KEY_ID",
    secretAccessKey ? null : "R2_SECRET_ACCESS_KEY or CLOUDFLARE_R2_SECRET_ACCESS_KEY",
    bucket ? null : "R2_BUCKET or CLOUDFLARE_R2_BUCKET",
    endpoint ? null : "R2_ENDPOINT or CLOUDFLARE_R2_ENDPOINT/CLOUDFLARE_R2_ACCOUNT_ID",
  ].filter(Boolean) as string[];
  const detectedEnvNames = R2_ENV_NAMES.filter((k) => Boolean(process.env[k]?.trim()));
  return {
    accountId, accessKeyId, accessKeyIdFingerprint: fingerprintAccessKeyId(accessKeyId), secretAccessKey, bucket,
    publicBaseUrl: process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL?.trim() || null, endpoint, region,
    forcePathStyle: boolEnv(env("R2_FORCE_PATH_STYLE"), true), missingEnvVars, detectedEnvNames, configured: missingEnvVars.length === 0,
  };
}
function hmac(key: crypto.BinaryLike, data: string) {
  return crypto.createHmac("sha256", key).update(data).digest();
}
function hashHex(data: crypto.BinaryLike) {
  return crypto.createHash("sha256").update(data).digest("hex");
}
function amzDate(d = new Date()) {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, "");
}
function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}
function fingerprintAccessKeyId(accessKeyId: string) {
  if (!accessKeyId) return null;
  if (accessKeyId.length <= 8)
    return `${accessKeyId.slice(0, 1)}***${accessKeyId.slice(-1)}`;
  return `${accessKeyId.slice(0, 4)}***${accessKeyId.slice(-4)}`;
}


function rememberSuccessfulR2WriteTest(health: R2Health) {
  if (health.canWrite && health.canDelete) {
    const now = new Date().toISOString();
    globalR2State.__swingUpRecentR2WriteTest = {
      writeAt: now,
      deleteAt: now,
      regionUsed: health.regionUsed,
      testObjectKey: health.testObjectKey,
    };
  }
}

function recentR2WriteTest() {
  const recent = globalR2State.__swingUpRecentR2WriteTest;
  if (!recent) return null;
  const writeMs = Date.parse(recent.writeAt);
  const deleteMs = Date.parse(recent.deleteAt);
  if (!Number.isFinite(writeMs) || !Number.isFinite(deleteMs)) return null;
  const fresh = Date.now() - Math.min(writeMs, deleteMs) <= R2_WRITE_TEST_FRESH_MS;
  return fresh ? recent : null;
}

async function signedFetch(
  method: string,
  key: string,
  body?: Buffer | string,
  contentType = "application/octet-stream",
  regionOverride?: string,
) {
  const c = getR2Config(regionOverride);
  if (!c.configured)
    throw new Error(
      `R2 not configured: missing ${c.missingEnvVars.join(", ")}`,
    );
  const url = new URL(
    `${c.endpoint}/${c.bucket}${key ? `/${encodePath(key)}` : ""}`,
  );
  const now = amzDate();
  const date = now.slice(0, 8);
  const payloadHash = hashHex(body ? Buffer.from(body) : Buffer.alloc(0));
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": now,
  };
  if (body) headers["content-type"] = contentType;
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k]}\n`)
    .join("");
  const canonical = [
    method,
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${date}/${c.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    now,
    scope,
    hashHex(canonical),
  ].join("\n");
  const kDate = hmac(`AWS4${c.secretAccessKey}`, date);
  const kRegion = hmac(kDate, c.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto
    .createHmac("sha256", kSigning)
    .update(stringToSign)
    .digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${c.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return fetch(url, {
    method,
    headers,
    body: body as BodyInit | undefined,
    cache: "no-store",
  });
}
export function computeContentHash(payload: unknown) {
  return hashHex(
    Buffer.isBuffer(payload)
      ? payload
      : typeof payload === "string"
        ? payload
        : JSON.stringify(payload),
  );
}
function clean(v: unknown, fallback = "unknown") {
  return (
    String(v ?? fallback)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._=-]+/g, "-")
      .replace(/^-+|-+$/g, "") || fallback
  );
}
function keyDate(v: string) {
  return clean(v).replace(/[^a-z0-9._=-]+/g, "-");
}
export function buildR2Key(
  source: string,
  assetType: string,
  symbol: string | null,
  dataType: string,
  dateKey: string,
  extraMetadata: Record<string, unknown> = {},
) {
  const s = clean(source);
  const a = clean(assetType);
  const sym = symbol ? clean(symbol).toUpperCase() : "_all";
  const d = clean(dataType);
  const dk = keyDate(dateKey);
  const year = keyDate(String(extraMetadata.year ?? dk));
  const quarter = String(extraMetadata.quarter ?? "").replace(/^q/i, "");
  if (
    s === "fmp" &&
    a === "stocks" &&
    [
      "profile",
      "quotes",
      "historical-prices",
      "financials",
      "ratios",
      "metrics",
      "analyst-estimates",
      "price-targets",
    ].includes(d)
  )
    return `raw/fmp/stocks/${sym}/${d}/${dk}.json`;
  if (s === "fmp" && d === "news") return `raw/fmp/news/${sym}/${dk}.json`;
  if (s === "fmp" && d === "press-releases")
    return `raw/fmp/press-releases/${sym}/${dk}.json`;
  if (s === "fmp" && d === "transcripts")
    return `raw/fmp/transcripts/${sym}/${year}/q${quarter || clean(extraMetadata.period ?? "unknown")}.json`;
  if (s === "fmp" && a === "proof")
    return `raw/fmp/proof/${sym}/${dk}/${clean(extraMetadata.runId ?? d)}.json`;
  if (s === "fmp" && d === "sec-filings")
    return `raw/fmp/sec-filings/${sym}/${clean(extraMetadata.formType ?? "filing")}/${clean(extraMetadata.accession ?? dk)}.json`;
  if (s === "sec")
    return `raw/sec/${sym}/${clean(extraMetadata.formType ?? d)}/${clean(extraMetadata.accession ?? dk)}.json`;
  if (s === "marketaux") return `raw/marketaux/news/${sym}/${dk}.json`;
  if (s === "alpha-vantage") return `raw/alpha-vantage/${sym}/${d}/${dk}.json`;
  if (s === "gdelt") return `raw/gdelt/events/${dk}.json`;
  if (s === "fred")
    return `raw/fred/${sym === "_ALL" ? clean(extraMetadata.seriesId ?? "series") : sym}/${dk}.json`;
  if (s === "frankfurter")
    return `raw/frankfurter/${sym === "_ALL" ? clean(extraMetadata.baseCurrency ?? "base") : sym}/${dk}.json`;
  if (s === "coingecko")
    return `raw/coingecko/${sym === "_ALL" ? clean(extraMetadata.assetId ?? "asset") : sym}/${dk}.json`;
  if (s === "openfda")
    return `raw/openfda/${clean(extraMetadata.category ?? a)}/${dk}.json`;
  return `raw/${s}/${a}/${sym}/${d}/${dk}.json`;
}
function sanitizeForR2(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[max-depth]";
  if (Array.isArray(value))
    return value.map((item) => sanitizeForR2(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (
        /authorization|cookie|set-cookie|x-api-key|api[_-]?key|access[_-]?key|secret|token|password|headers/i.test(
          k,
        )
      ) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = sanitizeForR2(v, depth + 1);
    }
    return out;
  }
  return value;
}
export async function objectExistsInR2(r2Key: string) {
  const res = await signedFetch("HEAD", r2Key);
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`R2 head failed with status ${res.status}`);
  return true;
}
export async function readRawDataFromR2(r2Key: string) {
  const res = await signedFetch("GET", r2Key);
  if (!res.ok) throw new Error(`R2 read failed with status ${res.status}`);
  return res.text();
}
async function put(
  r2Key: string,
  body: Buffer | string,
  contentType: string,
  metadata: Record<string, unknown> = {},
) {
  const res = await signedFetch("PUT", r2Key, body, contentType);
  if (!res.ok) throw new Error(`R2 write failed with status ${res.status}`);
  return indexRawDataObject(r2Key, body, metadata);
}
export const saveJsonToR2 = (
  r2Key: string,
  payload: unknown,
  metadata: Record<string, unknown> = {},
) =>
  put(
    r2Key,
    JSON.stringify(sanitizeForR2(payload)),
    "application/json",
    sanitizeForR2(metadata) as Record<string, unknown>,
  );
export const saveTextToR2 = (
  r2Key: string,
  payload: string,
  metadata: Record<string, unknown> = {},
) => put(r2Key, payload, "text/plain; charset=utf-8", metadata);
export const saveBinaryToR2 = (
  r2Key: string,
  payload: Buffer,
  metadata: Record<string, unknown> = {},
) => put(r2Key, payload, "application/octet-stream", metadata);
export async function saveRawDataToR2(
  source: string,
  assetType: string,
  symbol: string | null,
  dataType: string,
  dateKey: string,
  payload: unknown,
  metadata: Record<string, unknown> = {},
) {
  const r2Key = buildR2Key(
    source,
    assetType,
    symbol,
    dataType,
    dateKey,
    metadata,
  );
  return saveJsonToR2(r2Key, payload, {
    ...metadata,
    source,
    assetType,
    symbol,
    dataType,
  });
}
export async function indexRawDataObject(
  r2Key: string,
  body: Buffer | string,
  metadata: Record<string, unknown> = {},
) {
  if (!process.env.DATABASE_URL) return null;
  const byteSize = Buffer.byteLength(body);
  const contentHash = computeContentHash(body);
  const source = String(metadata.source ?? r2Key.split("/")[1] ?? "unknown");
  const assetType = String(
    metadata.assetType ?? r2Key.split("/")[2] ?? "unknown",
  );
  const symbol = metadata.symbol ? String(metadata.symbol) : null;
  const dataType = String(
    metadata.dataType ?? r2Key.split("/")[4] ?? "unknown",
  );
  const recordCount = Array.isArray(metadata.records)
    ? metadata.records.length
    : typeof metadata.recordCount === "number"
      ? metadata.recordCount
      : null;
  return prisma.rawDataObject.upsert({
    where: { contentHash },
    create: {
      source,
      assetType,
      symbol,
      normalizedSymbol: symbol?.toUpperCase() ?? null,
      dataType,
      r2Key,
      contentHash,
      byteSize,
      recordCount,
      status: "stored",
      providerPlanStatus: String(metadata.providerPlanStatus ?? "unknown"),
      sourceUrl: metadata.sourceUrl ? String(metadata.sourceUrl) : null,
      receiptUrl: metadata.receiptUrl ? String(metadata.receiptUrl) : null,
      metadata: metadata as object,
    },
    update: {
      storedAt: new Date(),
      r2Key,
      byteSize,
      recordCount,
      status: "stored",
      metadata: metadata as object,
    },
  });
}
function safeMessage(e: unknown) {
  return e instanceof Error ? redactSecrets(e.message).slice(0, 220) : "R2 request failed";
}
function responseCategory(prefix: string, res: Response | null) {
  if (!res) return `${prefix}_not_attempted`;
  if (res.ok) return null;
  if (res.status === 401 || res.status === 403) return "access_denied";
  if (res.status === 404) return "bucket_not_found";
  if (res.status === 400) return "signature_mismatch";
  if (res.status === 405) return "endpoint_mismatch";
  if (res.status >= 500) return "unknown_r2_error";
  return `${prefix}_http_${res.status}`;
}
async function safeResponseMessage(action: string, res: Response | null) {
  if (!res) return `${action} was not attempted.`;
  if (res.ok) return null;
  const text = await res.clone().text().catch(() => "");
  const hint = redactSecrets(text)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 160);
  return `R2 ${action} failed with status ${res.status}${hint ? `: ${hint}` : ""}`;
}
async function awsErrorDetails(res: Response | null) {
  if (!res) return { name: null, message: null };
  if (res.ok) return { name: null, message: null };
  const text = await res.clone().text().catch(() => "");
  const readTag = (tag: string) =>
    text
      .match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i"))?.[1]
      ? redactSecrets(text.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i"))?.[1] ?? "").slice(0, 180)
      : null;
  return {
    name: readTag("Code") ?? res.statusText ?? `HTTP_${res.status}`,
    message: readTag("Message"),
  };
}
function permissionNextAction(bucket: string | null) {
  return `Create or update Cloudflare R2 API token with Object Read, Object Write, and Object Delete permissions for bucket ${bucket ?? "the configured bucket"}, then update Railway variables.`;
}
function diagnoseR2Health(
  health: R2Health,
): Pick<R2Health, "suspectedCause" | "nextAction"> {
  if (!health.configured)
    return {
      suspectedCause: "Missing Railway R2 environment variables.",
      nextAction:
        "Set Cloudflare R2 account, access key, secret key, and bucket Railway variables.",
    };
  if (!health.canRead)
    return {
      suspectedCause:
        "Bucket read check failed; possible bucket name mismatch, endpoint/account mismatch, credentials problem, or missing Object Read permission.",
      nextAction: permissionNextAction(health.bucket),
    };
  if (health.canRead && (!health.canWrite || !health.canDelete))
    return {
      suspectedCause: [
        health.bucketUsed !== "swingup" ? "bucket name mismatch" : null,
        health.endpointUsedHost !==
        "d8a569e33989279f8b0d8375c2b9e757.r2.cloudflarestorage.com"
          ? "wrong account endpoint"
          : null,
        health.writeAwsStatusCode === 403 ? "token lacks object write" : null,
        health.deleteAwsStatusCode === 403 ? "token lacks object delete" : null,
        health.writeAwsStatusCode === 401 || health.deleteAwsStatusCode === 401
          ? "Railway still has old token or invalid R2 credentials"
          : null,
        health.regionFallbackUsed ? "region config issue" : null,
        !health.forcePathStyleUsed ? "SDK endpoint config issue" : null,
        "If the accessKeyIdFingerprint differs from the newly-created key fingerprint, Railway still has old token.",
      ]
        .filter(Boolean)
        .join("; "),
      nextAction:
        health.bucketUsed !== "swingup"
          ? "Set CLOUDFLARE_R2_BUCKET to swingup in Railway and redeploy."
          : health.endpointUsedHost !==
              "d8a569e33989279f8b0d8375c2b9e757.r2.cloudflarestorage.com"
            ? "Set CLOUDFLARE_R2_ENDPOINT to https://d8a569e33989279f8b0d8375c2b9e757.r2.cloudflarestorage.com in Railway and redeploy."
            : permissionNextAction(health.bucket),
    };
  return { suspectedCause: null, nextAction: null };
}
export async function checkR2Health(confirmWrite = false): Promise<R2Health> {
  const c = getR2Config();
  const base: R2Health = {
    connected: false,
    configured: c.configured,
    bucket: c.bucket || null,
    endpointHost: c.endpoint ? new URL(c.endpoint).host : null,
    canRead: false,
    canWrite: false,
    canDelete: false,
    storageMode: "postgresql_summary_only",
    lastConfirmedWriteAt: null,
    lastConfirmedDeleteAt: null,
    sourceOfTruth: confirmWrite ? "runtime_write_check" : "read_only_get_check",
    lastChecked: new Date().toISOString(),
    missingEnvVars: c.missingEnvVars,
    errorCategory: null,
    errorMessageSafe: null,
    writeErrorCategory: null,
    writeErrorMessageSafe: null,
    deleteErrorCategory: null,
    deleteErrorMessageSafe: null,
    suspectedCause: null,
    nextAction: null,
    writeAttempted: false,
    readAfterWriteAttempted: false,
    deleteAttempted: false,
    testObjectKey: null,
    writeAwsStatusCode: null,
    writeAwsErrorName: null,
    writeAwsErrorMessageSafe: null,
    deleteAwsStatusCode: null,
    deleteAwsErrorName: null,
    deleteAwsErrorMessageSafe: null,
    endpointUsedHost: c.endpoint ? new URL(c.endpoint).host : null,
    bucketUsed: c.bucket || null,
    regionUsed: c.region,
    forcePathStyleUsed: c.forcePathStyle,
    accessKeyIdFingerprint: c.accessKeyIdFingerprint,
    detectedEnvNames: c.detectedEnvNames,
    envLoadedAtRuntime: c.configured,
    runtimeVariableSource: "Railway env",
    regionFallbackAttempted: false,
    regionFallbackUsed: null,
    writeTestNotRun: !confirmWrite,
    message: confirmWrite
      ? null
      : "This is read-only health. Use POST with confirmWrite=true to test write/delete.",
    secretsRedacted: true,
  };
  if (!c.configured) {
    const d = diagnoseR2Health(base);
    return {
      ...base,
      errorCategory: "missing_env",
      errorMessageSafe: "Cloudflare R2 environment variables are incomplete.",
      ...d,
    };
  }
  try {
    const head = await signedFetch("HEAD", "");
    if (!head.ok) {
      const failed = {
        ...base,
        errorCategory: `bucket_${head.status}`,
        errorMessageSafe: `R2 bucket check failed with status ${head.status}`,
      };
      return { ...failed, ...diagnoseR2Health(failed) };
    }
    const health: R2Health = { ...base, connected: true, canRead: true };
    if (confirmWrite) {
      const testKey = `logs/r2-health/${Date.now()}-${crypto.randomUUID()}.json`;
      health.testObjectKey = testKey;
      const body = JSON.stringify({
        service: "swing-up",
        kind: "r2-health",
        checkedAt: new Date().toISOString(),
      });
      health.writeAttempted = true;
      let write = await signedFetch("PUT", testKey, body, "application/json");
      if (!write.ok && c.region === "auto") {
        health.regionFallbackAttempted = true;
        const fallbackWrite = await signedFetch(
          "PUT",
          testKey,
          body,
          "application/json",
          "us-east-1",
        );
        if (fallbackWrite.ok) {
          write = fallbackWrite;
          health.regionFallbackUsed = "us-east-1";
          health.regionUsed = "us-east-1";
        }
      }
      const writeAws = await awsErrorDetails(write);
      health.canWrite = write.ok;
      health.writeAwsStatusCode = write.status;
      health.writeAwsErrorName = writeAws.name;
      health.writeAwsErrorMessageSafe = writeAws.message;
      health.writeErrorCategory = responseCategory("write", write);
      health.writeErrorMessageSafe = await safeResponseMessage("write", write);
      health.readAfterWriteAttempted = true;
      const read = await signedFetch(
            "GET",
            testKey,
            undefined,
            "application/octet-stream",
            health.regionFallbackUsed ?? undefined,
          );
      const readText = read?.ok ? await read.text().catch(() => "") : "";
      health.canRead = Boolean(read?.ok && readText === body);
      if (read && !health.canRead) {
        health.errorCategory = responseCategory("readback", read);
        health.errorMessageSafe =
          (await safeResponseMessage("readback", read)) ??
          "R2 readback did not match the test object.";
      }
      health.deleteAttempted = true;
      const del = await signedFetch(
            "DELETE",
            testKey,
            undefined,
            "application/octet-stream",
            health.regionFallbackUsed ?? undefined,
          );
      const deleteAws = await awsErrorDetails(del);
      health.canDelete = Boolean(del?.ok);
      health.deleteAwsStatusCode = del?.status ?? null;
      health.deleteAwsErrorName = deleteAws.name;
      health.deleteAwsErrorMessageSafe = deleteAws.message;
      health.deleteErrorCategory = responseCategory("delete", del);
      health.deleteErrorMessageSafe = await safeResponseMessage("delete", del);
      health.connected = health.canRead;
      health.writeTestNotRun = false;
      if (health.canRead && health.canWrite && health.canDelete) {
        health.storageMode = "r2_raw_storage";
        health.lastConfirmedWriteAt = health.lastChecked;
        health.lastConfirmedDeleteAt = health.lastChecked;
        health.sourceOfTruth = "recent_write_test";
      }
    }
    if (confirmWrite) rememberSuccessfulR2WriteTest(health);
    return { ...health, ...diagnoseR2Health(health) };
  } catch (e) {
    const failed = {
      ...base,
      errorCategory: confirmWrite ? "unknown_r2_error" : "request_error",
      errorMessageSafe: safeMessage(e),
    };
    return { ...failed, ...diagnoseR2Health(failed) };
  }
}
export async function getR2OperationalStatus(options: { allowRuntimeWriteCheck?: boolean } = {}): Promise<R2OperationalStatus> {
  const recent = recentR2WriteTest();
  if (recent) {
    const rawHealth = await checkR2Health(false);
    return {
      configured: rawHealth.configured,
      connected: rawHealth.connected || rawHealth.canRead,
      canRead: rawHealth.canRead,
      canWrite: true,
      canDelete: true,
      writeAvailable: true,
      storageMode: "r2_raw_storage",
      lastConfirmedWriteAt: recent.writeAt,
      lastConfirmedDeleteAt: recent.deleteAt,
      sourceOfTruth: "recent_write_test",
      rawHealth,
    };
  }
  const rawHealth = await checkR2Health(options.allowRuntimeWriteCheck === true);
  const writeAvailable = rawHealth.canWrite && rawHealth.canDelete;
  return {
    configured: rawHealth.configured,
    connected: rawHealth.connected || rawHealth.canRead,
    canRead: rawHealth.canRead,
    canWrite: writeAvailable,
    canDelete: writeAvailable,
    writeAvailable,
    storageMode: writeAvailable ? "r2_raw_storage" : "postgresql_summary_only",
    lastConfirmedWriteAt: writeAvailable ? rawHealth.lastChecked : null,
    lastConfirmedDeleteAt: writeAvailable ? rawHealth.lastChecked : null,
    sourceOfTruth: options.allowRuntimeWriteCheck === true ? "runtime_write_check" : "read_only_get_check",
    rawHealth,
  };
}

export async function getRawWarehouseStatus() {
  if (!process.env.DATABASE_URL)
    return { count: 0, latest: null, snapshots: 0 };
  const [count, latest, snapshots] = await Promise.all([
    prisma.rawDataObject.count().catch(() => 0),
    prisma.rawDataObject
      .findFirst({ orderBy: { storedAt: "desc" } })
      .catch(() => null),
    prisma.rawDataObject
      .count({ where: { r2Key: { startsWith: "universe/" } } })
      .catch(() => 0),
  ]);
  return { count, latest, snapshots };
}

export async function trySaveRawDataToR2(
  source: string,
  assetType: string,
  symbol: string | null,
  dataType: string,
  dateKey: string,
  payload: unknown,
  metadata: Record<string, unknown> = {},
) {
  const op = await getR2OperationalStatus();
  const cfg = getR2Config();
  if (!op.writeAvailable)
    return {
      saved: false,
      reason: "r2_write_not_confirmed",
      missingEnvVars: cfg.missingEnvVars,
      r2Key: buildR2Key(source, assetType, symbol, dataType, dateKey, metadata),
    };
  if (!cfg.configured)
    return {
      saved: false,
      reason: "r2_not_configured",
      missingEnvVars: cfg.missingEnvVars,
      r2Key: buildR2Key(source, assetType, symbol, dataType, dateKey, metadata),
    };
  try {
    const row = await saveRawDataToR2(
      source,
      assetType,
      symbol,
      dataType,
      dateKey,
      payload,
      metadata,
    );
    return {
      saved: true,
      r2Key:
        row?.r2Key ??
        buildR2Key(source, assetType, symbol, dataType, dateKey, metadata),
      rawDataObjectId: row?.id ?? null,
    };
  } catch (error) {
    return {
      saved: false,
      reason: "r2_save_failed",
      errorMessageSafe:
        error instanceof Error ? error.message.slice(0, 160) : "R2 save failed",
      r2Key: buildR2Key(source, assetType, symbol, dataType, dateKey, metadata),
    };
  }
}
