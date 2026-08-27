#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = (process.env.COMBINED_ENGINE_RAILWAY_URL || "https://swing-up-swing-up-pr-262.up.railway.app").replace(/\/+$/, "");
const expectedCommit = (process.env.EXPECTED_BRANCH_COMMIT || "").trim();
const token = (process.env.SWING_UP_AUTOMATION_TOKEN || "").trim();
const outputPath = process.env.CURRENT_GLOBAL_SCAN_REPORT_PATH || "artifacts/current-global-serious-alert-report.json";
const timeoutMs = 15 * 60 * 1000;
const startedAt = Date.now();
const certifiedExchanges = new Set(["NASDAQ", "NYSE", "AMEX"]);

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const safeError = (error) => error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 1200) : "unknown_live_scan_failure";

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
    throw new Error(`Expected JSON from ${path}; status=${response.status}; body=${raw.slice(0, 800)}`);
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
    assert.equal(scannerHealth.json?.scanner, "tradingview_entire_world_primary_listing_scanner");
    assert.equal(scannerHealth.json?.publishingEnabled, false);
    assert.equal(scannerHealth.json?.notificationsEnabled, false);

    scan = await request("/api/internal/combined-opportunity-engine/global-scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      timeoutMs: 12 * 60 * 1000,
      body: JSON.stringify({
        maximumListings: 150000,
        pageSize: 1000,
        pageConcurrency: 8,
        deepQueueSize: 300,
        minimumPrice: 0.25,
        minimumMarketCap: 25000000,
        maximumCertifiedChecks: 5000,
        historyConcurrency: 10,
      }),
    });

    assert.ok([200, 206].includes(scan.status), `Unexpected global scan status: ${scan.status}`);
    assert.ok(scan.json?.universe?.primaryListingsFetched >= 1000, `Global provider universe unexpectedly small: ${scan.json?.universe?.primaryListingsFetched}`);
    assert.ok(scan.json?.universe?.exchanges >= 10, `Too few exchanges: ${scan.json?.universe?.exchanges}`);
    assert.ok(scan.json?.universe?.countries >= 10, `Too few countries: ${scan.json?.universe?.countries}`);
    assert.ok(scan.json?.universe?.coveragePercent >= 99, `Worldwide page coverage below 99%: ${scan.json?.universe?.coveragePercent}`);
    assert.equal(scan.json?.universe?.coverageComplete, true, `Worldwide coverage incomplete: ${JSON.stringify(scan.json?.universe)}`);
    assert.ok(scan.json?.universe?.identifiedProviderRowPercent >= 99, `Provider identities degraded: ${JSON.stringify(scan.json?.universe)}`);
    assert.ok(scan.json?.universe?.usableListingPercent >= 95, `Usable worldwide listings degraded: ${JSON.stringify(scan.json?.universe)}`);

    const verification = scan.json?.seriousAlerts?.verification;
    assert.equal(scan.json?.ok, true, `Global scan reported incomplete verification: ${JSON.stringify(verification)}`);
    assert.equal(scan.status, 200, `A complete global scan must return HTTP 200, received ${scan.status}.`);
    assert.equal(verification?.coverageComplete, true, `Candidate processing/disposition coverage incomplete: ${JSON.stringify(verification)}`);
    assert.equal(verification?.checkedCandidates, verification?.mappedCandidates, `Not all mapped candidates were attempted: ${JSON.stringify(verification)}`);
    assert.equal(verification?.skippedCandidates, 0, `Candidates were skipped: ${JSON.stringify(verification)}`);
    assert.equal(verification?.allMappedCandidatesAttempted, true);
    assert.equal(verification?.unresolvedCandidatesAreBlockedNotPromoted, true);
    assert.equal(verification?.executionComplete, true);
    assert.equal(verification?.allCandidatesAccountedFor, true);
    assert.equal(verification?.promotionSafetyComplete, true);
    assert.ok(scan.json?.seriousAlerts?.certifiedRuleIds?.includes("watch_out_30d_extreme_volatility_after_60pct_drawdown_v2"));
    assert.deepEqual(scan.json?.seriousAlerts?.buy, []);
    assert.deepEqual(scan.json?.seriousAlerts?.sell, []);
    assert.deepEqual(new Set(scan.json?.seriousAlerts?.certificationScope?.exchanges), certifiedExchanges);
    assert.equal(scan.json?.safety?.publishing, false);
    assert.equal(scan.json?.safety?.notifications, false);
    assert.equal(scan.json?.learningLedger?.backend, "cloudflare_r2");
    assert.equal(scan.json?.learningLedger?.durable, true);
    assert.equal(scan.json?.learningLedger?.branchNamespace, "pr-262");
    assert.equal(scan.json?.learningLedger?.immutableCreateOnlyRecords, true);
    assert.equal(scan.json?.learningLedger?.safety?.databaseWrites, false);
    assert.equal(scan.json?.learningLedger?.safety?.publishing, false);
    assert.equal(scan.json?.learningLedger?.safety?.notifications, false);
    assert.equal(scan.json?.learningLedger?.safety?.trading, false);

    const watchOutAlerts = Array.isArray(scan.json?.seriousAlerts?.watchOut) ? scan.json.seriousAlerts.watchOut : [];
    assert.equal(new Set(watchOutAlerts.map((alert) => alert.tradingViewSymbol)).size, watchOutAlerts.length, "Duplicate listing warnings escaped the live scan.");
    assert.equal(new Set(watchOutAlerts.map((alert) => alert.alertKey)).size, watchOutAlerts.length, "Duplicate warning keys escaped the live scan.");
    for (const alert of watchOutAlerts) {
      assert.equal(certifiedExchanges.has(String(alert.exchange).toUpperCase()), true, `Alert escaped certified listing scope: ${alert.tradingViewSymbol}`);
      assert.equal(alert.seriousSignal, true);
      assert.equal(alert.action, "watch_out");
      assert.equal(alert.subtype, "extreme_volatility_direction_uncertain");
      assert.ok(alert.trailing120SessionDrawdownPercent <= -60);
      assert.ok(alert.evidence?.marketDataAgeDays <= 4);
      assert.equal(alert.evidence?.primaryListing, true);
      assert.equal(alert.evidence?.noSyntheticData, true);
      assert.ok(alert.evidence?.estimatedAverageDollarVolume10d >= 1_000_000);
      assert.equal(alert.evidence?.minimumAverageDollarVolumeRequired, 1_000_000);
      assert.equal(alert.evidence?.splitEventsInLookback, 0);
      assert.ok(alert.evidence?.maximumSingleSessionPriceRatio < 4);
      assert.equal(alert.evidence?.corporateActionAndDiscontinuityCheckPassed, true);
      assert.ok(alert.calibration?.sampleSize >= 30);
      assert.ok(alert.calibration?.lowerConfidenceBound90 >= 0.9);
      assert.ok(alert.independentPriceAgreementPercent <= 5);
      assert.equal(alert.notificationEligible, false);
      assert.equal(alert.publicationStatus, "review_only");
    }

    const accountedCandidates = (verification?.checkedCandidates || 0) + (verification?.unsupportedYahooMappings || 0);
    assert.equal(accountedCandidates, verification?.prefilterCandidates, `Not every prefilter candidate was accounted for: ${JSON.stringify(verification)}`);
    const classifiedCandidates = (verification?.verifiedHistoryCandidates || 0)
      + (verification?.priceConflictsBlocked || 0)
      + (verification?.insufficientHistoryBlocked || 0)
      + (verification?.staleHistoryBlocked || 0)
      + (verification?.corporateActionBlocked || 0)
      + (verification?.historyDiscontinuityBlocked || 0)
      + (verification?.liquidityBlocked || 0)
      + (verification?.providerFailures || 0);
    assert.equal(classifiedCandidates, verification?.checkedCandidates, `Attempted candidates were not assigned an honest verification result: ${JSON.stringify(verification)}`);

    const report = {
      ok: scan.json.ok === true,
      checkedAt: new Date().toISOString(),
      expectedCommit: expectedCommit || null,
      runtimeCommit: health.runtime?.commitSha || null,
      deploymentAttempts,
      dataMode: "live_current_tradingview_worldwide_primary_listings_and_yahoo_adjusted_history",
      universe: scan.json.universe,
      researchQueues: {
        buy: scan.json.candidates?.buyResearch?.length || 0,
        sell: scan.json.candidates?.sellResearch?.length || 0,
        watchOut: scan.json.candidates?.watchOutResearch?.length || 0,
        deepAnalysis: scan.json.candidates?.deepAnalysisQueue?.length || 0,
      },
      seriousAlerts: {
        buy: 0,
        sell: 0,
        watchOut: watchOutAlerts.length,
        certificationScope: scan.json.seriousAlerts?.certificationScope,
        verification,
        alerts: watchOutAlerts,
      },
      blockedRatherThanPromoted: {
        unsupportedYahooMappings: verification?.unsupportedYahooMappings || 0,
        priceConflicts: verification?.priceConflictsBlocked || 0,
        insufficientHistory: verification?.insufficientHistoryBlocked || 0,
        staleHistory: verification?.staleHistoryBlocked || 0,
        corporateActions: verification?.corporateActionBlocked || 0,
        historyDiscontinuities: verification?.historyDiscontinuityBlocked || 0,
        insufficientOrMissingLiquidity: verification?.liquidityBlocked || 0,
        providerFailures: verification?.providerFailures || 0,
        globalCasesOutsideCertifiedListingScope: scan.json.seriousAlerts?.certificationScope?.researchOnlyOutsideCertifiedScope || 0,
      },
      opportunityCoverage: scan.json.opportunityCoverage,
      learningLedger: scan.json.learningLedger,
      safety: scan.json.safety,
    };

    await saveReport(report);
    console.log(JSON.stringify({
      ok: true,
      runtimeCommit: report.runtimeCommit,
      universeMode: report.universe.mode,
      primaryListingsFetched: report.universe.primaryListingsFetched,
      exchanges: report.universe.exchanges,
      countries: report.universe.countries,
      universeCoveragePercent: report.universe.coveragePercent,
      candidateProcessingCoveragePercent: verification?.processingCoveragePercent,
      independentHistoryAvailablePercent: verification?.independentHistoryAvailablePercent,
      candidatesAccountedFor: accountedCandidates,
      currentScopedSeriousWatchOutAlerts: report.seriousAlerts.watchOut,
      blockedRatherThanPromoted: report.blockedRatherThanPromoted,
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
