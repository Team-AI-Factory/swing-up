import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { getEngineStartReadiness } from "@/lib/engine-start-readiness";
import { buildAiCommitteeEvidencePack } from "@/lib/ai-committee/evidence-pack";
import { getAiCommitteeProviderStatus } from "@/lib/ai-committee/provider";
import { runAiCommittee } from "@/lib/ai-committee/orchestrator";
import { runFinalJudge } from "@/lib/ai-committee/final-judge";
import { runApprovalGate } from "@/lib/approval-gate/approval-gate";
import { POST as candidateFactoryPOST } from "@/app/api/internal/candidate-factory-run/route";
import { POST as publishApprovedAlertPOST } from "@/app/api/internal/publish-approved-alert/route";
import { runSources } from "@/lib/ops/source-runner";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

const DEFAULT_PAYLOAD = {
  dryRun: true,
  confirmRun: false,
  confirmPublish: false,
  confirmSend: false,
  maxAlertsToPublish: 1,
  allowTelegram: false,
};

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function int(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

function arrayText(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function obj(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function isApproved(value: unknown) {
  const record = obj(value);
  return record.approvalRecommendation === "approve" && arrayText(record.failedChecks).length === 0;
}

async function latestUsefulRawSignal() {
  return prisma.rawSignal.findFirst({
    where: { OR: [{ ticker: { not: null } }, { sourceUrl: { not: null } }, { importanceHint: { in: ["high", "urgent"] } }, { processedStatus: { in: ["new", "queued", "promoted"] } }] },
    orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
  });
}

async function jsonFromRoute(response: Response) {
  return (await response.json().catch(() => ({}))) as JsonRecord;
}

function baseResponse(input: { dryRun: boolean; readiness: unknown; warnings?: string[] }) {
  return {
    ok: true,
    dryRun: input.dryRun,
    stage: "initialized",
    readiness: input.readiness,
    sourceSummary: {},
    selectedRawSignalId: null as string | null,
    rawSignalSummary: {},
    candidateSummary: {},
    evidencePackSummary: {},
    aiCommitteeSummary: {},
    finalJudgeSummary: {},
    approvalGateSummary: {},
    publishLedgerSummary: {},
    signalFound: false,
    aiCommitteeRan: false,
    approved: false,
    publishable: false,
    published: false,
    publicAlertUrl: null as string | null,
    publicLedgerUrl: null as string | null,
    sentToTelegram: false,
    blockers: [] as string[],
    warnings: input.warnings ?? [],
    nextRecommendedAction: "Run the live alert cycle only with explicit confirmations.",
  };
}

export async function POST(request: NextRequest) {
  const body: JsonRecord = { ...DEFAULT_PAYLOAD, ...((await request.json().catch(() => ({}))) as JsonRecord) };
  const dryRun = bool(body.dryRun, true);
  const confirmRun = bool(body.confirmRun, false);
  const confirmPublish = bool(body.confirmPublish, false);
  const confirmSend = bool(body.confirmSend, false);
  const allowTelegram = bool(body.allowTelegram, false);
  const maxAlertsToPublish = Math.min(Math.max(int(body.maxAlertsToPublish, 1), 0), 1);
  const rawSignalId = text(body.rawSignalId);
  let candidateAlertId = text(body.candidateAlertId);
  const source = text(body.source);
  const warnings = ["Telegram is disabled for this founder website test; this route never sends Telegram.", ...(confirmSend || allowTelegram ? ["confirmSend/allowTelegram were ignored by this route."] : [])];

  try {
    const readiness = await getEngineStartReadiness();
    const output = baseResponse({ dryRun, readiness, warnings });
    if (!readiness.readyForFirstPublicAlert) {
      return NextResponse.json({ ...output, ok: false, stage: "readiness_blocked", blockers: readiness.blockers, nextRecommendedAction: readiness.exactNextFixes?.[0] ?? "Resolve engine-start readiness blockers before running a live alert cycle." }, { status: 503 });
    }
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ ...output, ok: false, stage: "database_blocked", blockers: ["database_not_configured"], nextRecommendedAction: "Configure DATABASE_URL before selecting a real raw signal." }, { status: 503 });
    }

    let rawSignal = rawSignalId ? await prisma.rawSignal.findUnique({ where: { id: rawSignalId } }) : await latestUsefulRawSignal();
    let sourceSummary: unknown = null;
    if (!rawSignal && !rawSignalId) {
      sourceSummary = await runSources({ dryRun: true, sources: source ? [source] : ["GDELT"], limit: 1, force: false }).catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : "source_run_unavailable" }));
      rawSignal = await latestUsefulRawSignal();
    }
    if (!rawSignal && !candidateAlertId) {
      return NextResponse.json({ ...output, ok: true, stage: "no_signal", sourceSummary: sourceSummary ?? {}, signalFound: false, blockers: [], nextRecommendedAction: "No useful real raw signal was available. Run source ears until real source data appears; do not create a fake alert." });
    }

    output.stage = "source_selected";
    output.sourceSummary = sourceSummary ? obj(sourceSummary) : { selectedSource: source || rawSignal?.source || null };
    output.selectedRawSignalId = rawSignal?.id ?? null;
    output.rawSignalSummary = rawSignal ? { id: rawSignal.id, source: rawSignal.source, ticker: rawSignal.ticker, title: rawSignal.title, receivedAt: rawSignal.receivedAt } : {};
    output.signalFound = Boolean(rawSignal || candidateAlertId);

    if (!candidateAlertId && rawSignal) {
      const candidateResponse = await candidateFactoryPOST(new NextRequest("http://internal/api/internal/candidate-factory-run", { method: "POST", body: JSON.stringify({ dryRun, rawSignalId: rawSignal.id, limit: 1, requireProof: true }) }));
      const candidateJson = await jsonFromRoute(candidateResponse);
      const created = Array.isArray(candidateJson.createdCandidateIds) ? candidateJson.createdCandidateIds.map(String) : [];
      candidateAlertId = created[0] ?? "";
      output.candidateSummary = { ...candidateJson, createdCandidateIds: created.slice(0, 1) };
      if (dryRun) {
        return NextResponse.json({ ...output, stage: "dry_run_planned", candidateSummary: candidateJson, nextRecommendedAction: candidateJson.nextRecommendedAction ?? "Dry run complete. Re-run Stage 2 with confirmRun=true to create/review one real candidate if eligible." });
      }
      if (!candidateAlertId) {
        return NextResponse.json({ ...output, stage: "candidate_blocked", approved: false, publishable: false, blockers: arrayText(candidateJson.blockedReasons), nextRecommendedAction: candidateJson.nextRecommendedAction ?? "Candidate factory did not create a candidate; inspect blocked reasons." });
      }
    }

    output.stage = "candidate_ready";
    output.candidateSummary = { ...obj(output.candidateSummary), candidateAlertId };
    const evidence = await buildAiCommitteeEvidencePack(candidateAlertId);
    output.evidencePackSummary = { ok: evidence.ok, readyForCommittee: evidence.readyForCommittee, missingRequiredEvidence: evidence.missingRequiredEvidence };

    const provider = getAiCommitteeProviderStatus();
    if (!confirmRun || !provider.enabled || !provider.configured) {
      return NextResponse.json({ ...output, stage: "ai_committee_planned", aiCommitteeSummary: { ok: true, status: "planned", provider: { enabled: provider.enabled, configured: provider.configured }, reason: !confirmRun ? "confirmRun=false" : "AI Committee provider not enabled/configured" }, nextRecommendedAction: "Run Stage 2 with confirmRun=true and configured AI Committee to get a real approval review. Nothing was published." });
    }

    const committee = await runAiCommittee({ candidateAlertId, dryRun: false, confirmRun: true, mode: "preview" });
    const committeeRunId = text((committee as JsonRecord).persistedRunId);
    output.aiCommitteeRan = true;
    output.aiCommitteeSummary = { ok: committee.ok, status: committee.status, committeeRunId, providerStatus: committee.providerStatus };

    const finalJudge = await runFinalJudge({ candidateAlertId, committeeRunId, dryRun: true });
    output.finalJudgeSummary = { ok: finalJudge.ok, finalDecision: finalJudge.finalDecision, publishAllowed: finalJudge.publishAllowed, requiredFixes: finalJudge.requiredFixes };
    if (finalJudge.finalDecision === "reject" || finalJudge.publishAllowed === false) warnings.push("Final judge did not allow publish; approval gate must block publication.");

    const gate = await runApprovalGate({ candidateAlertId, committeeRunId, dryRun: !confirmPublish, reviewerNote: confirmPublish ? "Founder confirmed Stage 3 website publish from live alert cycle route." : "Stage 2 review only; no publish." });
    const approved = isApproved(gate) && finalJudge.finalDecision === "approve" && finalJudge.publishAllowed === true;
    output.approvalGateSummary = { ok: gate.ok, approvalRecommendation: gate.approvalRecommendation, failedChecks: gate.failedChecks, warnings: gate.warnings };
    output.approved = approved;
    output.publishable = approved;

    if (!approved || dryRun || !confirmPublish || maxAlertsToPublish < 1) {
      return NextResponse.json({ ...output, stage: approved ? "approved_not_published" : "approval_blocked", blockers: approved ? [] : ["approval_gate_or_final_judge_not_approved"], nextRecommendedAction: approved ? "Stage 2 produced one real approved/publishable signal. Stage 3 may publish at most one alert after confirmation." : "Resolve final judge/approval gate failed checks before publishing. Nothing was published." });
    }

    const publishResponse = await publishApprovedAlertPOST(new NextRequest("http://internal/api/internal/publish-approved-alert", { method: "POST", body: JSON.stringify({ candidateAlertId, dryRun: false, confirmPublish: true }) }));
    const publishJson = await jsonFromRoute(publishResponse);
    return NextResponse.json({ ...output, stage: publishJson.published ? "published" : "publish_blocked", publishLedgerSummary: publishJson, published: publishJson.published === true, publicAlertUrl: text(publishJson.publicAlertUrl) || null, publicLedgerUrl: text(publishJson.publicLedgerUrl) || null, blockers: arrayText(publishJson.blockedReasons), warnings: [...warnings, ...arrayText(publishJson.warnings)], nextRecommendedAction: text(publishJson.nextRecommendedAction) || "Publish attempted; inspect publishLedgerSummary." }, { status: publishResponse.status });
  } catch (error) {
    const status = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2023" ? 400 : 500;
    return NextResponse.json({ ...baseResponse({ dryRun, readiness: {}, warnings }), ok: false, stage: "live_alert_cycle_failed", blockers: [error instanceof Error ? error.message : "unknown_error"], nextRecommendedAction: "Check server logs and rerun safely; no Telegram send was attempted." }, { status });
  }
}
