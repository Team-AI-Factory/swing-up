import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../lib/ai-committee/provider.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: "provider.ts",
});
const loadedModule = { exports: {} };
new Function("require", "module", "exports", transpiled.outputText)(() => ({}), loadedModule, loadedModule.exports);
const { runOpenAiCommitteeProvider } = loadedModule.exports;
if (typeof runOpenAiCommitteeProvider !== "function") throw new Error("OpenAI committee provider did not load.");

const envKeys = [
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "AI_COMMITTEE_ENABLED",
  "AI_COMMITTEE_DRY_RUN_DEFAULT",
  "AI_COMMITTEE_MODEL_ALLOWLIST",
  "AI_COMMITTEE_REQUEST_TIMEOUT_MS",
];
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const pinnedModel = "gpt-4.1-mini-2025-04-14";

try {
  process.env.OPENAI_API_KEY = "smoke-test-key";
  process.env.OPENAI_MODEL = pinnedModel;
  process.env.AI_COMMITTEE_ENABLED = "true";
  process.env.AI_COMMITTEE_DRY_RUN_DEFAULT = "false";
  process.env.AI_COMMITTEE_MODEL_ALLOWLIST = pinnedModel;
  process.env.AI_COMMITTEE_REQUEST_TIMEOUT_MS = "1000";

  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({
      choices: [{ message: { content: "{}" } }],
      usage: { prompt_tokens: 123, completion_tokens: 17, total_tokens: 140, prompt_tokens_details: { cached_tokens: 40 } },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const completed = await runOpenAiCommitteeProvider({ tier: "fast", confirmRun: true, dryRun: false, messages: [{ role: "user", content: "test" }] });
  if (!completed.ok || completed.model !== pinnedModel) throw new Error("Pinned model request did not complete.");
  if (completed.tokenUsage?.totalTokens !== 140 || completed.tokenUsage?.cachedPromptTokens !== 40) throw new Error("Actual OpenAI token usage was not captured.");

  process.env.OPENAI_MODEL = "gpt-4.1";
  const blocked = await runOpenAiCommitteeProvider({ tier: "fast", confirmRun: true, dryRun: false, messages: [{ role: "user", content: "test" }] });
  if (blocked.ok || blocked.status !== "model_not_allowed" || fetchCalls !== 1) throw new Error("A model outside the branch allowlist was not blocked before the API call.");

  process.env.OPENAI_MODEL = pinnedModel;
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    const safetyTimer = setTimeout(() => reject(new Error("timeout signal did not fire")), 1_500);
    init?.signal?.addEventListener("abort", () => {
      clearTimeout(safetyTimer);
      reject(init.signal.reason);
    }, { once: true });
  });
  const timedOut = await runOpenAiCommitteeProvider({ tier: "fast", confirmRun: true, dryRun: false, messages: [{ role: "user", content: "test" }] });
  if (timedOut.ok || timedOut.status !== "provider_timeout") throw new Error("A stalled OpenAI request did not stop at the configured timeout.");

  const startScript = await readFile(new URL("./railway-branch-start.mjs", import.meta.url), "utf8");
  for (const marker of [
    `OPENAI_MODEL: "${pinnedModel}"`,
    `AI_COMMITTEE_FAST_MODEL: "${pinnedModel}"`,
    `AI_COMMITTEE_DEEP_MODEL: "${pinnedModel}"`,
    `AI_COMMITTEE_FINAL_MODEL: "${pinnedModel}"`,
    `AI_COMMITTEE_MODEL_ALLOWLIST: "${pinnedModel}"`,
    `AI_COMMITTEE_REQUEST_TIMEOUT_MS: "12000"`,
  ]) {
    if (!startScript.includes(marker)) throw new Error(`Railway branch guardrail missing: ${marker}`);
  }

  console.log(JSON.stringify({ ok: true, pinnedModel, modelAllowlist: true, requestTimeout: true, actualTokenUsage: completed.tokenUsage }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
}
