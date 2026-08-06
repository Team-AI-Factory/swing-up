#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const path = "lib/opportunity-engine/us-signal-operations.ts";
let source = await readFile(path, "utf8");

function replaceOnce(label, before, after) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}_expected_once_found_${count}`);
  source = source.replace(before, after);
}

replaceOnce(
  "signal_source",
  '  | "earnings_value_bridge"\n  | "event_pilot"',
  '  | "earnings_value_bridge"\n  | "fundamental_acceleration"\n  | "event_pilot"',
);
replaceOnce(
  "specialist_type",
  '    | "utility_earnings_power"\n    | "semiconductor_mid_cycle"',
  '    | "utility_earnings_power"\n    | "mega_cap_cloud_platform"\n    | "semiconductor_mid_cycle"',
);

replaceOnce(
  "cloud_model",
  '  if (/\\b(semiconductor|memory|integrated circuits|chip)\\b/.test(words)) {',
  `  if (
    /\\b(cloud|software|internet retail|e-commerce|interactive media|digital platform|computer services)\\b/.test(words)
    && (item.marketCap ?? 0) >= 100_000_000_000
    && item.scores.businessQuality >= 75
  ) {
    const normalizedFcf = normalization?.normalizedFreeCashFlow ?? null;
    const normalizedFcfPerShare = normalizedFcf !== null && shares && shares > 0 ? normalizedFcf / shares : null;
    const growth = median([
      item.fundamentals.revenueGrowthTtmPercent,
      item.fundamentals.revenueGrowthFyPercent,
      item.fundamentals.epsGrowthTtmPercent,
    ].filter((value): value is number => value !== null)) ?? 0;
    const requiredFcfYield = clamp(0.06 - Math.max(0, growth) * 0.0006 - item.scores.businessQuality * 0.00008, 0.035, 0.06);
    const justifiedPe = clamp(20 + Math.max(0, growth) * 0.25 + (item.scores.businessQuality - 75) * 0.15, 20, 32);
    const values = [
      normalizedFcfPerShare && normalizedFcfPerShare > 0 ? normalizedFcfPerShare / requiredFcfYield : null,
      eps && eps > 0 ? eps * justifiedPe : null,
    ].filter((value): value is number => value !== null);
    const fairValue = median(values);
    const seriousEligible = values.length >= 2 && normalization?.buyQualityConfirmed === true;
    return {
      ticker: item.ticker,
      model: "mega_cap_cloud_platform",
      fairValue: rounded(fairValue),
      seriousEligible,
      confidence: fairValue === null ? 25 : seriousEligible ? 85 : 60,
      reasons: fairValue === null ? [] : [
        "Five-year owner earnings and current earnings power are combined for a high-quality cloud or digital-platform company.",
        \`The model uses a conservative \${(requiredFcfYield * 100).toFixed(1)}% owner-earnings yield and caps the earnings multiple at \${justifiedPe.toFixed(1)}x.\`,
      ],
      blockers: seriousEligible ? [] : [
        "Five-year SEC cash-flow durability and balance-sheet confirmation are required before serious promotion.",
      ],
    };
  }
  if (/\\b(semiconductor|memory|integrated circuits|chip)\\b/.test(words)) {`,
);

replaceOnce(
  "acceleration_lane",
  '    if (item.decision.tier === "serious_foundation_sell" && diligence.sell.has(ticker) && priceConfirmed) {',
  `    const revenueAcceleration = Math.max(
      item.fundamentals.revenueGrowthTtmPercent ?? -Infinity,
      item.fundamentals.revenueGrowthFyPercent ?? -Infinity,
    );
    const earningsAcceleration = Math.max(
      item.fundamentals.netIncomeGrowthTtmPercent ?? -Infinity,
      item.fundamentals.epsGrowthTtmPercent ?? -Infinity,
    );
    const accelerationUpside = baseFairValue ? (baseFairValue / currentPrice - 1) * 100 : null;
    const actualFundamentalAcceleration = commonBuyQuality
      && secBuyConfirmed
      && priceConfirmed
      && normalization?.buyQualityConfirmed === true
      && revenueAcceleration >= 12
      && earningsAcceleration >= 15
      && item.scores.businessQuality >= 80
      && item.scores.risk <= 40
      && (accelerationUpside ?? -Infinity) >= 10;
    if (actualFundamentalAcceleration) {
      currentSignals.push(makeSignal({
        source: "fundamental_acceleration",
        action: "buy",
        item,
        currentPrice,
        confidence: Math.min(96, Math.round(
          item.scores.fairValueConfidence * 0.55
          + Math.min(100, revenueAcceleration * 2) * 0.2
          + Math.min(100, earningsAcceleration * 1.5) * 0.15
          + item.scores.businessQuality * 0.1
        )),
        regime,
        reasons: [
          \`Revenue growth is running at \${revenueAcceleration.toFixed(1)}% and earnings growth at \${earningsAcceleration.toFixed(1)}%.\`,
          "Five-year SEC cash-flow, profit durability, cash, debt, and asset checks passed without relying on an analyst estimate.",
          \`The independently checked price remains \${(accelerationUpside ?? 0).toFixed(1)}% below normalized base fair value.\`,
          "This lane exists so a missed news headline cannot hide a real improvement in the business.",
        ],
        officialSourceConfirmed: true,
        secDiligenceConfirmed: true,
        priceCrossChecked: true,
        historicalPilotPassed: null,
        normalization,
        specialist,
        checkedAt,
      }));
    }

    if (item.decision.tier === "serious_foundation_sell" && diligence.sell.has(ticker) && priceConfirmed) {`,
);

replaceOnce(
  "policy_markers",
  "  thesisChangeEngine: true,\n  specialistValuationModels: true,",
  "  thesisChangeEngine: true,\n  fundamentalAccelerationBridge: true,\n  specialistValuationModels: true,\n  megaCapCloudPlatformModel: true,",
);

for (const marker of [
  '"fundamental_acceleration"',
  'model: "mega_cap_cloud_platform"',
  'const actualFundamentalAcceleration = commonBuyQuality',
  'fundamentalAccelerationBridge: true',
  'megaCapCloudPlatformModel: true',
]) {
  if (!source.includes(marker)) throw new Error(`missing_marker_${marker}`);
}

await writeFile(path, source, "utf8");
console.log("Added direct fundamental-acceleration Buy lane and mega-cap cloud-platform valuation model.");
