#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = (process.env.COMBINED_ENGINE_RAILWAY_URL || "https://swing-up-swing-up-pr-262.up.railway.app").replace(/\/+$/, "");
const expectedCommit = (process.env.EXPECTED_BRANCH_COMMIT || "").trim();
const token = (process.env.SWING_UP_AUTOMATION_TOKEN || "").trim();
const outputPath = process.env.CURRENT_GLOBAL_SCAN_REPORT_PATH || "artifacts/current-global-serious-alert-report.json";
const timeoutMs = 15 * 60 * 1000;
const startedAt = Date.now();

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const safeError = (error) => error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 800) : "unknown_live_scan_failure";

async function saveReport(report) {
  await mkdir(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function request(path, options = {}) {
  const headers = { accept: "application/json", ...(options.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(options.timeoutMs || 6 * 60 * 1000),
    ...options,
    headers,
  });
  const raw = await response.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`Expected JSON from ${path}; status=${response.status}; body=${raw.slice(0, 600)}`);
  }
  return { status: response.status, json };
}

async function main() {
  let health = null;
  let scannerHealth = null;
  let scan = null;
  let deploymentAttempts = 0;
  try {
    while (Date.now() - startedAt < timeoutMs) {
      deploymentAttempts += 1;
      try {
        const result = await request("/api/internal/combined-opportunity-engine", { timeoutMs: 90_000 });
        const runtimeCommit = String(result.json?.runtime?.commitSha || "");
        const commitMatches = !expectedCommit || runtimeCommit === expectedCommit || runtimeCommit.startsWith(expectedCommit.slice(0, 12));
        if (result.status === 200 && result.json?.ok === true && commitMatches) {
          health = result.json;
          break;
        }
      } catch {
        // Railway may still be replacing the previous branch deployment.
      }
      await sleep(10_000);
    }

    assert.ok(health, `Railway preview did not expose expected commit ${expectedCommit || "(any)"}.`);

    scannerHealth = await request("/api/internal/combined-opportunity-engine/global-scan", { timeoutMs: 90_000 });
    assert.equal(scannerHealth.status, 200);
    assert.equal(scannerHealth.json?.ok, true);
    assert.equal(scannerHealth.json?.providerConfigured, true);
    assert.equal(scannerHealth.json?.publishingEnabled, false);
    assert.equal(scannerHealth.json?.notificationsEnabled, false);

    scan = await request("/api/internal/combined-opportunity-engine/global-scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      timeoutMs: 12 * 60 * 1000,
      body: JSON.stringify({
        maximumStocks: 150000,
        batchSize: 500,
        deepQueueSize: 300,
        minimumPrice: 0.25,
        minimumMarketCap: 25000000,
        maximumCertifiedChecks: 5000,
        certifiedCheckConcurrency: 10,
      }),
    });

    assert.ok([200, 206].includes(scan.status), `Unexpected global scan status: ${scan.status}`);
    assert.ok(scan.json?.universe?.uniqueSymbols >= 1000, `Global provider universe unexpectedly small: ${scan.json?.universe?.uniqueSymbols}`);
    assert.ok(scan.json?.universe?.exchanges >= 10, `Too few exchanges: ${scan.json?.universe?.exchanges}`);
    assert.ok(scan.json?.universe?.countries >= 10, `Too few countries: ${scan.json?.universe?.countries}`);
    assert.ok(scan.json?.scan?.coveragePercent >= 99, `Quote coverage below 99%: ${scan.json?.scan?.coveragePercent}`);
    assert.equal(scan.json?.scan?.coverageComplete, true, `Quote coverage incomplete: ${JSON.stringify(scan.json?.scan)}`);
    assert.equal(scan.json?.seriousAlerts?.verification?.coverageComplete, true, `Certified verification incomplete: ${JSON.stringify(scan.json?.seriousAlerts?.verification)}`);
    assert.ok(scan.json?.seriousAlerts?.certifiedRuleIds?.includes("watch_out_30d_extreme_volatility_after_60pct_drawdown_v2"));
    assert.deepEqual(scan.json?.seriousAlerts?.buy, []);
    assert.deepEqual(scan.json?.seriousAlerts?.sell, []);
    assert.equal(scan.json?.safety?.publishing, false);
    assert.equal(scan.json?.safety?.notifications, false);

    const watchOutAlerts = Array.isArray(scan.json?.seriousAlerts?.watchOut) ? scan.json.seriousAlerts.watchOut : [];
    for (const alert of watchOutAlerts) {
      assert.equal(alert.seriousSignal, true);
      assert.equal(alert.action, "watch_out");
      assert.equal(alert.subtype, "extreme_volatility_direction_uncertain");
      assert.ok(alert.trailing120SessionDrawdownPercent <= -60);
      assert.ok(alert.evidence?.marketDataAgeDays <= 7);
      assert.equal(alert.evidence?.noSyntheticData, true);
      assert.ok(alert.calibration?.sampleSize >= 30);
      assert.ok(alert.calibration?.lowerConfidenceBound90 >= 0.9);
      assert.ok(alert.priceAgreementPercent === null || alert.priceAgreementPercent <= 5);
      assert.equal(alert.notificationEligible, false);
      assert.equal(alert.publicationStatus, "review_only");
    }

    const report = {
      ok: true,
      checkedAt: new Date().toISOString(),
      expectedCommit: expectedCommit || null,
      runtimeCommit: health.runtime?.commitSha || null,
      deploymentAttempts,
      dataMode: "live_current_global_provider_and_adjusted_daily_prices",
      universe: scan.json.universe,
      scan: scan.json.scan,
      researchQueues: {
        buy: scan.json.candidates?.buyResearch?.length || 0,
        sell: scan.json.candidates?.sellResearch?.length || 0,
        watchOut: scan.json.candidates?.watchOutResearch?.length || 0,
      },
      seriousAlerts: {
        buy: 0,
        sell: 0,
        watchOut: watchOutAlerts.length,
        verification: scan.json.seriousAlerts?.verification,
        alerts: watchOutAlerts,
      },
      opportunityCoverage: scan.json.opportunityCoverage,
      safety: scan.json.safety,
    };

    await saveReport(report);
    console.log(JSON.stringify({
      ok: true,
      runtimeCommit: report.runtimeCommit,
      uniqueSymbols: report.universe.uniqueSymbols,
      exchanges: report.universe.exchanges,
      countries: report.universe.countries,
      quoteCoveragePercent: report.scan.coveragePercent,
      certifiedVerificationCoveragePercent: report.seriousAlerts.verification.coveragePercent,
      currentSeriousWatchOutAlerts: report.seriousAlerts.watchOut,
      reportPath: outputPath,
    }, null, 2));
  } catch (error) {
    const failure = {
      ok: false,
      checkedAt: new Date().toISOString(),
      expectedCommit: expectedCommit || null,
      runtimeCommit: health?.runtime?.commitSha || null,
      deploymentAttempts,
      error: safeError(error),
      scannerHealth: scannerHealth ? { status: scannerHealth.status, json: scannerHealth.json } : null,
      globalScan: scan ? { status: scan.status, json: scan.json } : null,
      safety: { databaseWrites: false, publishing: false, notifications: false },
    };
    await saveReport(failure);
    console.error(JSON.stringify(failure, null, 2));
    process.exitCode = 1;
  }
}

await main();
