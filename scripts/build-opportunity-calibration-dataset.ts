import { mkdir, writeFile } from "node:fs/promises";
import { evaluateFoundation } from "../lib/opportunity-engine/engine";
import { buildCleanHistoricalOpportunityCases } from "../lib/opportunity-engine/historical-cases-v2";

const outputPath = process.env.CALIBRATION_DATASET_PATH ?? "/tmp/combined-opportunity-engine-calibration-dataset.json";
const earliestDate = process.env.CALIBRATION_EARLIEST_DATE ?? "2016-01-01";
const tickers = (process.env.CALIBRATION_TICKERS ?? "AAPL,MSFT,NVDA,GOOGL,AMZN,META,AVGO,AMD,TSLA,WMT,JPM,BAC,XOM,CVX,KO,PEP,UNH,HD,COST,CRM,ORCL,NFLX,UBER,ADBE,INTC,QCOM,CSCO,MCD,NKE,DIS")
  .split(",").map((ticker) => ticker.trim().toUpperCase()).filter(Boolean).slice(0, 35);

const round = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(8)) : null;
const safe = (error: unknown) => error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 260) : "dataset_build_failed";

async function main() {
  const source = await buildCleanHistoricalOpportunityCases(tickers, earliestDate);
  const rows = source.cases.map((row) => {
    const decision = evaluateFoundation(row.input);
    const marketCap = row.input.valuation.marketCap;
    return {
      ticker: row.ticker,
      company: row.company,
      filingDate: row.filingDate,
      accession: row.accession,
      fiscalPeriod: row.input.fiscalPeriod,
      year: Number(row.filingDate.slice(0, 4)),
      month: Number(row.filingDate.slice(5, 7)),
      features: {
        opportunityScore: decision.scores.opportunityScore,
        businessQuality: decision.scores.businessQuality,
        financialMomentum: decision.scores.financialMomentum,
        valuationSupport: decision.scores.valuationSupport,
        expectationsGap: decision.scores.expectationsGap,
        timingQuality: decision.scores.timingQuality,
        evidenceConfidence: decision.scores.evidenceConfidence,
        riskScore: decision.scores.riskScore,
        revenueGrowthYoY: round(row.input.metrics.revenueGrowthYoY),
        priorRevenueGrowthYoY: round(row.input.metrics.priorRevenueGrowthYoY),
        revenueGrowthAcceleration: row.input.metrics.revenueGrowthYoY !== null && row.input.metrics.priorRevenueGrowthYoY !== null ? round(row.input.metrics.revenueGrowthYoY - row.input.metrics.priorRevenueGrowthYoY) : null,
        operatingMargin: round(row.input.metrics.operatingMargin),
        priorOperatingMargin: round(row.input.metrics.priorOperatingMargin),
        operatingMarginChange: row.input.metrics.operatingMargin !== null && row.input.metrics.priorOperatingMargin !== null ? round(row.input.metrics.operatingMargin - row.input.metrics.priorOperatingMargin) : null,
        netMargin: round(row.input.metrics.netMargin),
        freeCashFlowMargin: round(row.input.metrics.freeCashFlowMargin),
        cashToLiabilities: round(row.input.metrics.cashToLiabilities),
        debtToAssets: round(row.input.metrics.debtToAssets),
        sharesGrowthYoY: round(row.input.metrics.sharesGrowthYoY),
        returnOnAssets: round(row.input.metrics.returnOnAssets),
        logMarketCap: marketCap !== null && marketCap > 0 ? round(Math.log(marketCap)) : null,
        priceToSales: round(row.input.valuation.priceToSales),
        priceToEarnings: round(row.input.valuation.priceToEarnings),
        freeCashFlowYield: round(row.input.valuation.freeCashFlowYield),
        priceChange1d: round(row.input.market.priceChange1d),
        priceChange20d: round(row.input.market.priceChange20d),
        priceChange90d: round(row.input.market.priceChange90d),
        volumeRatio: round(row.input.market.volumeRatio),
        missingFieldCount: row.input.missingFields.length,
        receiptCount: row.input.receipts.length,
      },
      outcomes: {
        return30d: round(row.return30d),
        excess30d: round(row.excess30d),
        drawdown30d: round(row.drawdown30d),
        return90d: round(row.return90d),
        excess90d: round(row.excess90d),
        drawdown90d: round(row.drawdown90d),
      },
      sourceUrls: row.input.receipts.map((receipt) => receipt.url).filter(Boolean),
    };
  }).sort((left, right) => `${left.filingDate}:${left.ticker}`.localeCompare(`${right.filingDate}:${right.ticker}`));

  const dataset = {
    version: 1,
    checkedAt: new Date().toISOString(),
    sourceMode: "real_point_in_time_sec_and_market_data",
    earliestDate,
    cleaning: source.cleaning,
    rows,
    sourceErrors: source.errors,
    noSyntheticData: true,
    safety: { databaseWrites: false, r2Writes: false, publishing: false, notifications: false, payments: false, openAiCalls: false },
  };
  await mkdir(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, rowCount: rows.length, tickers: [...new Set(rows.map((row) => row.ticker))].length, cleaning: source.cleaning, sourceErrors: source.errors.length, outputPath }, null, 2));
}

main().catch(async (error) => {
  const report = { version: 1, ok: false, checkedAt: new Date().toISOString(), fatalError: safe(error) };
  await mkdir(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
});
