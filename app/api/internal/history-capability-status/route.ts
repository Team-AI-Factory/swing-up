import { NextResponse } from "next/server";
import {
  assetUniverseRegistry,
  registrySafetySummary,
} from "@/lib/data-registries";

export function GET() {
  return NextResponse.json({
    ok: true,
    capabilities: assetUniverseRegistry.map((item) => ({
      ...item,
      rawBackfill: "disabled_until_r2",
      comparisonWindow: "maximum_available_history",
    })),
    safety: registrySafetySummary(),
  });
}
