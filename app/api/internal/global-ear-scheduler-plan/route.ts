import { NextRequest, NextResponse } from "next/server";
import { buildGlobalSchedulerPlan } from "@/lib/global-ear-scheduler";
import { checkR2Health } from "@/lib/r2-warehouse";

export const dynamic = "force-dynamic";

function int(value: unknown, fallback: number) { const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN; return Number.isFinite(parsed) ? Math.floor(parsed) : fallback; }
function bool(value: unknown, fallback: boolean) { return typeof value === "boolean" ? value : fallback; }

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const r2 = await checkR2Health(false);
  const plan = buildGlobalSchedulerPlan({ dryRun: bool(body.dryRun, true), universeMode: String(body.universeMode ?? "global"), maxAssetsToPlan: int(body.maxAssetsToPlan, 1000), maxAssetsToScanNow: int(body.maxAssetsToScanNow, 50), maxDeepScans: int(body.maxDeepScans, 5), respectProviderLimits: bool(body.respectProviderLimits, true), confirmRun: bool(body.confirmRun, false), r2RawStorageReady: r2.canWrite && r2.canDelete });
  return NextResponse.json({ ok: true, dryRun: bool(body.dryRun, true), universeMode: String(body.universeMode ?? "global"), ...plan });
}
