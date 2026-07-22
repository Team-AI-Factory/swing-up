#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = (process.env.COMBINED_ENGINE_RAILWAY_URL || "https://swing-up-swing-up-pr-262.up.railway.app").replace(/\/+$/, "");
const expectedCommit = (process.env.EXPECTED_BRANCH_COMMIT || "").trim();
const outputPath = process.env.RAILWAY_PROVIDER_REPORT_PATH || "artifacts/combined-opportunity-engine-railway-providers.json";
const token = (process.env.SWING_UP_AUTOMATION_TOKEN || "").trim();
const timeoutMs = 12 * 60 * 1000;
const startedAt = Date.now();

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function request(path, options = {}) {
  const headers = { accept: "application/json", ...(options.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(90_000),
    ...options,
    headers,
  });
  const raw = await response.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`Expected JSON from ${path}; status=${response.status}; body=${raw.slice(0, 300)}`);
  }
  return { status: response.status, json };
}

let health = null;
let attempts = 0;
while (Date.now() - startedAt < timeoutMs) {
  attempts += 1;
  try {
    const result = await request("/api/internal/combined-opportunity-engine");
    const runtimeCommit = String(result.json?.runtime?.commitSha || "");
    const commitMatches = !expectedCommit || runtimeCommit === expectedCommit || runtimeCommit.startsWith(expectedCommit.slice(0, 12));
    if (result.status === 200 && result.json?.ok === true && commitMatches) {
      health = result.json;
      break;
    }
  } catch {
    // Railway may still be replacing the previous deployment. Retry safely.
  }
  await sleep(10_000);
}

assert.ok(health, `Railway preview did not expose expected commit ${expectedCommit || "(any)"} within ${timeoutMs / 1000}s.`);

const [providerAudit, dataAudit, earConfig, readiness, liveRun] = await Promise.all([
  request("/api/internal/combined-opportunity-engine/provider-audit?ticker=MSFT"),
  request("/api/internal/combined-opportunity-engine/data-audit"),
  request("/api/internal/ear-config-status"),
  request("/api/internal/engine-start-readiness"),
  request("/api/internal/combined-opportunity-engine", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ useLiveData: true, useProviderEnrichment: true, liveTickers: ["MSFT", "NVDA"] }),
  }),
]);

assert.equal(providerAudit.status, 200);
assert.equal(providerAudit.json?.ok, true);
assert.equal(dataAudit.status, 200);
assert.equal(liveRun.status, 200);
assert.equal(liveRun.json?.ok, true);
assert.equal(liveRun.json?.summary?.liveProviderErrors, 0);
assert.equal(liveRun.json?.liveData?.noSyntheticData, true);

const sourceRows = Array.isArray(earConfig.json?.sources) ? earConfig.json.sources : [];
const report = {
  ok: true,
  checkedAt: new Date().toISOString(),
  baseUrl,
  expectedCommit: expectedCommit || null,
  deploymentAttempts: attempts,
  runtime: health.runtime,
  providerAudit: providerAudit.json,
  databaseOutcomeAudit: dataAudit.json,
  configuredSourceSummary: sourceRows.map((source) => ({
    sourceName: source.sourceName,
    enabled: source.enabled,
    requiredEnvVarsPresent: source.requiredEnvVarsPresent,
    missingEnvVars: source.missingEnvVars,
    lastRunStatus: source.lastRunStatus,
    lastSafeError: source.lastSafeError,
    sourceRole: source.sourceRole,
  })),
  engineReadiness: {
    ok: readiness.json?.ok,
    readyToStartEngine: readiness.json?.readyToStartEngine,
    readyForContinuousRunning: readiness.json?.readyForContinuousRunning,
    requiredSourcesPassed: readiness.json?.requiredSourcesPassed,
    requiredSourcesFailed: readiness.json?.requiredSourcesFailed,
    degradedSources: readiness.json?.degradedSources,
    missingApiKeys: readiness.json?.missingApiKeys,
    aiCommitteeStatus: readiness.json?.aiCommitteeStatus,
  },
  liveWorkflow: {
    dataMode: liveRun.json?.dataMode,
    foundationsChecked: liveRun.json?.summary?.foundationsChecked,
    eventsChecked: liveRun.json?.summary?.eventsChecked,
    liveProviderErrors: liveRun.json?.summary?.liveProviderErrors,
    optionalProviderErrors: liveRun.json?.summary?.optionalProviderErrors,
    seriousSignals: liveRun.json?.summary?.seriousSignals,
    abstentions: liveRun.json?.summary?.abstentions,
    noSyntheticData: liveRun.json?.liveData?.noSyntheticData,
    providerSummary: liveRun.json?.liveData?.providerSummary,
    decisions: (liveRun.json?.foundationDecisions || []).map((decision) => ({
      ticker: decision.ticker,
      opportunityScore: decision.scores?.opportunityScore,
      evidenceConfidence: decision.scores?.evidenceConfidence,
      calibratedConfidence: decision.confidence?.overall,
      confidenceKind: decision.confidence?.kind,
      targetPrice: decision.priceTarget?.basePrice,
      expectedUpsidePercent: decision.priceTarget?.upsidePercent,
      candidateBucket: decision.candidateBucket,
      signalAction: decision.signalAction,
      seriousSignal: decision.seriousSignal,
      blockedReasons: decision.blockedReasons,
    })),
  },
  safety: providerAudit.json?.safety,
};

await mkdir(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  ok: true,
  expectedCommit: report.expectedCommit,
  runtimeCommit: report.runtime?.commitSha,
  deploymentAttempts: attempts,
  connectedProviders: report.providerAudit?.connectedProviders,
  missingProviders: report.providerAudit?.missingProviders,
  usableDatabaseOutcomeRows: report.databaseOutcomeAudit?.counts?.usableOutcomeRows ?? 0,
  liveWorkflow: report.liveWorkflow,
  reportPath: outputPath,
}, null, 2));
