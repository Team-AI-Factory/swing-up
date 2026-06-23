import { NextRequest, NextResponse } from "next/server";
import { checkR2Health, saveJsonToR2 } from "@/lib/r2-warehouse";

const SOURCES = [
  ["fmp", "stocks"], ["fmp", "crypto"], ["sec", "company_tickers_and_filings"], ["marketaux", "news_entities"], ["alpha-vantage", "stocks_fx_crypto"], ["coingecko", "coins"], ["frankfurter", "currencies"], ["fred", "economic_series"], ["openfda", "drug_device_events"], ["gdelt", "global_news_events"], ["google-news-rss", "news_rss"],
] as const;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const dryRun = body?.dryRun !== false;
  const date = new Date().toISOString().slice(0, 10);
  const r2 = await checkR2Health(false);
  const planned = SOURCES.map(([source, assetType]) => ({ source, assetType, r2Key: `universe/${source}/${assetType}/${date}.json` }));
  const saved: string[] = [];
  if (!dryRun && r2.connected) {
    for (const item of planned) {
      await saveJsonToR2(item.r2Key, { source: item.source, assetType: item.assetType, syncedAt: new Date().toISOString(), records: [] }, { source: item.source, assetType: item.assetType, dataType: "universe", recordCount: 0 });
      saved.push(item.r2Key);
    }
  }
  return NextResponse.json({ ok: true, dryRun, sourceAgnostic: true, r2Connected: r2.connected, rawWarehouseMode: r2.connected ? "r2" : "postgresql-only-fallback", planned, saved, backfillPolicy: "universe snapshot only; no huge raw full-history backfills here" });
}
