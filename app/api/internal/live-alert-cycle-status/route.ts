import { NextResponse } from "next/server";
import { getEngineStartReadiness } from "@/lib/engine-start-readiness";
import { withRedactionMetadata } from "@/lib/redact-secrets";

export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = await getEngineStartReadiness().catch((error) => ({
    readyForContinuousRunning: false,
    blockers: ["engine_readiness_check_failed"],
    exactNextFixes: [
      error instanceof Error
        ? `Readiness check failed safely: ${error.message.slice(0, 120)}`
        : "Readiness check failed safely.",
    ],
  }));
  const blockers = Array.isArray(readiness.blockers)
    ? readiness.blockers.map(String)
    : ["engine_readiness_unavailable"];

  return NextResponse.json(
    withRedactionMetadata({
      ok: true,
      route: "/api/internal/live-alert-cycle-status",
      engineConfigured: true,
      lastStage1RunAt: null,
      lastStage1Ok: null,
      lastStorageMode: null,
      lastRawDataStored: null,
      lastFreeProofRecoverySkipped: null,
      lastCandidatesInspected: null,
      lastCandidatesMovedForward: null,
      lastAiReviewReadyCount: null,
      lastPublishReadyCount: null,
      lastPublished: false,
      lastSentToTelegram: false,
      continuousRunningReady:
        Boolean(readiness.readyForContinuousRunning) && blockers.length === 0,
      continuousRunningBlockers: blockers,
      nextSafeAction:
        Array.isArray(readiness.exactNextFixes) && readiness.exactNextFixes[0]
          ? String(readiness.exactNextFixes[0])
          : blockers.length
            ? "Resolve readiness blockers before enabling continuous running."
            : "Run a Stage 1 dry run from /ops/engine-control.",
      noOpenAI: true,
      noPublish: true,
      noTelegram: true,
      secretsRedacted: true,
    }),
  );
}
