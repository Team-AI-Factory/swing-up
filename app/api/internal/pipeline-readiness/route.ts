import { NextResponse } from "next/server";
import { getEngineStartReadiness } from "@/lib/engine-start-readiness";

export async function GET() {
  const readiness = await getEngineStartReadiness();
  return NextResponse.json({
    ok: readiness.ok,
    readyForDryRunTest: readiness.readyToStartEngine,
    readyForRealTest: readiness.readyForFirstPublicAlert,
    readyForAICommitteeRun: readiness.aiCommitteeStatus.aiCommitteeDryRunReady,
    readyForTelegramTest: false,
    missingRequiredItems: readiness.blockers,
    missingOptionalItems: readiness.optionalSourcesSkipped,
    warnings: readiness.warnings,
    nextRecommendedAction: readiness.exactNextFixes[0] ?? "Run the internal dry-run alert test before any real notification test.",
    engineStartReadiness: readiness,
  }, { status: readiness.ok ? 200 : 503 });
}
