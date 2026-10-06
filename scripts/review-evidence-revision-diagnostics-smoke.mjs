import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const { reviewEvidenceRevision: revision } = loadTsModule("@/lib/equity-signal/review-evidence-revision");
const pilot = {
  SWING_UP_SIMPLE_PILOT_ENABLED: "true",
  RAILWAY_GIT_BRANCH: "pilot-simple-alerts",
  RAILWAY_PROJECT_ID: "83d99341-d622-475f-8035-00ef3d0916d1",
  RAILWAY_ENVIRONMENT_ID: "87afb8d7-c4fc-4f84-92b6-5d2820a689b6",
  SWING_UP_PR262_STORAGE_PREFIX: "branch-labs/simple-alerts/",
  SWING_UP_R2_WRITE_PREFIX: "branch-labs/simple-alerts/",
};
const before = Object.fromEntries(Object.keys(pilot).map(key => [key, process.env[key]]));
const originalInfo = console.info;
const lines = [];
const base = {
  source: [{ id: "generated-a", summary: "sensitive quote A", rawEventType: "valuation_review" }],
  companyProfile: { business: "sensitive business", customers: "sensitive customers" },
  industry: "test", outlookRange: { base: 15 }, reviewPolicy: { model: "unchanged" },
  financialDocuments: [{ url: "https://example.test/private", filedAt: "2026-08-01", digest: "doc-a", readComplete: true }],
  modelAssumptions: [{ growth: 0.1 }],
  facts: [{ metric: "revenue", value: 100, unit: "USD", periodEnd: "2026-06-30", filedAt: "2026-08-01", retrievedAt: "time-a" }],
  sourceComplete: true, priceReady: true, haltKnown: true, halted: false,
  valuation: { base: 15, currentPriceSupportsValuation: true },
};
const packet = () => JSON.parse(lines.at(-1).slice(lines.at(-1).indexOf("{")));
const changed = (a, b) => Object.keys(a.components).filter(key => a.components[key] !== b.components[key]);
try {
  Object.assign(process.env, pilot);
  console.info = line => lines.push(line);
  // Frozen hashes from the pre-diagnostic implementation protect live locks.
  assert.equal(revision(base), "e3874a22b546f269");
  const first = packet();
  assert.equal(first.revision, "e3874a22b546f269");
  assert.equal(first.version, 1);
  assert.equal(Object.keys(first.components).length, 13);
  assert(lines[0].length < 1000);
  assert(!/sensitive|example\.test|2026-08-01/.test(lines[0]));
  assert(Object.values(first.components).every(value => /^[a-f0-9]{16}$/.test(value)));
  assert.equal(revision({ ...base, priceReady: false }), "ac495964a283cdb3");
  assert.deepEqual(changed(first, packet()), ["priceReady"]);
  assert.equal(revision({ ...base, facts: [{ ...base.facts[0], value: 101 }] }), "4e9642ffead183ae");
  assert.deepEqual(changed(first, packet()), ["facts"]);
  const refetched = { ...base, source: [{ id: "generated-b", summary: "sensitive quote B", rawEventType: "valuation_review" }],
    facts: [{ ...base.facts[0], retrievedAt: "time-b" }] };
  assert.equal(revision(refetched), first.revision);
  assert.deepEqual(packet().components, first.components);
  const reordered = Object.fromEntries(Object.entries(base).reverse());
  assert.equal(revision(reordered), first.revision);
  for (const key of Object.keys(pilot)) {
    process.env[key] = key === "RAILWAY_GIT_BRANCH" ? "main" : "not-authorized";
    const count = lines.length;
    assert.equal(revision(base), first.revision);
    assert.equal(lines.length, count, `No diagnostic outside exact pilot scope: ${key}`);
    process.env[key] = pilot[key];
  }
  console.info = () => { throw new Error("logger unavailable"); };
  assert.equal(revision(base), first.revision, "Logging failure must not change admission identity");
} finally {
  console.info = originalInfo;
  for (const [key, value] of Object.entries(before)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
console.log("PASS: pilot-only bounded component hashes, unchanged live revision hashes, meaningful differences visible, raw evidence absent, logging failure isolated");
