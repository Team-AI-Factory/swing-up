import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

// Independent, entirely local proof: a later role's oversized base prompt
// prevents all requests, and its actual receipt releases only its own holds.
// The modified judge instruction is synthetic; this is not an INOD replay.
const agents = loadTsModule("@/lib/ai-committee/agents");
const provider = loadTsModule("@/lib/ai-committee/provider");
const policy = loadTsModule("@/lib/ai-committee/review-policy");
const promptInput = loadTsModule("@/lib/ai-committee/prompt-input");
let networkCalls = 0, providerCalls = 0, gateInputs = [];
const committee = loadTsModule("@/lib/ai-committee/orchestrator", {
  "@/lib/ai-committee/agents": { ...agents, AI_COMMITTEE_AGENTS: agents.AI_COMMITTEE_AGENTS.map(agent =>
    agent.id === "final_judge" ? { ...agent,
      purpose: "Synthetic intrinsically oversized role requirement. ".repeat(1600) } : agent) },
  "@/lib/ai-committee/provider": { ...provider, runOpenAiCommitteeProvider: async options => {
    providerCalls++;
    return provider.runOpenAiCommitteeProvider(options);
  } },
  "@/lib/ai-committee/prompt-input": { ...promptInput, committeePromptPreflight: options => {
    gateInputs.push(structuredClone(options));
    return promptInput.committeePromptPreflight(options);
  } },
  "@/lib/ai-committee/evidence-pack": { buildAiCommitteeEvidencePack() { throw Error("Unexpected source I/O"); } },
  "@/lib/ai-committee/run-persistence": { persistAiCommitteeRun() { throw Error("Unexpected persistence"); } },
});
const pack = JSON.parse(readFileSync(new URL("./fixtures/committee-serv-reconstructed-2026-10-07/evidence-pack.json", import.meta.url), "utf8"));
const originalPack = structuredClone(pack);

