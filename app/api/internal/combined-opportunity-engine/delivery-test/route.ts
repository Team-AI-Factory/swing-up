import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { internalApiScopeAuthorized } from "@/lib/internal-api-auth";
import { deliverSeriousSignalOutbox } from "@/lib/notifications/serious-signal-delivery";
import { isPr262ApprovedPremergeProductionRollout } from "@/lib/opportunity-engine/pr262-runtime";
import { pr262StorageKey, resolvePr262StoragePrefix } from "@/lib/opportunity-engine/pr262-storage";
import { writeVersionedJsonToR2 } from "@/lib/r2-warehouse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function hidden() {
  return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
}

function safeError(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/bot[^/\s]+/gi, "bot[redacted]").replace(/\s+/g, " ").slice(0, 240)
    : "pr262_delivery_test_failed";
}

function configuredRunId() {
  const runId = process.env.SWING_UP_PR262_DELIVERY_TEST_RUN_ID?.trim() ?? "";
  return /^[a-z0-9][a-z0-9-]{11,63}$/i.test(runId) ? runId.toLowerCase() : null;
}

function testOutbox(createdAt: string, runId: string) {
  const fingerprint = crypto.createHash("sha256").update(`pr262-delivery-test:${runId}`).digest("hex");
  return {
    version: 1,
    kind: "pr262_serious_signal_delivery_test",
    testOnly: true,
    createdAt,
    ticker: "TEST",
    cik: "1",
    alertType: "buy",
    candidateFingerprint: fingerprint,
    candidate: {
      ticker: "TEST",
      cik: "1",
      direction: "upside",
      evidenceFingerprint: fingerprint,
      gatePassed: true,
      eventTruth: 100,
      mappingConfidence: 100,
      materiality: 100,
      transmissionConfidence: 100,
      evidenceIndependence: 100,
      contradictionPenalty: 0,
      pricedInPenalty: 0,
      rumour: false,
      eventHeadline: "DELIVERY TEST — not a company or market finding",
      whatHappened: "Synthetic payload used only to verify the configured delivery path.",
      quote: {
        price: 1,
        observedAt: createdAt,
        actionableForSeriousSignal: true,
        marketSession: "regular",
      },
      receipts: [],
    },
    committee: {
      agentsCompleted: 14,
      agentsFailed: 0,
      finalJudge: { verdict: "positive", confidence: 100 },
      output: {
        overallRecommendation: "approve",
        SwingUpView: "Synthetic delivery-path test; not investment analysis.",
      },
    },
    authority: {
      exactIssuerMapping: true,
      currentEvidenceGatesPassed: true,
      freshQuoteAndHaltStateKnown: true,
      fullCommitteeAgentsCompleted: 14,
      finalJudgePositiveMinimumConfidence: 100,
      historicalCasesRequired: false,
    },
  };
}

