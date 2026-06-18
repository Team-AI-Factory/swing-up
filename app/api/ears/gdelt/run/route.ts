import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_GDELT_TERMS, runGdeltIngestion } from "@/lib/ears/gdelt";

const MAX_AUTHENTICATED_TERMS = 25;
const MAX_UNAUTHENTICATED_TERMS = 2;
const MAX_AUTHENTICATED_LIMIT = 10;
const MAX_UNAUTHENTICATED_LIMIT = 3;

function parseTerms(value: string | null, q: string | null) {
  if (q?.trim()) return [q.trim()];
  if (!value) return DEFAULT_GDELT_TERMS;
  return value.split(",").map((term) => term.trim()).filter(Boolean);
}

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

  if (hasConfiguredToken && suppliedToken !== runToken) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const maxTerms = hasConfiguredToken ? MAX_AUTHENTICATED_TERMS : MAX_UNAUTHENTICATED_TERMS;
  const maxLimit = hasConfiguredToken ? MAX_AUTHENTICATED_LIMIT : MAX_UNAUTHENTICATED_LIMIT;
  const requestedTerms = parseTerms(request.nextUrl.searchParams.get("terms"), request.nextUrl.searchParams.get("q"));
  const terms = requestedTerms.slice(0, maxTerms);
  const limit = Math.min(parseLimit(request.nextUrl.searchParams.get("limit"), maxLimit), maxLimit);
  const dryRun = parseDryRun(request.nextUrl.searchParams.get("dryRun")) || !hasConfiguredToken;

  const result = await runGdeltIngestion({ terms, limit, dryRun });
  const status = result.ok ? 200 : 502;

  return NextResponse.json({
    ok: result.ok,
    source: result.source,
    termsChecked: result.termsChecked,
    signalsCreated: result.signalsCreated,
    duplicatesSkipped: result.duplicatesSkipped,
    errors: result.errors,
    dryRun,
    capped: !hasConfiguredToken,
  }, { status });
}

export async function GET(request: NextRequest) {
  return handleRun(request);
}

export async function POST(request: NextRequest) {
  return handleRun(request);
}