// Use actual cost/admission functions with isolated, ETag-checked memory only.
const objects = new Map();
let revision = 0;
const storageKey = key => `local-only/preflight-usage/${key}`;
const put = (key, value) => objects.set(key, { value: structuredClone(value), etag: `etag-${++revision}` });
const storage = {
  readVersionedTextFromR2: async key => {
    const row = objects.get(key);
    return row ? { found: true, text: JSON.stringify(row.value), etag: row.etag }
      : { found: false, text: null, etag: null };
  },
  writeVersionedJsonToR2: async (key, value, options = {}) => {
    const row = objects.get(key);
    assert.ok(options.createOnly || options.expectedEtag);
    if ((options.createOnly && row) || (options.expectedEtag && options.expectedEtag !== row?.etag)) {
      return { written: false, conflict: true, etag: null };
    }
    put(key, value);
    return { written: true, conflict: false, etag: objects.get(key).etag };
  },
};
const cost = loadTsModule("@/lib/opportunity-engine/pr262-ai-daily-cost", {
  "@/lib/r2-warehouse": storage,
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: storageKey },
  "@/lib/ai-committee/billing-audit": { readOpenAiBillingAudit() { throw Error("Billing API forbidden"); } },
});
const eventSource = readFileSync(new URL("../lib/opportunity-engine/pr262-event-job.ts", import.meta.url), "utf8");
assert.ok(eventSource.includes("async function releaseRejectedCommitteeCall("));
const exposed = eventSource.replace("async function releaseRejectedCommitteeCall(", "export async function releaseRejectedCommitteeCall(");
const compiled = ts.transpileModule(exposed, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const nativeRequire = createRequire(import.meta.url), eventModule = { exports: {} };
new Function("require", "module", "exports", "fetch", compiled)(specifier => {
  if (specifier === "@/lib/r2-warehouse") return storage;
  if (specifier === "@/lib/opportunity-engine/pr262-storage") return { pr262StorageKey: storageKey };
  if (specifier === "@/lib/ai-committee/review-policy") return policy;
  if (specifier === "@/lib/equity-signal/valuation-review-materiality") return loadTsModule(specifier);
  if (specifier.startsWith("node:")) return nativeRequire(specifier);
  return new Proxy({}, { get: (_value, key) => { throw Error(`Unexpected dependency: ${specifier}.${String(key)}`); } });
}, eventModule, eventModule.exports, () => { throw Error("Network forbidden"); });

const saved = { ...process.env }, originalFetch = globalThis.fetch, originalInfo = console.info;
try {
  Object.assign(process.env, { OPENAI_API_KEY: "synthetic-no-network", AI_COMMITTEE_ENABLED: "true",
    AI_COMMITTEE_DRY_RUN_DEFAULT: "false", AI_COMMITTEE_DEEP_MODEL: "gpt-6.1-sol",
    AI_COMMITTEE_FINAL_MODEL: "gpt-6-astra", AI_COMMITTEE_FAST_MODEL: "gpt-6-luna",
    AI_COMMITTEE_MODEL_ALLOWLIST: "gpt-6.1-sol,gpt-6-astra,gpt-6-luna", SWING_UP_PR262_AI_DAILY_LIMIT_USD: "10" });
  console.info = () => {};
  globalThis.fetch = async () => { networkCalls++; throw Error("Network forbidden"); };
  const result = await committee.runAiCommittee({ persistResult: false, mode: "preview", dryRun: false,
    confirmRun: true, reviewPolicy: "focused_v1", maximumPromptBytes: 60_000, maxCostUsd: 2.7538,
    [committee.TRUSTED_IN_MEMORY_EVIDENCE]: pack });
  assert.equal(result.ok, false);
  assert.deepEqual(result.plannedAgents, ["analyst_agent", "industry_agent", "accountant_agent", "skeptic_agent", "final_judge"]);
  assert.ok(gateInputs.filter(input => JSON.parse(input.messages[1].content).agent.id !== "final_judge")
    .every(input => !promptInput.committeePromptPreflight({ ...input, reservedPromptBytes: 0 })),
  "Every earlier empty-history role fits independently before prior-result growth is reserved");
  assert.ok(gateInputs.some(input => (input.reservedPromptBytes ?? 0) > 0),
    "Whole-review admission must reserve prior-role growth for later prompts");
  const failedRole = result.agentResults.find(role => role.status === "failed");
  assert.equal(failedRole.error, "prompt_too_large");
  assert.ok(result.agentResults.filter(role => role !== failedRole).every(role => role.status === "blocked"));
  assert.ok(result.agentResults.every(role => role.providerFailure?.category === "input_limit" && !role.tokenUsage));
  assert.equal(providerCalls, 0, "Do not invoke any provider when a later base prompt cannot fit");
  assert.equal(networkCalls, 0, "No compatibility or completion request is allowed");
  assert.deepEqual(pack, originalPack);
  const summary = result.committeeOutput.modelUsageSummary;
  assert.equal(summary.actualOpenAiUsage.responsesWithUsage, 0);
  assert.ok(Object.values(summary.actualOpenAiUsage.tokens).every(count => count === 0));
  assert.deepEqual(summary.actualOpenAiUsage.byModel, {});
  assert.ok(summary.roleDiagnostics.every(role => role.usageReported === false));
  assert.equal(result.committeeOutput.overallRecommendation, "needs_more_data");
  const proof = { output: result.committeeOutput };
  assert.equal(policy.committeeRequestsRejectedWithoutUsage(proof), true);

  const now = new Date("2026-10-07T05:20:00Z"), fingerprint = "synthetic-later-base-preflight", eventId = "synthetic-event";
  const priorCharge = { id: "old-actual", recordedAt: now.toISOString(), ticker: "OLD", alertType: "buy", costUsd: 0.027, source: "actual_tokens" };
  const priorPending = { id: "old-pending", recordedAt: now.toISOString(), ticker: "OLD", alertType: "buy",
    costUsd: 0.02, source: "usage_pending", pendingUpperBoundUsd: 0.136, retryAt: "2026-10-08T05:20:00Z" };
  const priorHold = { id: "old-hold", reservedAt: now.toISOString(), expiresAt: "2026-10-08T05:20:00Z", ticker: "OLD", direction: "upside", amountUsd: 0.156 };
  const costKey = storageKey("serious-signal/ai-cost-v1.json");
  put(costKey, { version: 1, updatedAt: now.toISOString(), entries: [priorCharge, priorPending], reservations: [priorHold],
    auditEntries: [priorCharge, priorPending], auditTrackingStartedAt: now.toISOString() });
  assert.equal((await cost.reservePr262AiCommitteeBudget({ candidateFingerprint: fingerprint, ticker: "TEST", direction: "downside" }, now)).allowed, true);
  // This legacy flow flag denotes committee admission. Actual receipts prove
  // that none of the admitted roles reached a billable request.
  const report = { openAiCalled: true, candidateFingerprint: fingerprint, selectedCandidate: { ticker: "TEST" }, committee: proof };
  await cost.recordPr262AiCommitteeCost(report, now);
  const state = objects.get(costKey).value, entry = state.entries.find(row => row.id === fingerprint);
  assert.equal(entry.source, "rejected_request");
  assert.equal(entry.costUsd, 0);
  assert.equal(entry.pendingUpperBoundUsd, undefined);
  assert.equal(state.providerCooldown, undefined, "Local input rejection cannot create a provider outage");
  assert.deepEqual(state.reservations, [priorHold]);
  assert.deepEqual(state.entries.slice(0, 2), [priorCharge, priorPending]);
  const budget = await cost.getPr262AiDailyBudgetStatus(now);
  assert.equal(budget.exposureUsd, 0.339, "All older actual charges, pending uncertainty and reservations survive");

  const admission = { eventId, candidateFingerprint: fingerprint, ticker: "TEST", direction: "downside", reservedAt: now.toISOString() };
  const otherEvent = { ...admission, eventId: "other-event" }, otherFingerprint = { ...admission, candidateFingerprint: "other-fingerprint" };
  const admissionKey = eventModule.exports.PR262_EVENT_JOB_KEYS.COMMITTEE_BUDGET_KEY;
  put(admissionKey, { version: 1, updatedAt: now.toISOString(), reservations: [otherEvent, otherFingerprint, admission] });
  await eventModule.exports.releaseRejectedCommitteeCall(eventId, report, now);
  assert.deepEqual(objects.get(admissionKey).value.reservations, [otherEvent, otherFingerprint],
    "The strict actual receipt releases only the matching event and fingerprint");
  assert.equal(networkCalls, 0);
  console.log(JSON.stringify({ syntheticOnly: true, historicalReplay: false, actualFailedRole: failedRole.agentId,
    earlierBaseRolesFit: true, earlierRolesBlocked: 4, providerCalls, networkCalls, strictNoUsageProof: true,
    ledgerSource: entry.source, ledgerCostUsd: entry.costUsd, newPendingUncertainty: false,
    olderExposurePreservedUsd: budget.exposureUsd, matchingAdmissionReleasedOnly: true, sharedProviderCooldown: false }));
} finally {
  globalThis.fetch = originalFetch; console.info = originalInfo;
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
}
