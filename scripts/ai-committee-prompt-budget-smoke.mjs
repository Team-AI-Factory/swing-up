import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const provider = loadTsModule("@/lib/ai-committee/provider");
const policy = loadTsModule("@/lib/ai-committee/model-policy");
const saved = { ...process.env }, originalFetch = globalThis.fetch, originalInfo = console.info;
let calls = 0, received;
try {
  Object.assign(process.env, { OPENAI_API_KEY: "synthetic-no-network", AI_COMMITTEE_ENABLED: "true", AI_COMMITTEE_DRY_RUN_DEFAULT: "false",
    AI_COMMITTEE_DEEP_MODEL: "gpt-6.1-sol", AI_COMMITTEE_MODEL_ALLOWLIST: "gpt-6.1-sol" });
  console.info = () => {};
  globalThis.fetch = async (url, init) => {
    if (url.endsWith("/models")) return Response.json({ data: [{ id: "gpt-6.1-sol" }] });
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    calls++; received = JSON.parse(init.body);
    return Response.json({ model: "gpt-6.1-sol", service_tier: "default",
      choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100,
        prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } } });
  };
  const content = JSON.stringify({ source: "Synthetic fixture only", datedFacts: Array.from({ length: 2200 }, (_, i) => ({ id: i, amount: i })) });
  const messages = [{ role: "system", content: "Use every supplied fact without changing dates or units." }, { role: "user", content }];
  assert.ok(Buffer.byteLength(JSON.stringify(messages)) > 60_997, "Reproduce the transport-escaping overflow class");
  const inputBytes = provider.committeePromptInputBytes(messages);
  assert.ok(inputBytes < 60_000);
  const options = { tier: "deep", confirmRun: true, dryRun: false, maximumPromptBytes: 60_000, messages };
  assert.equal((await provider.runOpenAiCommitteeProvider(options)).ok, true);
  assert.equal(calls, 1);
  assert.equal(received.messages[1].content, content, "No evidence truncation, summaries or changed values");
  assert.equal(received.messages[0].role, "developer");
  assert.equal(received.max_completion_tokens, 8192);
  const oversize = [{ role: "user", content: "ภาษาไทย 🧪".repeat(4000) }];
  assert.ok(provider.committeePromptInputBytes(oversize) > 60_000, "UTF-8 bytes, not JS character count");
  const blocked = await provider.runOpenAiCommitteeProvider({ ...options, messages: oversize });
  assert.equal(blocked.status, "prompt_too_large");
  assert.equal(calls, 1);
  const responseSchema = { name: "bounded", schema: { type: "object", description: "x".repeat(60_000) } };
  const schemaBlocked = await provider.runOpenAiCommitteeProvider({ ...options, messages: [{ role: "user", content: "tiny" }], responseSchema });
  assert.equal(schemaBlocked.status, "prompt_too_large", "Schema remains inside the same input reservation");
  assert.equal(calls, 1);
  assert.equal(policy.AI_COMMITTEE_REVIEW_MAX_PROMPT_BYTES, 60_000);
  assert.equal(policy.AI_COMMITTEE_REVIEW_MAX_COST_USD, 2.7538);
  console.log(JSON.stringify({ syntheticOnly: true, historicalReplay: false, inputBytes,
    transportBytes: Buffer.byteLength(JSON.stringify(messages)), exactContentPreserved: true,
    trueOversizeBlockedBeforeNetwork: true, schemaIncluded: true, unchangedReservation: true }));
} finally {
  globalThis.fetch = originalFetch; console.info = originalInfo;
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
}
