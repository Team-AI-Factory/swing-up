import { NextRequest, NextResponse } from "next/server";
import { runTestEarBatch } from "@/lib/ops/test-ear-batch";

type RequestBody = {
  dryRun?: unknown;
  sources?: unknown;
  limitPerSource?: unknown;
  saveRawSignals?: unknown;
};

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "no"].includes(normalized)) return false;
    if (["true", "1", "yes"].includes(normalized)) return true;
  }
  return undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseInt(value, 10);
  return undefined;
}

export async function POST(request: NextRequest) {
  let body: RequestBody = {};
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    body = {};
  }

  const result = await runTestEarBatch({
    dryRun: booleanValue(body.dryRun),
    sources: stringArray(body.sources),
    limitPerSource: numberValue(body.limitPerSource),
    saveRawSignals: booleanValue(body.saveRawSignals),
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 207 });
}
