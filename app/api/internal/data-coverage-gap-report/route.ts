import { NextResponse } from "next/server";
import {
  fmpDataRegistry,
  assetUniverseRegistry,
  registrySafetySummary,
} from "@/lib/data-registries";

export function GET() {
  return NextResponse.json({
    ok: true,
    gaps: [
      {
        area: "r2_raw_history_storage",
        status: "not_connected",
        action: "avoid_huge_raw_history_backfills",
      },
    ],
    fmpRegistryCount: fmpDataRegistry.length,
    assetUniverseCount: assetUniverseRegistry.length,
    safety: registrySafetySummary(),
  });
}
