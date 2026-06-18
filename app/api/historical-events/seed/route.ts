import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

const seedEvents = [
  { ticker: "AAPL", companyName: "Apple", sector: "Technology", eventType: "product_launch", eventDate: "2023-06-05", title: "Vision Pro headset unveiled", summary: "Apple introduced a major new spatial-computing product category at WWDC.", source: "Mock press coverage", sourceUrl: "https://www.apple.com/newsroom/", priceBefore: 179.58, priceAfter1d: 179.21, priceAfter7d: 183.31, priceAfter30d: 189.59, outcomeLabel: "positive", notes: "Mock training event for product launch reactions." },
  { ticker: "NVDA", companyName: "NVIDIA", sector: "Technology", eventType: "guidance_raise", eventDate: "2023-05-24", title: "AI demand drives guidance raise", summary: "NVIDIA issued sharply higher forward revenue guidance tied to data-center AI demand.", source: "Mock earnings release", sourceUrl: "https://nvidianews.nvidia.com/", priceBefore: 305.38, priceAfter1d: 379.80, priceAfter7d: 378.34, priceAfter30d: 422.09, outcomeLabel: "positive", notes: "Illustrates high-conviction guidance reset." },
  { ticker: "TSLA", companyName: "Tesla", sector: "Consumer Discretionary", eventType: "earnings_surprise", eventDate: "2022-10-19", title: "Mixed earnings reaction", summary: "Tesla reported earnings that beat some estimates while margin and demand commentary kept reaction mixed.", source: "Mock earnings coverage", sourceUrl: "https://ir.tesla.com/", priceBefore: 222.04, priceAfter1d: 207.28, priceAfter7d: 224.64, priceAfter30d: 180.19, outcomeLabel: "mixed", notes: "Mixed setup with short-term volatility." },
  { ticker: "META", companyName: "Meta Platforms", sector: "Communication Services", eventType: "guidance_cut", eventDate: "2022-10-26", title: "Cost and growth concerns pressure shares", summary: "Meta cut expectations as investors reacted to slower growth and elevated metaverse spending.", source: "Mock earnings coverage", sourceUrl: "https://investor.fb.com/", priceBefore: 129.82, priceAfter1d: 97.94, priceAfter7d: 90.79, priceAfter30d: 111.41, outcomeLabel: "negative", notes: "Guidance cut and expense concern example." },
  { ticker: "PFE", companyName: "Pfizer", sector: "Health Care", eventType: "fda_approval", eventDate: "2021-08-23", title: "COVID vaccine receives full FDA approval", summary: "FDA approval acted as a regulatory milestone for the vaccine franchise.", source: "Mock FDA release", sourceUrl: "https://www.fda.gov/", priceBefore: 48.72, priceAfter1d: 49.48, priceAfter7d: 46.07, priceAfter30d: 43.73, outcomeLabel: "mixed", notes: "Regulatory good news can still fade after anticipation." },
  { ticker: "MRNA", companyName: "Moderna", sector: "Health Care", eventType: "trial_success", eventDate: "2020-11-16", title: "Vaccine trial efficacy success", summary: "Moderna announced strong efficacy data from a pivotal vaccine trial.", source: "Mock company release", sourceUrl: "https://investors.modernatx.com/", priceBefore: 89.39, priceAfter1d: 97.95, priceAfter7d: 101.03, priceAfter30d: 140.23, outcomeLabel: "positive", notes: "Trial success example for biotech-style catalysts." },
  { ticker: "BIIB", companyName: "Biogen", sector: "Health Care", eventType: "trial_failure", eventDate: "2019-03-21", title: "Alzheimer trial discontinued", summary: "A key late-stage Alzheimer program was stopped after an interim futility analysis.", source: "Mock company release", sourceUrl: "https://investors.biogen.com/", priceBefore: 320.59, priceAfter1d: 226.88, priceAfter7d: 233.18, priceAfter30d: 235.67, outcomeLabel: "negative", notes: "Large downside trial-failure reference case." },
  { ticker: "JPM", companyName: "JPMorgan Chase", sector: "Financials", eventType: "sec_filing", eventDate: "2023-05-01", title: "Bank acquisition details filed", summary: "A regulatory filing described terms tied to a distressed-bank acquisition.", source: "Mock SEC filing", sourceUrl: "https://www.sec.gov/", priceBefore: 138.24, priceAfter1d: 141.20, priceAfter7d: 136.74, priceAfter30d: 135.71, outcomeLabel: "neutral", notes: "SEC filing event with limited sustained impact." },
  { ticker: "COIN", companyName: "Coinbase", sector: "Financials", eventType: "crypto_shock", eventDate: "2022-11-09", title: "Crypto exchange shock hits sector", summary: "A major crypto liquidity crisis pressured crypto-linked equities.", source: "Mock market coverage", sourceUrl: "https://www.coinbase.com/blog", priceBefore: 55.87, priceAfter1d: 50.83, priceAfter7d: 45.26, priceAfter30d: 39.63, outcomeLabel: "negative", notes: "Crypto contagion shock case." },
  { ticker: "SPY", companyName: "SPDR S&P 500 ETF", sector: "Macro", eventType: "macro_shock", eventDate: "2020-03-16", title: "Pandemic volatility shock", summary: "Broad markets sold off sharply during the pandemic liquidity shock.", source: "Mock market history", sourceUrl: "https://www.federalreserve.gov/", priceBefore: 269.32, priceAfter1d: 252.80, priceAfter7d: 222.95, priceAfter30d: 279.10, outcomeLabel: "mixed", notes: "Macro shock with later policy-driven rebound." },
  { ticker: "NFLX", companyName: "Netflix", sector: "Communication Services", eventType: "insider_buy", eventDate: "2022-01-28", title: "Insider purchase after drawdown", summary: "A notable insider purchase followed a sharp subscriber-growth repricing.", source: "Mock Form 4", sourceUrl: "https://www.sec.gov/", priceBefore: 384.36, priceAfter1d: 427.14, priceAfter7d: 410.17, priceAfter30d: 391.29, outcomeLabel: "neutral", notes: "Insider buy does not guarantee sustained upside." },
  { ticker: "AMZN", companyName: "Amazon", sector: "Consumer Discretionary", eventType: "insider_sell", eventDate: "2021-11-15", title: "Executive stock sale disclosed", summary: "A planned executive sale was disclosed during a period of broad technology volatility.", source: "Mock Form 4", sourceUrl: "https://www.sec.gov/", priceBefore: 177.28, priceAfter1d: 177.04, priceAfter7d: 178.63, priceAfter30d: 169.67, outcomeLabel: "neutral", notes: "Routine insider sale reference case." },
];

export async function POST() {
  try {
    let created = 0;
    let skipped = 0;

    for (const event of seedEvents) {
      const eventDate = new Date(`${event.eventDate}T00:00:00.000Z`);
      const existing = await prisma.historicalEvent.findFirst({
        where: { ticker: event.ticker, eventType: event.eventType, eventDate, title: event.title },
      });
      if (existing) {
        skipped += 1;
        continue;
      }
      await prisma.historicalEvent.create({ data: { ...event, eventDate } });
      created += 1;
    }

    return NextResponse.json({ ok: true, created, skipped, total: seedEvents.length });
  } catch {
    return NextResponse.json({ ok: false, error: "Unable to seed historical events." }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}
