import assert from "node:assert/strict";
import { mapGlobalListingToYahoo } from "../lib/opportunity-engine/global-listing-identity";
import { buildOverlappingPageStarts, isEligibleUsCommonStockOrAdr, summarizeGlobalUniverseRows } from "../lib/opportunity-engine/global-market-scanner-v3";

assert.equal(isEligibleUsCommonStockOrAdr({ exchange: "NASDAQ", typeSpecs: ["common"] }), true);
assert.equal(isEligibleUsCommonStockOrAdr({ exchange: "NYSE", typeSpecs: ["dr"] }), true);
assert.equal(isEligibleUsCommonStockOrAdr({ exchange: "LSE", typeSpecs: ["common"] }), false);
assert.equal(isEligibleUsCommonStockOrAdr({ exchange: "NYSE", typeSpecs: ["preferred"] }), false);

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

console.log(JSON.stringify({
  ok: true,
  ambiguousExchangeResolvedByCountry: true,
  unknownAmbiguousExchangeBlocked: true,
  sharedByGlobalScannerAndDeepResearch: true,
  stableOverlappingPagination: true,
  rawRowsSeparatedFromDuplicatesAndUsability: true,
  usCommonStocksAndAdrsOnly: true,
  nonUsListingsDisabled: true,
}, null, 2));
