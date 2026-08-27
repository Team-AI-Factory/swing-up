import { NextRequest, NextResponse } from "next/server";
import {
  readResumableUsValueState,
  runResumableUsValueBatch,
} from "@/lib/opportunity-engine/us-value-investing-resumable";
import {
  getR2Config,
  readVersionedTextFromR2,
  writeVersionedJsonToR2,
} from "@/lib/r2-warehouse";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";

export const dynamic = "force-dynamic";

const BRANCH = "agent/combined-opportunity-engine";
const REPORT_PREFIX = pr262StorageKey("value-investing/resumable/reports");
const LATEST_REPORT_KEY = `${REPORT_PREFIX}/latest.json`;

const state = globalThis as typeof globalThis & {
  __swingUpUsValueBatchRun?: Promise<Awaited<ReturnType<typeof runResumableUsValueBatch>>>;
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

function dateKey(value: string) {
  return value.replace(/[^0-9]/g, "").slice(0, 17);
}

async function readLatestReport() {
  if (!getR2Config().configured) return null;
  const current = await readVersionedTextFromR2(LATEST_REPORT_KEY);
  if (!current.found || !current.text) return null;
  return JSON.parse(current.text) as Record<string, unknown>;
}

async function persistReport(report: Record<string, unknown>, checkedAt: string, identity: NonNullable<ReturnType<typeof schedulerIdentity>>) {
  if (!getR2Config().configured) throw new Error("cloudflare_r2_not_configured");
  const immutableKey = `${REPORT_PREFIX}/runs/${checkedAt.slice(0, 10)}/${dateKey(checkedAt)}-${identity.workerId.slice(0, 8)}-${identity.sequence}.json`;
  const payload = {
    ...report,
    schedulerInvocation: identity,
    reportWarehouse: {
      backend: "cloudflare_r2",
      latestKey: LATEST_REPORT_KEY,
      immutableKey,
      persisted: true,
    },
  };
  await writeVersionedJsonToR2(LATEST_REPORT_KEY, payload);
  const immutable = await writeVersionedJsonToR2(immutableKey, payload, { createOnly: true });
  if (!immutable.written && !immutable.conflict) throw new Error("us_value_batch_report_archive_failed");
  return payload;
}

export async function GET() {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  try {
    const [latest, latestReport] = await Promise.all([
      readResumableUsValueState(),
      readLatestReport(),
    ]);
    return NextResponse.json({
      ok: true,
      ready: Boolean(latest),
      branch: BRANCH,
      latest,
      latestReport,
      latestReportKey: LATEST_REPORT_KEY,
      safety: {
        databaseWrites: false,
        publishing: false,
        notifications: false,
        trades: false,
        productionWrites: false,
      },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      ready: false,
      error: error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 400) : "us_value_batch_read_failed",
      safety: {
        databaseWrites: false,
        publishing: false,
        notifications: false,
        trades: false,
      },
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const expected = process.env.SWING_UP_BRANCH_LAB_RUNTIME_TOKEN?.trim();
  if (!expected || suppliedToken(request) !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const identity = schedulerIdentity(request);
  if (!identity) return NextResponse.json({ ok: false, error: "invalid_scheduler" }, { status: 403 });

  if (!state.__swingUpUsValueBatchRun) {
    state.__swingUpUsValueBatchRun = runResumableUsValueBatch().finally(() => {
      delete state.__swingUpUsValueBatchRun;
    });
  }

  try {
    const report = await state.__swingUpUsValueBatchRun;
    const payload = await persistReport(report as unknown as Record<string, unknown>, report.checkedAt, identity);
    return NextResponse.json(payload, { status: report.ok ? 200 : 503 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      mode: "pr262_us_value_resumable_batches",
      branch: BRANCH,
      status: "technical_failure",
      schedulerInvocation: identity,
      error: error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 400) : "us_value_batch_failed",
      seriousSignalFound: false,
      seriousSignalCount: 0,
      newSeriousSignalCount: 0,
      safety: {
        databaseWrites: false,
        publishing: false,
        notifications: false,
        trades: false,
        productionWrites: false,
      },
    }, { status: 500 });
  }
}
