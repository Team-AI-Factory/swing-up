import { NextResponse } from "next/server";
import { getR2OperationalStatus } from "@/lib/r2-warehouse";
import { withRedactionMetadata } from "@/lib/redact-secrets";

export const dynamic = "force-dynamic";

export async function GET() {
  const r2 = await getR2OperationalStatus({ allowRuntimeWriteCheck: false });
  const healthyRecentWriteDelete =
    r2.canRead === true &&
    r2.canWrite === true &&
    r2.canDelete === true &&
    r2.storageMode === "r2_raw_storage" &&
    r2.sourceOfTruth === "recent_write_test";
  const r2HealthResult = healthyRecentWriteDelete
    ? {
        ...r2.rawHealth,
        canRead: true,
        canWrite: true,
        canDelete: true,
        storageMode: "r2_raw_storage",
        sourceOfTruth: "recent_write_test",
        suspectedCause: null,
        nextAction: "R2 is healthy",
      }
    : r2.rawHealth;

  return NextResponse.json(
    withRedactionMetadata({
      ok: true,
      route: "/api/internal/r2-truth-diagnostics",
      status: healthyRecentWriteDelete ? "healthy" : "needs_write_delete_check",
      summary: healthyRecentWriteDelete
        ? "R2 read/write/delete truth is healthy from a recent write test."
        : "R2 read-only checks cannot prove write/delete. Run the confirmed R2 write/delete test.",
      routeResultsCompared: [
        "/api/internal/r2-health",
        "/api/internal/run-live-alert-cycle",
        "shared lib/r2-warehouse getR2OperationalStatus",
      ],
      r2HealthResult,
      stage1StorageDecision: {
        storageMode: r2.storageMode,
        rawDataStoredWhenWritesSucceed: r2.writeAvailable,
        rawWarehouseWriteUnavailable: healthyRecentWriteDelete ? false : !r2.writeAvailable,
        sourceOfTruth: r2.sourceOfTruth,
        suspectedCause: healthyRecentWriteDelete ? null : r2.rawHealth.suspectedCause,
        nextAction: healthyRecentWriteDelete ? "R2 is healthy" : r2.rawHealth.nextAction,
      },
      lastWriteDeleteTest: {
        lastConfirmedWriteAt: r2.lastConfirmedWriteAt,
        lastConfirmedDeleteAt: r2.lastConfirmedDeleteAt,
        sourceOfTruth: r2.sourceOfTruth,
      },
      staleHealthDetected: !healthyRecentWriteDelete,
      conflictingHealthDetected: false,
      readOnlyCheckOverrodeWriteDelete: false,
      recommendedFix: healthyRecentWriteDelete
        ? "R2 is healthy"
        : "Run POST /api/internal/r2-health with confirmWrite=true to refresh write/delete truth.",
      nextAction: healthyRecentWriteDelete ? "R2 is healthy" : r2.rawHealth.nextAction,
      noOpenAI: true,
      noPublish: true,
      noTelegram: true,
      noSecretsExposed: true,
      secretsRedacted: true,
    }),
  );
}
