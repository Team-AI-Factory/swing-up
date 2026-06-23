import { NextResponse } from "next/server";
import { checkR2Health, getRawWarehouseStatus } from "@/lib/r2-warehouse";

const ASSET_UNIVERSE_SOURCES = [
  ["fmp", "stocks"], ["fmp", "crypto"], ["sec", "company_tickers_and_filings"], ["marketaux", "news_entities"], ["alpha-vantage", "stocks_fx_crypto"], ["coingecko", "coins"], ["frankfurter", "currencies"], ["fred", "economic_series"], ["openfda", "drug_device_events"], ["gdelt", "global_news_events"], ["google-news-rss", "news_rss"],
] as const;

export async function GET() {
  const date = new Date().toISOString().slice(0, 10);
  const plannedSnapshotKeys = ASSET_UNIVERSE_SOURCES.map(([source, assetType]) => `universe/${source}/${assetType}/${date}.json`);
  const [r2, warehouse] = await Promise.all([checkR2Health(false), getRawWarehouseStatus()]);
  return NextResponse.json({
    ok: true,
    sourceAgnostic: true,
    rawWarehouseAvailable: r2.connected,
    rawWarehouseMode: r2.connected ? "r2" : "postgresql-only-fallback",
    assetUniverseSnapshotsSaved: warehouse.snapshots,
    latestSavedRawObjectPath: warehouse.latest?.r2Key ?? null,
    sources: ASSET_UNIVERSE_SOURCES.map(([source, assetType]) => ({ source, assetType })),
    plannedSnapshotKeys,
    backfillPolicy: r2.connected ? "small incremental universe snapshots allowed" : "do not run huge raw full-history backfills before R2 is connected",
  });
}
