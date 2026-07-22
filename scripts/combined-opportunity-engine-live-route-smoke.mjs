#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const baseUrl = (process.env.COMBINED_ENGINE_BASE_URL || "http://127.0.0.1:3015").replace(/\/+$/, "");
const endpoint = `${baseUrl}/api/internal/combined-opportunity-engine`;
const tickers = ["AAPL", "MSFT", "NVDA", "KO"];

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(90_000),
    ...options,
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${path}; status=${response.status}; body=${text.slice(0, 300)}`);
  }
  return { response, json };
}

function normalizedDecision(result) {
  const foundations = Array.isArray(result.foundationDecisions) ? result.foundationDecisions : [];
  const events = Array.isArray(result.eventDecisions) ? result.eventDecisions : [];
  const liveSnapshots = Array.isArray(result.liveData?.snapshots) ? result.liveData.snapshots : [];
  return {
    foundations: foundations.map((row) => ({
      ticker: row.ticker,
      fiscalPeriod: row.input?.fiscalPeriod,
      opportunityScore: row.scores?.opportunityScore,
      evidenceConfidence: row.scores?.evidenceConfidence,
      riskScore: row.scores?.riskScore,
      candidateBucket: row.candidateBucket,
      thesisStatus: row.thesisStatus,
      securityReadiness: row.securityReadiness,
      alertType: row.alertType,
      blockedReasons: row.blockedReasons,
    })).sort((left, right) => left.ticker.localeCompare(right.ticker)),
    events: events.map((row) => ({
      ticker: row.ticker,
      alertType: row.alertType,
      direction: row.impact?.direction,
      severity: row.impact?.severity,
      thesisStatusAfter: row.thesisStatusAfter,
      blockedReasons: row.blockedReasons,
      rawSignalId: row.event?.rawSignalId,
    })).sort((left, right) => left.ticker.localeCompare(right.ticker)),
    liveSnapshots: liveSnapshots.map((row) => ({
      ticker: row.ticker,
      sourceMode: row.sourceMode,
      fiscalPeriod: row.fiscalPeriod,
      latestFilingAccession: row.latestFilingAccession,
      marketSource: row.marketSource,
      marketDate: row.marketDate,
      realDataReceipts: row.realDataReceipts,
    })).sort((left, right) => left.ticker.localeCompare(right.ticker)),
  };
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const health = await request("/api/internal/combined-opportunity-engine");
assert.equal(health.response.status, 200);
assert.equal(health.json.ok, true);
assert.equal(health.json.liveDataAvailable, true);
assert.equal(health.json.safety?.databaseWrites, false);
assert.equal(health.json.safety?.publishing, false);
assert.equal(health.json.safety?.notifications, false);

async function liveRun() {
  const result = await request("/api/internal/combined-opportunity-engine", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ useLiveData: true, liveTickers: tickers }),
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.dataMode, "real_live_sec_and_market_data");
  assert.equal(result.json.summary?.foundationsChecked, tickers.length);
  assert.equal(result.json.summary?.eventsChecked, tickers.length);
  assert.equal(result.json.summary?.liveProviderErrors, 0);
  assert.equal(result.json.liveData?.errors?.length, 0);
  assert.equal(result.json.liveData?.noSyntheticData, true);
  assert.equal(result.json.liveData?.snapshots?.length, tickers.length);
  assert.ok(result.json.liveData.snapshots.every((row) => row.sourceMode === "real_live_sec_and_market_data"));
  assert.ok(result.json.liveData.snapshots.every((row) => row.marketSource === "Yahoo Finance public chart API"));
  assert.ok(result.json.liveData.snapshots.every((row) => row.realDataReceipts >= 3));
  assert.equal(result.json.safety?.databaseWrites, false);
  assert.equal(result.json.safety?.publishing, false);
  assert.equal(result.json.safety?.notifications, false);
  assert.equal(result.json.safety?.payments, false);
  assert.equal(result.json.safety?.openAiCalls, false);
  return result.json;
}

const first = await liveRun();
const second = await liveRun();
const firstNormalized = normalizedDecision(first);
const secondNormalized = normalizedDecision(second);
assert.deepEqual(secondNormalized, firstNormalized);
assert.ok(firstNormalized.events.some((row) => row.direction !== "neutral"));

console.log(JSON.stringify({
  ok: true,
  endpoint,
  liveRuns: 2,
  tickers,
  foundationsPerRun: first.summary.foundationsChecked,
  eventsPerRun: first.summary.eventsChecked,
  liveProviderErrors: first.summary.liveProviderErrors + second.summary.liveProviderErrors,
  sameDecisionDigest: digest(firstNormalized) === digest(secondNormalized),
  decisionDigest: digest(firstNormalized),
  decisions: firstNormalized,
  safety: first.safety,
}, null, 2));
