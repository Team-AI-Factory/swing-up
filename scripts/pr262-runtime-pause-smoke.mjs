import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const read = (relativePath) => readFile(path.join(repositoryRoot, relativePath), "utf8");

const [railwayRaw, packageRaw, middleware, cronLauncher, legacySensorWorker, legacyPauseLauncher, oldSensorRoute, sensorV3, historicalPolicy, watchOutAuthority] = await Promise.all([
  read("railway.json"),
  read("package.json"),
  read("middleware.ts"),
  read("scripts/pr262-cron-cycle.mjs"),
  read("scripts/railway-pr262-sensor-worker.mjs"),
  read("scripts/railway-pr262-cost-pause-start.mjs"),
  read("app/api/internal/combined-opportunity-engine/change-sensor/route.ts"),
  read("lib/opportunity-engine/pr262-lightweight-sensor-v3.ts"),
  read("lib/equity-signal/pilot-serious-signal-policy.ts"),
  read("lib/opportunity-engine/pr262-serious-watch-out-authority.ts"),
]);

const railway = JSON.parse(railwayRaw);
const pkg = JSON.parse(packageRaw);

assert.equal(railway.deploy?.startCommand, "npm run pr262:cron", "PR262 must run only through the bounded cron launcher");
assert.equal(railway.deploy?.cronSchedule, "*/5 * * * *", "PR262 must use Railway's five-minute cron schedule");
assert.equal(railway.deploy?.restartPolicyType, "NEVER", "A completed cron must not become an always-on process");
assert.equal(railway.deploy?.restartPolicyMaxRetries, 0, "Cron failures must wait for the next scheduled run rather than spin continuously");
assert.equal(pkg.scripts?.["pr262:cron"], "node scripts/pr262-cron-cycle.mjs", "Package script must enter the bounded cron launcher");

assert.match(cronLauncher, /SWING_UP_PR262_CRON_RUNTIME_TOKEN/, "Cron must create or pass a short-lived internal token");
assert.match(cronLauncher, /SWING_UP_R2_WRITE_PREFIX:\s*"branch-labs\/pr-262\/"/, "Cron must fence all R2 writes to PR262");
assert.match(cronLauncher, /AbortSignal\.timeout\(240_000\)/, "Cron route call must have an absolute timeout shorter than the next five-minute schedule");
assert.match(cronLauncher, /SIGTERM/, "Cron must shut down the temporary web app after one cycle");

assert.match(middleware, /\/api\/health/, "Health route must remain available");
assert.match(middleware, /\/api\/internal\/combined-opportunity-engine\/cron-v3/, "Only the V3 cron route may cross the PR262 runtime boundary");
assert.match(middleware, /x-swing-up-pr262-cron-token/, "Cron route must require its internal token");
assert.match(middleware, /pr262_runtime_route_blocked/, "All other API routes must remain blocked");

assert.match(legacySensorWorker, /HARD PAUSED/, "The obsolete direct sensor worker must remain disabled");
assert.match(legacyPauseLauncher, /HARD PAUSED/, "The obsolete hard-pause launcher remains inert and must not be the Railway entry point");
assert.match(oldSensorRoute, /PR262_RUNTIME_HARD_PAUSED = true/, "The old public change-sensor route must remain disabled");

for (const expected of [
  /fetchOfficialFeeds/,
  /fetchGdeltDiscovery/,
  /fetchMarketauxDiscovery/,
  /fetchCommerceNews/,
  /fetchAlphaNews/,
  /fetchAlphaEarningsCalendar/,
  /fetchFederalRegister/,
  /fetchOpenFdaRecalls/,
  /fetchNasdaqTradeHalts/,
  /runPr262DirectAnnouncementMonitor/,
  /market_watch/,
  /FIVE_MINUTES_MS/,
  /FIFTEEN_MINUTES_MS/,
]) assert.match(sensorV3, expected, `V3 sensor is missing ${expected}`);

assert.match(historicalPolicy, /historicalCasesRequiredForSeriousSignal:\s*false/, "Historical cases must not gate Serious Signals");
assert.match(historicalPolicy, /passed:\s*true/, "Compatibility history gate must remain non-blocking");
assert.match(watchOutAuthority, /pr262_committee_verified_serious_watch_out/, "Serious Watch Out must have a committee-verified outbox path");
assert.match(watchOutAuthority, /agentsCompleted\)\s*===\s*14/, "Serious Watch Out must require all 14 committee roles");

console.log("PR #262 controlled runtime smoke passed: five-minute cron enabled, legacy scanners blocked, comprehensive lightweight sensor wired, history gate disabled, and Serious Watch Out authority protected.");
