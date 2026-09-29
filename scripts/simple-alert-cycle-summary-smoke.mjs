import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { simpleAlertCycleSummary } from "./helpers/simple-alert-cycle-summary.mjs";

const oversized = JSON.stringify({ processing: { eventResults: [{ evidence: "private-evidence".repeat(20000) }], eventFailures: 1,
  funnel: { committeeApproved: 0 } }, aiCostControl: { spentUsd: 0.3, reservedUsd: 0.156, limitUsd: 10, accountingHealthy: true },
  notifications: { durableRecoveryConsumer: { skipped: true, reason: "cycle_deadline_reserve" } } });
assert.ok(oversized.length > 80000);
const summary = simpleAlertCycleSummary(oversized);
assert.equal(summary.accounting.reservedUsd, 0.156);
assert.equal(summary.processing.eventFailures, 1);
assert.equal(summary.funnel.committeeApproved, 0);
assert.equal(summary.recovery.skipped, true);
assert.equal(summary.recovery.delivered, null);
assert.equal(summary.receiptVerifiedBySummary, false);
assert.ok(JSON.stringify(summary).length < 8000);
assert.ok(!JSON.stringify(summary).includes("private-evidence"));
assert.equal(simpleAlertCycleSummary('{"ok":false}').accounting.accountingHealthy, null);
assert.equal(simpleAlertCycleSummary('{"ok":false}').funnel.committeeApproved, null);
assert.equal(simpleAlertCycleSummary('{"ok":').summaryStatus, "unparseable_response");
assert.equal(simpleAlertCycleSummary('null').summaryStatus, "invalid_response");
const profiles = simpleAlertCycleSummary(JSON.stringify({ attempted: 100, newlyVerifiedThisRun: 7, newlyVerifiedToday: 12, remaining: 488 }));
assert.equal(profiles.profileProduction.newlyVerifiedThisRun, 7);
assert.equal(profiles.profileProduction.attempted, 100);
const launcher = readFileSync(new URL("./simple-alert-pilot-cycle.mjs", import.meta.url), "utf8");
assert.ok(launcher.indexOf("[simple-alerts-summary]") < launcher.indexOf("body.slice(0, 80000)"));
console.log("simple alert bounded cycle summary smoke: passed");
