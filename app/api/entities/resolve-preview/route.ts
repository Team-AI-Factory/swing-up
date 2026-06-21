import { NextResponse } from "next/server";
import { resolveTickerEntity } from "@/lib/entities/ticker-resolver";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("query") ?? "";
  const dryRun = url.searchParams.get("dryRun") !== "false";
  const provider = url.searchParams.get("provider") ?? "resolve-preview";
  const result = resolveTickerEntity({ companyName: query, sourceTitle: query, sourceProvider: provider, rawPayload: { query } });

  return NextResponse.json({ ok: true, dryRun, readOnly: true, query, result });
}
