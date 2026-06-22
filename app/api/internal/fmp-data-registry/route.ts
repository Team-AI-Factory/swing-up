import { NextResponse } from "next/server";
import { fmpDataRegistry, registrySafetySummary } from "@/lib/data-registries";

export function GET() {
  return NextResponse.json({
    ok: true,
    provider: "FMP Catalyst",
    registry: fmpDataRegistry,
    safety: registrySafetySummary(),
  });
}
