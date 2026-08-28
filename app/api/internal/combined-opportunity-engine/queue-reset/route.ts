import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { internalApiScopeAuthorized } from "@/lib/internal-api-auth";
import { pr262StorageKey, resolvePr262StoragePrefix } from "@/lib/opportunity-engine/pr262-storage";
import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRODUCTION_PREFIX = "production/pr262/";
const CONFIRMATION = "CLEAR_PR262_PENDING_QUEUE_KEEP_SEEN_V1";

function hidden() {
  return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeError(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/\s+/g, " ").slice(0, 240)
    : "pr262_queue_reset_failed";
}

function productionResetEnabled() {
  return process.env.SWING_UP_PR262_QUEUE_RESET_ENABLED?.trim().toLowerCase() === "true"
    && process.env.SWING_UP_R2_WRITE_PREFIX?.trim() === PRODUCTION_PREFIX
    && resolvePr262StoragePrefix() === PRODUCTION_PREFIX;
}

export async function POST(request: NextRequest) {
  if (!internalApiScopeAuthorized(request.headers, "automation") || !productionResetEnabled()) {
    return hidden();
  }

  let body: { confirmation?: unknown };
  try {
    body = await request.json() as { confirmation?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (body.confirmation !== CONFIRMATION) {
    return NextResponse.json({ ok: false, error: "queue_reset_confirmation_required" }, { status: 400 });
  }

  const stateKey = pr262StorageKey("sensor/state-v1.json");
  try {
    const current = await readVersionedTextFromR2(stateKey);
    if (!current.found || !current.text || !current.etag) {
      throw new Error("pr262_queue_state_missing");
    }
    const parsed = record(JSON.parse(current.text));
    if (!parsed
      || parsed.version !== 2
      || !Array.isArray(parsed.pending)
      || !Array.isArray(parsed.seen)) {
      throw new Error("pr262_queue_state_contract_invalid");
    }

    const resetAt = new Date().toISOString();
    const removedCount = parsed.pending.length;
    const seenCount = parsed.seen.length;
    const digest = crypto.createHash("sha256").update(current.text).digest("hex").slice(0, 16);
    const backupKey = pr262StorageKey(
      `rollback/queue-reset-${resetAt.replace(/[:.]/g, "-")}-${digest}-${crypto.randomBytes(4).toString("hex")}.json`,
    );
    const backup = await writeVersionedJsonToR2(backupKey, {
      version: 1,
      kind: "pr262_queue_reset_rollback",
      createdAt: resetAt,
      sourceKey: stateKey,
      sourceEtag: current.etag,
      removedCount,
      state: parsed,
    }, { createOnly: true });
    if (!backup.written) throw new Error("pr262_queue_reset_backup_conflict");

    const nextState = {
      ...parsed,
      updatedAt: resetAt,
      pending: [],
    };
    const written = await writeVersionedJsonToR2(stateKey, nextState, { expectedEtag: current.etag });
    if (!written.written) {
      return NextResponse.json({
        ok: false,
        error: "pr262_queue_reset_state_changed",
        queueUntouched: true,
        backupKey,
      }, { status: 409 });
    }

    const verified = await readVersionedTextFromR2(stateKey);
    const verifiedState = verified.text ? record(JSON.parse(verified.text)) : null;
    const exactlyVerified = verified.found
      && verifiedState !== null
      && JSON.stringify(verifiedState) === JSON.stringify(nextState)
      && Array.isArray(verifiedState.pending)
      && verifiedState.pending.length === 0
      && Array.isArray(verifiedState.seen)
      && verifiedState.seen.length === seenCount;
    if (!exactlyVerified) throw new Error("pr262_queue_reset_verification_failed");

    return NextResponse.json({
      ok: true,
      mode: "pr262_pending_queue_reset",
      resetAt,
      stateKey,
      backupKey,
      removedCount,
      pendingCount: 0,
      seenCount,
      preservedSeen: true,
      preservedAllOtherState: true,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      mode: "pr262_pending_queue_reset",
      error: safeError(error),
    }, { status: 503 });
  }
}
