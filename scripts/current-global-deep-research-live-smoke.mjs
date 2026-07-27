#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = (process.env.COMBINED_ENGINE_RAILWAY_URL || "https://swing-up-swing-up-pr-262.up.railway.app").replace(/\/+$/, "");
const expectedCommit = (process.env.EXPECTED_BRANCH_COMMIT || "").trim();
const token = (process.env.SWING_UP_AUTOMATION_TOKEN || "").trim();
const outputPath = process.env.CURRENT_GLOBAL_DEEP_RESEARCH_REPORT_PATH || "artifacts/current-global-deep-research-report.json";
const deadline = Date.now() + 15 * 60 * 1000;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const safeError = (error) => error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 1200) : "unknown_deep_research_failure";

async function saveReport(report) {
  await mkdir(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function request(path, options = {}) {
  const headers = { accept: "application/json", ...(options.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(options.timeoutMs || 8 * 60 * 1000),
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
  let routeHealth = null;
  let research = null;
  let deploymentAttempts = 0;
  try {
    while (Date.now() < deadline) {
      deploymentAttempts += 1;
      try {
        const result = await request("/api/internal/combined-opportunity-engine", { timeoutMs: 90_000 });
        const runtimeCommit = String(result.json?.runtime?.commitSha || "");
        const matches = !expectedCommit || runtimeCommit === expectedCommit || runtimeCommit.startsWith(expectedCommit.slice(0, 12));
        if (result.status === 200 && result.json?.ok === true && matches) {
          health = result.json;
          break;
        }
      } catch {
        // Railway may still be replacing the previous branch deployment.
      }
      await sleep(10_000);
    }

    assert.ok(health, `Railway preview did not expose expected commit ${expectedCommit || "(any)"}.`);

    routeHealth = await request("/api/internal/combined-opportunity-engine/global-deep-research", { timeoutMs: 90_000 });
    assert.equal(routeHealth.status, 200);
    assert.equal(routeHealth.json?.ok, true);
    assert.equal(routeHealth.json?.workflow, "global_live_deep_research");
    assert.equal(routeHealth.json?.seriousDirectionalAlertsEnabled, false);
    assert.equal(routeHealth.json?.safety?.databaseWrites, false);
    assert.equal(routeHealth.json?.safety?.publishing, false);
    assert.equal(routeHealth.json?.safety?.notifications, false);

    research = await request("/api/internal/combined-opportunity-engine/global-deep-research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      timeoutMs: 12 * 60 * 1000,
      body: JSON.stringify({ perAction: 3 }),
    });

    assert.equal(research.status, 200);
    assert.equal(research.json?.ok, true);
    assert.ok(research.json?.universe?.primaryListingsFetched >= 1_000);
    assert.ok(research.json?.universe?.exchanges >= 10);
    assert.ok(research.json?.universe?.countries >= 10);
    assert.ok(research.json?.universe?.coveragePercent >= 99);
    assert.equal(research.json?.requested?.perAction, 3);
    assert.equal(research.json?.requested?.totalCandidates, 9);
    assert.equal(research.json?.summary?.researched, 9);
    assert.equal(research.json?.summary?.seriousSignals, 0);
    assert.equal(research.json?.safety?.seriousSignalsUnlocked, false);
    assert.equal(research.json?.safety?.databaseWrites, false);
    assert.equal(research.json?.safety?.publishing, false);
    assert.equal(research.json?.safety?.notifications, false);

    for (const action of ["buy", "sell", "watchOut"]) {
      const cases = research.json?.results?.[action];
      assert.ok(Array.isArray(cases));
      assert.equal(cases.length, 3);
      for (const item of cases) {
        assert.equal(item.seriousSignal, false);
        assert.ok(["advance_to_committee_research", "watch_for_more_evidence", "reject_or_deprioritize"].includes(item.researchDisposition));
        assert.ok(Array.isArray(item.providersAttempted));
        assert.ok(item.providersAttempted.includes("TradingView"));
        assert.ok(typeof item.currentPrice === "number" && item.currentPrice > 0);
        assert.equal(item.currentPriceSource, "TradingView public stock scanner");
        assert.ok(Array.isArray(item.blockedReasons) && item.blockedReasons.some((reason) => /certificate/i.test(reason)));
        if (item.secondSourcePrice !== null) {
          assert.ok(item.secondSourcePrice > 0);
          assert.ok(item.priceAgreementPercent === null || item.priceAgreementPercent >= 0);
        }
      }
    }

    const report = {
      ok: true,
      checkedAt: new Date().toISOString(),
      expectedCommit: expectedCommit || null,
      runtimeCommit: health.runtime?.commitSha || null,
      deploymentAttempts,
      dataMode: "current_worldwide_primary_listings_with_live_fmp_expectations_and_marketaux_news",
      universe: research.json.universe,
      requested: research.json.requested,
      summary: research.json.summary,
      results: research.json.results,
      safety: research.json.safety,
    };
    await saveReport(report);
    console.log(JSON.stringify({
      ok: true,
      runtimeCommit: report.runtimeCommit,
      primaryListingsFetched: report.universe.primaryListingsFetched,
      exchanges: report.universe.exchanges,
      countries: report.universe.countries,
      researched: report.summary.researched,
      advanced: report.summary.advanced,
      watched: report.summary.watched,
      rejected: report.summary.rejected,
      seriousSignals: report.summary.seriousSignals,
      providerErrors: report.summary.providerErrors,
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
      routeHealth: routeHealth ? { status: routeHealth.status, json: routeHealth.json } : null,
      research: research ? { status: research.status, json: research.json } : null,
      safety: { databaseWrites: false, publishing: false, notifications: false },
    };
    await saveReport(failure);
    console.error(JSON.stringify(failure, null, 2));
    process.exitCode = 1;
  }
}

await main();
