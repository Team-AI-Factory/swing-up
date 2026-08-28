import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const monitor = readFileSync(new URL("../lib/opportunity-engine/pr262-direct-announcements.ts", import.meta.url), "utf8");
const sensor = readFileSync(new URL("../lib/opportunity-engine/pr262-lightweight-sensor-v3.ts", import.meta.url), "utf8");

assert.match(monitor, /MAX_DISCOVERIES_PER_CYCLE = 12/, "Issuer-feed discovery must make practical progress through the exposure universe.");
assert.match(monitor, /DISCOVERY_CONCURRENCY = 4/, "Issuer discovery must stay bounded while avoiding one-by-one timeout amplification.");
assert.match(monitor, /NO_FEED_RETRY_MS = 7 \* 24 \* 60 \* 60_000/, "Missing feeds must be retried weekly rather than hidden for a month.");
assert.match(monitor, /Promise\.all\(discoveryTargets\.slice\(start, start \+ DISCOVERY_CONCURRENCY\)/, "Issuer discovery must use its bounded parallel batch.");
assert.match(sensor, /recordsRead: direct\.feedsPolled, newEvents: direct\.events\.length/, "Cost telemetry must report feeds polled rather than pretending zero-event feeds were not checked.");

console.log(JSON.stringify({
  ok: true,
  weeklyRediscovery: true,
  boundedParallelDiscovery: true,
  twelveIssuersPerCycle: true,
  feedPollingTelemetryHonest: true,
}, null, 2));
