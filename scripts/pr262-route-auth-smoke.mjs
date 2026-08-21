import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const source = await readFile(new URL("../lib/internal-api-auth.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", output)(() => {
  throw new Error("Route auth helper must not load runtime dependencies.");
}, loaded, loaded.exports);

const { requiredInternalApiScope, internalApiScopeAuthorized, INTERNAL_API_PATHS } = loaded.exports;
const environment = {
  SWING_UP_PR262_CRON_RUNTIME_TOKEN: "cron-only-secret",
  SWING_UP_PR262_SENSOR_TOKEN: "sensor-only-secret",
  SWING_UP_PR262_FOUNDATION_RUNTIME_TOKEN: "foundation-only-secret",
  SWING_UP_AUTOMATION_TOKEN: "automation-only-secret",
  SWING_UP_INTERNAL_API_TOKEN: "master-internal-secret",
  SWING_UP_SERIOUS_SIGNAL_READ_TOKEN: "read-only-secret",
};

assert.equal(requiredInternalApiScope(INTERNAL_API_PATHS.pr262Cron, "POST"), "cron_runtime");
assert.equal(requiredInternalApiScope(INTERNAL_API_PATHS.pr262SensorHandoff, "POST"), "sensor_handoff");
assert.equal(requiredInternalApiScope(INTERNAL_API_PATHS.pr262ProductionFoundation, "POST"), "foundation_runtime");
assert.equal(requiredInternalApiScope(INTERNAL_API_PATHS.seriousSignalStatus, "GET"), "serious_signal_read");
assert.equal(requiredInternalApiScope("/api/internal/publish-approved-alert", "POST"), "high_privilege");
assert.equal(requiredInternalApiScope("/api/internal/combined-opportunity-engine/global-scan", "POST"), "automation");
assert.equal(requiredInternalApiScope("/api/health", "GET"), null);

const highPrivilegePaths = [
  "/api/internal/publish-approved-alert",
  "/api/internal/run-live-alert-cycle",
  "/api/internal/e2e-alert-test",
  "/api/internal/full-e2e-telegram-test",
  "/api/internal/candidate-factory-run",
  "/api/internal/ledger-outcome-scheduler",
  "/api/internal/live-outcome-evaluator",
  "/api/internal/railway-branch-signal-lab",
  "/api/candidate-alerts/from-raw-signal",
  "/api/candidate-alerts/persist-analysis",
  "/api/price-snapshots/from-alert",
  "/api/ai-committee/run",
];
for (const apiPath of highPrivilegePaths) {
  for (const method of ["GET", "POST"]) assert.equal(requiredInternalApiScope(apiPath, method), "high_privilege", `${apiPath} ${method} escaped the high-privilege boundary.`);
}

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const combinedRoot = path.join(repositoryRoot, "app/api/internal/combined-opportunity-engine");
function routeFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(target) : entry.name === "route.ts" ? [target] : [];
  });
}
for (const file of routeFiles(combinedRoot)) {
  const apiPath = `/api/${path.relative(path.join(repositoryRoot, "app/api"), path.dirname(file)).split(path.sep).join("/")}`;
  const routeSource = readFileSync(file, "utf8");
  const methods = [...routeSource.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((match) => match[1]);
  for (const method of methods) assert.notEqual(requiredInternalApiScope(apiPath, method), null, `${apiPath} ${method} has no explicit middleware scope.`);
}

const sensorHeaders = new Headers({ "x-swing-up-pr262-sensor-token": environment.SWING_UP_PR262_SENSOR_TOKEN });
assert.equal(internalApiScopeAuthorized(sensorHeaders, "sensor_handoff", environment), true);
for (const forbidden of ["cron_runtime", "foundation_runtime", "automation", "high_privilege", "serious_signal_read"]) {
  assert.equal(internalApiScopeAuthorized(sensorHeaders, forbidden, environment), false, `Sensor token crossed into ${forbidden}.`);
}

const cronHeaders = new Headers({ "x-swing-up-pr262-cron-token": environment.SWING_UP_PR262_CRON_RUNTIME_TOKEN });
assert.equal(internalApiScopeAuthorized(cronHeaders, "cron_runtime", environment), true);
assert.equal(internalApiScopeAuthorized(cronHeaders, "sensor_handoff", environment), false);
assert.equal(internalApiScopeAuthorized(cronHeaders, "high_privilege", environment), false);

const foundationHeaders = new Headers({ "x-swing-up-pr262-foundation-token": environment.SWING_UP_PR262_FOUNDATION_RUNTIME_TOKEN });
assert.equal(internalApiScopeAuthorized(foundationHeaders, "foundation_runtime", environment), true);
for (const forbidden of ["cron_runtime", "sensor_handoff", "automation", "high_privilege", "serious_signal_read"]) {
  assert.equal(internalApiScopeAuthorized(foundationHeaders, forbidden, environment), false, `Foundation token crossed into ${forbidden}.`);
}

const automationHeaders = new Headers({ authorization: `Bearer ${environment.SWING_UP_AUTOMATION_TOKEN}` });
assert.equal(internalApiScopeAuthorized(automationHeaders, "automation", environment), true);
assert.equal(internalApiScopeAuthorized(automationHeaders, "high_privilege", environment), false);
assert.equal(internalApiScopeAuthorized(automationHeaders, "serious_signal_read", environment), false);

const readHeaders = new Headers({ "x-swing-up-serious-signal-read-token": environment.SWING_UP_SERIOUS_SIGNAL_READ_TOKEN });
assert.equal(internalApiScopeAuthorized(readHeaders, "serious_signal_read", environment), true);
assert.equal(internalApiScopeAuthorized(readHeaders, "automation", environment), false);
assert.equal(internalApiScopeAuthorized(readHeaders, "high_privilege", environment), false);

const masterHeaders = new Headers({ authorization: `Bearer ${environment.SWING_UP_INTERNAL_API_TOKEN}` });
for (const scope of ["cron_runtime", "sensor_handoff", "foundation_runtime", "automation", "high_privilege", "serious_signal_read"]) {
  assert.equal(internalApiScopeAuthorized(masterHeaders, scope, environment), true, `Master token failed ${scope}.`);
}
assert.equal(internalApiScopeAuthorized(new Headers(), "high_privilege", environment), false);
assert.equal(internalApiScopeAuthorized(new Headers({ authorization: "Bearer guessed" }), "high_privilege", environment), false);

const middleware = await readFile(new URL("../middleware.ts", import.meta.url), "utf8");
const cronLauncher = await readFile(new URL("./pr262-cron-cycle.mjs", import.meta.url), "utf8");
const foundationRoute = await readFile(new URL("../app/api/internal/combined-opportunity-engine/production-foundation/route.ts", import.meta.url), "utf8");
assert.match(middleware, /requiredInternalApiScope/);
assert.match(middleware, /internalApiScopeAuthorized/);
assert.doesNotMatch(middleware, /expectedInternalTokens/, "Middleware must never pool unlike-privilege tokens.");
assert.match(cronLauncher, /const token = process\.env\.SWING_UP_PR262_CRON_RUNTIME_TOKEN/);
assert.doesNotMatch(cronLauncher, /const token = process\.env\.SWING_UP_PR262_SENSOR_TOKEN/, "Cron must not reuse the cheap-sensor token.");
assert.match(foundationRoute, /internalApiScopeAuthorized\(request\.headers, "foundation_runtime"\)/, "The production foundation route must enforce its scope even if middleware is bypassed.");

console.log(JSON.stringify({
  ok: true,
  sensorTokenLimitedToHandoff: true,
  foundationTokenLimitedToBaseline: true,
  cronTokenLimitedToCron: true,
  readTokenCannotMutate: true,
  automationTokenCannotPublish: true,
  pooledTokenAuthorizationRemoved: true,
  everyPr262EngineRouteScoped: true,
  everyChangedHighPrivilegeRouteScoped: true,
  productionFoundationChecksScopeInRoute: true,
}, null, 2));
