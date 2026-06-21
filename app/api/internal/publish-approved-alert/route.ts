import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { absoluteUrl, alertSeoSlug, canonicalAlertPath, jsonRecord } from "@/lib/seo-alerts";

const PUBLISHABLE_STATUSES = new Set(["approved", "published"]);
const BLOCKED_DRAFT_STATUSES = new Set(["candidate", "draft", "queued", "review", "ready_for_review", "needs_more_data", "rejected", "blocked"]);
const UNSAFE_WORDS = [/guarantee/i, /guaranteed/i, /risk[-\s]?free/i, /can't lose/i, /sure thing/i, /100%/i, /mock/i, /placeholder/i, /draft/i];
const MIN_PROFIT_SCORE = 60;
const MIN_EVIDENCE_SCORE = 60;

type PublishPayload = { candidateAlertId?: unknown; alertId?: unknown; dryRun?: unknown; confirmPublish?: unknown };
type BlockCode = "missing_alert_id" | "database_unavailable" | "not_found" | "not_publishable_status" | "proof_missing" | "risk_missing" | "scores_missing" | "weak_scores" | "unsafe_wording" | "public_tracking_disabled" | "confirmation_required";

type AlertRecord = Prisma.AlertGetPayload<{
  include: {
    scores: { orderBy: { createdAt: "desc" }; take: 1 };
    sources: true;
    patternMatches: { orderBy: { createdAt: "desc" }; take: 1 };
    publicLedger: { orderBy: { createdAt: "desc" }; take: 1 };
  };
}>;

function boolValue(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true" ? true : value.toLowerCase() === "false" ? false : fallback;
  return fallback;
}

function decimalText(value: Prisma.Decimal | null | undefined) {
  return value ? value.toString() : null;
}

function trackingEnabled() {
  return process.env.PUBLIC_LEDGER_TRACKING_ENABLED !== "false" && process.env.PUBLIC_TRACKING_ENABLED !== "false";
}

function hasProof(alert: AlertRecord) {
  return alert.sources.some((source) => Boolean(source.receiptUrl?.trim() || source.summary?.trim()));
}

function unsafeWordingReasons(alert: AlertRecord) {
  const text = [alert.ticker, alert.company, alert.action, alert.event, ...alert.sources.map((source) => `${source.summary ?? ""} ${source.receiptUrl ?? ""}`)].join("\n");
  return UNSAFE_WORDS.filter((pattern) => pattern.test(text)).map((pattern) => `Unsafe or non-public wording matched ${pattern.toString()}.`);
}

function review(alert: AlertRecord) {
  const blockedReasons: string[] = [];
  const blockCodes: BlockCode[] = [];
  const warnings: string[] = [];
  const status = alert.status.toLowerCase();
  const score = alert.scores[0];
  const unsafe = unsafeWordingReasons(alert);

  if (BLOCKED_DRAFT_STATUSES.has(status) || !PUBLISHABLE_STATUSES.has(status)) {
    blockCodes.push("not_publishable_status");
    blockedReasons.push(`Alert status is ${alert.status}; only approved alerts can be newly published.`);
  }
  if (!hasProof(alert)) {
    blockCodes.push("proof_missing");
    blockedReasons.push("No source proof/receipt is attached to this alert.");
  }
  if (!score) {
    blockCodes.push("scores_missing", "risk_missing");
    blockedReasons.push("No alert score exists, so scores and risk cannot be verified.");
  } else {
    if (!score.riskLevel?.trim()) {
      blockCodes.push("risk_missing");
      blockedReasons.push("Risk level is missing from the latest alert score.");
    }
    if (score.profitPotential < MIN_PROFIT_SCORE || score.evidenceConfidence < MIN_EVIDENCE_SCORE) {
      blockCodes.push("weak_scores");
      blockedReasons.push(`Latest scores are too weak for publication (profit ${score.profitPotential}, evidence ${score.evidenceConfidence}; minimum ${MIN_PROFIT_SCORE}/${MIN_EVIDENCE_SCORE}).`);
    }
  }
  if (unsafe.length) {
    blockCodes.push("unsafe_wording");
    blockedReasons.push(...unsafe);
  }
  if (!trackingEnabled()) {
    blockCodes.push("public_tracking_disabled");
    blockedReasons.push("Public tracking is disabled by environment configuration.");
  }

  if (alert.publicLedger.length > 0) warnings.push("Existing public ledger row is already connected; publish will reuse it.");
  return { blockedReasons, blockCodes: Array.from(new Set(blockCodes)), warnings, score };
}

function ledgerEntry(alert: AlertRecord, priceAtAlert: string | null, now: Date): Prisma.InputJsonObject {
  const score = alert.scores[0];
  const match = alert.patternMatches[0];
  const existing = jsonRecord(alert.publicLedger[0]?.entry);
  return {
    ...existing,
    alertId: alert.id,
    ticker: alert.ticker,
    company: alert.company,
    action: alert.action,
    event: alert.event,
    alertDate: (alert.publishedAt ?? now).toISOString(),
    priceAtAlert: existing.priceAtAlert ?? priceAtAlert,
    latestPrice: existing.latestPrice ?? priceAtAlert,
    profitPotentialScore: score?.profitPotential ?? null,
    evidenceConfidenceScore: score?.evidenceConfidence ?? null,
    riskLevel: score?.riskLevel ?? null,
    historicalPatternMatch: match?.confidenceLabel ?? match?.similarity?.toString() ?? null,
    outcome: existing.outcome ?? "tracking",
    status: existing.status ?? "tracking",
    receiptsCount: alert.sources.length,
    sourceMode: "live",
    trackingStartedAt: existing.trackingStartedAt ?? now.toISOString(),
    createdFrom: existing.createdFrom ?? "api/internal/publish-approved-alert",
    result: existing.result ?? "Tracking started; no performance outcome has been classified yet.",
  };
}

function response(params: { dryRun: boolean; published: boolean; alert: AlertRecord | null; ledgerSlug?: string | null; priceAtAlert?: string | null; blockedReasons: string[]; warnings: string[]; nextRecommendedAction: string }) {
  const seoSlug = params.alert ? (params.ledgerSlug?.trim() || alertSeoSlug({ ...params.alert, publishedAt: params.alert.publishedAt ?? new Date() })) : null;
  const publicAlertPath = params.alert && seoSlug ? canonicalAlertPath({ ...params.alert, publishedAt: params.alert.publishedAt ?? new Date() }, seoSlug) : null;
  return {
    ok: params.blockedReasons.length === 0,
    dryRun: params.dryRun,
    published: params.published,
    publicAlertUrl: publicAlertPath ? absoluteUrl(publicAlertPath) : null,
    publicLedgerUrl: params.ledgerSlug ? absoluteUrl(`/ledger/${params.ledgerSlug}`) : null,
    seoSlug,
    priceAtAlert: params.priceAtAlert ?? null,
    blockedReasons: params.blockedReasons,
    warnings: params.warnings,
    nextRecommendedAction: params.nextRecommendedAction,
  };
}

export async function POST(request: NextRequest) {
  let payload: PublishPayload;
  try {
    payload = (await request.json()) as PublishPayload;
  } catch {
    return NextResponse.json({ ok: false, dryRun: true, published: false, publicAlertUrl: null, publicLedgerUrl: null, seoSlug: null, priceAtAlert: null, blockedReasons: ["Request body must be valid JSON."], warnings: [], nextRecommendedAction: "Send JSON with candidateAlertId or alertId." }, { status: 400 });
  }

  const dryRun = boolValue(payload.dryRun, true);
  const confirmPublish = boolValue(payload.confirmPublish, false);
  const alertId = (typeof payload.alertId === "string" ? payload.alertId : typeof payload.candidateAlertId === "string" ? payload.candidateAlertId : "").trim();
  if (!alertId) {
    return NextResponse.json(response({ dryRun, published: false, alert: null, blockedReasons: ["candidateAlertId or alertId is required."], warnings: [], nextRecommendedAction: "Retry with a real approved alert id." }), { status: 400 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(response({ dryRun, published: false, alert: null, blockedReasons: ["DATABASE_URL is not configured."], warnings: [], nextRecommendedAction: "Configure the live database before publishing." }), { status: 503 });
  }

  const alert = await prisma.alert.findUnique({ where: { id: alertId }, include: { scores: { orderBy: { createdAt: "desc" }, take: 1 }, sources: true, patternMatches: { orderBy: { createdAt: "desc" }, take: 1 }, publicLedger: { orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!alert) {
    return NextResponse.json(response({ dryRun, published: false, alert: null, blockedReasons: ["Alert was not found."], warnings: [], nextRecommendedAction: "Verify the candidateAlertId/alertId before retrying." }), { status: 404 });
  }

  const latestSnapshot = await prisma.priceSnapshot.findFirst({ where: { ticker: alert.ticker }, orderBy: { capturedAt: "desc" } });
  const priceAtAlert = decimalText(latestSnapshot?.price);
  const checked = review(alert);
  const warnings = [...checked.warnings];
  if (!priceAtAlert) warnings.push("No price snapshot was available; priceAtAlert will remain null rather than using a fake price.");
  if (!dryRun && !confirmPublish) checked.blockedReasons.push("confirmPublish=true is required when dryRun=false.");

  if (dryRun || checked.blockedReasons.length > 0) {
    const action = checked.blockedReasons.length ? "Resolve blockedReasons before publishing." : "Retry with dryRun=false and confirmPublish=true to publish and connect the ledger row.";
    return NextResponse.json(response({ dryRun, published: false, alert, ledgerSlug: alert.publicLedger[0]?.publicSlug, priceAtAlert, blockedReasons: checked.blockedReasons, warnings, nextRecommendedAction: action }), { status: checked.blockedReasons.length ? 409 : 200 });
  }

  const now = new Date();
  const seoSlug = alert.publicLedger[0]?.publicSlug ?? alertSeoSlug({ ...alert, publishedAt: alert.publishedAt ?? now });
  const entry = ledgerEntry(alert, priceAtAlert, now);

  const result = await prisma.$transaction(async (tx) => {
    const publishedAlert = await tx.alert.update({ where: { id: alert.id }, data: { status: "published", publishedAt: alert.publishedAt ?? now }, include: { scores: { orderBy: { createdAt: "desc" }, take: 1 }, sources: true, patternMatches: { orderBy: { createdAt: "desc" }, take: 1 }, publicLedger: { orderBy: { createdAt: "desc" }, take: 1 } } });
    const ledger = alert.publicLedger[0]
      ? await tx.publicLedger.update({ where: { id: alert.publicLedger[0].id }, data: { alertId: alert.id, entry } })
      : await tx.publicLedger.create({ data: { alertId: alert.id, publicSlug: seoSlug, entry } });
    return { alert: publishedAlert, ledger };
  });

  return NextResponse.json(response({ dryRun: false, published: true, alert: result.alert, ledgerSlug: result.ledger.publicSlug, priceAtAlert, blockedReasons: [], warnings, nextRecommendedAction: "Open the public alert and ledger URLs, then let outcome tracking update win/loss checkpoints over time." }));
}
