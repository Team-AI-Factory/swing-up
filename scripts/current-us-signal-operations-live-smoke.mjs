#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = (process.env.COMBINED_ENGINE_RAILWAY_URL || "https://swing-up-swing-up-pr-262.up.railway.app").replace(/\/+$/, "");
const expectedCommit = (process.env.EXPECTED_BRANCH_COMMIT || "").trim();
const outputPath = process.env.CURRENT_US_SIGNAL_OPERATIONS_REPORT_PATH || "artifacts/current-us-signal-operations-report.json";
const deadline = Date.now() + 20 * 60 * 1000;
const endpoint = "/api/internal/combined-opportunity-engine/us-signal-operations";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const safeError = (error) => error instanceof Error
  ? error.message.replace(/\s+/g, " ").slice(0, 1600)
  : "unknown_us_signal_operations_validation_failure";

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

function commitMatches(value) {
  const runtimeCommit = String(value || "");
  return !expectedCommit
    || runtimeCommit === expectedCommit
    || runtimeCommit.startsWith(expectedCommit.slice(0, 12));
}

async function main() {
  let attempts = 0;
  let lastObserved = null;
  try {
    while (Date.now() < deadline) {
      attempts += 1;
      try {
        const result = await request(endpoint);
        const report = result.json?.report;
        const checkedAtMs = Date.parse(String(report?.checkedAt || ""));
        const ageMs = Number.isFinite(checkedAtMs) ? Date.now() - checkedAtMs : Infinity;
        lastObserved = {
          status: result.status,
          ready: result.json?.ready ?? null,
          checkedAt: report?.checkedAt ?? null,
          runtimeCommit: report?.runtime?.commitSha ?? null,
          companiesLoaded: report?.coverage?.companiesLoadedFromR2Batches ?? null,
          liveQuotes: report?.coverage?.liveQuotes ?? null,
          activeRegistry: report?.activeRegistry ?? null,
          buyFocus: report?.buyFocus ?? null,
          errors: report?.errors ?? null,
        };
        const safety = report?.safety;
        const ready = result.status === 200
          && result.json?.ok === true
          && result.json?.ready === true
          && result.json?.branch === "agent/combined-opportunity-engine"
          && report?.version === 1
          && report?.mode === "pr262_us_serious_signal_operations"
          && report?.branch === "agent/combined-opportunity-engine"
          && commitMatches(report?.runtime?.commitSha)
          && ageMs >= 0
          && ageMs <= 20 * 60 * 1000
          && Number(report?.coverage?.totalStoredCompanies) >= 4_500
          && Number(report?.coverage?.companiesLoadedFromR2Batches) >= 4_500
          && Number(report?.coverage?.priceCandidates) > 0
          && Array.isArray(report?.seriousSignals?.buy)
          && Array.isArray(report?.seriousSignals?.sell)
          && Array.isArray(report?.seriousSignals?.watchOut)
          && report?.buyFocus?.priority === true
          && Array.isArray(report?.buyFocus?.nearMisses)
          && typeof report?.activeRegistry?.key === "string"
          && report.activeRegistry.key.startsWith("branch-labs/pr-262/signal-operations/")
          && typeof report?.notificationDigest?.key === "string"
          && report.notificationDigest.readyForExternalConditionWatcher === true
          && report.notificationDigest.deliveryEnabledInsideDraftBranch === false
          && Array.isArray(report?.longTermNormalization)
          && Array.isArray(report?.specialistValuations)
          && safety?.databaseWrites === false
          && safety?.publishing === false
          && safety?.directUserNotifications === false
          && safety?.trades === false
          && safety?.productionWrites === false
          && safety?.nonUsScanning === false;
        if (ready) {
          const allSignals = [
            ...report.seriousSignals.buy,
            ...report.seriousSignals.sell,
            ...report.seriousSignals.watchOut,
          ];
          assert.ok(allSignals.every((signal) => typeof signal.fingerprint === "string" && signal.fingerprint.length >= 20));
          assert.ok(allSignals.every((signal) => ["buy", "sell", "watch_out"].includes(signal.action)));
          assert.ok(allSignals.every((signal) => signal.evidence && typeof signal.evidence.priceCrossChecked === "boolean"));
          assert.ok(report.seriousSignals.buy.every((signal) => signal.action === "buy"));
          const validation = {
            validationOk: true,
            validatedAt: new Date().toISOString(),
            attempts,
            expectedCommit: expectedCommit || null,
            ...result.json,
          };
          await saveReport(validation);
          console.log(JSON.stringify({
            ok: true,
            checkedAt: report.checkedAt,
            runtimeCommit: report.runtime?.commitSha ?? null,
            companiesLoaded: report.coverage.companiesLoadedFromR2Batches,
            priceCandidates: report.coverage.priceCandidates,
            liveQuotes: report.coverage.liveQuotes,
            seriousBuys: report.seriousSignals.buy.length,
            seriousSells: report.seriousSignals.sell.length,
            seriousWatchOuts: report.seriousSignals.watchOut.length,
            newNotificationSignals: report.notificationDigest.newSignalCount,
            reportPath: outputPath,
          }, null, 2));
          return;
        }
      } catch (error) {
        lastObserved = { requestError: safeError(error), observedAt: new Date().toISOString() };
      }
      await sleep(10_000);
    }
    throw new Error("The PR #262 buy-first signal-operations worker did not persist a fresh valid report before the validation deadline.");
  } catch (error) {
    const failure = {
      validationOk: false,
      validatedAt: new Date().toISOString(),
      attempts,
      expectedCommit: expectedCommit || null,
      error: safeError(error),
      lastObserved,
      safety: {
        databaseWrites: false,
        publishing: false,
        directUserNotifications: false,
        trades: false,
      },
    };
    await saveReport(failure);
    console.error(JSON.stringify(failure, null, 2));
    process.exitCode = 1;
  }
}

await main();
