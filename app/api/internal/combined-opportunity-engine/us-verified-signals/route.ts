import { NextResponse } from "next/server";
import { readLatestUsSignalOperationsReport } from "@/lib/opportunity-engine/us-signal-operations";
import { verifyUsSeriousSignals } from "@/lib/opportunity-engine/us-serious-signal-consistency";

export const dynamic = "force-dynamic";

const BRANCH = "agent/combined-opportunity-engine";

function branchAllowed() {
  if (process.env.SWING_UP_COMBINED_ENGINE_ALLOW_LOCAL === "true") return true;
  const branch = process.env.RAILWAY_GIT_BRANCH?.trim();
  const environment = process.env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase();
  return Boolean(
    process.env.RAILWAY_PROJECT_ID
    && branch === BRANCH
    && environment
    && environment !== "production",
  );
}

export async function GET() {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  try {
    const rawReport = await readLatestUsSignalOperationsReport();
    if (!rawReport) {
      return NextResponse.json({
        ok: true,
        ready: false,
        branch: BRANCH,
        safety: { databaseWrites: false, publishing: false, directUserNotifications: false, trades: false },
      });
    }
    const verified = verifyUsSeriousSignals(rawReport);
    return NextResponse.json({
      ok: true,
      ready: true,
      branch: BRANCH,
      runtime: {
        commitSha: process.env.RAILWAY_GIT_COMMIT_SHA?.trim() || null,
        deploymentId: process.env.RAILWAY_DEPLOYMENT_ID?.trim() || null,
      },
      verified,
      safety: {
        databaseWrites: false,
        publishing: false,
        directUserNotifications: false,
        trades: false,
        productionWrites: false,
        nonUsScanning: false,
      },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      ready: false,
      branch: BRANCH,
      error: error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 400) : "verified_signal_read_failed",
      safety: { databaseWrites: false, publishing: false, directUserNotifications: false, trades: false },
    }, { status: 500 });
  }
}
