import { NextRequest, NextResponse } from "next/server";
import { internalApiScopeAuthorized } from "@/lib/internal-api-auth";
import { loadPr262ExposureIndex } from "@/lib/opportunity-engine/pr262-exposure-index";
import {
  readResumableUsValueState,
  runResumableUsValueBatch,
} from "@/lib/opportunity-engine/us-value-investing-resumable";
import { resolvePr262StoragePrefix } from "@/lib/opportunity-engine/pr262-storage";
import { isPr262ApprovedPremergeProductionRollout } from "@/lib/opportunity-engine/pr262-runtime";

export const dynamic = "force-dynamic";

const PR262_BRANCH = "agent/combined-opportunity-engine";
const REFRESH_AFTER_MS = 20 * 60 * 60_000;

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

export async function POST(request: NextRequest) {
  if (!internalApiScopeAuthorized(request.headers, "foundation_runtime")) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (!productionEnabled()) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  try {
    const prior = await readResumableUsValueState();
    if (freshComplete(prior)) {
      const exposure = await completeExposure();
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
    const exposure = result.status === "complete" ? await completeExposure() : null;
    return NextResponse.json({
      ...result,
      mode: "pr262_production_foundation",
      foundationOnly: true,
      exposure,
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
