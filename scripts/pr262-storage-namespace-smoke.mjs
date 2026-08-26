import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
import {
  APPROVED_PR262_RAILWAY_ROLLOUT,
  isApprovedPr262PremergeProductionRollout,
} from "./pr262-premerge-production-rollout.mjs";

const source = readFileSync(new URL("../lib/opportunity-engine/pr262-storage.ts", import.meta.url), "utf8");
const runtimeSource = readFileSync(new URL("../lib/opportunity-engine/pr262-runtime.ts", import.meta.url), "utf8");
const runtimeOutput = ts.transpileModule(runtimeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const runtimeLoaded = { exports: {} };
new Function("require", "module", "exports", runtimeOutput)(createRequire(import.meta.url), runtimeLoaded, runtimeLoaded.exports);
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", output)((specifier) => {
  if (specifier === "@/lib/opportunity-engine/pr262-runtime") return runtimeLoaded.exports;
  return createRequire(import.meta.url)(specifier);
}, loaded, loaded.exports);

const { resolvePr262StoragePrefix, pr262StorageKey, PR262_STORAGE_PREFIXES } = loaded.exports;
assert.equal(PR262_STORAGE_PREFIXES.preview, "branch-labs/pr-262/");
assert.equal(PR262_STORAGE_PREFIXES.production, "production/pr262/");
assert.equal(resolvePr262StoragePrefix({}), "branch-labs/pr-262/");
assert.equal(resolvePr262StoragePrefix({ RAILWAY_GIT_BRANCH: "agent/combined-opportunity-engine", RAILWAY_ENVIRONMENT_NAME: "production" }), "branch-labs/pr-262/");
assert.equal(resolvePr262StoragePrefix({ RAILWAY_GIT_BRANCH: "main", RAILWAY_ENVIRONMENT_NAME: "production" }), "production/pr262/");
assert.equal(pr262StorageKey("sensor/state-v1.json", { RAILWAY_GIT_BRANCH: "main" }), "production/pr262/sensor/state-v1.json");
assert.throws(() => resolvePr262StoragePrefix({
  RAILWAY_GIT_BRANCH: "main",
  SWING_UP_PR262_STORAGE_PREFIX: "production/custom-signal-v2/",
}), /pr262_production_storage_prefix_mismatch/);
assert.equal(resolvePr262StoragePrefix({
  RAILWAY_GIT_BRANCH: "main",
  SWING_UP_R2_WRITE_PREFIX: "production/legacy-engine/",
}), "production/pr262/", "The global write guard must not redirect the PR262 queue namespace.");

assert.throws(() => resolvePr262StoragePrefix({
  RAILWAY_GIT_BRANCH: "main",
  SWING_UP_PR262_STORAGE_PREFIX: "branch-labs/pr-262/",
}), /pr262_production_storage_prefix_mismatch/);
assert.throws(() => resolvePr262StoragePrefix({
  RAILWAY_GIT_BRANCH: "agent/combined-opportunity-engine",
  SWING_UP_PR262_STORAGE_PREFIX: "production/pr262/",
}), /pr262_preview_storage_prefix_mismatch/);

const approvedCommit = "a".repeat(40);
const approvedPremergeEnvironment = {
  SWING_UP_PR262_PREMERGE_PRODUCTION_ROLLOUT: "true",
  SWING_UP_PR262_PREMERGE_APPROVED_COMMIT_SHA: approvedCommit,
  RAILWAY_GIT_COMMIT_SHA: approvedCommit,
  RAILWAY_PROJECT_ID: "83d99341-d622-475f-8035-00ef3d0916d1",
  RAILWAY_ENVIRONMENT_ID: "aa17ed61-337a-41e5-a016-a6ad7bca1534",
  RAILWAY_ENVIRONMENT_NAME: "swing-up-pr-262",
  RAILWAY_GIT_BRANCH: "agent/combined-opportunity-engine",
  SWING_UP_PR262_STORAGE_PREFIX: "production/pr262/",
  SWING_UP_R2_WRITE_PREFIX: "production/pr262/",
};
assert.equal(resolvePr262StoragePrefix(approvedPremergeEnvironment), "production/pr262/");
assert.equal(pr262StorageKey("sensor/state-v1.json", approvedPremergeEnvironment), "production/pr262/sensor/state-v1.json");
assert.equal(isApprovedPr262PremergeProductionRollout(approvedPremergeEnvironment), true);
assert.deepEqual(APPROVED_PR262_RAILWAY_ROLLOUT, runtimeLoaded.exports.PR262_ROLLOUT_RUNTIME);
for (const invalidEnvironment of [
  { ...approvedPremergeEnvironment, SWING_UP_PR262_PREMERGE_PRODUCTION_ROLLOUT: "false" },
  { ...approvedPremergeEnvironment, RAILWAY_PROJECT_ID: "wrong-project" },
  { ...approvedPremergeEnvironment, RAILWAY_ENVIRONMENT_ID: "wrong-environment" },
  { ...approvedPremergeEnvironment, RAILWAY_ENVIRONMENT_NAME: "production" },
  { ...approvedPremergeEnvironment, RAILWAY_GIT_BRANCH: "other-branch" },
  { ...approvedPremergeEnvironment, SWING_UP_PR262_PREMERGE_APPROVED_COMMIT_SHA: "b".repeat(40) },
  { ...approvedPremergeEnvironment, SWING_UP_R2_WRITE_PREFIX: "production/other/" },
]) {
  assert.equal(isApprovedPr262PremergeProductionRollout(invalidEnvironment), false);
  assert.throws(
    () => resolvePr262StoragePrefix(invalidEnvironment),
    /pr262_preview_storage_prefix_mismatch|pr262_nonproduction_storage_prefix_mismatch/,
  );
}
assert.throws(() => pr262StorageKey("../state.json", {}), /pr262_storage_key_invalid/);

console.log(JSON.stringify({
  ok: true,
  previewAndProductionNamespacesSeparated: true,
  productionCannotReadOrWriteBranchNamespaceByConfiguration: true,
  cloudflareAndRailwaySensorStateKeyMatch: true,
  genericWriteGuardCannotRedirectQueue: true,
  premergeProductionRolloutRequiresExactProjectEnvironmentBranchCommitAndPrefixes: true,
}, null, 2));
