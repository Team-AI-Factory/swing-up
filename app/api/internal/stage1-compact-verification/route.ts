import { NextRequest, NextResponse } from "next/server";
import { POST as runLiveAlertCyclePOST } from "@/app/api/internal/run-live-alert-cycle/route";
import { withRedactionMetadata } from "@/lib/redact-secrets";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

export async function POST(request: NextRequest) {
  const body = ((await request.json().catch(() => ({}))) ?? {}) as JsonRecord;
  const payload = {
    dryRun: body.dryRun !== false,
    confirmRun: false,
    confirmPublish: false,
    confirmSend: false,
    compact: true,
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
    maxCandidates: Math.min(
      Math.max(Number(body.maxCandidates ?? 20) || 20, 1),
      20,
    ),
    allowTelegram: false,
  };

  try {
    const response = await runLiveAlertCyclePOST(
      new NextRequest("http://internal/api/internal/run-live-alert-cycle", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
    const json = (await response.json().catch(() => ({}))) as JsonRecord;
    return NextResponse.json(
      withRedactionMetadata({
        ...json,
        stage1HttpStatus: response.status,
        safety: {
          noOpenAI: true,
          noPublish: true,
          noTelegram: true,
          secretsRedacted: true,
        },
      }),
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      withRedactionMetadata({
        ok: false,
        overallStatus: "fail",
        checkedAt: new Date().toISOString(),
        stage1Finished: false,
        stage1HttpStatus: 500,
        problem:
          error instanceof Error
            ? error.message.slice(0, 160)
            : "stage1_compact_verification_failed_safe",
        safety: {
          noOpenAI: true,
          noPublish: true,
          noTelegram: true,
          secretsRedacted: true,
        },
      }),
      { status: 200 },
    );
  }
}
