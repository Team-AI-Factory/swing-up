import { NextRequest, NextResponse } from "next/server";
import { POST as runLiveAlertCyclePOST } from "@/app/api/internal/run-live-alert-cycle/route";
import { withRedactionMetadata } from "@/lib/redact-secrets";

type JsonRecord = Record<string, unknown>;

async function jsonFromResponse(response: Response): Promise<JsonRecord> {
  try {
    const value = await response.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as JsonRecord)
      : {};
  } catch {
    return {};
  }
}

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as JsonRecord;
  const maxCandidates = Math.max(1, Math.min(Number(body.maxCandidates ?? 20), 20));
  const dryRun = body.dryRun !== false;
  const confirmRun = body.confirmRun === true;

  const stage1Response = await runLiveAlertCyclePOST(
    new NextRequest("http://internal/api/internal/run-live-alert-cycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dryRun,
        confirmRun: false && confirmRun,
        confirmPublish: false,
        confirmSend: false,
        includeFreeProofRecovery: true,
        includeR2TruthCheck: true,
        includeFundamentalsFallback: true,
        includeOfficialProof: true,
        includeHistoricalMemory: true,
        includeRiskDetector: true,
        includeImprovedPriceVolume: true,
        universeMode: "global",
        maxAssetsToScanNow: 50,
        maxDeepScans: 5,
        maxCandidates,
        allowTelegram: false,
      }),
    }),
  );
  const stage1 = await jsonFromResponse(stage1Response);
  const report =
    stage1.proofVerificationReport &&
    typeof stage1.proofVerificationReport === "object" &&
    !Array.isArray(stage1.proofVerificationReport)
      ? (stage1.proofVerificationReport as JsonRecord)
      : null;

  return NextResponse.json(
    withRedactionMetadata({
      ok: Boolean(report),
      stage1Ok: stage1.ok !== false,
      dryRun: true,
      confirmRun: false,
      route: "/api/internal/stage1-proof-verification-run",
      proofVerificationReport: report,
      compactTopCandidateDeltas: Array.isArray(report?.topCandidateDeltas)
        ? report.topCandidateDeltas.slice(0, maxCandidates)
        : [],
      noOpenAI: true,
      noPublish: true,
      noTelegram: true,
      secretsRedacted: true,
    }),
    { status: 200 },
  );
}
