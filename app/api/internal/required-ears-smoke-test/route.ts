import { NextRequest, NextResponse } from "next/server";
import { runRequiredEarsSmokeTest } from "@/lib/ops/required-ears-smoke-test";

type Body = { dryRun?: unknown; limitPerSource?: unknown; sources?: unknown };
function bool(value: unknown) { if (typeof value === "boolean") return value; if (typeof value === "string") return ["1", "true", "yes"].includes(value.toLowerCase()) ? true : ["0", "false", "no"].includes(value.toLowerCase()) ? false : undefined; return undefined; }
function num(value: unknown) { if (typeof value === "number") return value; if (typeof value === "string") return Number.parseInt(value, 10); return undefined; }
function strings(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : undefined; }

export async function POST(request: NextRequest) {
  let body: Body = {};
  try { body = await request.json() as Body; } catch { body = {}; }
  const payload = await runRequiredEarsSmokeTest({ dryRun: bool(body.dryRun), limitPerSource: num(body.limitPerSource), sources: strings(body.sources) });
  return NextResponse.json(payload, { status: payload.ok ? 200 : 207 });
}
