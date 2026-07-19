import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../lib/branch-signal-lab-policy.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const cjsModule = { exports: {} };
vm.runInNewContext(`(function (exports, module) { ${compiled}\n})(cjsModule.exports, cjsModule);`, { cjsModule, URL });
const policy = cjsModule.exports;

const at = "2026-07-19T00:00:00.000Z";
const manyGoogle = Array.from({ length: 16 }, (_, index) => ({ title: `Google ${index}`, publisher: `g${index}.example`, publishedAt: at, channel: "google_news_rss" }));
const otherChannels = [
  { title: "GDELT one", publisher: "gdelt-one.example", publishedAt: at, channel: "gdelt" },
  { title: "GDELT two", publisher: "gdelt-two.example", publishedAt: at, channel: "gdelt" },
  { title: "Marketaux one", publisher: "marketaux-one.example", publishedAt: at, channel: "marketaux" },
  { title: "Marketaux two", publisher: "marketaux-two.example", publishedAt: at, channel: "marketaux" },
  { title: "Google 0", publisher: "syndicated-copy.example", publishedAt: at, channel: "marketaux" },
];
const balanced = policy.selectBalancedReceipts([...manyGoogle, ...otherChannels], 16);
assert.equal(balanced.length, 16);
assert.deepEqual([...new Set(balanced.map((item) => item.channel))].sort(), ["gdelt", "google_news_rss", "marketaux"]);
assert.equal(balanced.filter((item) => item.title === "Google 0").length, 1);

const alignedBase = { catalystStrength: 78, priceVolumeConfirmation: 75, evidenceConfidence: 68, absoluteMovePercent: 3.5, alignedChannelCount: 2, alignedPublisherCount: 3, alignedKeywordCount: 2 };
assert.ok(policy.computeActionStrength(alignedBase) >= 60);
assert.ok(policy.computeActionStrength({ ...alignedBase, absoluteMovePercent: 1.2 }) < 60);
assert.ok(policy.computeActionStrength({ ...alignedBase, alignedChannelCount: 1 }) < 60);
assert.ok(policy.computeActionStrength({ ...alignedBase, alignedKeywordCount: 0 }) < 60);

const eventIdentity = "exchange hack confirmed|official.example|official.example/story|2026-07-19T00";
const firstFingerprint = policy.candidateFingerprintInput({ ticker: "BTC", direction: "downside", alignedKeywords: ["hack", "breach"], eventIdentity });
const reorderedFingerprint = policy.candidateFingerprintInput({ ticker: "btc", direction: "downside", alignedKeywords: ["breach", "hack", "hack"], eventIdentity });
assert.equal(firstFingerprint, reorderedFingerprint);
assert.notEqual(firstFingerprint, policy.candidateFingerprintInput({ ticker: "BTC", direction: "upside", alignedKeywords: ["breach", "hack"], eventIdentity }));
assert.equal(policy.matchesAssetText("Follow this link for more crypto news", { name: "Chainlink", ticker: "LINK" }), false);
assert.equal(policy.matchesAssetText("Chainlink announces a protocol upgrade", { name: "Chainlink", ticker: "LINK" }), true);
assert.equal(policy.matchesAssetText("$LINK token rises after upgrade", { name: "Chainlink", ticker: "LINK" }), true);
assert.equal(policy.matchesAssetText("Ada Lovelace history in a blockchain article", { name: "Cardano", ticker: "ADA" }), false);
assert.equal(policy.matchesAssetText("ADA token faces a network outage", { name: "Cardano", ticker: "ADA" }), true);
assert.equal(policy.normalizeProviderCryptoSymbol("BTCUSD"), "BTC");
assert.equal(policy.normalizeProviderCryptoSymbol("CRYPTO:ETH"), "ETH");

for (const failure of [
  policy.providerFailurePolicy({ httpStatus: 429 }),
  policy.providerFailurePolicy({ httpStatus: 200, bodyText: "Please limit requests to one every 5 seconds" }),
  policy.providerFailurePolicy({ httpStatus: 503 }),
  policy.providerFailurePolicy({ transportFailure: true }),
  policy.providerFailurePolicy({ malformedPayload: true }),
]) {
  assert.equal(failure.repairEligible, false);
  assert.equal(failure.failureScope, "external_provider");
}
assert.equal(policy.providerFailurePolicy({ httpStatus: 429 }).status, "rate_limited");
assert.equal(policy.providerFailurePolicy({ httpStatus: 503 }).status, "temporarily_unavailable");
assert.ok(policy.providerCooldownMs({ failureCount: 1, refreshMs: 15 * 60_000, maximumCooldownMs: 6 * 60 * 60_000 }) >= 15 * 60_000);

const providerBudgetRequest = { quotaKey: "marketaux_free", cadenceKey: "marketaux_news", rollingWindowMs: 24 * 60 * 60_000, maximumCallsInWindow: 2, minimumIntervalMs: 20 * 60_000 };
const providerBudgetHistory = [{ quotaKey: "marketaux_free", cadenceKey: "marketaux_news", reservedAt: at }];
assert.equal(policy.providerCallBudgetDecision(providerBudgetHistory, providerBudgetRequest, Date.parse(at) + 5 * 60_000).reason, "cadence_guard");
assert.equal(policy.providerCallBudgetDecision(providerBudgetHistory, providerBudgetRequest, Date.parse(at) + 21 * 60_000).allowed, true);
assert.equal(policy.providerCallBudgetDecision([...providerBudgetHistory, { ...providerBudgetHistory[0], reservedAt: "2026-07-19T00:21:00.000Z" }], providerBudgetRequest, Date.parse(at) + 42 * 60_000).reason, "rolling_quota_guard");

const externalFailure = { status: "source_temporarily_unavailable", failureScope: "external_provider", repairEligible: false, technicalFailureFingerprint: "external_provider_gdelt" };
assert.equal(policy.noGainRepairAttempts([externalFailure, externalFailure], externalFailure), 0);
const applicationFailure = { status: "technical_failure", failureScope: "application", repairEligible: true, technicalFailureFingerprint: "local_parser_invariant" };
assert.equal(policy.noGainRepairAttempts([applicationFailure, applicationFailure], applicationFailure), 3);
assert.equal(policy.noGainRepairAttempts([applicationFailure, { status: "no_qualified_signal", repairEligible: false }], applicationFailure), 1);
assert.equal(policy.noGainRepairAttempts([applicationFailure, applicationFailure], { ...applicationFailure, measurableGain: true }), 0);

console.log(JSON.stringify({ ok: true, balancedEvidenceChannels: true, strictDirectionAwareStrength: true, stableFingerprint: true, durableProviderBudgetPolicy: true, externalFailuresNotRepairEligible: true, applicationFailureStopPolicy: true }, null, 2));
