import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_GDELT_MAXRECORDS,
  GDELT_MAXRECORDS_HARD_CAP,
  runGdeltIngestion,
} from "@/lib/ears/gdelt";

function parseLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? String(DEFAULT_GDELT_MAXRECORDS), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_GDELT_MAXRECORDS;
  return Math.min(parsed, GDELT_MAXRECORDS_HARD_CAP);
}

function parseDryRun(value: string | null) {
  return value === "true" || value === "1" || value === "yes";
}

async function handleRun(request: NextRequest) {
  const runToken = process.env.EAR_RUN_TOKEN?.trim();
  const suppliedToken = request.nextUrl.searchParams.get("token")?.trim();
  const requestedDryRun = parseDryRun(
    request.nextUrl.searchParams.get("dryRun"),
  );
  const q = request.nextUrl.searchParams.get("q")?.trim() || undefined;
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const tokenRequired = Boolean(runToken);
  const tokenValid = tokenRequired ? suppliedToken === runToken : true;

  if (tokenRequired && !tokenValid && !requestedDryRun) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Unauthorized. Missing token permits dryRun=true test runs only.",
      },
      { status: 401 },
    );
  }

  const dryRun = requestedDryRun || (tokenRequired && !tokenValid);
  const result = await runGdeltIngestion({ q, limit, dryRun });
  const status = result.ok || result.rateLimited ? 200 : 502;

  return NextResponse.json(
    {
      ...result,
      reason: result.skipReason,
      dryRun,
      capped: limit === GDELT_MAXRECORDS_HARD_CAP,
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
