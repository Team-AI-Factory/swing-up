import { NextResponse } from "next/server";
import {
  assetUniverseRegistry,
  registrySafetySummary,
} from "@/lib/data-registries";

export function GET() {
  return NextResponse.json({
    ok: true,
    registry: assetUniverseRegistry,
    status: "dry_run_ready",
    safety: registrySafetySummary(),
  });
}
