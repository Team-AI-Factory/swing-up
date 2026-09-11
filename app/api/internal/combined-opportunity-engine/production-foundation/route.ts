import { NextRequest, NextResponse } from "next/server";
import { internalApiScopeAuthorized } from "@/lib/internal-api-auth";
import { loadPr262ExposureIndex } from "@/lib/opportunity-engine/pr262-exposure-index";
import {
  readResumableUsValueState,
  runResumableUsValueBatch,
} from "@/lib/opportunity-engine/us-value-investing-resumable";
import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";
import { pr262StorageKey, resolvePr262StoragePrefix } from "@/lib/opportunity-engine/pr262-storage";
import { isPr262ApprovedPremergeProductionRollout } from "@/lib/opportunity-engine/pr262-runtime";
import { getValuationWatchlistStatus } from "@/lib/opportunity-engine/valuation-watchlist-feed";

export const dynamic = "force-dynamic";

const PR262_BRANCH = "agent/combined-opportunity-engine";
const REFRESH_AFTER_MS = 20 * 60 * 60_000;
const FORCE_ONCE_STATE_KEY = pr262StorageKey("value-investing/runtime/force-foundation-once-v1.json");

const runtime = globalThis as typeof globalThis & {
  __swingUpProductionFoundationRun?: Promise<Awaited<ReturnType<typeof runResumableUsValueBatch>>>;
};

function productionEnabled() {
  if (process.env.SWING_UP_PR262_PRODUCTION_FOUNDATION_ENABLED?.trim().toLowerCase() !== "true") return false;
  const branch = process.env.RAILWAY_GIT_BRANCH?.trim() ?? "";
  const environment = process.env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase() ?? "";
  if (branch === PR262_BRANCH) {
    if (!isPr262ApprovedPremergeProductionRollout()) return false;
  } else if (branch !== "main" && environment !== "production") return false;
  return resolvePr262StoragePrefix() === "production/pr262/";
}

function safeError(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/\s+/g, " ").slice(0, 400)
    : "production_foundation_failed";
}

function freshComplete(state: Awaited<ReturnType<typeof readResumableUsValueState>>, now = Date.now()) {
  if (state?.status !== "complete" || !state.completedAt) return false;
  const completedAt = Date.parse(state.completedAt);
  return Number.isFinite(completedAt)
    && completedAt <= now + 5 * 60_000
    && now - completedAt < REFRESH_AFTER_MS;
}

async function consumeForceOnceGate(request: NextRequest, now = new Date()) {
  const enabled = process.env.SWING_UP_PR262_FORCE_FOUNDATION_ONCE?.trim().toLowerCase() === "true";
  const requested = request.nextUrl.searchParams.get("force") === "true";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await readVersionedTextFromR2(FORCE_ONCE_STATE_KEY);
    const prior = current.found && current.text
      ? JSON.parse(current.text) as { enabled?: unknown; consumedAt?: unknown }
      : null;
    if (!enabled) {
      if (!prior || prior.enabled === false) return false;
      const reset = await writeVersionedJsonToR2(FORCE_ONCE_STATE_KEY, {
        version: 1,
        enabled: false,
        consumedAt: null,
        updatedAt: now.toISOString(),
      }, current.etag ? { expectedEtag: current.etag } : { createOnly: true });
      if (!reset.conflict) return false;
      continue;
    }
    if (!requested) return false;
    if (prior?.enabled === true && typeof prior.consumedAt === "string") return false;
    const consumed = await writeVersionedJsonToR2(FORCE_ONCE_STATE_KEY, {
      version: 1,
      enabled: true,
      consumedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }, current.etag ? { expectedEtag: current.etag } : { createOnly: true });
    if (!consumed.conflict) return true;
  }
  throw new Error("production_foundation_force_once_gate_conflict");
}

