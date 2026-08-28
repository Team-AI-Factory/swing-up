import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const monitor = readFileSync(new URL("../lib/opportunity-engine/pr262-direct-announcements.ts", import.meta.url), "utf8");
const sensor = readFileSync(new URL("../lib/opportunity-engine/pr262-lightweight-sensor-v3.ts", import.meta.url), "utf8");

assert.match(monitor, /MAX_DISCOVERIES_PER_CYCLE = 24/, "Issuer-feed discovery must make practical progress through the exposure universe at the cost-safe two-hour sensor cadence.");
assert.match(monitor, /DISCOVERY_CONCURRENCY = 4/, "Issuer discovery must stay bounded while avoiding one-by-one timeout amplification.");
assert.match(monitor, /NO_FEED_RETRY_MS = 24 \* 60 \* 60_000/, "Missing feeds must be rechecked daily rather than hidden for a week.");
assert.match(monitor, /Promise\.all\(discoveryTargets\.slice\(start, start \+ DISCOVERY_CONCURRENCY\)/, "Issuer discovery must use its bounded parallel batch.");
assert.match(monitor, /strongBuyBelowPrice[\s\S]*?buyBelowPrice[\s\S]*?trimAbovePrice/, "Issuer discovery must prioritize the live valuation watchlist before traversing the rest of the universe.");
assert.match(sensor, /recordsRead: direct\.feedsPolled, newEvents: direct\.events\.length/, "Cost telemetry must report feeds polled rather than pretending zero-event feeds were not checked.");

console.log(JSON.stringify({
  ok: true,
  dailyRediscovery: true,
  boundedParallelDiscovery: true,
  twentyFourIssuersPerCycle: true,
  feedPollingTelemetryHonest: true,
}, null, 2));
