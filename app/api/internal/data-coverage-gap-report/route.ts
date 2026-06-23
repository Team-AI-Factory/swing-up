import { NextResponse } from "next/server";
import { checkR2Health, getRawWarehouseStatus } from "@/lib/r2-warehouse";

const SOURCES = ["fmp", "sec", "marketaux", "alpha-vantage", "coingecko", "frankfurter", "fred", "openfda", "gdelt", "google-news-rss"];

export async function GET() {
  const [r2, warehouse] = await Promise.all([checkR2Health(false), getRawWarehouseStatus()]);
  return NextResponse.json({
    ok: true,
    r2Connected: r2.connected,
    rawDataObjectCount: warehouse.count,
    backfillPolicy: r2.connected ? "incremental source-by-source backfills allowed" : "do not start huge raw full-history backfills until R2 is connected",
    gaps: SOURCES.map((source) => ({ source, storedHistory: warehouse.count > 0 ? "inspect indexed raw objects" : "none indexed", maxAvailableHistory: "use max available provider/source history by asset type", needsBackfill: r2.connected ? "planned" : "blocked_until_r2_connected" })),
    safety: { noFakeHistoricalPatternMatching: true, publishesAlerts: false, callsOpenAI: false, sendsTelegram: false },
  });
}
