#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = (process.env.COMBINED_ENGINE_RAILWAY_URL || "https://swing-up-swing-up-pr-262.up.railway.app").replace(/\/+$/, "");
const expectedCommit = (process.env.EXPECTED_BRANCH_COMMIT || "").trim();
const outputPath = process.env.CURRENT_US_VALUE_REPORT_PATH || "artifacts/current-us-value-investing-report.json";
const deadline = Date.now() + 20 * 60 * 1000;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const safeError = (error) => error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 1600) : "unknown_us_value_validation_failure";

async function saveReport(report) {
  await mkdir(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function request(path, timeoutMs = 120_000) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await response.text();
  let json;
  try { json = JSON.parse(raw); }
  catch { throw new Error(`Expected JSON from ${path}; status=${response.status}; body=${raw.slice(0, 800)}`); }
  return { status: response.status, json };
}

async function main() {
  let runtime = null;
  let lab = null;
  let deploymentAttempts = 0;
  let labAttempts = 0;
  try {
    while (Date.now() < deadline) {
      deploymentAttempts += 1;
      try {
        const result = await request("/api/internal/combined-opportunity-engine", 90_000);
        const runtimeCommit = String(result.json?.runtime?.commitSha || "");
        const matches = !expectedCommit || runtimeCommit === expectedCommit || runtimeCommit.startsWith(expectedCommit.slice(0, 12));
        if (result.status === 200 && result.json?.ok === true && matches) {
          runtime = result.json;
          break;
        }
      } catch {
        // Railway may still be replacing the previous PR deployment.
      }
      await sleep(10_000);
    }
    assert.ok(runtime, `Railway preview did not expose expected commit ${expectedCommit || "(any)"}.`);

    while (Date.now() < deadline) {
      labAttempts += 1;
      try {
        const result = await request("/api/internal/railway-branch-signal-lab", 180_000);
        const latest = result.json?.latest;
        const value = latest?.valueInvesting;
        const warehouse = value?.warehouse;
        if (
          result.status === 200
          && result.json?.ok === true
          && result.json?.branch === "agent/combined-opportunity-engine"
          && value?.coverage?.companiesAnalyzed >= 5_000
          && warehouse?.storage === "cloudflare_r2"
          && warehouse?.companyRecordsStored === value.coverage.companiesAnalyzed
        ) {
          lab = result.json;
          break;
        }
      } catch {
        // The five-minute worker may still be completing its first full valuation cycle.
      }
      await sleep(15_000);
    }

    assert.ok(lab, "Railway worker did not complete and persist the live U.S. fair-value warehouse before the validation deadline.");
    const latest = lab.latest;
    const value = latest.valueInvesting;
    const coverage = value.coverage;
    const warehouse = value.warehouse;

    assert.equal(value.marketScope, "US listed common stocks and ADRs only");
    assert.equal(value.methodology.style, "company_first_conservative_intrinsic_value");
    assert.equal(value.methodology.analystTargetUsedAsFairValue, false);
    assert.equal(value.methodology.newsRequiredForFoundationAlert, false);
    assert.equal(value.methodology.fullFundamentalRefreshMinutes, 15);
    assert.equal(value.methodology.fullWarehousePersistenceHours, 6);
    assert.ok(coverage.usPrimaryListings >= 5_000);
    assert.equal(coverage.companiesAnalyzed, coverage.usPrimaryListings);
    assert.ok(coverage.companiesWithFairValue > 0);
    assert.equal(coverage.companiesWithFairValue + coverage.companiesWithoutFairValue, coverage.companiesAnalyzed);
    assert.equal(coverage.pagesFailed, 0);
    assert.ok(coverage.processingCoveragePercent >= 95);

    assert.ok(Array.isArray(value.seriousAlerts.buy));
    assert.ok(Array.isArray(value.seriousAlerts.sell));
    assert.ok(Array.isArray(value.seriousAlerts.watchOut));
    assert.ok(Array.isArray(value.watchlists.qualityWaitingForPrice));
    assert.ok(typeof value.watchlists.researchOnlyCount === "number");

    assert.equal(warehouse.storage, "cloudflare_r2");
    assert.equal(warehouse.persistedThisCycle, true);
    assert.ok(warehouse.shardKeys.length >= Math.ceil(coverage.companiesAnalyzed / 500));
    assert.ok(warehouse.immutableRunKey?.startsWith("branch-labs/pr-262/value-investing/runs/"));
    assert.ok(warehouse.latestIndexKey?.startsWith("branch-labs/pr-262/value-investing/latest/"));
    assert.equal(warehouse.companyRecordsStored, coverage.companiesAnalyzed);
    assert.deepEqual(warehouse.errors, []);

    assert.equal(latest.liveSourcePolicy.foundationNewsRequired, false);
    assert.equal(latest.liveSourcePolicy.foundationFairValueCanTriggerImmediately, true);
    assert.equal(latest.liveSourcePolicy.headlineAloneCanPromoteSeriousSignal, false);
    assert.ok(latest.liveSourcePolicy.maximumFullArticlesReadPerScan >= 12);
    assert.ok(latest.liveSourcePolicy.maximumFullArticlesReadPerScan <= 20);
    assert.equal(latest.safety?.databaseWrites, false);
    assert.equal(latest.safety?.publishing, false);
    assert.equal(latest.safety?.notifications, false);
    assert.equal(value.safety.databaseWrites, false);
    assert.equal(value.safety.publishing, false);
    assert.equal(value.safety.notifications, false);
    assert.equal(value.safety.trades, false);
    assert.equal(lab.stateStorage?.primary, "cloudflare_r2");
    assert.equal(lab.stateStorage?.durable, true);
    assert.equal(lab.stateStorage?.writable, true);

    const report = {
      ok: true,
      checkedAt: new Date().toISOString(),
      expectedCommit: expectedCommit || null,
      runtimeCommit: runtime.runtime?.commitSha || null,
      deploymentAttempts,
      labAttempts,
      runNumber: latest.runNumber,
      coverage,
      methodology: value.methodology,
      seriousAlertCounts: {
        buy: value.seriousAlerts.buy.length,
        sell: value.seriousAlerts.sell.length,
        watchOut: value.seriousAlerts.watchOut.length,
      },
      qualityPriceWatchlistCount: value.watchlists.qualityWaitingForPrice.length,
      researchOnlyCount: value.watchlists.researchOnlyCount,
      warehouse,
      articlePolicy: {
        minimum: latest.liveSourcePolicy.minimumFullArticlesReadPerScan,
        maximum: latest.liveSourcePolicy.maximumFullArticlesReadPerScan,
        mode: latest.liveSourcePolicy.articleBudgetMode,
      },
      safety: value.safety,
    };
    await saveReport(report);
    console.log(JSON.stringify({
      ok: true,
      runtimeCommit: report.runtimeCommit,
      runNumber: report.runNumber,
      companiesAnalyzed: coverage.companiesAnalyzed,
      companiesWithFairValue: coverage.companiesWithFairValue,
      seriousAlertCounts: report.seriousAlertCounts,
      qualityPriceWatchlistCount: report.qualityPriceWatchlistCount,
      r2ShardCount: warehouse.shardKeys.length,
      reportPath: outputPath,
    }, null, 2));
  } catch (error) {
    const failure = {
      ok: false,
      checkedAt: new Date().toISOString(),
      expectedCommit: expectedCommit || null,
      runtimeCommit: runtime?.runtime?.commitSha || null,
      deploymentAttempts,
      labAttempts,
      error: safeError(error),
      latest: lab?.latest ?? null,
      safety: { databaseWrites: false, publishing: false, notifications: false, trades: false },
    };
    await saveReport(failure);
    console.error(JSON.stringify(failure, null, 2));
    process.exitCode = 1;
  }
}

await main();
