#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = (process.env.COMBINED_ENGINE_RAILWAY_URL || "https://swing-up-swing-up-pr-262.up.railway.app").replace(/\/+$/, "");
const expectedCommit = (process.env.EXPECTED_BRANCH_COMMIT || "").trim();
const outputPath = process.env.CURRENT_US_VALUE_REPORT_PATH || "artifacts/current-us-value-investing-report.json";
const deadline = Date.now() + 20 * 60 * 1000;
const minimumExpectedUsPrimaryListings = 4_500;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const safeError = (error) => error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 1600) : "unknown_us_value_validation_failure";

function inspectLabReadiness(result) {
  const latest = result.json?.latest;
  const value = latest?.valueInvesting;
  const diligence = latest?.catalystCompanyDiligence;
  const warehouse = value?.warehouse;
  const checks = {
    httpOk: result.status === 200,
    responseOk: result.json?.ok === true,
    isolatedBranch: result.json?.branch === "agent/combined-opportunity-engine",
    hardenedValueSafety: value?.methodology?.safetyOverlay === "us_value_alert_safety_v2",
    diligenceOverlay: value?.methodology?.catalystDiligenceOverlay === "sec_debt_earnings_quality_revenue_durability_reinvestment_v1",
    diligenceRequired: value?.methodology?.foundationSeriousAlertsRequireDiligenceConfirmation === true,
    buyDiligenceRequired: diligence?.policy?.seriousFoundationBuyRequiresBuyQualityConfirmed === true,
    minimumCompanyCoverage: value?.coverage?.companiesAnalyzed >= minimumExpectedUsPrimaryListings,
    fullEligibleUniverseCovered: value?.coverage?.companiesAnalyzed === value?.coverage?.usPrimaryListings,
    noMarketPagesFailed: value?.coverage?.pagesFailed === 0,
    minimumProcessingCoverage: value?.coverage?.processingCoveragePercent >= 95,
    r2Warehouse: warehouse?.storage === "cloudflare_r2",
    allCompanyRecordsStored: warehouse?.companyRecordsStored === value?.coverage?.companiesAnalyzed,
    warehouseHasImmutableSummary: typeof warehouse?.immutableRunKey === "string"
      && warehouse.immutableRunKey.startsWith("branch-labs/pr-262/value-investing/runs/"),
    warehouseHasAllShards: Array.isArray(warehouse?.shardKeys)
      && warehouse.shardKeys.length >= Math.ceil((value?.coverage?.companiesAnalyzed ?? 0) / 500),
    warehouseHasNoErrors: Array.isArray(warehouse?.errors) && warehouse.errors.length === 0,
    diligencePersisted: diligence?.warehouse?.persisted === true,
    diligenceHasNoErrors: Array.isArray(diligence?.warehouse?.errors) && diligence.warehouse.errors.length === 0,
  };
  return {
    ready: Object.values(checks).every(Boolean),
    observed: {
      observedAt: new Date().toISOString(),
      status: result.status,
      branch: result.json?.branch ?? null,
      deploymentId: result.json?.deploymentId ?? result.json?.railway?.deploymentId ?? null,
      runCount: result.json?.runCount ?? null,
      runNumber: latest?.runNumber ?? null,
      checkedAt: latest?.checkedAt ?? null,
      scheduler: result.json?.scheduler ?? result.json?.pollingPolicy?.runtimeWorker ?? null,
      valueInvesting: value ? {
        methodology: {
          safetyOverlay: value.methodology?.safetyOverlay ?? null,
          catalystDiligenceOverlay: value.methodology?.catalystDiligenceOverlay ?? null,
          foundationSeriousAlertsRequireDiligenceConfirmation: value.methodology?.foundationSeriousAlertsRequireDiligenceConfirmation ?? null,
        },
        coverage: {
          companiesAnalyzed: value.coverage?.companiesAnalyzed ?? null,
          processingCoveragePercent: value.coverage?.processingCoveragePercent ?? null,
          usPrimaryListings: value.coverage?.usPrimaryListings ?? null,
          pagesFailed: value.coverage?.pagesFailed ?? null,
        },
        warehouse: warehouse ? {
          storage: warehouse.storage ?? null,
          persistedThisCycle: warehouse.persistedThisCycle ?? null,
          companyRecordsStored: warehouse.companyRecordsStored ?? null,
          shardCount: Array.isArray(warehouse.shardKeys) ? warehouse.shardKeys.length : null,
          immutableRunKey: warehouse.immutableRunKey ?? null,
          errors: warehouse.errors ?? null,
        } : null,
      } : null,
      catalystCompanyDiligence: diligence ? {
        policy: {
          maximumFreshSecCompaniesPerScan: diligence.policy?.maximumFreshSecCompaniesPerScan ?? null,
          requestTimeoutSeconds: diligence.policy?.requestTimeoutSeconds ?? null,
          maximumWorstCaseFreshSecStageSeconds: diligence.policy?.maximumWorstCaseFreshSecStageSeconds ?? null,
          rotatesFoundationAndCatalystQueues: diligence.policy?.rotatesFoundationAndCatalystQueues ?? null,
          seriousFoundationBuyRequiresBuyQualityConfirmed: diligence.policy?.seriousFoundationBuyRequiresBuyQualityConfirmed ?? null,
        },
        coverage: diligence.coverage ?? null,
        warehouse: diligence.warehouse ? {
          persisted: diligence.warehouse.persisted ?? null,
          latestKey: diligence.warehouse.latestKey ?? null,
          errors: diligence.warehouse.errors ?? null,
        } : null,
      } : null,
      unmetConditions: Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name),
    },
  };
}

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
  let lastObservedLab = null;
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
        const result = await request("/api/internal/railway-branch-signal-lab", 240_000);
        const readiness = inspectLabReadiness(result);
        lastObservedLab = readiness.observed;
        if (readiness.ready) {
          lab = result.json;
          break;
        }
      } catch (error) {
        lastObservedLab = {
          observedAt: new Date().toISOString(),
          requestError: safeError(error),
        };
      }
      await sleep(15_000);
    }

    assert.ok(lab, "Railway worker did not complete and persist the diligence-confirmed live U.S. fair-value warehouse before the validation deadline.");
    const latest = lab.latest;
    const value = latest.valueInvesting;
    const diligence = latest.catalystCompanyDiligence;
    const coverage = value.coverage;
    const warehouse = value.warehouse;

    assert.equal(value.marketScope, "US listed common stocks and ADRs only");
    assert.equal(value.methodology.style, "company_first_conservative_intrinsic_value");
    assert.equal(value.methodology.safetyOverlay, "us_value_alert_safety_v2");
    assert.equal(value.methodology.specialistSectorModelsRequired, true);
    assert.equal(value.methodology.catalystDiligenceOverlay, "sec_debt_earnings_quality_revenue_durability_reinvestment_v1");
    assert.equal(value.methodology.foundationSeriousAlertsRequireDiligenceConfirmation, true);
    assert.equal(value.methodology.analystTargetUsedAsFairValue, false);
    assert.equal(value.methodology.newsRequiredForFoundationAlert, false);
    assert.equal(value.methodology.fullFundamentalRefreshMinutes, 15);
    assert.equal(value.methodology.fullWarehousePersistenceHours, 6);
    assert.ok(coverage.usPrimaryListings >= minimumExpectedUsPrimaryListings);
    assert.equal(coverage.companiesAnalyzed, coverage.usPrimaryListings);
    assert.ok(coverage.companiesWithFairValue > 0);
    assert.equal(coverage.companiesWithFairValue + coverage.companiesWithoutFairValue, coverage.companiesAnalyzed);
    assert.equal(coverage.pagesFailed, 0);
    assert.ok(coverage.processingCoveragePercent >= 95);
    assert.ok(coverage.eligibleExchangeCoveragePercent >= 95);

    assert.ok(Array.isArray(value.seriousAlerts.buy));
    assert.ok(Array.isArray(value.seriousAlerts.sell));
    assert.ok(Array.isArray(value.seriousAlerts.watchOut));
    assert.ok(value.seriousAlerts.buy.every((item) => ["NASDAQ", "NYSE", "AMEX", "NYSEAMERICAN"].includes(item.exchange)));
    assert.ok(value.seriousAlerts.sell.every((item) => ["NASDAQ", "NYSE", "AMEX", "NYSEAMERICAN"].includes(item.exchange)));
    assert.ok(value.seriousAlerts.watchOut.every((item) => ["NASDAQ", "NYSE", "AMEX", "NYSEAMERICAN"].includes(item.exchange)));
    assert.ok(value.seriousAlerts.buy.every((item) => diligence.companies[item.ticker]?.buyQualityConfirmed === true));
    assert.ok(value.seriousAlerts.sell.every((item) => diligence.companies[item.ticker]?.valuationInputsReliable === true));
    assert.ok(value.seriousAlerts.watchOut.every((item) => diligence.companies[item.ticker]?.fundamentalRiskConfirmed === true));
    assert.ok(Array.isArray(value.provisionalAlertsSuppressed.buy));
    assert.ok(Array.isArray(value.provisionalAlertsSuppressed.sell));
    assert.ok(Array.isArray(value.provisionalAlertsSuppressed.watchOut));
    assert.ok(Array.isArray(value.watchlists.qualityWaitingForPrice));
    assert.ok(typeof value.watchlists.researchOnlyCount === "number");

    assert.equal(warehouse.storage, "cloudflare_r2");
    assert.equal(typeof warehouse.persistedThisCycle, "boolean");
    assert.ok(warehouse.shardKeys.length >= Math.ceil(coverage.companiesAnalyzed / 500));
    assert.ok(warehouse.immutableRunKey?.startsWith("branch-labs/pr-262/value-investing/runs/"));
    assert.ok(warehouse.latestIndexKey?.startsWith("branch-labs/pr-262/value-investing/latest/"));
    assert.equal(warehouse.companyRecordsStored, coverage.companiesAnalyzed);
    assert.deepEqual(warehouse.errors, []);

    assert.equal(diligence.policy.primarySource, "SEC Company Facts");
    assert.equal(diligence.policy.revenueDurabilityIsOnlyAProxy, true);
    assert.equal(diligence.policy.noSyntheticData, true);
    assert.equal(diligence.policy.rotatesFoundationAndCatalystQueues, true);
    assert.ok(diligence.policy.maximumFreshSecCompaniesPerScan <= 12);
    assert.ok(diligence.policy.requestTimeoutSeconds <= 8);
    assert.ok(diligence.policy.maximumWorstCaseFreshSecStageSeconds < 60);
    assert.ok(diligence.policy.reservedCatalystSlotsWhenBothQueuesNonEmpty >= 1);
    assert.ok(diligence.coverage.companiesCompleted > 0);
    assert.ok(typeof diligence.coverage.foundationCompaniesQueuedForLaterScan === "number");
    assert.ok(typeof diligence.coverage.catalystCompaniesQueuedForLaterScan === "number");
    assert.equal(diligence.warehouse.persisted, true);
    assert.ok(diligence.warehouse.latestKey.startsWith("branch-labs/pr-262/value-investing/catalyst-diligence/"));
    assert.deepEqual(diligence.warehouse.errors, []);

    assert.equal(latest.liveSourcePolicy.foundationNewsRequired, false);
    assert.equal(latest.liveSourcePolicy.foundationFairValueCanTriggerImmediately, true);
    assert.equal(latest.liveSourcePolicy.foundationSpecialistSectorModelsRequired, true);
    assert.equal(latest.liveSourcePolicy.foundationCatalystDiligenceRequired, true);
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
      seriousAlerts: value.seriousAlerts,
      provisionalAlertsSuppressed: value.provisionalAlertsSuppressed,
      qualityPriceWatchlist: value.watchlists.qualityWaitingForPrice,
      qualityPriceWatchlistCount: value.watchlists.qualityWaitingForPrice.length,
      researchOnlyCount: value.watchlists.researchOnlyCount,
      warehouse,
      catalystCompanyDiligence: diligence,
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
      provisionalAlertsSuppressed: Object.values(value.provisionalAlertsSuppressed).reduce((total, items) => total + items.length, 0),
      diligenceCompaniesCompleted: diligence.coverage.companiesCompleted,
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
      lastObservedLab,
      safety: { databaseWrites: false, publishing: false, notifications: false, trades: false },
    };
    await saveReport(failure);
    console.error(JSON.stringify(failure, null, 2));
    process.exitCode = 1;
  }
}

await main();
