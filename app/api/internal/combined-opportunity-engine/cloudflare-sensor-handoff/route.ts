import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { internalApiScopeAuthorized } from "@/lib/internal-api-auth";
import {
  pr262CloudflareHandoffReceiptKey,
  verifyPr262CloudflareHandoff,
  type Pr262CloudflareHandoff,
} from "@/lib/opportunity-engine/pr262-cloudflare-handoff-auth";
import { runPr262AnalysisOnlyCycle } from "@/lib/opportunity-engine/pr262-cron-orchestrator";
import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const PR262_CLOUDFLARE_HANDOFF_RETIRED = true;

type Json = Record<string, unknown>;
type Receipt = {
  version: 1;
  kind: "pr262_cloudflare_handoff_receipt";
  scanId: string;
  acceptedAt: string;
  updatedAt: string;
  status: "accepted" | "processing" | "completed" | "failed";
  handoff: Pr262CloudflareHandoff;
  analysis: Json | null;
  error: string | null;
};

const runtime = globalThis as typeof globalThis & {
  __swingUpPr262CloudflareAnalysis?: Promise<Json>;
};
const ACTIVE_RECEIPT_MS = 4 * 60_000;

function safeMessage(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/\s+/g, " ").replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]").slice(0, 240)
    : "cloudflare_handoff_failed";
}

function asJson(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function normalizeEtag(value: string | null | undefined) {
  return value?.trim().replace(/^W\//i, "").replace(/^"|"$/g, "") ?? "";
}

async function verifyDurableObjects(payload: Pr262CloudflareHandoff) {
  const [state, run] = await Promise.all([
    readVersionedTextFromR2(payload.stateKey),
    readVersionedTextFromR2(payload.runKey),
  ]);
  if (!state.found || !state.text || !state.etag) throw new Error("cloudflare_handoff_state_missing");
  if (!run.found || !run.text) throw new Error("cloudflare_handoff_run_missing");
  // The state can legitimately change between the Worker PUT and this read if
  // Railway is acknowledging an older event. The signed ETag is retained for
  // audit, while the immutable run digest proves this exact scan existed.
  if (!normalizeEtag(payload.stateEtag)) throw new Error("cloudflare_handoff_state_etag_missing");
  const digest = crypto.createHash("sha256").update(run.text).digest("hex");
  if (digest !== payload.runDigest) throw new Error("cloudflare_handoff_run_digest_mismatch");
  const audit = asJson(JSON.parse(run.text));
  if (audit.kind !== "pr262_cloudflare_cheap_sensor_run"
    || audit.owner !== "cloudflare_worker"
    || audit.scanId !== payload.scanId
    || audit.checkedAt !== payload.checkedAt
    || audit.stateKey !== payload.stateKey
    || audit.runKey !== payload.runKey) {
    throw new Error("cloudflare_handoff_run_contract_mismatch");
  }
}

async function loadReceipt(key: string) {
  const current = await readVersionedTextFromR2(key);
  if (!current.found || !current.text) return { receipt: null as Receipt | null, etag: current.etag };
  try { return { receipt: JSON.parse(current.text) as Receipt, etag: current.etag }; }
  catch { throw new Error("cloudflare_handoff_receipt_invalid"); }
}

async function storeReceipt(key: string, receipt: Receipt, etag: string | null, createOnly = false) {
  const written = await writeVersionedJsonToR2(key, receipt, createOnly ? { createOnly: true } : { expectedEtag: etag });
  if (written.conflict) return null;
  return written.etag;
}

async function claimReceipt(payload: Pr262CloudflareHandoff) {
  const key = pr262CloudflareHandoffReceiptKey(payload);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const loaded = await loadReceipt(key);
    if (loaded.receipt?.status === "completed") return { key, receipt: loaded.receipt, etag: loaded.etag, completed: true, active: false };
    const activeAge = loaded.receipt ? Date.now() - Date.parse(loaded.receipt.updatedAt) : Number.POSITIVE_INFINITY;
    if (loaded.receipt
      && ["accepted", "processing"].includes(loaded.receipt.status)
      && Number.isFinite(activeAge)
      && activeAge >= 0
      && activeAge < ACTIVE_RECEIPT_MS) {
      return { key, receipt: loaded.receipt, etag: loaded.etag, completed: false, active: true };
    }
    const now = new Date().toISOString();
    const receipt: Receipt = {
      version: 1,
      kind: "pr262_cloudflare_handoff_receipt",
      scanId: payload.scanId,
      acceptedAt: loaded.receipt?.acceptedAt ?? now,
      updatedAt: now,
      status: "accepted",
      handoff: payload,
      analysis: loaded.receipt?.analysis ?? null,
      error: null,
    };
    const etag = await storeReceipt(key, receipt, loaded.etag, !loaded.receipt);
    if (etag) return { key, receipt, etag, completed: false, active: false };
  }
  throw new Error("cloudflare_handoff_receipt_conflict");
}

async function updateReceipt(key: string, expectedEtag: string | null, receipt: Receipt) {
  let etag = expectedEtag;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const nextEtag = await storeReceipt(key, receipt, etag);
    if (nextEtag) return nextEtag;
    const current = await loadReceipt(key);
    etag = current.etag;
  }
  throw new Error("cloudflare_handoff_receipt_update_conflict");
}

