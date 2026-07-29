import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/equity-signal/fundamentals.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  fileName: "fundamentals.ts",
}).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", output)((name) => {
  throw new Error(`Unexpected fundamentals import: ${name}`);
}, loaded, loaded.exports);

const { enrichCandidateFundamentals } = loaded.exports;
const now = new Date("2026-11-01T12:00:00.000Z");

const candidate = (eventFamily, metric) => ({
  cik: "0001234567",
  eventFamily,
  eventMagnitude: {
    status: "absolute_only",
    metrics: [{
      ...metric,
      sourceReceiptId: "receipt-1",
      sourceUrl: "https://issuer.example/event",
      sourcePublisher: "Issuer",
      primarySource: true,
      corroboratingPublishers: 1,
      promotionEvidenceVerified: true,
      eventStatus: eventFamily === "contract_award" ? "committed" : eventFamily === "financing_dilution" ? "priced" : metric.eventStatus,
      evidenceText: "Explicit current event amount.",
    }],
    relativeToCompany: null,
    materialityBasis: "Explicit amount only.",
  },
  fundamentals: null,
});

const connectedFetch = (body) => async () => new Response(JSON.stringify(body), {
  status: 200,
  headers: { "content-type": "application/json" },
});

const validFacts = {
  facts: {
    "us-gaap": {
      RevenueFromContractWithCustomerExcludingAssessedTax: {
        units: {
          USD: [
            {
              val: 300_000_000,
              start: "2026-01-01",
              end: "2026-09-30",
              filed: "2026-10-25",
              form: "10-Q",
            },
            {
              val: 2_000_000_000,
              start: "2025-01-01",
              end: "2025-12-31",
              filed: "2026-02-20",
              form: "10-K",
              segment: { dimension: "ProductOrServiceAxis", value: "ExampleMember" },
            },
            {
              val: 800_000_000,
              start: "2024-01-01",
              end: "2024-12-31",
              filed: "2025-02-20",
              form: "10-K",
            },
          ],
        },
      },
      Revenues: {
        units: {
          USD: [{
            val: 1_000_000_000,
            start: "2025-01-01",
            end: "2025-12-31",
            filed: "2026-02-15",
            form: "10-K",
          }],
        },
      },
      CashAndCashEquivalentsAtCarryingValue: {
        units: {
          USD: [{
            val: 75_000_000,
            end: "2026-09-30",
            filed: "2026-10-25",
            form: "10-Q",
          }],
        },
      },
      CommonStockSharesOutstanding: {
        units: {
          shares: [
            {
              val: 120_000_000,
              end: "2026-06-30",
              filed: "2026-10-30",
              form: "10-Q",
            },
            {
              val: 200_000_000,
              start: "2026-01-01",
              end: "2026-09-30",
              filed: "2026-10-30",
              form: "10-Q",
            },
          ],
        },
      },
      CommonStocksIncludingAdditionalPaidInCapitalMember: {
        units: {
          shares: [{
            val: 999_000_000,
            end: "2026-10-30",
            filed: "2026-10-31",
            form: "10-Q",
          }],
        },
      },
    },
    dei: {
      EntityCommonStockSharesOutstanding: {
        units: {
          shares: [
            {
              val: 100_000_000,
              end: "2026-09-30",
              filed: "2026-10-25",
              form: "10-Q",
            },
            {
              val: -1,
              end: "2026-10-30",
              filed: "2026-10-31",
              form: "10-Q",
            },
          ],
        },
      },
    },
  },
};

const contract = candidate("contract_award", { kind: "contract_value", value: 500_000_000, unit: "USD" });
const contractResult = await enrichCandidateFundamentals(contract, connectedFetch(validFacts), now);
assert.equal(contractResult.provider.status, "connected");
assert.equal(contract.fundamentals.available, true);
assert.equal(contract.fundamentals.items.find((item) => item.metric === "revenue")?.value, 1_000_000_000);
assert.equal(contract.fundamentals.items.some((item) => item.metric === "revenue" && item.form === "10-Q"), false);
assert.equal(contract.eventMagnitude.status, "relative_to_company");
assert.deepEqual(contract.eventMagnitude.relativeToCompany, {
  metric: "annual_revenue",
  eventValue: 500_000_000,
  eventMetricSourceReceiptId: "receipt-1",
  companyValue: 1_000_000_000,
  ratioPercent: 50,
  sourceUrl: "https://data.sec.gov/api/xbrl/companyfacts/CIK0001234567.json",
});

const offering = candidate("financing_dilution", { kind: "offering_shares", value: 20_000_000, unit: "shares" });
await enrichCandidateFundamentals(offering, connectedFetch(validFacts), now);
assert.equal(offering.fundamentals.available, true);
assert.equal(offering.fundamentals.items.find((item) => item.metric === "shares_outstanding")?.value, 100_000_000);
assert.equal(offering.eventMagnitude.status, "relative_to_company");
assert.equal(offering.eventMagnitude.relativeToCompany?.ratioPercent, 20);

