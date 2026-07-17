import { readFile, writeFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { runBranchSignalLab } from "@/lib/branch-signal-lab";

export const dynamic = "force-dynamic";

const REPORT_PATH = "/tmp/swing-up-railway-branch-signal-lab.json";
const LAB_BRANCH = "agent/live-signal-evaluation-automation";
const MAX_OPENAI_RUNS_PER_24_HOURS = 3;
const OPENAI_EVIDENCE_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const OUTCOME_CHECKPOINTS = [
  { label: "1D", milliseconds: 24 * 60 * 60 * 1000 },
  { label: "3D", milliseconds: 3 * 24 * 60 * 60 * 1000 },
  { label: "7D", milliseconds: 7 * 24 * 60 * 60 * 1000 },
  { label: "30D", milliseconds: 30 * 24 * 60 * 60 * 1000 },
  { label: "90D", milliseconds: 90 * 24 * 60 * 60 * 1000 },
] as const;

type JsonRecord = Record<string, unknown>;
type History = { version: number; branch: string; deploymentId: string | null; stopped: boolean; stopReason: string | null; runs: JsonRecord[]; updatedAt: string };

function branchAllowed() {
  if (process.env.SWING_UP_BRANCH_LAB_ALLOW_LOCAL === "true") return true;
  const branch = process.env.RAILWAY_GIT_BRANCH?.trim();
  const environment = process.env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase();
  return Boolean(process.env.RAILWAY_PROJECT_ID && branch === LAB_BRANCH && environment && environment !== "production");
}

function emptyHistory(): History {
  return { version: 2, branch: process.env.RAILWAY_GIT_BRANCH?.trim() || LAB_BRANCH, deploymentId: process.env.RAILWAY_DEPLOYMENT_ID?.trim() || null, stopped: false, stopReason: null, runs: [], updatedAt: new Date().toISOString() };
}

async function loadHistory() {
  try {
    const parsed = JSON.parse(await readFile(REPORT_PATH, "utf8")) as History;
    return parsed && Array.isArray(parsed.runs) ? parsed : emptyHistory();
  } catch {
    return emptyHistory();
  }
}

async function saveHistory(history: History) {
  history.updatedAt = new Date().toISOString();
  await writeFile(REPORT_PATH, `${JSON.stringify(history, null, 2)}\n`, "utf8");
}

function suppliedToken(request: NextRequest) {
  return request.headers.get("x-swing-up-branch-lab-token")?.trim() || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
}

function safeRun(run: JsonRecord) {
  return run.databaseWrites === false && run.publishing === false && run.notifications === false;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function updateForwardOutcomes(history: History, currentReport: JsonRecord) {
  const checkedAt = Date.parse(String(currentReport.checkedAt ?? ""));
  const snapshot = Array.isArray(currentReport.marketSnapshot) ? currentReport.marketSnapshot.map(record).filter((item): item is JsonRecord => Boolean(item)) : [];
  if (!Number.isFinite(checkedAt) || !snapshot.length) return;
  for (const run of history.runs) {
    if (run.openAiCalled !== true) continue;
    const selected = record(run.selectedCandidate);
    const ticker = typeof selected?.ticker === "string" ? selected.ticker : null;
    const entryPrice = finiteNumber(selected?.price);
    const direction = selected?.direction === "downside" ? "downside" : "upside";
    const startedAt = Date.parse(String(run.checkedAt ?? ""));
    if (!ticker || !entryPrice || !Number.isFinite(startedAt)) continue;
    const current = snapshot.find((item) => item.ticker === ticker);
    const currentPrice = finiteNumber(current?.price);
    if (!currentPrice) continue;
    const outcomes = Array.isArray(run.outcomeEvaluations) ? run.outcomeEvaluations.map(record).filter((item): item is JsonRecord => Boolean(item)) : [];
    const existing = new Set(outcomes.map((outcome) => outcome.checkpoint));
    for (const checkpoint of OUTCOME_CHECKPOINTS) {
      if (checkedAt - startedAt < checkpoint.milliseconds || existing.has(checkpoint.label)) continue;
      const forwardReturnPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
      const directionAdjustedReturnPercent = direction === "downside" ? -forwardReturnPercent : forwardReturnPercent;
      outcomes.push({ checkpoint: checkpoint.label, evaluatedAt: new Date(checkedAt).toISOString(), priceAtSignal: entryPrice, evaluationPrice: currentPrice, forwardReturnPercent: Math.round(forwardReturnPercent * 100) / 100, directionAdjustedReturnPercent: Math.round(directionAdjustedReturnPercent * 100) / 100, usefulAtCheckpoint: directionAdjustedReturnPercent >= 2, source: "CoinGecko live snapshot" });
    }
    run.outcomeEvaluations = outcomes;
  }
}

export async function GET() {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const history = await loadHistory();
  const recent = history.runs.slice(-3);
  const validatedSeriousSignalRuns = history.runs.filter((run) => run.seriousSignalFound === true && Array.isArray(run.outcomeEvaluations) && run.outcomeEvaluations.some((outcome) => record(outcome)?.checkpoint === "1D"));
  const validatedSeriousSignals = [...new Map(validatedSeriousSignalRuns.map((run) => [String(run.candidateFingerprint ?? run.checkedAt), run])).values()];
  const usefulValidatedSignals = validatedSeriousSignals.filter((run) => (run.outcomeEvaluations as unknown[]).some((outcome) => record(outcome)?.checkpoint === "1D" && record(outcome)?.usefulAtCheckpoint === true));
  return NextResponse.json({
    ok: true,
    mode: "railway_branch_live_read_only",
    branch: history.branch,
    deploymentId: history.deploymentId,
    stopped: history.stopped,
    stopReason: history.stopReason,
    runCount: history.runs.length,
    consistentSafeBehavior: recent.length === 3 && recent.every(safeRun),
    consecutiveSeriousSignals: recent.filter((run) => run.seriousSignalFound === true).length,
    validatedSeriousSignalCount: validatedSeriousSignals.length,
    distinctValidatedEvidenceCount: validatedSeriousSignals.length,
    usefulValidatedSeriousSignalCount: usefulValidatedSignals.length,
    consistentSeriousSignals: validatedSeriousSignals.length >= 3 && usefulValidatedSignals.length / validatedSeriousSignals.length >= 2 / 3,
    latest: history.runs.at(-1) ?? null,
    runs: history.runs.slice(-6),
    updatedAt: history.updatedAt,
  });
}

export async function POST(request: NextRequest) {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const expected = process.env.SWING_UP_BRANCH_LAB_RUNTIME_TOKEN?.trim();
  if (!expected || suppliedToken(request) !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const history = await loadHistory();
  if (history.stopped) return NextResponse.json({ ok: false, stopped: true, stopReason: history.stopReason, runCount: history.runs.length }, { status: 409 });
  const now = Date.now();
  const openAiRuns = history.runs.filter((run) => run.openAiCalled === true && now - Date.parse(String(run.checkedAt ?? "")) < 24 * 60 * 60 * 1000).length;
  const reviewedFingerprints = history.runs.filter((run) => run.openAiCalled === true && now - Date.parse(String(run.checkedAt ?? "")) < OPENAI_EVIDENCE_COOLDOWN_MS).map((run) => run.candidateFingerprint).filter((value): value is string => typeof value === "string");
  const report = await runBranchSignalLab({ allowOpenAi: openAiRuns < MAX_OPENAI_RUNS_PER_24_HOURS, skipOpenAiCandidateFingerprints: reviewedFingerprints }) as JsonRecord;
  updateForwardOutcomes(history, report);
  const previousFailures = history.runs.slice(-2).map((run) => run.technicalFailureFingerprint).filter(Boolean);
  const fingerprint = report.technicalFailureFingerprint;
  const repeatedTechnicalFailure = Boolean(fingerprint && previousFailures.length === 2 && previousFailures.every((value) => value === fingerprint));
  history.runs.push({ ...report, runNumber: history.runs.length + 1 });
  if (repeatedTechnicalFailure) {
    history.stopped = true;
    history.stopReason = `Stopped after the same technical failure produced no gain three times: ${String(fingerprint)}`;
  }
  await saveHistory(history);
  const openAiRunsLast24Hours = history.runs.filter((run) => run.openAiCalled === true && now - Date.parse(String(run.checkedAt ?? "")) < 24 * 60 * 60 * 1000).length;
  return NextResponse.json({ ...report, runNumber: history.runs.length, stopped: history.stopped, stopReason: history.stopReason, openAiRunsLast24Hours, maxOpenAiRunsPer24Hours: MAX_OPENAI_RUNS_PER_24_HOURS });
}
