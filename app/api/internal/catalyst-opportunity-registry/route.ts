import { NextResponse } from "next/server";
import { registrySafetySummary } from "@/lib/data-registries";

export function GET() {
  return NextResponse.json({
    ok: true,
    opportunities: [
      "company_filings",
      "company_press_releases",
      "verified_news",
      "macro_data",
      "market_context_bonus",
    ],
    safety: registrySafetySummary(),
  });
}
