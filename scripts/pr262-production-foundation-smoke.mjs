import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
const routeSource = readFileSync(new URL("../app/api/internal/combined-opportunity-engine/production-foundation/route.ts", import.meta.url), "utf8");
const output = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

let storedState = null;
let runInput = null;
let runCount = 0;
let exposureBuilds = 0;
const stubs = {
  "next/server": {
    NextResponse: {
      json(body, options = {}) {
        return { body, status: options.status ?? 200 };
      },
    },
  },
  "@/lib/internal-api-auth": {
    internalApiScopeAuthorized: (headers, scope) => scope === "foundation_runtime"
      && headers.get("x-swing-up-pr262-foundation-token") === "foundation-token",
  },
  "@/lib/opportunity-engine/pr262-exposure-index": {
    loadPr262ExposureIndex: async () => {
      exposureBuilds += 1;
      return {
        version: 2,
        valueCycleId: "cycle-complete",
        builtAt: new Date().toISOString(),
        valueCoverage: { complete: true, totalCompanies: 6_000, companiesStored: 6_000, completedBatches: 12, totalBatches: 12 },
        entries: Array.from({ length: 6_000 }, (_, index) => ({ ticker: `T${index}` })),
      };
    },
  },
  "@/lib/opportunity-engine/us-value-investing-resumable": {
    readResumableUsValueState: async () => storedState,
    runResumableUsValueBatch: async (input) => {
      runInput = input;
      runCount += 1;
      return {
        ok: true,
        mode: "pr262_us_value_resumable_batches",
        status: "running",
        progress: { cycleId: "cycle-1", totalCompanies: 6_000, companiesStored: 2_000 },
        safety: { databaseWrites: false, publishing: false, notifications: false, trades: false, productionWrites: true },
      };
    },
  },
  "@/lib/opportunity-engine/pr262-storage": {
    resolvePr262StoragePrefix: () => "production/pr262/",
  },
};
const loaded = { exports: {} };
new Function("require", "module", "exports", output)((name) => stubs[name] ?? nodeRequire(name), loaded, loaded.exports);

const priorEnvironment = {
  branch: process.env.RAILWAY_GIT_BRANCH,
  environment: process.env.RAILWAY_ENVIRONMENT_NAME,
  enabled: process.env.SWING_UP_PR262_PRODUCTION_FOUNDATION_ENABLED,
};
process.env.RAILWAY_GIT_BRANCH = "main";
process.env.RAILWAY_ENVIRONMENT_NAME = "production";
process.env.SWING_UP_PR262_PRODUCTION_FOUNDATION_ENABLED = "true";

try {
  const request = { headers: new Headers({ "x-swing-up-pr262-foundation-token": "foundation-token" }) };
  const unauthenticated = await loaded.exports.POST({ headers: new Headers() });
  assert.equal(unauthenticated.status, 404, "The route must enforce its dedicated token without relying only on middleware.");

  const running = await loaded.exports.POST(request);
  assert.equal(running.status, 200);
  assert.equal(running.body.mode, "pr262_production_foundation");
  assert.equal(running.body.foundationOnly, true);
  assert.deepEqual(runInput, { foundationOnly: true, requireCompleteUniverse: true });

  storedState = {
    status: "complete",
    completedAt: new Date().toISOString(),
    cycleId: "cycle-complete",
    totalCompanies: 6_000,
    companiesStored: 6_000,
    totalBatches: 12,
    completedBatchKeys: Array.from({ length: 12 }, (_, index) => `batch-${index}`),
  };
  const fresh = await loaded.exports.POST(request);
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.skipped, true);
  assert.equal(fresh.body.reason, "production_foundation_fresh");
  assert.equal(fresh.body.exposure.ready, true);
  assert.equal(fresh.body.exposure.entries, 6_000);
  assert.equal(exposureBuilds, 1, "A complete foundation must materialize and verify the full exposure index.");
  assert.equal(runCount, 1, "A fresh completed foundation must not rescan the market.");

  process.env.RAILWAY_GIT_BRANCH = "agent/combined-opportunity-engine";
  process.env.RAILWAY_ENVIRONMENT_NAME = "preview";
  const preview = await loaded.exports.POST(request);
  assert.equal(preview.status, 404, "The production foundation route must fail closed on the PR branch.");
} finally {
  if (priorEnvironment.branch === undefined) delete process.env.RAILWAY_GIT_BRANCH;
  else process.env.RAILWAY_GIT_BRANCH = priorEnvironment.branch;
  if (priorEnvironment.environment === undefined) delete process.env.RAILWAY_ENVIRONMENT_NAME;
  else process.env.RAILWAY_ENVIRONMENT_NAME = priorEnvironment.environment;
  if (priorEnvironment.enabled === undefined) delete process.env.SWING_UP_PR262_PRODUCTION_FOUNDATION_ENABLED;
  else process.env.SWING_UP_PR262_PRODUCTION_FOUNDATION_ENABLED = priorEnvironment.enabled;
}

const runnerSource = readFileSync(new URL("../lib/opportunity-engine/us-value-investing-resumable.ts", import.meta.url), "utf8");
const launcherSource = readFileSync(new URL("./pr262-production-foundation-cycle.mjs", import.meta.url), "utf8");
const railwayConfig = JSON.parse(readFileSync(new URL("../railway.foundation.json", import.meta.url), "utf8"));
assert.match(runnerSource, /input\.requireCompleteUniverse && !raw\.ok/);
assert.match(runnerSource, /if \(!input\.foundationOnly\)/);
for (const secret of ["DATABASE_URL", "OPENAI_API_KEY", "TELEGRAM_BOT_TOKEN", "SWING_UP_SERIOUS_SIGNAL_WEBHOOK_URL"]) {
  assert.match(launcherSource, new RegExp(`"${secret}"`), `${secret} must be stripped from the isolated foundation process.`);
}
assert.match(launcherSource, /MAX_BATCH_ROUNDS = 10/);
assert.equal(railwayConfig.deploy.startCommand, "npm run pr262:production-foundation");
assert.equal(railwayConfig.deploy.cronSchedule, "17 2 * * *");

console.log(JSON.stringify({
  ok: true,
  productionOnly: true,
  dedicatedLeastPrivilegeToken: true,
  completeUniverseRequired: true,
  foundationCannotUseAiDatabaseOrNotifications: true,
  freshDailyBaselineSkipsDuplicateWork: true,
  oneJobResumesAllBatches: true,
  completeExposureRequiredBeforeSuccess: true,
}, null, 2));
