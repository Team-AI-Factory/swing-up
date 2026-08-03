#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = (process.env.COMBINED_ENGINE_RAILWAY_URL || "https://swing-up-swing-up-pr-262.up.railway.app").replace(/\/+$/, "");
const expectedCommit = (process.env.EXPECTED_BRANCH_COMMIT || "").trim();
const outputPath = process.env.CURRENT_US_VALUE_BATCH_REPORT_PATH || "artifacts/current-us-value-batch-report.json";
const deadline = Date.now() + 18 * 60 * 1000;
const endpoint = "/api/internal/combined-opportunity-engine/us-value-batch";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const safeError = (error) => error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 1600) : "unknown_us_value_batch_validation_failure";

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
  return !expectedCommit || runtimeCommit === expectedCommit || runtimeCommit.startsWith(expectedCommit.slice(0, 12));
}

async function main() {
  let attempts = 0;
  let runtime = null;
  let lastObserved = null;
  try {
    while (Date.now() < deadline && !runtime) {
      attempts += 1;
      try {
        const result = await request("/api/internal/combined-opportunity-engine", 90_000);
        if (result.status === 200 && result.json?.ok === true && commitMatches(result.json?.runtime?.commitSha)) {
          runtime = result.json;
          break;
        }
      } catch {}
      await sleep(10_000);
    }
    assert.ok(runtime, `Railway preview did not expose expected commit ${expectedCommit || "(any)"}.`);

    while (Date.now() < deadline) {
      attempts += 1;
      try {
        const result = await request(endpoint);
        const latest = result.json?.latest;
        const updatedAtMs = Date.parse(String(latest?.updatedAt || ""));
        const ageMs = Number.isFinite(updatedAtMs) ? Date.now() - updatedAtMs : Infinity;
        lastObserved = {
          status: result.status,
          ready: result.json?.ready ?? null,
          cycleId: latest?.cycleId ?? null,
          batchStatus: latest?.status ?? null,
          updatedAt: latest?.updatedAt ?? null,
          totalCompanies: latest?.totalCompanies ?? null,
          companiesStored: latest?.companiesStored ?? null,
          nextIndex: latest?.nextIndex ?? null,
          completedBatchCount: Array.isArray(latest?.completedBatchKeys) ? latest.completedBatchKeys.length : null,
          lastError: latest?.lastError ?? null,
        };
        const ready = result.status === 200
          && result.json?.ok === true
          && result.json?.ready === true
          && result.json?.branch === "agent/combined-opportunity-engine"
          && latest?.version === 1
          && ["running", "complete"].includes(latest?.status)
          && ageMs >= 0
          && ageMs <= 20 * 60 * 1000
          && Number(latest?.totalCompanies) >= 4_500
          && Number(latest?.companiesStored) >= 500
          && Number(latest?.nextIndex) >= Number(latest?.companiesStored)
          && Array.isArray(latest?.completedBatchKeys)
          && latest.completedBatchKeys.length >= 1
          && latest.completedBatchKeys.every((key) => typeof key === "string" && key.startsWith("branch-labs/pr-262/value-investing/resumable/cycles/"))
          && latest?.lastError === null
          && result.json?.safety?.databaseWrites === false
          && result.json?.safety?.publishing === false
          && result.json?.safety?.notifications === false
          && result.json?.safety?.trades === false;
        if (ready) {
          assert.ok(latest.companiesStored <= latest.totalCompanies);
          assert.ok(latest.completedBatchKeys.length <= latest.totalBatches);
          const validation = {
            validationOk: true,
            validatedAt: new Date().toISOString(),
            attempts,
            expectedCommit: expectedCommit || null,
            runtimeCommit: runtime.runtime?.commitSha ?? null,
            ...result.json,
          };
          await saveReport(validation);
          console.log(JSON.stringify({
            ok: true,
            runtimeCommit: validation.runtimeCommit,
            cycleId: latest.cycleId,
            status: latest.status,
            totalCompanies: latest.totalCompanies,
            companiesStored: latest.companiesStored,
            completedBatches: latest.completedBatchKeys.length,
            totalBatches: latest.totalBatches,
            reportPath: outputPath,
          }, null, 2));
          return;
        }
      } catch (error) {
        lastObserved = { requestError: safeError(error), observedAt: new Date().toISOString() };
      }
      await sleep(10_000);
    }
    throw new Error("The resumable U.S. valuation worker did not persist a fresh company batch before the validation deadline.");
  } catch (error) {
    const failure = {
      validationOk: false,
      validatedAt: new Date().toISOString(),
      attempts,
      expectedCommit: expectedCommit || null,
      runtimeCommit: runtime?.runtime?.commitSha ?? null,
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
