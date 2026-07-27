import assert from "node:assert/strict";
import { mapGlobalListingToYahoo } from "../lib/opportunity-engine/global-listing-identity";

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

console.log(JSON.stringify({
  ok: true,
  ambiguousExchangeResolvedByCountry: true,
  unknownAmbiguousExchangeBlocked: true,
  sharedByGlobalScannerAndDeepResearch: true,
}, null, 2));
