#!/usr/bin/env node

import assert from "node:assert/strict";

const baseUrl = (process.env.COMBINED_ENGINE_RAILWAY_URL || "https://swing-up-swing-up-pr-262.up.railway.app").replace(/\/+$/, "");
const expectedCommit = (process.env.EXPECTED_BRANCH_COMMIT || "").trim();
const endpoint = "/api/internal/combined-opportunity-engine/us-verified-signals";
const deadline = Date.now() + 12 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function commitMatches(value) {
  const runtimeCommit = String(value || "");
  return !expectedCommit || runtimeCommit === expectedCommit || runtimeCommit.startsWith(expectedCommit.slice(0, 12));
}

async function main() {
  let last = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        headers: { accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      const report = await response.json();
      last = report;
      const sourceCheckedAt = Date.parse(String(report?.verified?.sourceCheckedAt || ""));
      const ageMs = Number.isFinite(sourceCheckedAt) ? Date.now() - sourceCheckedAt : Infinity;
      if (
        response.ok
        && report.ok === true
        && report.ready === true
        && report.branch === "agent/combined-opportunity-engine"
        && commitMatches(report.runtime?.commitSha)
        && ageMs >= 0
        && ageMs <= 45 * 60 * 1000
      ) {
        const verified = report.verified;
        assert.equal(verified.policy, "pr262_authoritative_valuation_consistency_v1");
        assert.ok(verified.verifiedCounts.buy <= verified.rawCounts.buy);
        assert.ok(verified.verifiedCounts.sell <= verified.rawCounts.sell);
        assert.ok(verified.verifiedCounts.watchOut <= verified.rawCounts.watchOut);
        assert.equal(verified.invariants.specialistModelOverridesGenericThresholds, true);
        assert.equal(verified.invariants.displayedPotentialMustMatchDisplayedBaseFairValue, true);
        assert.equal(verified.invariants.unsupportedPharmaGeneralModelCannotPromoteSeriousBuy, true);
        console.log(JSON.stringify({
          ok: true,
          runtimeCommit: report.runtime?.commitSha ?? null,
          sourceCheckedAt: verified.sourceCheckedAt,
          rawCounts: verified.rawCounts,
          verifiedCounts: verified.verifiedCounts,
          rejectedBuys: verified.rejected.filter((item) => item.action === "buy").map((item) => ({ ticker: item.ticker, reasons: item.reasons })),
        }, null, 2));
        return;
      }
    } catch (error) {
      last = { error: error instanceof Error ? error.message : String(error) };
    }
    await sleep(10_000);
  }
  console.error(JSON.stringify({ ok: false, error: "fresh_verified_signal_report_not_ready", last }, null, 2));
  process.exitCode = 1;
}

await main();
