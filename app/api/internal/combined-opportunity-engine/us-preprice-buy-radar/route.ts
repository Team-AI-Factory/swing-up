import { NextRequest, NextResponse } from "next/server";
import {
  readLatestUsPrePriceBuyRadar,
  runUsPrePriceBuyRadar,
} from "@/lib/opportunity-engine/us-preprice-buy-radar";

export const dynamic = "force-dynamic";

const BRANCH = "agent/combined-opportunity-engine";
const state = globalThis as typeof globalThis & {
  __swingUpUsPrePriceBuyRadar?: Promise<Awaited<ReturnType<typeof runUsPrePriceBuyRadar>>>;
};

function branchAllowed() {
  if (process.env.SWING_UP_COMBINED_ENGINE_ALLOW_LOCAL === "true") return true;
  const branch = process.env.RAILWAY_GIT_BRANCH?.trim();
  const environment = process.env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase();
  return Boolean(process.env.RAILWAY_PROJECT_ID && branch === BRANCH && environment && environment !== "production");
}

function suppliedToken(request: NextRequest) {
  return request.headers.get("x-swing-up-branch-lab-token")?.trim()
    || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
}

function schedulerIdentity(request: NextRequest) {
  const owner = request.headers.get("x-swing-up-branch-lab-scheduler");
  const workerId = request.headers.get("x-swing-up-branch-lab-worker-id")?.trim() || "";
  const workerStartedAt = request.headers.get("x-swing-up-branch-lab-worker-started-at")?.trim() || "";
  const sequence = Number(request.headers.get("x-swing-up-branch-lab-worker-sequence"));
  if (owner !== "dedicated_worker") return null;
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(workerId)) return null;
  if (!Number.isFinite(Date.parse(workerStartedAt))) return null;
  if (!Number.isInteger(sequence) || sequence < 1) return null;
  return { owner, workerId, workerStartedAt, sequence };
}

export async function GET() {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const report = await readLatestUsPrePriceBuyRadar();
  return NextResponse.json({
    ok: true,
    ready: Boolean(report),
    branch: BRANCH,
    report,
    safety: { databaseWrites: false, publishing: false, directUserNotifications: false, trades: false },
  });
}

export async function POST(request: NextRequest) {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const expected = process.env.SWING_UP_BRANCH_LAB_RUNTIME_TOKEN?.trim();
  if (!expected || suppliedToken(request) !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const identity = schedulerIdentity(request);
  if (!identity) return NextResponse.json({ ok: false, error: "invalid_scheduler" }, { status: 403 });
  if (!state.__swingUpUsPrePriceBuyRadar) {
    state.__swingUpUsPrePriceBuyRadar = runUsPrePriceBuyRadar().finally(() => {
      delete state.__swingUpUsPrePriceBuyRadar;
    });
  }
  try {
    const report = await state.__swingUpUsPrePriceBuyRadar;
    return NextResponse.json({ ...report, schedulerInvocation: identity }, { status: report.ok ? 200 : 503 });
  } catch (error) {
    return NextResponse.json({
      version: 1,
      ok: false,
      branch: BRANCH,
      mode: "pr262_source_first_preprice_buy_radar",
      checkedAt: new Date().toISOString(),
      status: "technical_failure",
      error: error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 400) : "preprice_buy_radar_failed",
      seriousBuys: [],
      buyCandidates: [],
      newSeriousBuys: [],
      schedulerInvocation: identity,
      safety: { databaseWrites: false, publishing: false, directUserNotifications: false, trades: false, productionWrites: false, nonUsScanning: false },
    }, { status: 500 });
  }
}
