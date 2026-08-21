#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = (process.env.COMBINED_ENGINE_RAILWAY_URL || "https://swing-up-swing-up-pr-262.up.railway.app").replace(/\/+$/, "");
const expectedCommit = (process.env.EXPECTED_BRANCH_COMMIT || "").trim();
const outputPath = process.env.CURRENT_US_WATCH_OUT_REPORT_PATH || "artifacts/current-us-watch-out-report.json";
const deadline = Date.now() + 12 * 60 * 1000;
const endpoint = "/api/internal/combined-opportunity-engine/us-watch-out-scan";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const safeError = (error) => error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 1600) : "unknown_us_watch_out_validation_failure";

async function saveReport(report) {
  await mkdir(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function request(path, timeoutMs = 90_000) {
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

function commitMatches(value) {
  const runtimeCommit = String(value || "");
  return !expectedCommit || runtimeCommit === expectedCommit || runtimeCommit.startsWith(expectedCommit.slice(0, 12));
}

async function main() {
  let attempts = 0;
  let lastObserved = null;
  try {
    while (Date.now() < deadline) {
      attempts += 1;
      try {
        const result = await request(endpoint);
        const report = result.json;
        const checkedAtMs = Date.parse(String(report.checkedAt || ""));
        const ageMs = Number.isFinite(checkedAtMs) ? Date.now() - checkedAtMs : Infinity;
        lastObserved = {
          status: result.status,
          ready: report.ready ?? null,
          checkedAt: report.checkedAt ?? null,
          runtimeCommit: report.runtime?.commitSha ?? null,
          seriousSignalCount: report.seriousSignalCount ?? null,
          newSeriousSignalCount: report.newSeriousSignalCount ?? null,
          seriousScope: report.seriousScope ?? null,
          marketStructureScan: report.marketStructureScan ?? null,
          warehouse: report.warehouse ?? null,
          safety: report.safety ?? null,
        };
        const ready = result.status === 200
          && report.ok === true
          && report.ready === true
          && report.branch === "agent/combined-opportunity-engine"
          && commitMatches(report.runtime?.commitSha)
          && ageMs >= 0
          && ageMs <= 15 * 60 * 1000
          && report.marketScope === "NASDAQ, NYSE, and NYSE American common stocks and ADRs only for serious alerts"
          && Array.isArray(report.seriousScope?.eligibleExchanges)
          && report.seriousScope.eligibleExchanges.join(",") === "NASDAQ,NYSE,NYSE American"
          && Number(report.seriousScope?.eligibleListings) >= 4_500
          && Number.isInteger(report.seriousScope?.researchOnlyExcludedCount)
          && report.seriousScope.researchOnlyExcludedCount >= 0
          && report.marketStructureScan?.pagesFailed === 0
          && report.marketStructureScan?.usPrimaryListingsChecked >= 4_500
          && report.warehouse?.persisted === true
          && Array.isArray(report.warehouse?.errors)
          && report.warehouse.errors.length === 0
          && report.seriousSignalFound === true
          && Number(report.seriousSignalCount) > 0
          && Array.isArray(report.seriousSignals)
          && report.seriousSignals.length === report.seriousSignalCount
          && report.counts?.seriousEligible === report.seriousSignalCount
          && Number(report.counts?.researchOnlyExcluded) === Number(report.seriousScope?.researchOnlyExcludedCount)
          && Number.isInteger(report.newSeriousSignalCount)
          && report.newSeriousSignalCount >= 0
          && report.newSeriousSignalCount <= report.seriousSignalCount
          && Array.isArray(report.newSeriousSignals)
          && report.newSeriousSignals.length === report.newSeriousSignalCount
          && report.newSeriousSignals.every((item) => typeof item.outboxKey === "string" && item.outboxKey.startsWith("branch-labs/pr-262/research-candidates/outbox/watch-out/"))
          && report.notificationOutbox?.deliveryEnabled === false
          && report.safety?.databaseWrites === false
          && report.safety?.publishing === false
          && report.safety?.notifications === false
          && report.safety?.trades === false;
        if (ready) {
          assert.ok(report.seriousSignals.every((item) => item.seriousSignal === true && item.action === "watch_out"));
          assert.ok(report.seriousSignals.every((item) => item.notificationEligible === false));
          const validation = {
            validationOk: true,
            validatedAt: new Date().toISOString(),
            attempts,
            expectedCommit: expectedCommit || null,
            ...report,
          };
          await saveReport(validation);
          console.log(JSON.stringify({
            ok: true,
            checkedAt: report.checkedAt,
            runtimeCommit: report.runtime?.commitSha ?? null,
            listingsChecked: report.marketStructureScan.usPrimaryListingsChecked,
            seriousEligibleListings: report.seriousScope.eligibleListings,
            researchOnlyExcludedCount: report.seriousScope.researchOnlyExcludedCount,
            seriousSignalCount: report.seriousSignalCount,
            newSeriousSignalCount: report.newSeriousSignalCount,
            topSignals: report.seriousSignals.slice(0, 10).map((item) => ({
              ticker: item.ticker,
              company: item.company,
              ruleId: item.ruleId,
              currentPrice: item.currentPrice,
              reasons: item.reasons,
            })),
            reportPath: outputPath,
          }, null, 2));
          return;
        }
      } catch (error) {
        lastObserved = { requestError: safeError(error), observedAt: new Date().toISOString() };
      }
      await sleep(10_000);
    }
    throw new Error("The independent U.S. Watch Out worker did not produce and persist a fresh major-exchange serious signal before the validation deadline.");
  } catch (error) {
    const failure = {
      validationOk: false,
      validatedAt: new Date().toISOString(),
      attempts,
      expectedCommit: expectedCommit || null,
      error: safeError(error),
      lastObserved,
      safety: { databaseWrites: false, publishing: false, notifications: false, trades: false },
    };
    await saveReport(failure);
    console.error(JSON.stringify(failure, null, 2));
    process.exitCode = 1;
  }
}

await main();
