import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";

const mockSignals = [
  { source: "SEC EDGAR", ticker: "NVDA", signalType: "8-K filing", title: "NVDA files material agreement update", summary: "A new 8-K filing references a supply agreement amendment that may affect forward margin assumptions.", importanceHint: "high", sourceUrl: "https://www.sec.gov/edgar", payload: { form: "8-K", accession: "mock-nvda-8k" } },
  { source: "FMP", ticker: "AMD", signalType: "earnings calendar", title: "AMD earnings date refreshed", summary: "Financial Modeling Prep calendar data shows an updated expected earnings window for AMD.", importanceHint: "medium", payload: { endpoint: "earnings-calendar", provider: "FMP" } },
  { source: "GDELT", ticker: "TSLA", signalType: "news velocity", title: "Tesla coverage velocity rises", summary: "GDELT-style monitoring detected a rise in international coverage around delivery commentary.", importanceHint: "medium", payload: { tone: 1.7, article_count: 42 } },
  { source: "FRED", ticker: null, signalType: "macro series", title: "Treasury spread update", summary: "A macro series refresh was stored for later cross-checking against rate-sensitive equities.", importanceHint: "low", sourceUrl: "https://fred.stlouisfed.org/", payload: { series: "T10Y2Y", value: "mock" } },
  { source: "openFDA", ticker: "PFE", signalType: "safety report", title: "FDA adverse-event monitor changed", summary: "Mock openFDA watchlist data recorded a modest change in report volume for a monitored product family.", importanceHint: "medium", sourceUrl: "https://open.fda.gov/", payload: { reports_delta_pct: 3.8 } },
  { source: "ClinicalTrials.gov", ticker: "MRNA", signalType: "trial update", title: "Clinical trial status changed", summary: "A registered trial status changed and is queued for later review against biotech watchlist rules.", importanceHint: "high", sourceUrl: "https://clinicaltrials.gov/", payload: { nct_id: "NCT00000000", status: "Recruiting" } },
  { source: "Google News RSS", ticker: "SHOP", signalType: "headline cluster", title: "Shopify merchant tools coverage cluster", summary: "A headline cluster around merchant tooling was captured for later duplicate filtering and source scoring.", importanceHint: "low", payload: { cluster_size: 9 } },
  { source: "CoinGecko", ticker: "COIN", signalType: "crypto market", title: "Crypto market liquidity proxy moved", summary: "CoinGecko-style market data noted a move in crypto liquidity proxies relevant to exchange-linked equities.", importanceHint: "medium", sourceUrl: "https://www.coingecko.com/", payload: { asset: "bitcoin", volume_change_pct: 5.2 } },
  { source: "Frankfurter FX", ticker: "EURUSD", signalType: "fx rate", title: "EUR/USD reference rate stored", summary: "A foreign-exchange reference rate was stored for future macro and multinational revenue checks.", importanceHint: "low", sourceUrl: "https://www.frankfurter.app/", payload: { base: "EUR", quote: "USD" } },
];

export async function POST() {
  try {
    const results = [];
    for (const signal of mockSignals) {
      const existing = await prisma.rawSignal.findFirst({ where: { source: signal.source, title: signal.title } });
      if (existing) {
        results.push(existing);
        continue;
      }
      results.push(await prisma.rawSignal.create({ data: { ...signal, processedStatus: "new", payload: signal.payload as Prisma.InputJsonValue } }));
    }
    return NextResponse.json({ ok: true, created_or_existing: results.length });
  } catch {
    return NextResponse.json({ ok: false, error: "Unable to seed raw signals." }, { status: 500 });
  }
}

export { POST as GET };
