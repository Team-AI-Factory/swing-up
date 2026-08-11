import { NextRequest, NextResponse } from "next/server";
import { enrichPr262SensorCompanyMappings } from "@/lib/opportunity-engine/pr262-company-directory";
import { readPr262ChangeSensorState, runPr262ChangeSensor } from "@/lib/opportunity-engine/pr262-change-sensor";
import { runPr262EventJob } from "@/lib/opportunity-engine/pr262-event-job";

export const dynamic = "force-dynamic";
const BRANCH = "agent/combined-opportunity-engine";
const PR262_RUNTIME_HARD_PAUSED = true;

function allowed() {
  if (PR262_RUNTIME_HARD_PAUSED) return false;
  if (process.env.SWING_UP_COMBINED_ENGINE_ALLOW_LOCAL === "true") return true;
  const branch = process.env.RAILWAY_GIT_BRANCH?.trim();
  const environment = process.env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase();
  return Boolean(process.env.RAILWAY_PROJECT_ID && branch === BRANCH && environment && environment !== "production");
}

function authorized(request: NextRequest) {
  const expected = process.env.SWING_UP_PR262_SENSOR_TOKEN?.trim();
  const supplied = request.headers.get("x-swing-up-pr262-sensor-token")?.trim();
  return Boolean(expected && supplied === expected);
}

export async function GET() {
  if (!allowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  try {
    const state = await readPr262ChangeSensorState();
    return NextResponse.json({
      ok: true,
      mode: "pr262_sensor_first",
      branch: BRANCH,
      pendingEventCount: state.pending.length,
      latestPending: state.pending.slice(0, 25),
      updatedAt: state.updatedAt,
      oldFiveMinuteScannerEnabled: false,
      safety: { publishing: false, notifications: false, trades: false, databaseWrites: false },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "sensor_state_failed" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (!allowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const sensor = await runPr262ChangeSensor();
    const mapping = sensor.ok
      ? await enrichPr262SensorCompanyMappings().catch((error) => ({ mapped: 0, directoryCompanies: 0, directoryUpdatedAt: null, error: error instanceof Error ? error.message : "mapping_failed" }))
      : { mapped: 0, directoryCompanies: 0, directoryUpdatedAt: null };
    const eventJob = sensor.ok
      ? await runPr262EventJob()
      : {
          ok: true,
          mode: "pr262_targeted_event_job",
          skipped: true,
          reason: "sensor_source_coverage_blind",
          eventsProcessed: 0,
        };
    return NextResponse.json({
      ok: true,
      mode: "pr262_sensor_first_cycle",
      sensor,
      mapping,
      eventJob,
      costControl: {
        oldFiveMinuteScannerEnabled: false,
        oldOneMinuteSecDeepScannerEnabled: false,
        quietCycleAiCalls: 0,
        quietCycleFullCompanyRebuilds: 0,
        eventJobReadsAtMostOneDueMaterialQueueItem: true,
        companyDirectoryReusedInsteadOfFundamentalRebuild: true,
        exactCompanyOnly: true,
        pilotFiveRunsBeforePaidCommittee: true,
        fullCommitteeRequiredForSeriousSignal: true,
      },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      mode: "pr262_sensor_first_cycle",
      error: error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 400) : "sensor_cycle_failed",
      oldFiveMinuteScannerEnabled: false,
    }, { status: 500 });
  }
}
