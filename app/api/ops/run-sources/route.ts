import { NextRequest, NextResponse } from "next/server";
import { runSources } from "@/lib/ops/source-runner";

type RunSourcesBody = {
  dryRun?: boolean | string;
  sources?: string[] | string;
  limit?: number | string;
  tickers?: string[] | string;
  force?: boolean | string;
};

function parseBoolean(value: boolean | string | null | undefined, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  if (["true", "1", "yes"].includes(value.toLowerCase())) return true;
  if (["false", "0", "no"].includes(value.toLowerCase())) return false;
  return fallback;
}

function parseList(value: string[] | string | null | undefined) {
  if (Array.isArray(value)) return value;
  if (!value) return undefined;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseLimit(value: number | string | null | undefined) {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return undefined;
  return Math.floor(parsed);
}

async function readBody(request: NextRequest): Promise<RunSourcesBody> {
  if (!request.headers.get("content-type")?.includes("application/json")) return {};
  try {
    return (await request.json()) as RunSourcesBody;
  } catch {
    return {};
  }
}

async function runFromRequest(request: NextRequest, body: RunSourcesBody = {}) {
  const query = request.nextUrl.searchParams;
  const result = await runSources({
    dryRun: parseBoolean(body.dryRun ?? query.get("dryRun"), true),
    sources: parseList(body.sources ?? query.get("sources")),
    limit: parseLimit(body.limit ?? query.get("limit")),
    tickers: parseList(body.tickers ?? query.get("tickers")),
    force: parseBoolean(body.force ?? query.get("force"), false),
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 207 });
}

export async function GET(request: NextRequest) {
  return runFromRequest(request);
}

export async function POST(request: NextRequest) {
  return runFromRequest(request, await readBody(request));
}
