#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const path = "lib/opportunity-engine/us-signal-operations.ts";
let source = await readFile(path, "utf8");

function replaceOnce(label, before, after) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}_expected_once_found_${count}`);
  source = source.replace(before, after);
}

function replaceSection(label, start, end, replacement) {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) throw new Error(`${label}_start_not_found`);
  const endIndex = source.indexOf(end, startIndex);
  if (endIndex < 0) throw new Error(`${label}_end_not_found`);
  source = source.slice(0, startIndex) + replacement + source.slice(endIndex);
}

source = source.replace("const MAX_PRICE_CANDIDATES = 400;", "const MAX_PRICE_CANDIDATES = 5_000;");
source = source.replace(
  ".filter((candidate) => recentCandidate(candidate, now, 7));",
  ".filter((candidate) => recentCandidate(candidate, now, 14));",
);

if (!source.includes("buyQualityConfirmed: boolean;")) {
  replaceOnce(
    "normalization_type",
    "  normalizedFreeCashFlow: number | null;\n  positiveNetIncomeYears: number;",
    "  normalizedFreeCashFlow: number | null;\n  cash: number | null;\n  totalDebt: number | null;\n  assets: number | null;\n  debtToCash: number | null;\n  debtToAssets: number | null;\n  buyQualityConfirmed: boolean;\n  positiveNetIncomeYears: number;",
  );
}

replaceSection(
  "tradingview_chunks",
  "async function fetchTradingViewQuotes(",
  "async function fetchYahooSeries(",
  `async function fetchTradingViewQuotes(items: UsValueCompanyAnalysis[], fetchImpl: typeof fetch, observedAt: string) {
  if (!items.length) return new Map<string, Quote>();
  const chunks = Array.from(
    { length: Math.ceil(items.length / 500) },
    (_, index) => items.slice(index * 500, (index + 1) * 500),
  );
  const maps = await mapWithConcurrency(chunks, 5, async (chunk) => {
    const response = await fetchImpl("https://scanner.tradingview.com/america/scan", {
      method: "POST",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        origin: "https://www.tradingview.com",
        referer: "https://www.tradingview.com/",
        "user-agent": "Mozilla/5.0 (compatible; SwingUpPriceOnly/2.0)",
      },
      body: JSON.stringify({
        symbols: {
          tickers: chunk.map((item) => item.tradingViewSymbol),
          query: { types: [] },
        },
        columns: [
          "name",
          "description",
          "exchange",
          "close",
          "change",
          "volume",
          "relative_volume_10d_calc",
          "market_cap_basic",
        ],
        range: [0, chunk.length],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const payload = object(await response.json().catch(() => null));
    if (!response.ok) throw new Error(\`tradingview_price_only_http_\${response.status}\`);
    const output = new Map<string, Quote>();
    for (const raw of array(payload.data).map(object)) {
      const symbol = text(raw.s)?.toUpperCase();
      const data = array(raw.d);
      if (!symbol || data.length < 8) continue;
      const ticker = symbol.includes(":") ? symbol.split(":").at(-1)! : symbol;
      const price = finite(data[3]);
      if (price === null || price <= 0) continue;
      output.set(ticker, {
        ticker,
        tradingViewSymbol: symbol,
        exchange: text(data[2]),
        price,
        changePercent: finite(data[4]),
        volume: finite(data[5]),
        relativeVolume: finite(data[6]),
        marketCap: finite(data[7]),
        observedAt,
        source: "TradingView public scanner",
      });
    }
    return output;
  });
  const combined = new Map<string, Quote>();
  for (const map of maps) for (const [ticker, quote] of map) combined.set(ticker, quote);
  return combined;
}

async function fetchYahooSeries(`,
);

if (!source.includes("function latestInstantValue(")) {
  replaceOnce(
    "instant_helper",
    "function alignedValue(rows: SecFactRow[], end: string) {\n  return rows.find((row) => row.end === end)?.value ?? null;\n}\n",
    `function alignedValue(rows: SecFactRow[], end: string) {
  return rows.find((row) => row.end === end)?.value ?? null;
}

function latestInstantValue(payload: Json, concepts: string[]) {
  const rows = secRows(payload, concepts, ["USD"])
    .filter((row) => SEC_ANNUAL_FORMS.has(row.form ?? ""))
    .sort((left, right) => \`\${right.end}:\${right.filed ?? ""}\`.localeCompare(\`\${left.end}:\${left.filed ?? ""}\`));
  return rows[0]?.value ?? null;
}
`,
  );
}

if (!source.includes("const totalDebt = currentDebt + noncurrentDebt;")) {
  replaceOnce(
    "normalization_debt_compute",
    "  const normalizedFreeCashFlow = median(freeCashFlows.slice(-5));\n  const latestNetIncome = netIncomeValues.at(-1) ?? null;",
    `  const normalizedFreeCashFlow = median(freeCashFlows.slice(-5));
  const cash = latestInstantValue(payload, [
    "CashAndCashEquivalentsAtCarryingValue",
    "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    "CashAndCashEquivalents",
  ]);
  const currentDebt = latestInstantValue(payload, [
    "DebtCurrent",
    "LongTermDebtCurrent",
    "ShortTermBorrowings",
    "CommercialPaper",
    "CurrentBorrowings",
  ]) ?? 0;
  const noncurrentDebt = latestInstantValue(payload, [
    "LongTermDebtNoncurrent",
    "LongTermDebtAndFinanceLeaseObligationsNoncurrent",
    "LongTermDebtAndCapitalLeaseObligations",
    "NoncurrentBorrowings",
  ]) ?? 0;
  const assets = latestInstantValue(payload, ["Assets"]);
  const totalDebt = currentDebt + noncurrentDebt;
  const debtToCash = cash && cash > 0 ? totalDebt / cash : totalDebt > 0 ? Infinity : 0;
  const debtToAssets = assets && assets > 0 ? totalDebt / assets : null;
  const balanceSheetRisk = debtToCash > 4 || (debtToAssets ?? 0) > 0.55;
  const latestNetIncome = netIncomeValues.at(-1) ?? null;`,
  );
}

replaceOnce(
  "normalization_durable",
  "  const oneTimeOrPeakRisk = (latestNetIncomeToMedianRatio ?? 1) > 2\n    || (latestCashConversion ?? 1) < 0.5\n    || earningsStability < 60\n    || freeCashFlowStability < 60;",
  `  const oneTimeOrPeakRisk = (latestNetIncomeToMedianRatio ?? 1) > 2
    || (latestCashConversion ?? 1) < 0.5
    || earningsStability < 60
    || freeCashFlowStability < 60;
  const buyQualityConfirmed = yearsAvailable >= 5
    && !oneTimeOrPeakRisk
    && !balanceSheetRisk
    && normalizedFreeCashFlow !== null
    && normalizedFreeCashFlow > 0;`,
);

replaceOnce(
  "normalization_blockers",
  "    ...((latestCashConversion ?? 1) < 0.5 ? [\"Latest operating cash flow is less than half of reported net income.\"] : []),\n  ];",
  `    ...((latestCashConversion ?? 1) < 0.5 ? ["Latest operating cash flow is less than half of reported net income."] : []),
    ...(debtToCash > 4 ? ["Total debt is more than four times available cash."] : []),
    ...((debtToAssets ?? 0) > 0.55 ? ["Debt exceeds 55% of reported assets."] : []),
  ];`,
);

replaceOnce(
  "normalization_return",
  "    normalizedFreeCashFlow: rounded(normalizedFreeCashFlow, 0),\n    positiveNetIncomeYears,",
  `    normalizedFreeCashFlow: rounded(normalizedFreeCashFlow, 0),
    cash: rounded(cash, 0),
    totalDebt: rounded(totalDebt, 0),
    assets: rounded(assets, 0),
    debtToCash: Number.isFinite(debtToCash) ? rounded(debtToCash) : null,
    debtToAssets: rounded(debtToAssets),
    buyQualityConfirmed,
    positiveNetIncomeYears,`,
);
source = source.replace(
  "    durableEnoughForSeriousBuy: yearsAvailable >= 5 && !oneTimeOrPeakRisk,",
  "    durableEnoughForSeriousBuy: buyQualityConfirmed,",
);
source = source.replaceAll(
  "const secBuyConfirmed = diligence.buy.has(ticker);",
  "const secBuyConfirmed = diligence.buy.has(ticker) || normalization?.buyQualityConfirmed === true;",
);

if (!source.includes("const MAX_PRICE_CANDIDATES = 5_000;")) throw new Error("full_market_price_coverage_not_applied");
if (!source.includes("recentCandidate(candidate, now, 14)")) throw new Error("fourteen_day_event_memory_not_applied");
if (!source.includes("buyQualityConfirmed: boolean;")) throw new Error("buy_quality_type_not_applied");
if (!source.includes("const buyQualityConfirmed = yearsAvailable >= 5")) throw new Error("buy_quality_calculation_not_applied");
if ((source.match(/normalization\?\.buyQualityConfirmed === true/g) ?? []).length < 2) throw new Error("fresh_sec_buy_confirmation_not_applied_to_both_buy_paths");

await writeFile(path, source, "utf8");
console.log("Expanded PR #262 to full-market price coverage, 14-day earnings memory, and fresh SEC Buy quality confirmation.");
