import { NextRequest, NextResponse } from "next/server";
import type { ArticleEvidenceReport } from "@/lib/equity-signal/article-evidence";
import { buildApprovedUsWatchOutReview } from "@/lib/equity-signal/us-watch-out-engine";
import { promoteApprovedWatchOutRules } from "@/lib/equity-signal/us-watch-out-serious-promotion";
import {
  getR2Config,
  readVersionedTextFromR2,
  writeVersionedJsonToR2,
} from "@/lib/r2-warehouse";

export const dynamic = "force-dynamic";

const BRANCH = "agent/combined-opportunity-engine";
const R2_PREFIX = "branch-labs/pr-262/serious-signal/us-watch-out";
const LATEST_KEY = `${R2_PREFIX}/latest.json`;

const state = globalThis as typeof globalThis & {
  __swingUpUsWatchOutScan?: Promise<Record<string, unknown>>;
};

function branchAllowed() {
  if (process.env.SWING_UP_COMBINED_ENGINE_ALLOW_LOCAL === "true") return true;
  const branch = process.env.RAILWAY_GIT_BRANCH?.trim();
  const environment = process.env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase();
  return Boolean(process.env.RAILWAY_PROJECT_ID && branch === BRANCH && environment && environment !== "production");
}

function suppliedToken(request: NextRequest) {
  return request.headers.get("x-swing-up-branch-lab-token")?.trim()
    || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
}

function schedulerIdentity(request: NextRequest) {
  const owner = request.headers.get("x-swing-up-branch-lab-scheduler");
  const workerId = request.headers.get("x-swing-up-branch-lab-worker-id")?.trim() || "";
  const workerStartedAt = request.headers.get("x-swing-up-branch-lab-worker-started-at")?.trim() || "";
  const sequence = Number(request.headers.get("x-swing-up-branch-lab-worker-sequence"));
  if (owner !== "dedicated_worker") return null;
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(workerId)) return null;
  if (!Number.isFinite(Date.parse(workerStartedAt))) return null;
  if (!Number.isInteger(sequence) || sequence < 1) return null;
  return { owner, workerId, workerStartedAt, sequence };
}

function emptyArticleEvidence(): ArticleEvidenceReport {
  return {
    policyVersion: 1,
    maximumFullArticlesPerScan: 0,
    maximumConcurrentArticleReads: 0,
    maximumBytesPerArticle: 300_000,
    headlineAloneCanPromoteSeriousSignal: false,
    candidates: {},
    diagnostics: {
      candidatesConsidered: 0,
      urlsSelected: 0,
      urlsFetched: 0,
      urlsSupported: 0,
      urlsFailed: 0,
      officialStructuredCandidates: 0,
    },
  };
}

function dateKey(value: string) {
  return value.replace(/[^0-9]/g, "").slice(0, 17);
}

async function runScan(identity: NonNullable<ReturnType<typeof schedulerIdentity>>) {
  const checkedAt = new Date().toISOString();
  const review = await buildApprovedUsWatchOutReview({ rankedCandidates: [], now: new Date(checkedAt), fetchImpl: fetch });
  const promoted = promoteApprovedWatchOutRules({
    watchOutReview: review,
    articleEvidence: emptyArticleEvidence(),
  });
  const seriousSignals = promoted.seriousSignals;
  const immutableRunKey = `${R2_PREFIX}/runs/${checkedAt.slice(0, 10)}/${dateKey(checkedAt)}-${identity.workerId.slice(0, 8)}-${identity.sequence}.json`;
  const report = {
    version: 1,
    ok: review.marketStructureScan.pagesFailed === 0,
    mode: "pr262_us_watch_out_live",
    branch: BRANCH,
    checkedAt,
    runtime: {
      commitSha: process.env.RAILWAY_GIT_COMMIT_SHA?.trim() || null,
      deploymentId: process.env.RAILWAY_DEPLOYMENT_ID?.trim() || null,
    },
    schedulerInvocation: identity,
    marketScope: "US listed common equities and ADRs only",
    marketStructureScan: review.marketStructureScan,
    counts: promoted.counts,
    seriousSignalFound: seriousSignals.length > 0,
    seriousSignalCount: seriousSignals.length,
    seriousSignals,
    blockedPromotionCandidates: promoted.blockedPromotionCandidates,
    certificationDisclosure: promoted.certificationDisclosure,
    warehouse: {
      backend: "cloudflare_r2",
      latestKey: LATEST_KEY,
      immutableRunKey,
      persisted: false,
      errors: [] as string[],
    },
    safety: {
      databaseWrites: false,
      publishing: false,
      notifications: false,
      trades: false,
      productionWrites: false,
      noSyntheticData: true,
    },
  };

  try {
    if (!getR2Config().configured) throw new Error("cloudflare_r2_not_configured");
    await writeVersionedJsonToR2(LATEST_KEY, report);
    const immutable = await writeVersionedJsonToR2(immutableRunKey, report, { createOnly: true });
    if (!immutable.written && !immutable.conflict) throw new Error("watch_out_immutable_r2_write_failed");
    report.warehouse.persisted = true;
  } catch (error) {
    report.ok = false;
    report.warehouse.errors.push(error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 300) : "unknown_watch_out_r2_error");
  }

  // Refresh latest after the persistence flag is known. If this write fails, the
  // immutable object from above still preserves the exact scan and its signals.
  if (report.warehouse.persisted) {
    await writeVersionedJsonToR2(LATEST_KEY, report).catch(() => {});
  }
  return report;
}

export async function GET() {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  if (!getR2Config().configured) {
    return NextResponse.json({ ok: false, ready: false, error: "cloudflare_r2_not_configured" }, { status: 503 });
  }
  try {
    const latest = await readVersionedTextFromR2(LATEST_KEY);
    if (!latest.found || !latest.text) {
      return NextResponse.json({
        ok: true,
        ready: false,
        branch: BRANCH,
        latestKey: LATEST_KEY,
        safety: { databaseWrites: false, publishing: false, notifications: false, trades: false },
      });
    }
    return NextResponse.json({ ...JSON.parse(latest.text), ready: true });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      ready: false,
      error: error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 300) : "watch_out_latest_read_failed",
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const expected = process.env.SWING_UP_BRANCH_LAB_RUNTIME_TOKEN?.trim();
  if (!expected || suppliedToken(request) !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const identity = schedulerIdentity(request);
  if (!identity) return NextResponse.json({ ok: false, error: "invalid_scheduler" }, { status: 403 });

  if (!state.__swingUpUsWatchOutScan) {
    state.__swingUpUsWatchOutScan = runScan(identity).finally(() => {
      delete state.__swingUpUsWatchOutScan;
    });
  }
  const report = await state.__swingUpUsWatchOutScan;
  return NextResponse.json(report, { status: report.ok === true ? 200 : 503 });
}
