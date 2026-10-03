import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { inSimpleAlertPilot } from "./helpers/simple-alert-pilot-fixture.mjs";

const cohort = JSON.parse(readFileSync(new URL("../config/simple-alert-pilot.json", import.meta.url)));
const scope = loadTsModule("@/lib/simple-alert-pilot-scope");
assert.equal(cohort.cohortId, "small-ai-25-20261003-v1");
assert.deepEqual(cohort.companies.map(row => row.ticker), [
  "AIOT", "PGY", "CRNC", "INOD", "UPST", "LTRX", "AIP", "AMBQ", "AISP", "BKSY", "CEVA", "SDGR", "SOUN",
  "HSAI", "TSSI", "AMBA", "OUST", "AI", "LMND", "RXRX", "PDYN", "SERV", "BBAI", "RDNT", "REKR",
]);
assert.equal(new Set(cohort.companies.map(row => row.cik)).size, 25);
assert.equal(cohort.research.sha256, "eaab722b5a473760eccfcb67ef9bd79d86572d07f8c4eb22beb0384ee4ec3efe");
assert.equal(cohort.research.validated10xInvestments, 0);
assert.equal(cohort.research.verifiedValuationInputs, false);
assert.equal(cohort.companies.filter(row => row.upsidePolicy === "existing_evidence_gates_required").length, 24);
assert.ok(cohort.companies.every(row => !row.tenXVerified && !row.valuationReady && row.monitoringEligible));
for (const row of cohort.companies) {
  assert.ok(row.sourceUrls.length >= 2);
  assert.equal(new URL(row.identitySourceUrl).hostname, "www.sec.gov");
  assert.match(new URL(row.profileSourceUrl).pathname, new RegExp(`/edgar/data/${Number(row.cik)}/`));
  assert.ok(!("fairValue" in row) && !("scenario_required_equity_value_usd" in row), "Screen backsolves must not feed verified runtime valuations");
}
const hsai = cohort.companies.find(row => row.ticker === "HSAI");
assert.equal(hsai.securityType, "adr");
assert.deepEqual(hsai.filingForms, ["20-F", "6-K"]);
assert.equal(hsai.adsOrdinarySharesRatio, 8);
assert.equal(hsai.financialReportingCurrency, "RMB");
for (const ticker of ["PDYN", "BKSY"]) {
  const row = cohort.companies.find(row => row.ticker === ticker);
  assert.equal(row.securityType, "common_stock");
  assert.deepEqual(row.excludedSecurityClasses, ["warrants"]);
  assert.match(row.securityNotes, /warrants, not common shares/);
}
await inSimpleAlertPilot(async () => {
  assert.equal(scope.pilotCompanies().length, 25);
  for (const row of cohort.companies) {
    assert.equal(scope.pilotIncludes(row), true);
    assert.equal(scope.pilotIncludes({ ticker: row.ticker, cik: "9999999999" }), false);
  }
  for (const ticker of ["AAPL", "AXS", "CUBI", "INTR", "PDYNW", "BKSY.WS"]) assert.equal(scope.pilotIncludes({ ticker }), false);
  assert.match(scope.pilotUpsideBlocker({ ticker: "REKR" }), /financing\/compliance quarantine/);
  assert.match(scope.pilotUpsideBlocker({ ticker: "rekr", cik: "1697851" }), /financing\/compliance quarantine/);
  assert.match(scope.pilotUpsideBlocker({ ticker: "WRONG", cik: "1697851" }), /financing\/compliance quarantine/);
  assert.equal(scope.pilotUpsideBlocker(cohort.companies[0]), null);
  for (const action of ["buy", "buy_research", "upside"]) {
    const monitored = scope.applyPilotResearchAlertPolicy({ ticker: "REKR", action, userAlertEligible: true, committeeApproved: true, sources: ["original"] });
    assert.equal(monitored.action, "price_watch");
    assert.equal(monitored.userAlertEligible, false);
    assert.equal(monitored.committeeApproved, false);
    assert.deepEqual(monitored.sources, ["original"]);
    assert.deepEqual(scope.applyPilotResearchAlertPolicy(monitored), monitored);
  }
  for (const action of ["sell", "watch_out", "watch_out_research"]) {
    const row = { ticker: "REKR", action, userAlertEligible: true };
    assert.deepEqual(scope.applyPilotResearchAlertPolicy(row), row);
  }
  for (const mutate of [
    value => value.companies.pop(),
    value => value.companies.push(...structuredClone(value.companies)),
    value => { value.companies[0].cik = value.companies[1].cik; },
    value => { value.companies[0].tenXVerified = true; },
    value => { value.companies.at(-1).upsidePolicy = "existing_evidence_gates_required"; },
  ]) {
    const bad = structuredClone(cohort); mutate(bad);
    const badScope = loadTsModule("@/lib/simple-alert-pilot-scope", { "@/config/simple-alert-pilot.json": bad });
    assert.throws(() => badScope.pilotCompanies(), /simple_pilot_cohort_invalid/);
  }

  // Stored legacy approvals must also be downgraded on read, without deleting evidence.
  const storedRows = [
    { ticker: "REKR", cik: "0001697851", action: "buy", userAlertEligible: true, committeeApproved: true, sources: [{ url: "https://www.sec.gov/Archives/edgar/data/1697851/filing.htm" }] },
    { ticker: "REKR", cik: "0001697851", action: "watch_out", userAlertEligible: true, committeeApproved: false },
  ];
  const evidence = loadTsModule("@/lib/opportunity-engine/pr262-research-evidence", {
    "@/lib/r2-warehouse": { readVersionedTextFromR2: async () => ({ found: true, text: JSON.stringify({ alerts: storedRows }) }) },
    "@/lib/opportunity-engine/company-profile-cache": { readCompanyProfiles: async () => new Map() },
  });
  const read = await evidence.readResearchAlerts();
  assert.equal(read.length, 2);
  assert.equal(read[0].committeeApproved, false);
  assert.equal(read[0].userAlertEligible, false);
  assert.deepEqual(read[0].sources, storedRows[0].sources);
  assert.deepEqual(read[1], storedRows[1]);
});
const savedBranch = process.env.RAILWAY_GIT_BRANCH;
try {
  process.env.RAILWAY_GIT_BRANCH = "main";
  assert.equal(scope.pilotUpsideBlocker({ ticker: "REKR" }), null, "Pilot config cannot alter main behavior");
} finally {
  if (savedBranch === undefined) delete process.env.RAILWAY_GIT_BRANCH;
  else process.env.RAILWAY_GIT_BRANCH = savedBranch;
}
console.log("Small-AI cohort: exact 25, research-only provenance, REKR quarantine, source retention, HSAI ADS and warrant-class semantics passed.");