async function completeExposure() {
  const exposure = await loadPr262ExposureIndex();
  if (exposure.version !== 2 || exposure.valueCoverage.complete !== true || exposure.entries.length === 0) {
    throw new Error("production_foundation_exposure_incomplete");
  }
  return {
    ready: true,
    builtAt: exposure.builtAt,
    entries: exposure.entries.length,
    valueCoverage: exposure.valueCoverage,
  };
}

async function foundationCandidateSummary() {
  const watchlist = await getValuationWatchlistStatus({ limit: 200 });
  const candidates = watchlist.candidates
    .filter((candidate) => candidate.action !== "price_watch")
    .map((candidate) => ({
      ticker: candidate.ticker,
      company: candidate.company,
      action: candidate.action,
      currentPrice: candidate.currentPrice,
      baseValue: candidate.fairValue.base,
      upsideToBasePercent: candidate.fairValue.upsideToBasePercent,
      specialistModelApplied: candidate.specialistModelApplied,
      userAlertEligible: false as const,
    }));
  return {
    cycleId: watchlist.foundation.cycleId,
    complete: watchlist.foundation.complete,
    buyCount: watchlist.summary.buyResearch,
    sellCount: watchlist.summary.sellResearch,
    watchOutCount: watchlist.summary.watchOutResearch,
    candidates,
    candidatesComplete: !watchlist.truncated
      || candidates.length >= watchlist.summary.buyResearch + watchlist.summary.sellResearch + watchlist.summary.watchOutResearch,
    provisionalResearchOnly: true as const,
  };
}

export async function POST(request: NextRequest) {
  if (!internalApiScopeAuthorized(request.headers, "foundation_runtime")) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (!productionEnabled()) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  try {
    const prior = await readResumableUsValueState();
    const forceOnce = freshComplete(prior) ? await consumeForceOnceGate(request) : false;
    if (freshComplete(prior) && !forceOnce) {
      const [exposure, candidateSummary] = await Promise.all([
        completeExposure(),
        foundationCandidateSummary(),
      ]);
      return NextResponse.json({
        ok: true,
        mode: "pr262_production_foundation",
        status: "complete",
        skipped: true,
        reason: "production_foundation_fresh",
        checkedAt: new Date().toISOString(),
        progress: {
          cycleId: prior?.cycleId ?? null,
          totalCompanies: prior?.totalCompanies ?? 0,
          companiesStored: prior?.companiesStored ?? 0,
          totalBatches: prior?.totalBatches ?? 0,
          batchesCompleted: prior?.completedBatchKeys.length ?? 0,
          coveragePercent: prior?.totalCompanies
            ? Math.round(((prior.companiesStored / prior.totalCompanies) * 100) * 100) / 100
            : 0,
        },
        exposure,
        foundationCandidateSummary: candidateSummary,
        safety: {
          databaseWrites: false,
          publishing: false,
          notifications: false,
          trades: false,
          productionR2WritesPossible: true,
          writesLimitedToFoundationAndExposure: true,
        },
      });
    }

    if (!runtime.__swingUpProductionFoundationRun) {
      runtime.__swingUpProductionFoundationRun = runResumableUsValueBatch({
        foundationOnly: true,
        requireCompleteUniverse: true,
      }).finally(() => {
        delete runtime.__swingUpProductionFoundationRun;
      });
    }
    const result = await runtime.__swingUpProductionFoundationRun;
    const [exposure, candidateSummary] = result.status === "complete"
      ? await Promise.all([completeExposure(), foundationCandidateSummary()])
      : [null, null];
    return NextResponse.json({
      ...result,
      mode: "pr262_production_foundation",
      foundationOnly: true,
      exposure,
      foundationCandidateSummary: candidateSummary,
    }, { status: result.ok ? 200 : 503 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      mode: "pr262_production_foundation",
      status: "technical_failure",
      checkedAt: new Date().toISOString(),
      error: safeError(error),
      safety: {
        databaseWrites: false,
        publishing: false,
        notifications: false,
        trades: false,
        productionR2WritesPossible: true,
        partialFoundationWritesMayRemainForResume: true,
      },
    }, { status: 503 });
  }
}
