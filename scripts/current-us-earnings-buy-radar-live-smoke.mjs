#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = (process.env.COMBINED_ENGINE_RAILWAY_URL || "https://swing-up-swing-up-pr-262.up.railway.app").replace(/\/+$/, "");
const expectedCommit = (process.env.EXPECTED_BRANCH_COMMIT || "").trim();
const outputPath = process.env.CURRENT_US_EARNINGS_BUY_RADAR_REPORT_PATH || "artifacts/current-us-earnings-buy-radar-report.json";
const deadline = Date.now() + 18 * 60 * 1000;
const endpoint = "/api/internal/combined-opportunity-engine/us-earnings-buy-radar";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const safeError = (error) => error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 1600) : "unknown_earnings_buy_radar_validation_failure";

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

async function save(report) {
  await mkdir(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

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
        storedCompaniesLoaded: report?.coverage?.storedCompaniesLoaded ?? null,
        liveQuotesFetched: report?.coverage?.liveQuotesFetched ?? null,
        officialEarningsChecks: report?.coverage?.officialEarningsChecks ?? null,
        officialEarningsReceiptsFound: report?.coverage?.officialEarningsReceiptsFound ?? null,
        seriousBuys: Array.isArray(report?.seriousBuys) ? report.seriousBuys.length : null,
        buyCandidates: Array.isArray(report?.buyCandidates) ? report.buyCandidates.length : null,
        retrospectiveMissAudit: Array.isArray(report?.retrospectiveMissAudit) ? report.retrospectiveMissAudit.length : null,
        warehouse: report?.warehouse ?? null,
      };
      const ready = result.status === 200
        && result.json?.ok === true
        && result.json?.ready === true
        && result.json?.branch === "agent/combined-opportunity-engine"
        && report?.ok === true
        && report?.mode === "pr262_direct_sec_earnings_buy_radar"
        && commitMatches(report?.runtime?.commitSha)
        && ageMs >= 0
        && ageMs <= 20 * 60 * 1000
        && Number(report?.coverage?.storedCompaniesLoaded) >= 4_500
        && Number(report?.coverage?.liveQuotesFetched) > 0
        && Number(report?.coverage?.officialEarningsChecks) > 0
        && report?.coverage?.directNewsQueueDependency === false
        && report?.methodology?.earningsHeadlineAloneCanTriggerBuy === false
        && report?.methodology?.analystExpectationsCanVetoBuy === false
        && report?.methodology?.officialSecOrIssuerEvidenceRequired === true
        && report?.methodology?.independentPriceCrossCheckRequired === true
        && report?.methodology?.fiveYearNormalizationRequiredForSeriousBuy === true
        && report?.warehouse?.persisted === true
        && Array.isArray(report?.warehouse?.errors)
        && report.warehouse.errors.length === 0
        && report?.safety?.databaseWrites === false
        && report?.safety?.publishing === false
        && report?.safety?.directUserNotifications === false
        && report?.safety?.trades === false;
      if (ready) {
        assert.ok(report.seriousBuys.every((item) => item.classification === "serious_buy"));
        assert.ok(report.seriousBuys.every((item) => item.officialEarnings && item.independentPrice?.passed === true));
        assert.ok(report.seriousBuys.every((item) => item.normalization?.buyQualityConfirmed === true && item.normalization?.oneTimeOrPeakRisk !== true));
        const validation = { validationOk: true, validatedAt: new Date().toISOString(), attempts, expectedCommit: expectedCommit || null, ...report };
        await save(validation);
        console.log(JSON.stringify({
          ok: true,
          checkedAt: report.checkedAt,
          runtimeCommit: report.runtime?.commitSha ?? null,
          storedCompaniesLoaded: report.coverage.storedCompaniesLoaded,
          liveQuotesFetched: report.coverage.liveQuotesFetched,
          officialEarningsChecks: report.coverage.officialEarningsChecks,
          officialEarningsReceiptsFound: report.coverage.officialEarningsReceiptsFound,
          seriousBuys: report.seriousBuys.map((item) => ({ ticker: item.ticker, currentPrice: item.currentPrice, baseFairValue: item.baseFairValue, upsideToBasePercent: item.upsideToBasePercent, confidence: item.confidence })),
          buyCandidates: report.buyCandidates.slice(0, 10).map((item) => ({ ticker: item.ticker, blockers: item.blockers })),
          retrospectiveMissAudit: report.retrospectiveMissAudit.slice(0, 10).map((item) => ({ ticker: item.ticker, filingDate: item.officialEarnings?.filingDate, blockers: item.blockers })),
          reportPath: outputPath,
        }, null, 2));
        process.exit(0);
      }
    } catch (error) {
      lastObserved = { requestError: safeError(error), observedAt: new Date().toISOString() };
    }
    await sleep(10_000);
  }
  throw new Error("The direct SEC earnings Buy radar did not produce a fresh persisted report before the validation deadline.");
} catch (error) {
  const failure = { validationOk: false, validatedAt: new Date().toISOString(), attempts, expectedCommit: expectedCommit || null, error: safeError(error), lastObserved };
  await save(failure);
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
}
