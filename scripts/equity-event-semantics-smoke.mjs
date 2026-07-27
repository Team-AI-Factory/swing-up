import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";

function compile(url, dependencies = {}) {
  const source = readFileSync(url, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name === "node:crypto") return crypto;
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected import while testing event semantics: ${name}`);
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

const policy = compile(new URL("../lib/branch-signal-lab-policy.ts", import.meta.url));
const historical = compile(new URL("../lib/equity-signal/historical-analogs.ts", import.meta.url));
const analysis = compile(new URL("../lib/equity-signal/analysis.ts", import.meta.url), {
  "@/lib/branch-signal-lab-policy": policy,
  "@/lib/equity-signal/historical-analogs": historical,
});

const entry = (ticker, name, aliases = []) => ({ ticker, name, exchange: "NASDAQ", cik: null, aliases, securityType: "common_stock", sourceNames: ["test official universe"] });
const universe = {
  version: 1,
  scope: "active_us_exchange_listed_common_equities_and_adrs",
  constructionMode: "nasdaq_plus_sec",
  refreshedAt: "2026-07-22T13:00:00.000Z",
  entries: [
    entry("FRHC", "Freedom Holding Corp.", ["Freedom Holding Corp.", "Freedom"]),
    entry("EML", "EASTERN CO", ["Eastern"]),
    entry("INTC", "INTEL CORP", ["Intel"]),
    entry("PPLI", "People Inc", ["People"]),
    entry("XOM", "Exxon Mobil Corporation", ["Exxon Mobil"]),
    entry("RS", "Reliance, Inc.", ["Reliance"]),
    entry("AWX", "Avalon Holdings Corp.", ["Avalon"]),
    entry("GOOGL", "Alphabet Inc.", ["Alphabet"]),
    entry("AAPL", "Apple Inc.", ["Apple"]),
  ],
  coverage: { nasdaqRows: 9, otherExchangeRows: 0, eligibleEquities: 9, cikMapped: 0, cikMappedPercent: 0, adrCount: 0, excludedByReason: {} },
  sources: [],
};
const macro = { checkedAt: "2026-07-22T13:00:00.000Z", status: "connected", series: [], regime: ["normal"], historicalComparisonAvailable: false, errors: [] };
const receipt = (overrides) => ({
  id: crypto.randomUUID(),
  title: "Official event",
  summary: null,
  url: "https://official.example/event",
  publisher: "Official Source",
  publishedAt: "2026-07-22T12:30:00.000Z",
  channel: "white_house",
  official: true,
  primarySource: true,
  scheduled: false,
  symbolHints: [],
  companyHints: [],
  rawEventType: null,
  ...overrides,
});
const build = (receipts) => analysis.buildImpactCandidates(receipts, universe, macro, new Date("2026-07-22T13:00:00.000Z"), []);

const commemoration = build([receipt({
  title: "Presidential Message on the Anniversary of the Liberation of Guam",
  summary: "The nation commemorates freedom and the end of occupation during the Second World War.",
})]);
assert.equal(commemoration.candidates.length, 0);

const departmentName = build([receipt({
  title: "Department of War Partners With the Genesis Mission to Proliferate AI for Science",
  channel: "defense_department",
})]);
assert.equal(departmentName.candidates.some((item) => item.eventFamily === "geopolitical_conflict"), false);

const genericFreedom = build([receipt({
  title: "Government imposes sanctions to defend freedom in the region",
  summary: "The official action does not name Freedom Holding or ticker FRHC.",
})]);
assert.equal(genericFreedom.candidates.some((item) => item.ticker === "FRHC"), false);

const easternTime = build([receipt({
  title: "National Construction Safety Team Advisory Committee Meeting",
  summary: "The virtual meeting begins at 1:00 p.m. Eastern Time and reviews a building-collapse investigation.",
  channel: "federal_register",
})]);
assert.equal(easternTime.candidates.some((item) => item.ticker === "EML"), false);

const declassifiedIntel = build([receipt({
  title: "President Declassifies Intel on Foreign Election Interference",
  summary: "The government says people should review a deep-state coverup and intelligence-community findings.",
})]);
assert.equal(declassifiedIntel.candidates.some((item) => item.ticker === "INTC" || item.ticker === "PPLI"), false);

const unrelatedRelianceRecall = build([receipt({
  title: "Reliance Life Sciences Private Limited FDA recall: Lack of Sterility Assurance",
  summary: "The recall concerns products made by Reliance Life Sciences Private Limited.",
  channel: "openfda",
  companyHints: ["Reliance Life Sciences Private Limited"],
  rawEventType: "recall",
})]);
assert.equal(unrelatedRelianceRecall.candidates.some((item) => item.ticker === "RS"), false);

const passiveStakeArticle = build([receipt({
  title: "Avalon Trust Co Decreases Stake in Alphabet Inc. $GOOGL after an earnings miss",
  publisher: "Market article",
  channel: "google_news_rss",
  official: false,
  primarySource: false,
  symbolHints: ["GOOGL"],
})]);
assert.equal(passiveStakeArticle.candidates.length, 0);
assert.equal(passiveStakeArticle.diagnostics.noiseRejected, 1);

const activeConflict = build([receipt({
  title: "Military strikes close a Red Sea shipping route as conflict escalates",
  channel: "defense_department",
})]);
assert.equal(activeConflict.candidates.some((item) => item.ticker === "XOM" && item.eventFamily === "geopolitical_conflict" && item.relationship === "second_order"), true);
const conflictKnockOn = activeConflict.candidates.find((item) => item.ticker === "XOM" && item.relationship === "second_order");
assert.equal(conflictKnockOn?.historicalAnalog.available, false);
assert.equal(conflictKnockOn?.gateChecks.historicalComparisonRequired, false);
assert.equal(conflictKnockOn?.gateChecks.knockOnCausalPathVerified, true);
assert.equal(conflictKnockOn?.gatePassed, true);

const exactIssuer = build([receipt({
  title: "Freedom Holding Corp. announces a secondary offering",
  summary: "The issuer disclosed new share supply.",
  symbolHints: ["FRHC"],
  companyHints: ["Freedom Holding Corp."],
})]);
assert.equal(exactIssuer.candidates.some((item) => item.ticker === "FRHC" && item.relationship === "direct" && item.eventFamily === "financing_dilution"), true);

const exactIntelIssuer = build([receipt({
  title: "Intel launches a new semiconductor processor",
})]);
assert.equal(exactIntelIssuer.candidates.some((item) => item.ticker === "INTC" && item.relationship === "direct" && item.eventFamily === "product_launch"), true);

const exactSingleTokenBrand = build([receipt({
  title: "Apple launches a new product platform",
})]);
assert.equal(exactSingleTokenBrand.candidates.some((item) => item.ticker === "AAPL" && item.relationship === "direct" && item.eventFamily === "product_launch"), true);

console.log(JSON.stringify({
  ok: true,
  warAnniversaryRejected: true,
  departmentNameNotConflict: true,
  genericCompanyWordRejected: true,
  timeZoneWordNotIssuer: true,
  wordSenseNotIssuer: true,
  unrelatedSameFirstWordIssuerRejected: true,
  passiveStakeArticleRejectedAsNoise: true,
  activeConflictStillMapped: true,
  knockOnCanQualifyWithoutHistory: true,
  exactTickerAndCompanyStillMapped: true,
  exactIntelIssuerStillMapped: true,
  exactSingleTokenBrandStillMapped: true,
}, null, 2));