function beginAnalysis(claim: Awaited<ReturnType<typeof claimReceipt>>) {
  const prior = runtime.__swingUpPr262CloudflareAnalysis;
  const processing: Receipt = { ...claim.receipt, status: "processing", updatedAt: new Date().toISOString(), error: null };
  const work = (prior ? prior.catch(() => ({})) : Promise.resolve({})).then(async () => {
      let etag = await updateReceipt(claim.key, claim.etag, processing);
      try {
        const analysis = asJson(await runPr262AnalysisOnlyCycle());
        if (analysis.ok !== true) throw new Error(`pr262_analysis_cycle_incomplete:${String(analysis.mode ?? "unknown")}`);
        const completed: Receipt = { ...processing, status: "completed", updatedAt: new Date().toISOString(), analysis, error: null };
        etag = await updateReceipt(claim.key, etag, completed);
        return { ok: true, status: "completed", receiptKey: claim.key, receiptEtag: etag, analysis };
      } catch (error) {
        const failed: Receipt = { ...processing, status: "failed", updatedAt: new Date().toISOString(), analysis: null, error: safeMessage(error) };
        await updateReceipt(claim.key, etag, failed).catch(() => null);
        throw error;
      }
    });
  const tracked = work.finally(() => {
    if (runtime.__swingUpPr262CloudflareAnalysis === tracked) delete runtime.__swingUpPr262CloudflareAnalysis;
  });
  runtime.__swingUpPr262CloudflareAnalysis = tracked;
  // Attach a terminal rejection handler because Railway continues this
  // durable-queue consumer after the HTTP acknowledgement has been returned.
  void tracked.catch(() => null);
  return tracked;
}

export async function POST(request: NextRequest) {
  if (PR262_CLOUDFLARE_HANDOFF_RETIRED) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  if (!internalApiScopeAuthorized(request.headers, "sensor_handoff")) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 16_384) {
    return NextResponse.json({ ok: false, error: "invalid_handoff" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  try {
    const rawBody = await request.text();
    const payload = verifyPr262CloudflareHandoff({ rawBody, headers: request.headers });
    await verifyDurableObjects(payload);
    const claim = await claimReceipt(payload);
    if (claim.completed) {
      return NextResponse.json({ ok: true, accepted: true, duplicate: true, status: "completed", scanId: payload.scanId, receiptKey: claim.key }, { status: 200, headers: { "cache-control": "no-store" } });
    }
    if (claim.active) {
      return NextResponse.json({ ok: true, accepted: true, duplicate: true, status: claim.receipt.status, scanId: payload.scanId, receiptKey: claim.key }, { status: 202, headers: { "cache-control": "no-store" } });
    }
    const analysis = beginAnalysis(claim);
    const quick = await Promise.race([
      analysis.then(
        (result) => ({ settled: true as const, ok: true as const, result }),
        (error) => ({ settled: true as const, ok: false as const, error: safeMessage(error) }),
      ),
      new Promise<{ settled: false }>((resolve) => setTimeout(() => resolve({ settled: false }), 1_500)),
    ]);
    if (quick.settled) {
      if (!quick.ok) return NextResponse.json({ ok: false, accepted: true, duplicate: false, status: "failed", scanId: payload.scanId, receiptKey: claim.key, error: quick.error }, { status: 503, headers: { "cache-control": "no-store" } });
      return NextResponse.json({ ...quick.result, ok: true, accepted: true, duplicate: false, scanId: payload.scanId, receiptKey: claim.key }, { status: 200, headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json({ ok: true, accepted: true, duplicate: false, status: "processing", scanId: payload.scanId, receiptKey: claim.key, durableQueue: payload.stateKey }, { status: 202, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "invalid_handoff", reason: safeMessage(error) }, { status: 400, headers: { "cache-control": "no-store" } });
  }
}