export async function POST(request: NextRequest) {
  if (!internalApiScopeAuthorized(request.headers, "delivery_test_runtime")) return hidden();
  const runId = configuredRunId();
  if (process.env.SWING_UP_PR262_APPROVED_DELIVERY_TEST?.trim().toLowerCase() !== "true"
    || !runId
    || !isPr262ApprovedPremergeProductionRollout()
    || resolvePr262StoragePrefix() !== "production/pr262/") return hidden();

  let body: { confirmDeliveryTest?: unknown };
  try { body = await request.json() as { confirmDeliveryTest?: unknown }; }
  catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  if (body.confirmDeliveryTest !== true) {
    return NextResponse.json({ ok: false, error: "delivery_test_confirmation_required" }, { status: 400 });
  }

  const createdAt = new Date().toISOString();
  const outboxKey = pr262StorageKey(`serious-signal/delivery-test/outbox/${runId}.json`);
  const auditKey = pr262StorageKey(`serious-signal/delivery-test/runs/${runId}.json`);

  try {
    const created = await writeVersionedJsonToR2(outboxKey, testOutbox(createdAt, runId), { createOnly: true });
    const first = await deliverSeriousSignalOutbox(outboxKey, {
      now: new Date(),
      ownerId: `delivery-test-${runId}-first`,
    });
    const second = await deliverSeriousSignalOutbox(outboxKey, {
      now: new Date(),
      ownerId: `delivery-test-${runId}-duplicate-check`,
    });
    if (first.outboxKey === null || second.outboxKey === null) {
      throw new Error("pr262_delivery_test_outbox_missing");
    }
    const firstWebFeedSent = first.channels.some((channel) => channel.channel === "web_feed" && channel.sent);
    const firstTelegramSent = first.channels.some((channel) => channel.channel === "telegram" && channel.sent);
    const deliveryReachedPrimary = first.ok && first.deliveryTest === true && first.seriousSignal === false;
    const duplicateSuppressed = second.ok
      && second.deliveryTest === true
      && second.seriousSignal === false
      && second.attempts === first.attempts
      && second.channels.every((channel) => !channel.sent);
    const firstInvocationProvedWebFeed = created.written ? firstWebFeedSent : true;
    const passed = deliveryReachedPrimary && duplicateSuppressed && firstInvocationProvedWebFeed;
    const channelDiagnostics = first.channels.map((channel) => ({
      channel: channel.channel,
      configured: channel.configured,
      sent: channel.sent,
      status: channel.status,
      responseStatus: channel.responseStatus ?? null,
      error: channel.error?.replace(/bot[^/\s]+/gi, "bot[redacted]").slice(0, 120) ?? null,
    }));

    const audit = {
      version: 1,
      kind: "pr262_serious_signal_delivery_test_audit",
      runId,
      checkedAt: new Date().toISOString(),
      passed,
      firstInvocationCreatedOutbox: created.written,
      firstInvocationWebFeedSent: firstWebFeedSent,
      firstInvocationTelegramSent: firstTelegramSent,
      deliveryStatus: first.deliveryStatus,
      duplicateStatus: second.deliveryStatus,
      duplicateSuppressed,
      channelDiagnostics,
      seriousSignalFeedExcluded: true,
      liveWebhookDisabled: true,
      destination: "authenticated_delivery_test_feed",
      deployedCommit: process.env.RAILWAY_GIT_COMMIT_SHA?.trim() || null,
    };
    await writeVersionedJsonToR2(auditKey, audit, { createOnly: true });
    console.log(`[pr262-delivery-test] ${JSON.stringify({
      runId,
      passed,
      firstInvocationCreatedOutbox: created.written,
      firstInvocationWebFeedSent: firstWebFeedSent,
      deliveryStatus: first.deliveryStatus,
      duplicateStatus: second.deliveryStatus,
      duplicateSuppressed,
      channelDiagnostics,
    })}`);
    if (!passed) {
      return NextResponse.json({
        ok: false,
        mode: "pr262_serious_signal_delivery_test",
        runId,
        testOnly: true,
        error: "pr262_delivery_test_contract_failed",
        deliveryStatus: first.deliveryStatus,
        duplicateStatus: second.deliveryStatus,
        duplicateSuppressed,
        channelDiagnostics,
      }, { status: 503 });
    }

    return NextResponse.json({
      ok: true,
      mode: "pr262_serious_signal_delivery_test",
      runId,
      testOnly: true,
      deliveryMode: "authenticated_r2_feed",
      firstInvocationWebFeedSent: firstWebFeedSent,
      firstInvocationTelegramSent: firstTelegramSent,
      deliveryStatus: first.deliveryStatus,
      duplicateSuppressed,
      seriousSignalFeedExcluded: true,
      liveWebhookDisabled: true,
      exactCommit: process.env.RAILWAY_GIT_COMMIT_SHA?.trim() || null,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      mode: "pr262_serious_signal_delivery_test",
      runId,
      testOnly: true,
      error: safeError(error),
    }, { status: 503 });
  }
}