const ceilingAndTaskOrder = candidate("contract_award", { kind: "contract_value", value: 1_000_000_000, unit: "USD" });
ceilingAndTaskOrder.eventMagnitude.metrics[0].eventStatus = "ceiling";
ceilingAndTaskOrder.eventMagnitude.metrics.push({
  kind: "contract_value",
  value: 10_000_000,
  unit: "USD",
  sourceReceiptId: "receipt-2",
  sourceUrl: "https://issuer.example/task-order",
  sourcePublisher: "Issuer",
  primarySource: true,
  corroboratingPublishers: 1,
  promotionEvidenceVerified: true,
  evidenceText: "Committed task order valued at $10 million.",
  eventStatus: "committed",
});
await enrichCandidateFundamentals(ceilingAndTaskOrder, connectedFetch(validFacts), now);
assert.equal(ceilingAndTaskOrder.eventMagnitude.relativeToCompany?.eventValue, 10_000_000);
assert.equal(ceilingAndTaskOrder.eventMagnitude.relativeToCompany?.eventMetricSourceReceiptId, "receipt-2");
assert.equal(ceilingAndTaskOrder.eventMagnitude.relativeToCompany?.ratioPercent, 1);

const finalFine = candidate("regulatory_enforcement", { kind: "fine_value", value: 20_000_000, unit: "USD", eventStatus: "final" });
await enrichCandidateFundamentals(finalFine, connectedFetch(validFacts), now);
assert.equal(finalFine.eventMagnitude.relativeToCompany?.metric, "annual_revenue");
assert.equal(finalFine.eventMagnitude.relativeToCompany?.eventValue, 20_000_000);
assert.equal(finalFine.eventMagnitude.relativeToCompany?.ratioPercent, 2);

const staleFacts = {
  facts: {
    "us-gaap": {
      Revenues: {
        units: {
          USD: [{
            val: 900_000_000,
            start: "2023-01-01",
            end: "2023-12-31",
            filed: "2024-02-20",
            form: "10-K",
          }],
        },
      },
      CashAndCashEquivalentsAtCarryingValue: {
        units: {
          USD: [{
            val: 50_000_000,
            end: "2026-09-30",
            filed: "2026-10-25",
            form: "10-Q",
          }],
        },
      },
    },
    dei: {
      EntityCommonStockSharesOutstanding: {
        units: {
          shares: [{
            val: 100_000_000,
            end: "2025-12-31",
            filed: "2026-01-15",
            form: "10-K",
          }],
        },
      },
    },
  },
};

const staleContract = candidate("contract_award", { kind: "contract_value", value: 500_000_000, unit: "USD" });
await enrichCandidateFundamentals(staleContract, connectedFetch(staleFacts), now);
assert.equal(staleContract.fundamentals.items.some((item) => item.metric === "cash"), true);
assert.equal(staleContract.fundamentals.items.some((item) => item.metric === "revenue"), false);
assert.equal(staleContract.fundamentals.available, false);
assert.equal(staleContract.fundamentals.error, "required_company_scale_unavailable");
assert.equal(staleContract.eventMagnitude.status, "absolute_only");
assert.equal(staleContract.eventMagnitude.relativeToCompany, null);

const staleOffering = candidate("financing_dilution", { kind: "offering_shares", value: 20_000_000, unit: "shares" });
await enrichCandidateFundamentals(staleOffering, connectedFetch(staleFacts), now);
assert.equal(staleOffering.fundamentals.items.some((item) => item.metric === "shares_outstanding"), false);
assert.equal(staleOffering.fundamentals.available, false);
assert.equal(staleOffering.fundamentals.error, "required_company_scale_unavailable");
assert.equal(staleOffering.eventMagnitude.status, "absolute_only");
assert.equal(staleOffering.eventMagnitude.relativeToCompany, null);

const foreignAnnualFacts = {
  facts: {
    "us-gaap": {
      Revenues: {
        units: {
          USD: [{
            val: 600_000_000,
            start: "2025-01-01",
            end: "2025-12-31",
            filed: "2026-04-01",
            form: "20-F",
          }],
        },
      },
    },
  },
};
const foreignContract = candidate("contract_award", { kind: "contract_value", value: 60_000_000, unit: "USD" });
await enrichCandidateFundamentals(foreignContract, connectedFetch(foreignAnnualFacts), now);
assert.equal(foreignContract.fundamentals.available, true);
assert.equal(foreignContract.eventMagnitude.relativeToCompany?.ratioPercent, 10);

console.log(JSON.stringify({
  ok: true,
  factsGatheredAcrossConcepts: true,
  newerQuarterlyRevenueIgnored: true,
  segmentedAnnualRevenueIgnored: true,
  invalidSharesConceptIgnored: true,
  latestPositivePointInTimeSharesSelected: true,
  staleRevenueRejected: true,
  staleSharesRejected: true,
  foreignAnnualFormAccepted: true,
  relativeMagnitudePopulated: true,
}, null, 2));
