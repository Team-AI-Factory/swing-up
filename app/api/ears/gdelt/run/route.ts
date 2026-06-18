import { NextRequest, NextResponse } from "next/server";
import { runGdeltIngestion } from "@/lib/ears/gdelt";

const DEFAULT_LIMIT = 25;
const MAX_AUTHENTICATED_LIMIT = 50;
const MAX_UNAUTHENTICATED_LIMIT = 25;

function parseLimit(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function parseDryRun(value: string | null) {
  return value === "true" || value === "1" || value === "yes";
}

async function handleRun(request: NextRequest) {
  const runToken = process.env.EAR_RUN_TOKEN?.trim();
  const suppliedToken = request.nextUrl.searchParams.get("token")?.trim();
  const hasConfiguredToken = Boolean(runToken);
  const requestedDryRun = parseDryRun(request.nextUrl.searchParams.get("dryRun"));
  const q = request.nextUrl.searchParams.get("q")?.trim() || undefined;

  if (hasConfiguredToken && suppliedToken !== runToken && !requestedDryRun) {
    return NextResponse.json({ ok: false, error: "Unauthorized. Missing token permits dryRun=true test runs only." }, { status: 401 });
  }

  const isAuthorizedRealRun = !hasConfiguredToken || suppliedToken === runToken;
  const dryRun = requestedDryRun || !isAuthorizedRealRun;
  const maxLimit = isAuthorizedRealRun ? MAX_AUTHENTICATED_LIMIT : MAX_UNAUTHENTICATED_LIMIT;
  const limit = Math.min(parseLimit(request.nextUrl.searchParams.get("limit"), DEFAULT_LIMIT), maxLimit);

  const result = await runGdeltIngestion({ q, limit, dryRun });
  const status = result.ok || result.rateLimited ? 200 : 502;

  return NextResponse.json({
    ok: result.ok,
    source: result.source,
    mode: result.mode,
    articlesChecked: result.articlesChecked,
    companyMatches: result.companyMatches,
    macroSignals: result.macroSignals,
    signalsCreated: result.signalsCreated,
    duplicatesSkipped: result.duplicatesSkipped,
    rateLimited: result.rateLimited,
    errors: result.errors,
    dryRun,
    capped: !isAuthorizedRealRun,
  }, { status });
}

export async function GET(request: NextRequest) {
  return handleRun(request);
}

export async function POST(request: NextRequest) {
  return handleRun(request);
}
