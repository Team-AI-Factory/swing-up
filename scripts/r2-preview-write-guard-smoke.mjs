import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const source = await readFile(new URL("../lib/r2-warehouse.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: "r2-warehouse.ts",
});
const nodeRequire = createRequire(import.meta.url);
const loadedModule = { exports: {} };
new Function("require", "module", "exports", transpiled.outputText)(
  (specifier) => {
    if (specifier === "@/lib/db/client") return { prisma: {} };
    if (specifier === "@/lib/redact-secrets") return { redactSecrets: (value) => value };
    return nodeRequire(specifier);
  },
  loadedModule,
  loadedModule.exports,
);

const {
  assertR2MutationKeyAllowed,
  normalizeR2WritePrefix,
} = loadedModule.exports;
if (typeof assertR2MutationKeyAllowed !== "function" || typeof normalizeR2WritePrefix !== "function") {
  throw new Error("R2 preview write guard helpers were not exported.");
}

const prefix = "branch-labs/pr-262/";
if (normalizeR2WritePrefix(` ${prefix} `) !== prefix) throw new Error("Valid R2 preview prefix was not normalized.");
for (const method of ["PUT", "DELETE", "POST", "PATCH"]) {
  assertR2MutationKeyAllowed(method, `${prefix}serious-signal/state.json`, prefix);
  let blocked = false;
  try {
    assertR2MutationKeyAllowed(method, "branch-labs/pr-261/serious-signal/state.json", prefix);
  } catch (error) {
    blocked = error instanceof Error && error.message === "r2_mutation_outside_write_prefix";
  }
  if (!blocked) throw new Error(`${method} outside the preview R2 prefix was not blocked.`);
}
assertR2MutationKeyAllowed("GET", "raw/shared/read-only.json", prefix);
assertR2MutationKeyAllowed("HEAD", "", prefix);

for (const invalid of ["/branch-labs/pr-262/", "branch-labs/pr-262", "branch-labs/../pr-262/", "branch-labs//pr-262/"]) {
  let blocked = false;
  try {
    normalizeR2WritePrefix(invalid);
  } catch (error) {
    blocked = error instanceof Error && error.message === "r2_write_prefix_invalid";
  }
  if (!blocked) throw new Error(`Invalid R2 write prefix was accepted: ${invalid}`);
}

const startScript = await readFile(new URL("./railway-branch-start.mjs", import.meta.url), "utf8");
for (const marker of [
  `SWING_UP_R2_WRITE_PREFIX: r2WritePrefix`,
  `"branch-labs/pr-262/"`,
  `"branch-labs/pr-261/"`,
  `const productionLabBranch = allowedLabBranch && environment === "production"`,
  `if (productionLabBranch)`,
  `migrations were not run`,
]) {
  if (!startScript.includes(marker)) throw new Error(`Branch startup preview guard is missing: ${marker}`);
}

const productionAttempt = spawnSync(process.execPath, [fileURLToPath(new URL("./railway-branch-start.mjs", import.meta.url))], {
  encoding: "utf8",
  env: {
    ...process.env,
    RAILWAY_GIT_BRANCH: "agent/combined-opportunity-engine",
    RAILWAY_ENVIRONMENT_NAME: "production",
    RAILWAY_PROJECT_ID: "smoke-project",
  },
  timeout: 5_000,
});
if (productionAttempt.status !== 1) throw new Error(`Allowed lab branch did not refuse production startup (exit ${productionAttempt.status}).`);
const productionOutput = `${productionAttempt.stdout ?? ""}${productionAttempt.stderr ?? ""}`;
if (!productionOutput.includes("refusing to start isolated branch") || !productionOutput.includes("migrations were not run")) {
  throw new Error("Production refusal did not explicitly confirm migrations were skipped.");
}
if (productionOutput.includes("applying normal database migrations")) {
  throw new Error("Production lab-branch refusal attempted database migrations.");
}

console.log(JSON.stringify({
  ok: true,
  previewPrefixes: ["branch-labs/pr-261/", "branch-labs/pr-262/"],
  outsidePrefixMutationsBlocked: true,
  readOutsidePrefixAllowed: true,
  productionLabBranchRefusedBeforeMigrations: true,
}, null, 2));
