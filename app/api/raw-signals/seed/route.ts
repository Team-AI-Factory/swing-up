import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/client";
import { normalizeRawSignalInput, serializeRawSignal } from "@/lib/raw-signals";

const mockSignals = [
  { source: "SEC EDGAR", ticker: "NVDA", signal_type: "filing", title: "10-Q filing received for NVIDIA", summary: "Quarterly filing metadata captured for later review.", importance_hint: "high", source_url: "https://www.sec.gov/edgar/search/", payload: { form: "10-Q", accession: "mock-nvda-10q" } },
  { source: "FMP", ticker: "AAPL", signal_type: "earnings_calendar", title: "Apple earnings date update", summary: "Earnings calendar item recorded without scoring.", importance_hint: "medium", payload: { fiscalQuarter: "Q3", confirmed: false } },
  { source: "GDELT", ticker: "TSLA", signal_type: "news_event", title: "Tesla supply chain headline cluster", summary: "News event cluster saved for downstream filtering.", importance_hint: "medium", source_url: "https://www.gdeltproject.org/", payload: { tone: 1.8, articleCount: 14 } },
  { source: "FRED", ticker: null, signal_type: "macro", title: "Treasury yield observation", summary: "Macro series observation saved as market context.", importance_hint: "low", source_url: "https://fred.stlouisfed.org/", payload: { series: "DGS10", value: "4.21" } },
  { source: "openFDA", ticker: "PFE", signal_type: "regulatory", title: "Drug label update captured", summary: "Public FDA label change stored for future review.", importance_hint: "high", source_url: "https://open.fda.gov/", payload: { endpoint: "drug/label", count: 3 } },
  { source: "ClinicalTrials.gov", ticker: "MRNA", signal_type: "clinical_trial", title: "Clinical trial status changed", summary: "Trial status metadata stored for later matching.", importance_hint: "urgent", source_url: "https://clinicaltrials.gov/", payload: { nctId: "NCT00000000", status: "Completed" } },
  { source: "Google News RSS", ticker: "MSFT", signal_type: "news", title: "Microsoft AI infrastructure headlines", summary: "RSS headline bundle saved without promotion.", importance_hint: "medium", payload: { headlineCount: 7 } },
  { source: "CoinGecko", ticker: "BTC", signal_type: "crypto_market", title: "Bitcoin market snapshot", summary: "Crypto market context stored from public source placeholder.", importance_hint: "low", source_url: "https://www.coingecko.com/", payload: { symbol: "bitcoin", priceUsd: 64000 } },
  { source: "Frankfurter FX", ticker: "EURUSD", signal_type: "fx", title: "EUR/USD exchange rate snapshot", summary: "FX rate context saved for macro-aware review.", importance_hint: "low", source_url: "https://www.frankfurter.app/", payload: { base: "EUR", quote: "USD", rate: 1.08 } },
  { source: "SEC EDGAR", ticker: "AMD", signal_type: "filing", title: "8-K filing received for AMD", summary: "Current report filing metadata captured for later review.", importance_hint: "high", source_url: "https://www.sec.gov/edgar/search/", payload: { form: "8-K", accession: "mock-amd-8k" } },
];

export async function POST() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ ok: false, message: "Raw signal seeding is unavailable right now." }, { status: 503 });
  }

  try {
    const created = [];
    let skipped = 0;

    for (const signal of mockSignals) {
      const normalized = normalizeRawSignalInput(signal);
      if (!normalized.ok) continue;

      const existing = await prisma.rawSignal.findFirst({
        where: { source: normalized.data.source, title: normalized.data.title, ticker: normalized.data.ticker },
      });

      if (existing) {
        skipped += 1;
        continue;
      }

      created.push(await prisma.rawSignal.create({ data: normalized.data }));
    }

    return NextResponse.json({ ok: true, created: created.length, skipped, signals: created.map(serializeRawSignal) }, { status: 201 });
  } catch {
    return NextResponse.json({ ok: false, message: "Raw signal seeding failed safely." }, { status: 500 });
  }
}

export { POST as GET };
