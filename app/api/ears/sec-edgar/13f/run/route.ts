import { NextRequest, NextResponse } from "next/server";
import { parseSec13FManagersParam, runSecEdgar13FIngestion } from "@/lib/ears/sec-edgar";

const MAX_AUTHENTICATED_MANAGERS = 5;
const MAX_UNAUTHENTICATED_MANAGERS = 2;
const MAX_AUTHENTICATED_LIMIT = 50;
const MAX_UNAUTHENTICATED_LIMIT = 10;

function parseLimit(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function parseDryRun(value: string | null) {
  if (value == null) return true;
  return !(value === "false" || value === "0" || value === "no");
}

async function handleRun(request: NextRequest) {
  const runToken = process.env.EAR_RUN_TOKEN?.trim();
  const suppliedToken = request.nextUrl.searchParams.get("token")?.trim();
  const hasConfiguredToken = Boolean(runToken);

  if (hasConfiguredToken && suppliedToken !== runToken) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const maxManagers = hasConfiguredToken ? MAX_AUTHENTICATED_MANAGERS : MAX_UNAUTHENTICATED_MANAGERS;
  const maxLimit = hasConfiguredToken ? MAX_AUTHENTICATED_LIMIT : MAX_UNAUTHENTICATED_LIMIT;
  const managers = parseSec13FManagersParam(request.nextUrl.searchParams.get("managers")).slice(0, maxManagers);
  const limit = Math.min(parseLimit(request.nextUrl.searchParams.get("limit"), maxLimit), maxLimit);
  const dryRun = parseDryRun(request.nextUrl.searchParams.get("dryRun"));

  const result = await runSecEdgar13FIngestion({ managers, limit, dryRun });
  const status = result.ok ? 200 : 502;

  return NextResponse.json(
    {
      ok: result.ok,
      source: result.source,
      dryRun: result.dryRun,
      managersChecked: result.managersChecked,
      filingsChecked: result.filingsChecked,
      holdingsCompared: result.holdingsCompared,
      signalsCreated: result.signalsCreated,
      duplicatesSkipped: result.duplicatesSkipped,
      errors: result.errors,
      capped: !hasConfiguredToken,
      label: "SEC Form 13F disclosed historical holdings; not live trades or fund intent.",
    },
    { status },
  );
}

export async function GET(request: NextRequest) {
  return handleRun(request);
}

export async function POST(request: NextRequest) {
  return handleRun(request);
}
