import assert from "node:assert/strict";
import { mapGlobalListingToYahoo } from "../lib/opportunity-engine/global-listing-identity";
import {
  assessLiveCertifiedWatchOutQuality,
  buildOverlappingPageStarts,
  LIVE_CERTIFIED_WATCH_OUT_QUALITY_POLICY,
  summarizeGlobalUniverseRows,
} from "../lib/opportunity-engine/global-market-scanner-v3";


assert.deepEqual(
  mapGlobalListingToYahoo({ symbol: "CEZ", exchange: "PSE", country: "Czech Republic" }),
  { symbol: "CEZ.PR", reason: "Prague Stock Exchange" },
);
assert.deepEqual(
  mapGlobalListingToYahoo({ symbol: "SM", exchange: "PSE", country: "Philippines" }),
  { symbol: "SM.PS", reason: "Philippine Stock Exchange" },
);
assert.equal(
  mapGlobalListingToYahoo({ symbol: "UNKNOWN", exchange: "PSE", country: null }),
  null,
);
assert.deepEqual(
  mapGlobalListingToYahoo({ symbol: "BRK.B", exchange: "NYSE", country: "United States" }),
  { symbol: "BRK-B", reason: "US primary listing" },
);
assert.deepEqual(
  mapGlobalListingToYahoo({ symbol: "MC", exchange: "EURONEXT", country: "France" }),
  { symbol: "MC.PA", reason: "Euronext Paris" },
);

const pagination = buildOverlappingPageStarts(49_369, 1_000);
assert.equal(pagination.pageOverlapRows, 100);
assert.equal(pagination.pageStep, 900);
assert.equal(pagination.starts[0], 900);
assert.ok(pagination.starts.at(-1)! < 49_369);
assert.ok(pagination.starts.every((start, index) => index === 0 || start - pagination.starts[index - 1] <= 1_000));

const rowSummary = summarizeGlobalUniverseRows([
  { rawRowCount: 3, rawListingIdentities: ["NASDAQ:A", "NASDAQ:A"] },
  { rawRowCount: 1, rawListingIdentities: ["NYSE:B"] },
], 2, 1, 2);
assert.equal(rowSummary.rawProviderRowsFetched, 4);
assert.equal(rowSummary.identifiedProviderRows, 3);
assert.equal(rowSummary.unidentifiedProviderRows, 1);
assert.equal(rowSummary.uniqueProviderListingIdentities, 2);
assert.equal(rowSummary.duplicateProviderRowsDiscarded, 1);
assert.equal(rowSummary.unusablePrimaryListings, 0);
assert.equal(rowSummary.usableListingsExcludedByConfiguredLimit, 1);
assert.equal(rowSummary.usableListingPercent, 100);
assert.equal(rowSummary.coveragePercent, 100);

const qualityRows = Array.from({ length: 120 }, (_, index) => ({
  date: new Date(Date.parse("2026-03-28T00:00:00.000Z") + index * 86_400_000).toISOString().slice(0, 10),
  close: 100 - index * 0.1,
  high: 101 - index * 0.1,
}));
const liveQuality = assessLiveCertifiedWatchOutQuality({
  rows: qualityRows,
  splitEvents: [],
  averageVolume: 20_000,
  now: new Date("2026-07-27T10:00:00.000Z"),
});
assert.equal(liveQuality.eligible, true);
assert.ok(liveQuality.eligible && liveQuality.estimatedAverageDollarVolume10d >= 1_000_000);
assert.equal(LIVE_CERTIFIED_WATCH_OUT_QUALITY_POLICY.minimumEstimatedAverageDollarVolume10d, 1_000_000);

const splitBlocked = assessLiveCertifiedWatchOutQuality({
  rows: qualityRows,
  splitEvents: [{ date: qualityRows[80].date, numerator: 1, denominator: 25, splitRatio: "1:25" }],
  averageVolume: 20_000,
  now: new Date("2026-07-27T10:00:00.000Z"),
});
assert.deepEqual(
  { eligible: splitBlocked.eligible, reason: splitBlocked.eligible ? null : splitBlocked.reason },
  { eligible: false, reason: "corporate_action_in_lookback" },
);

const discontinuityRows = qualityRows.map((row, index) => index === 80 ? { ...row, close: 10, high: 11 } : row);
const discontinuityBlocked = assessLiveCertifiedWatchOutQuality({
  rows: discontinuityRows,
  splitEvents: [],
  averageVolume: 20_000,
  now: new Date("2026-07-27T10:00:00.000Z"),
});
assert.deepEqual(
  { eligible: discontinuityBlocked.eligible, reason: discontinuityBlocked.eligible ? null : discontinuityBlocked.reason },
  { eligible: false, reason: "history_price_discontinuity" },
);

const liquidityBlocked = assessLiveCertifiedWatchOutQuality({
  rows: qualityRows,
  splitEvents: [],
  averageVolume: 1_000,
  now: new Date("2026-07-27T10:00:00.000Z"),
});
assert.deepEqual(
  { eligible: liquidityBlocked.eligible, reason: liquidityBlocked.eligible ? null : liquidityBlocked.reason },
  { eligible: false, reason: "insufficient_liquidity" },
);

const missingLiquidityBlocked = assessLiveCertifiedWatchOutQuality({
  rows: qualityRows,
  splitEvents: [],
  averageVolume: null,
  now: new Date("2026-07-27T10:00:00.000Z"),
});
assert.deepEqual(
  { eligible: missingLiquidityBlocked.eligible, reason: missingLiquidityBlocked.eligible ? null : missingLiquidityBlocked.reason },
  { eligible: false, reason: "liquidity_evidence_unavailable" },
);

const staleBlocked = assessLiveCertifiedWatchOutQuality({
  rows: qualityRows,
  splitEvents: [],
  averageVolume: 20_000,
  now: new Date("2026-08-03T10:00:00.000Z"),
});
assert.deepEqual(
  { eligible: staleBlocked.eligible, reason: staleBlocked.eligible ? null : staleBlocked.reason },
  { eligible: false, reason: "stale_history" },
);

console.log(JSON.stringify({
  ok: true,
  ambiguousExchangeResolvedByCountry: true,
  unknownAmbiguousExchangeBlocked: true,
  sharedByGlobalScannerAndDeepResearch: true,
  stableOverlappingPagination: true,
  rawRowsSeparatedFromDuplicatesAndUsability: true,
  corporateActionsBlockedFromSeriousWarnings: true,
  extremeHistoryDiscontinuitiesBlockedFromSeriousWarnings: true,
  minimumLiquidityEvidenceRequired: true,
  staleHistoryBlockedWithinFourDays: true,
}, null, 2));
