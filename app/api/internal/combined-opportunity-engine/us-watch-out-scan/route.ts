import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { ArticleEvidenceReport } from "@/lib/equity-signal/article-evidence";
import { loadEquityUniverse } from "@/lib/equity-signal/universe";
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
const OUTBOX_PREFIX = "branch-labs/pr-262/serious-signal/outbox/watch-out";
const DAILY_MARKET_RULES = new Set([
  "liquidity_collapse_or_gap_risk",
  "volatility_regime_spike",
]);
const SERIOUS_EXCHANGE_NAMES = new Set([
  "NASDAQ",
  "NYSE",
  "NYSE AMERICAN",
  "AMEX",
  "NYSEAMERICAN",
]);

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

function normalizedExchange(value: string | null) {
  return (value ?? "").toUpperCase().replace(/[^A-Z ]+/g, "").replace(/\s+/g, " ").trim();
}

function signalFingerprint(signal: Record<string, unknown>, checkedAt: string) {
  const ruleId = typeof signal.ruleId === "string" ? signal.ruleId : "unknown";
  const ticker = typeof signal.ticker === "string" ? signal.ticker.toUpperCase() : "UNKNOWN";
  const identity = DAILY_MARKET_RULES.has(ruleId)
    ? `${ruleId}|${ticker}|${checkedAt.slice(0, 10)}`
    : `${ruleId}|${ticker}|${typeof signal.duplicateKey === "string" ? signal.duplicateKey : checkedAt.slice(0, 13)}`;
  return crypto.createHash("sha256").update(identity).digest("hex").slice(0, 24);
}

async function persistNewSignalOutbox(signals: Array<Record<string, unknown>>, checkedAt: string) {
  const output: Array<Record<string, unknown>> = [];
  for (const signal of signals) {
    const fingerprint = signalFingerprint(signal, checkedAt);
    const ticker = typeof signal.ticker === "string" ? signal.ticker.toUpperCase() : "UNKNOWN";
    const ruleId = typeof signal.ruleId === "string" ? signal.ruleId : "unknown";
    const key = `${OUTBOX_PREFIX}/${checkedAt.slice(0, 10)}/${ruleId}/${ticker}/${fingerprint}.json`;
    const payload = {
      version: 1,
      kind: "pr262_new_serious_watch_out",
      branch: BRANCH,
      fingerprint,
      checkedAt,
      signal,
      deliveryStatus: "pending_internal_notification_channel",
      safety: {
        databaseWrites: false,
        publishing: false,
        userNotificationsSent: false,
        trades: false,
      },
    };
    const written = await writeVersionedJsonToR2(key, payload, { createOnly: true });
    if (!written.written) continue;
    output.push({
      fingerprint,
      outboxKey: key,
      ticker: signal.ticker ?? null,
      company: signal.company ?? null,
      ruleId: signal.ruleId ?? null,
      ruleName: signal.ruleName ?? null,
      currentPrice: signal.currentPrice ?? null,
      reasons: Array.isArray(signal.reasons) ? signal.reasons : [],
    });
  }
  return output;
}

async function runScan(identity: NonNullable<ReturnType<typeof schedulerIdentity>>) {
  const checkedAt = new Date().toISOString();
  const now = new Date(checkedAt);
  const [review, universe] = await Promise.all([
    buildApprovedUsWatchOutReview({ rankedCandidates: [], now, fetchImpl: fetch }),
    loadEquityUniverse(fetch, now),
  ]);
  const promoted = promoteApprovedWatchOutRules({
    watchOutReview: review,
    articleEvidence: emptyArticleEvidence(),
  });
  const eligibleEntries = universe.snapshot.entries.filter((entry) => SERIOUS_EXCHANGE_NAMES.has(normalizedExchange(entry.exchange)));
  const eligibleTickers = new Set(eligibleEntries.map((entry) => entry.ticker.toUpperCase()));
  const allPromoted = promoted.seriousSignals as unknown as Array<Record<string, unknown>>;
  const seriousSignals = allPromoted.filter((signal) => {
    const ticker = typeof signal.ticker === "string" ? signal.ticker.toUpperCase() : "";
    return eligibleTickers.has(ticker);
  });
  const researchOnlyExcludedSignals = allPromoted.filter((signal) => {
    const ticker = typeof signal.ticker === "string" ? signal.ticker.toUpperCase() : "";
    return !eligibleTickers.has(ticker);
  });
  const immutableRunKey = `${R2_PREFIX}/runs/${checkedAt.slice(0, 10)}/${dateKey(checkedAt)}-${identity.workerId.slice(0, 8)}-${identity.sequence}.json`;
  const report = {
    version: 3,
    ok: review.marketStructureScan.pagesFailed === 0 && eligibleEntries.length >= 4_500,
    mode: "pr262_us_watch_out_live",
    branch: BRANCH,
    checkedAt,
    runtime: {
      commitSha: process.env.RAILWAY_GIT_COMMIT_SHA?.trim() || null,
      deploymentId: process.env.RAILWAY_DEPLOYMENT_ID?.trim() || null,
    },
    schedulerInvocation: identity,
    marketScope: "NASDAQ, NYSE, and NYSE American common stocks and ADRs only for serious alerts",
    seriousScope: {
      eligibleExchanges: ["NASDAQ", "NYSE", "NYSE American"],
      eligibleListings: eligibleEntries.length,
      source: universe.snapshot.sources,
      constructionMode: universe.snapshot.constructionMode,
      researchOnlyExcludedCount: researchOnlyExcludedSignals.length,
      researchOnlyExclusionReason: "OTC and unsupported exchange listings are retained outside the serious notification lane because thin liquidity creates excessive noise.",
    },
    marketStructureScan: review.marketStructureScan,
    counts: {
      ...review.counts,
      seriousEligible: seriousSignals.length,
      researchOnlyExcluded: researchOnlyExcludedSignals.length,
    },
    seriousSignalFound: seriousSignals.length > 0,
    seriousSignalCount: seriousSignals.length,
    seriousSignals,
    researchOnlyExcludedSignals: researchOnlyExcludedSignals.slice(0, 250),
    newSeriousSignalCount: 0,
    newSeriousSignals: [] as Array<Record<string, unknown>>,
    blockedPromotionCandidates: promoted.blockedPromotionCandidates,
    certificationDisclosure: promoted.certificationDisclosure,
    notificationOutbox: {
      prefix: OUTBOX_PREFIX,
      deliveryEnabled: false,
      deduplication: "market-structure rules alert once per ticker/rule/day; event rules use their stable evidence key",
    },
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
    report.newSeriousSignals = await persistNewSignalOutbox(seriousSignals, checkedAt);
    report.newSeriousSignalCount = report.newSeriousSignals.length;
    await writeVersionedJsonToR2(LATEST_KEY, report);
    const immutable = await writeVersionedJsonToR2(immutableRunKey, report, { createOnly: true });
    if (!immutable.written && !immutable.conflict) throw new Error("watch_out_immutable_r2_write_failed");
    report.warehouse.persisted = true;
  } catch (error) {
    report.ok = false;
    report.warehouse.errors.push(error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 300) : "unknown_watch_out_r2_error");
  }

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
