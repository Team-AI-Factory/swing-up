import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/opportunity-engine/pr262-storage.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", output)(createRequire(import.meta.url), loaded, loaded.exports);

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
assert.throws(() => pr262StorageKey("../state.json", {}), /pr262_storage_key_invalid/);

console.log(JSON.stringify({
  ok: true,
  previewAndProductionNamespacesSeparated: true,
  productionCannotReadOrWriteBranchNamespaceByConfiguration: true,
  cloudflareAndRailwaySensorStateKeyMatch: true,
  genericWriteGuardCannotRedirectQueue: true,
}, null, 2));
