import { NextResponse } from "next/server";
import { COINGECKO_SOURCE, getCoinGeckoSourceHealth } from "@/lib/ears/coingecko";

export async function GET() {
  try {
    const health = await getCoinGeckoSourceHealth();
    return NextResponse.json({ ok: true, source: COINGECKO_SOURCE, health });
  } catch {
    return NextResponse.json({ ok: false, source: COINGECKO_SOURCE, error: "Unable to load CoinGecko source health." }, { status: 500 });
  }
}
