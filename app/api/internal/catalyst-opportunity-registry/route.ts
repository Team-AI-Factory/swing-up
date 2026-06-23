import { NextResponse } from "next/server";

const OPPORTUNITIES = [
  { source: "FMP", catalysts: ["press_release", "stock_news", "earnings", "guidance", "analyst_estimate"], marketReaction: "bonus_only" },
  { source: "SEC", catalysts: ["8-K", "10-Q", "10-K", "13F", "insider_transactions"], marketReaction: "bonus_only" },
  { source: "Marketaux", catalysts: ["entity_news", "sector_news"], marketReaction: "bonus_only" },
  { source: "Alpha Vantage", catalysts: ["time_series", "news_sentiment", "fundamentals"], marketReaction: "bonus_only" },
  { source: "CoinGecko", catalysts: ["coin_market_data", "crypto_universe"], marketReaction: "bonus_only" },
  { source: "Frankfurter", catalysts: ["fx_rates"], marketReaction: "bonus_only" },
  { source: "FRED", catalysts: ["macro_series"], marketReaction: "bonus_only" },
  { source: "openFDA", catalysts: ["drug_events", "device_events", "recalls"], marketReaction: "bonus_only" },
  { source: "GDELT", catalysts: ["global_events", "news_documents"], marketReaction: "bonus_only" },
  { source: "Google News RSS", catalysts: ["rss_headlines"], marketReaction: "bonus_only" },
];

export async function GET() {
  return NextResponse.json({ ok: true, opportunities: OPPORTUNITIES, gates: { marketReactionRequired: false, missingPriceVolumeRejectsCandidate: false, stage2LockedUnlessProofAndPromotionScorePass: true }, safety: { publishesAlerts: false, callsOpenAI: false, sendsTelegram: false } });
}
