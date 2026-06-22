import { NextRequest, NextResponse } from "next/server";
import {
  assetUniverseRegistry,
  registrySafetySummary,
} from "@/lib/data-registries";

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const body = await request.json().catch(() => ({}));
  const dryRun =
    url.searchParams.get("dryRun") !== "false" && body?.dryRun !== false;
  return NextResponse.json({
    ok: true,
    dryRun,
    synced: dryRun ? 0 : assetUniverseRegistry.length,
    preview: assetUniverseRegistry,
    safety: registrySafetySummary(),
  });
}
