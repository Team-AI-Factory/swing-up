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

const entry = (ticker, name, aliases = [], cik = null) => ({ ticker, name, exchange: "NASDAQ", cik, aliases, securityType: "common_stock", sourceNames: ["test official universe"] });
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
    entry("DAL", "Delta Air Lines, Inc.", ["Delta Air Lines", "Delta"]),
    entry("JPM", "JPMorgan Chase & Co.", ["JPMorgan Chase", "JPMorgan"]),
    entry("RS", "Reliance, Inc.", ["Reliance"]),
    entry("AWX", "Avalon Holdings Corp.", ["Avalon"]),
    entry("GOOGL", "Alphabet Inc.", ["Alphabet"]),
    entry("AAPL", "Apple Inc.", ["Apple"]),
    entry("JYNT", "JOINT Corp", ["The Joint"]),
    entry("MAA", "MID AMERICA APARTMENT COMMUNITIES INC.", ["Mid-America Apartment Communities"]),
    entry("MAA-PI", "MID AMERICA APARTMENT COMMUNITIES INC.", ["Mid-America Apartment Communities"]),
    entry("MAAI", "MID AMERICA APARTMENT COMMUNITIES INC.", ["Mid-America Apartment Communities"]),
    entry("CNMD", "CONMED Corp", ["Conmed"]),
    entry("CAPR", "Capricor Therapeutics Inc.", ["Capricor Therapeutics", "Capricor"]),
    entry("TWST", "TWIST BIOSCIENCE CORP", ["Twist Bioscience"], "0001581280"),
    entry("DTST", "DATA STORAGE CORP", ["Data Storage"], "0001419951"),
    entry("ATKR", "ATKORE INC", ["Atkore"], "0001666138"),
    entry("PRYMF", "PRYSMIAN S.P.A.", ["Prysmian"], "0001992536"),
    entry("INDV", "INDIVIOR PLC", ["Indivior"], "0001625297"),
  ],
  coverage: { nasdaqRows: 11, otherExchangeRows: 0, eligibleEquities: 11, cikMapped: 0, cikMappedPercent: 0, adrCount: 0, excludedByReason: {} },
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
const build = (receipts, historicalSignals = []) => analysis.buildImpactCandidates(receipts, universe, macro, new Date("2026-07-22T13:00:00.000Z"), historicalSignals);

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

const genericJointGuidance = build([receipt({
  title: "CISA publishes joint guidance for corporate software users",
  summary: "The agencies jointly report minimum software bill of materials elements.",
  channel: "federal_register",
})]);
assert.equal(genericJointGuidance.candidates.some((item) => item.ticker === "JYNT"), false);

const explicitMaaTicker = build([receipt({
  title: "Mid-America Apartment Communities (NYSE:MAA) beats expectations",
  summary: "The company reports quarterly earnings.",
  channel: "google_news_rss",
  official: false,
  primarySource: false,
  symbolHints: ["MAA"],
  companyHints: ["MID AMERICA APARTMENT COMMUNITIES INC."],
})]);
assert.deepEqual([...new Set(explicitMaaTicker.candidates.map((item) => item.ticker))], ["MAA"]);

const neutralConmedForecast = build([receipt({
  title: "Conmed forecasts 2026 adjusted EPS of $4.48 to $4.60 while targeting 5% to 6% organic growth",
  summary: "Management also discussed tariff exposure during the call.",
  channel: "google_news_rss",
  official: false,
  primarySource: false,
  symbolHints: ["CNMD"],
  companyHints: ["CONMED Corp"],
})]);
assert.equal(neutralConmedForecast.candidates.some((item) => item.eventFamily === "sanctions_trade"), false);
assert.equal(neutralConmedForecast.diagnostics.directionUnknown, 1);

const twistSecResults = build([receipt({
  title: "8-K - TWIST BIOSCIENCE CORP (0001581280) (Filer)",
  summary: "Official SEC 8-K filing by TWIST BIOSCIENCE CORP. Official filing content: Exhibit 99.1 Twist Bioscience Reports Fiscal Third Quarter 2026 Financial Results. Record revenue was $118.4 million and full-year 2026 guidance was raised. The release later describes the Atlas Data Storage solution and excludes litigation settlement costs from a non-GAAP measure.",
  url: "https://www.sec.gov/Archives/edgar/data/1581280/000158128026000101/twist-20260803x8k-index.htm",
  publisher: "U.S. Securities and Exchange Commission",
  channel: "sec_current_filings",
  official: true,
  primarySource: true,
  companyHints: ["TWIST BIOSCIENCE CORP", "CIK0001581280"],
  rawEventType: "8-K",
})]);
assert.deepEqual([...new Set(twistSecResults.candidates.map((item) => item.ticker))], ["TWST"]);
assert.equal(twistSecResults.candidates[0]?.eventFamily, "earnings_guidance");
assert.equal(twistSecResults.candidates[0]?.direction, "upside");

const atkoreSecTransaction = build([receipt({
  title: "8-K - ATKORE INC (0001666138) (Filer)",
  summary: "Official SEC 8-K filing by ATKORE INC. Official filing content: Exhibit 99.1 Atkore Announces Third Quarter 2026 Results. Atkore entered into a definitive agreement to be acquired by Prysmian for $95.00 per share, representing an enterprise value of $3.8 billion. The release later reports a $50 million litigation settlement charge.",
  url: "https://www.sec.gov/Archives/edgar/data/1666138/000166613826000101/atkore-20260803x8k-index.htm",
  publisher: "U.S. Securities and Exchange Commission",
  channel: "sec_current_filings",
  official: true,
  primarySource: true,
  companyHints: ["ATKORE INC", "CIK0001666138"],
  rawEventType: "8-K",
})]);
assert.deepEqual([...new Set(atkoreSecTransaction.candidates.map((item) => item.ticker))], ["ATKR"]);
assert.equal(atkoreSecTransaction.candidates[0]?.eventFamily, "merger_acquisition");
assert.equal(atkoreSecTransaction.candidates[0]?.direction, "upside");

const indiviorSecResults = build([receipt({
  title: "8-K - INDIVIOR PLC (0001625297) (Filer)",
  summary: "Official SEC 8-K filing by INDIVIOR PLC. Official filing content: Indivior Reports Second Quarter 2026 Financial Results. The risk discussion later refers to possible tariffs, sanctions, and trade restrictions.",
  url: "https://www.sec.gov/Archives/edgar/data/1625297/000162529726000101/indivior-20260803x8k-index.htm",
  publisher: "U.S. Securities and Exchange Commission",
  channel: "sec_current_filings",
  official: true,
  primarySource: true,
  companyHints: ["INDIVIOR PLC", "CIK0001625297"],
  rawEventType: "8-K",
})]);
assert.equal(indiviorSecResults.candidates.some((item) => item.eventFamily === "sanctions_trade"), false);
assert.equal(indiviorSecResults.diagnostics.directionUnknown, 1);

const unknownSecIssuer = build([receipt({
  title: "8-K - UNKNOWN ISSUER (0009999999) (Filer)",
  summary: "Official SEC 8-K filing. Official filing content: Apple Inc. raises guidance and reports record revenue.",
  url: "https://www.sec.gov/Archives/edgar/data/9999999/000999999926000101/unknown-20260803x8k-index.htm",
  publisher: "U.S. Securities and Exchange Commission",
  channel: "sec_current_filings",
  official: true,
  primarySource: true,
  companyHints: ["UNKNOWN ISSUER", "CIK0009999999"],
  rawEventType: "8-K",
})]);
assert.equal(unknownSecIssuer.candidates.some((item) => item.ticker === "AAPL"), false);

const missingSecCik = build([receipt({
  title: "8-K - UNMAPPED ISSUER (Filer)",
  summary: "Official SEC 8-K filing. Official filing content: Apple Inc. raises guidance and reports record revenue.",
  url: "https://www.sec.gov/Archives/edgar/data/9999998/000999999826000101/unmapped-20260803x8k-index.htm",
  publisher: "U.S. Securities and Exchange Commission",
  channel: "sec_current_filings",
  official: true,
  primarySource: true,
  companyHints: ["UNMAPPED ISSUER"],
  rawEventType: "8-K",
})]);
assert.equal(missingSecCik.candidates.some((item) => item.ticker === "AAPL"), false);

const realTariffPolicy = build([receipt({
  title: "Government imposes new medical-device tariffs and trade restrictions on CONMED",
  summary: "The tariff policy affects CONMED's imported devices.",
  channel: "federal_register",
  symbolHints: ["CNMD"],
  companyHints: ["CONMED Corp"],
})]);
assert.equal(realTariffPolicy.candidates.some((item) => item.eventFamily === "sanctions_trade"), true);

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
assert.equal(conflictKnockOn?.causalExposure.status, "generic_sector_proxy");
assert.equal(conflictKnockOn?.gateChecks.knockOnCausalPathVerified, false);
assert.equal(conflictKnockOn?.gatePassed, false);

const vaguePrimaryCompanyMention = build([receipt({
  title: "Official notice: military strikes close a Red Sea shipping route",
  summary: "The notice mentions Exxon Mobil Corporation but contains no company-specific exposure size or effect direction.",
  companyHints: ["Exxon Mobil Corporation"],
})]);
const vaguePrimaryCandidate = vaguePrimaryCompanyMention.candidates.find((item) => item.ticker === "XOM");
assert.equal(vaguePrimaryCandidate?.relationship, "second_order");
assert.equal(vaguePrimaryCandidate?.causalExposure.status, "generic_sector_proxy");
assert.equal(vaguePrimaryCandidate?.causalExposure.eligibleForSeriousSignal, false);
assert.equal(vaguePrimaryCandidate?.gateChecks.knockOnCausalPathVerified, false);
assert.equal(vaguePrimaryCandidate?.gatePassed, false);

const companySpecificConflictExposure = build([receipt({
  title: "Military strikes close a Red Sea shipping route as conflict escalates",
  summary: "Exxon Mobil Corporation derives 25% of its revenue from operations exposed to the affected route, creating a direct disclosed disruption risk.",
  channel: "defense_department",
  companyHints: ["Exxon Mobil Corporation"],
})]);
const verifiedExposure = companySpecificConflictExposure.candidates.find((item) => item.ticker === "XOM" && item.causalExposure.status === "event_specific");
assert.equal(verifiedExposure?.causalExposure.status, "event_specific");
assert.equal(verifiedExposure?.causalExposure.eligibleForSeriousSignal, true);
assert.equal(verifiedExposure?.gateChecks.knockOnCausalPathVerified, true);
assert.equal(verifiedExposure?.gatePassed, true);

const independentlyVerifiedExposure = build([
  receipt({
    title: "Red Sea military strikes close a shipping route",
    summary: "Exxon Mobil Corporation derives 25% of its revenue from operations exposed to the affected route, and the disruption is expected to reduce revenue.",
    publisher: "Independent Energy Desk",
    url: "https://news-one.example/red-sea-route",
    channel: "google_news_rss",
    official: false,
    primarySource: false,
    companyHints: ["Exxon Mobil Corporation"],
    rawEventType: "red-sea-route-20260722",
  }),
  receipt({
    title: "Shipping disruption follows military strikes in Red Sea",
    summary: "Exxon Mobil Corporation derives 25% of its revenue from operations using the affected route, and the disruption is expected to reduce revenue.",
    publisher: "Independent Logistics Desk",
    url: "https://news-two.example/shipping-disruption",
    channel: "marketaux",
    official: false,
    primarySource: false,
    companyHints: ["Exxon Mobil Corporation"],
    rawEventType: "red-sea-route-20260722",
  }),
]);
const corroboratedExposure = independentlyVerifiedExposure.candidates.find((item) => item.ticker === "XOM" && item.causalExposure.status === "event_specific");
assert.equal(corroboratedExposure?.independentPublishers, 2);
assert.equal(corroboratedExposure?.causalExposure.eligibleForSeriousSignal, true);
assert.equal(corroboratedExposure?.gateChecks.knockOnCausalPathVerified, true);
assert.equal(corroboratedExposure?.gatePassed, true);

const vaguePrimaryDoesNotValidateExposure = build([
  receipt({
    title: "Official notice: military strikes close a Red Sea shipping route",
    summary: "The notice mentions Exxon Mobil Corporation but contains no quantified company exposure.",
    publisher: "Official Source",
    url: "https://official.example/red-sea-route",
    companyHints: ["Exxon Mobil Corporation"],
    rawEventType: "red-sea-route-vague-20260722",
  }),
  receipt({
    title: "Publisher estimates Exxon exposure after Red Sea military strikes",
    summary: "Exxon Mobil Corporation derives 25% of its revenue from operations exposed to the affected route, and the disruption is expected to reduce revenue.",
    publisher: "Single Secondary Desk",
    url: "https://single-secondary.example/exposure",
    channel: "google_news_rss",
    official: false,
    primarySource: false,
    companyHints: ["Exxon Mobil Corporation"],
    rawEventType: "red-sea-route-vague-20260722",
  }),
]);
const singleSecondaryExposure = vaguePrimaryDoesNotValidateExposure.candidates.find((item) => item.ticker === "XOM" && item.causalExposure.status === "event_specific");
assert.equal(singleSecondaryExposure?.causalExposure.eligibleForSeriousSignal, false);
assert.equal(singleSecondaryExposure?.gateChecks.knockOnCausalPathVerified, false);
assert.equal(singleSecondaryExposure?.gatePassed, false);

const airlineFuelExposure = build([receipt({
  title: "Oil prices surge after pipeline disruption",
  summary: "Delta Air Lines reports fuel costs represent 25% of operating expense, and higher oil prices will increase fuel costs and pressure margins.",
  publisher: "Delta Air Lines",
  url: "https://delta.example/fuel-exposure",
  companyHints: ["Delta Air Lines"],
})]);
const airlineEffect = airlineFuelExposure.candidates.find((item) => item.ticker === "DAL" && item.causalExposure.status === "event_specific");
assert.equal(airlineEffect?.direction, "downside");
assert.equal(airlineEffect?.causalExposure.sensitivityDirection, "downside");
assert.equal(airlineEffect?.causalExposure.eligibleForSeriousSignal, true);

const unsignedFuelExposure = build([receipt({
  title: "Oil prices surge after pipeline disruption",
  summary: "Delta Air Lines reports fuel costs represent 25% of operating expense.",
  publisher: "Delta Air Lines",
  url: "https://delta.example/unsigned-fuel-exposure",
  companyHints: ["Delta Air Lines"],
})]);
const unsignedAirlineEffect = unsignedFuelExposure.candidates.find((item) => item.ticker === "DAL" && item.causalExposure.status === "event_specific");
assert.equal(unsignedAirlineEffect?.causalExposure.sensitivityDirection, null);
assert.equal(unsignedAirlineEffect?.causalExposure.eligibleForSeriousSignal, false);
assert.equal(unsignedAirlineEffect?.gatePassed, false);

const bankRateExposure = build([receipt({
  title: "Federal Reserve raises interest rate",
  summary: "JPMorgan Chase reports 20% policy exposure and expects net interest margin and profit to increase after the rate hike.",
  publisher: "JPMorgan Chase",
  url: "https://jpmorgan.example/rate-exposure",
  companyHints: ["JPMorgan Chase"],
})]);
const bankEffect = bankRateExposure.candidates.find((item) => item.ticker === "JPM" && item.causalExposure.status === "event_specific");
assert.equal(bankEffect?.direction, "upside");
assert.equal(bankEffect?.causalExposure.sensitivityDirection, "upside");
assert.equal(bankEffect?.causalExposure.eligibleForSeriousSignal, true);

const exactIssuer = build([receipt({
  title: "Freedom Holding Corp. announces a secondary offering",
  summary: "The issuer disclosed new share supply.",
  symbolHints: ["FRHC"],
  companyHints: ["Freedom Holding Corp."],
})]);
assert.equal(exactIssuer.candidates.some((item) => item.ticker === "FRHC" && item.relationship === "direct" && item.eventFamily === "financing_dilution"), true);
assert.equal(exactIssuer.candidates.find((item) => item.ticker === "FRHC")?.gatePassed, false);

const syndicatedOfferingReceipts = [
  receipt({
    title: "Apple priced a public offering of 10 million new shares",
    summary: "The issuer priced 10 million new shares.",
    publisher: "Apple Inc.",
    url: "https://issuer.example/apple-offering",
    publishedAt: "2026-07-22T05:15:00.000Z",
    symbolHints: ["AAPL"],
    companyHints: ["Apple Inc."],
  }),
  receipt({
    title: "AAPL completes sale of 10m new shares",
    summary: "Apple completed its public offering of 10 million new shares.",
    publisher: "Independent Capital News",
    url: "https://capital-news.example/aapl-sale",
    publishedAt: "2026-07-22T12:15:00.000Z",
    channel: "google_news_rss",
    official: false,
    primarySource: false,
    symbolHints: ["AAPL"],
    companyHints: ["Apple Inc."],
  }),
];
const syndicatedOffering = build(syndicatedOfferingReceipts);
const reversedSyndicatedOffering = build([...syndicatedOfferingReceipts].reverse());
const syndicatedCandidates = syndicatedOffering.candidates.filter((item) => item.ticker === "AAPL" && item.eventFamily === "financing_dilution");
assert.equal(syndicatedCandidates.length, 1);
assert.equal(syndicatedCandidates[0].independentPublishers, 2);
assert.equal(syndicatedCandidates[0].rootEventKey, reversedSyndicatedOffering.candidates.find((item) => item.ticker === "AAPL" && item.eventFamily === "financing_dilution")?.rootEventKey);

const distinctSameDayContracts = build([
  receipt({
    title: "Apple awarded a $100 million contract for cloud services",
    summary: "The first committed contract covers cloud services.",
    url: "https://issuer.example/apple-cloud-contract",
    publishedAt: "2026-07-22T08:00:00.000Z",
    symbolHints: ["AAPL"],
    companyHints: ["Apple Inc."],
    rawEventType: "8-K",
  }),
  receipt({
    title: "Apple awarded a $100 million contract for device services",
    summary: "The second committed contract covers device services.",
    url: "https://issuer.example/apple-device-contract",
    publishedAt: "2026-07-22T13:00:00.000Z",
    symbolHints: ["AAPL"],
    companyHints: ["Apple Inc."],
    rawEventType: "8-K",
  }),
]);
const distinctContractCandidates = distinctSameDayContracts.candidates.filter((item) => item.ticker === "AAPL" && item.eventFamily === "contract_award");
assert.equal(distinctContractCandidates.length, 2);
assert.equal(new Set(distinctContractCandidates.map((item) => item.rootEventKey)).size, 2);

const distinctFiledContracts = build([
  receipt({
    title: "Apple awarded a $100 million contract for cloud services",
    summary: "The committed contract has accession 0000320193-26-000101.",
    url: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000101/apple-a.htm",
    publishedAt: "2026-07-22T08:00:00.000Z",
    symbolHints: ["AAPL"],
    companyHints: ["Apple Inc."],
    rawEventType: "8-K",
  }),
  receipt({
    title: "Apple awarded a $100 million contract for device services",
    summary: "The committed contract has accession 0000320193-26-000102.",
    url: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000102/apple-b.htm",
    publishedAt: "2026-07-22T13:00:00.000Z",
    symbolHints: ["AAPL"],
    companyHints: ["Apple Inc."],
    rawEventType: "8-K",
  }),
]);
const filedContractCandidates = distinctFiledContracts.candidates.filter((item) => item.ticker === "AAPL" && item.eventFamily === "contract_award");
assert.equal(filedContractCandidates.length, 2);
assert.equal(new Set(filedContractCandidates.map((item) => item.rootEventKey)).size, 2);

const materialContractReceipt = receipt({
  title: "Apple wins contract, a five-year award valued at $500 million",
  summary: "The committed contract was awarded to Apple.",
  symbolHints: ["AAPL"],
  companyHints: ["Apple Inc."],
});
const contractBeforeScale = build([materialContractReceipt]).candidates.find((item) => item.ticker === "AAPL");
assert.ok(contractBeforeScale);
assert.equal(contractBeforeScale.gateChecks.eventMagnitudeActionable, false);
assert.equal(contractBeforeScale.trackingDisposition, "shadow_near_miss");
contractBeforeScale.eventMagnitude.relativeToCompany = {
  metric: "annual_revenue",
  eventValue: 500_000_000,
  eventMetricSourceReceiptId: contractBeforeScale.eventMagnitude.metrics[0].sourceReceiptId,
  companyValue: 1_000_000_000,
  ratioPercent: 50,
  sourceUrl: "https://data.sec.gov/example",
};
contractBeforeScale.eventMagnitude.status = "relative_to_company";
analysis.reassessCandidateAfterFundamentals(contractBeforeScale, new Date("2026-07-22T13:00:00.000Z"));
assert.equal(contractBeforeScale.gateChecks.eventMagnitudeActionable, true);
assert.equal(contractBeforeScale.gatePassed, true);

const winsAmountBeforeContract = build([receipt({
  title: "Apple wins $500 million contract",
  summary: "The committed award was announced by Apple.",
  symbolHints: ["AAPL"],
  companyHints: ["Apple Inc."],
})]).candidates.find((item) => item.ticker === "AAPL");
assert.equal(winsAmountBeforeContract?.eventFamily, "contract_award");
assert.equal(winsAmountBeforeContract?.eventMagnitude.metrics.find((item) => item.kind === "contract_value")?.value, 500_000_000);
assert.equal(winsAmountBeforeContract?.trackingDisposition, "shadow_near_miss");

const awardedAmountBeforeContract = build([receipt({
  title: "Apple awarded a $100 million contract",
  summary: "The committed award was announced by Apple.",
  symbolHints: ["AAPL"],
  companyHints: ["Apple Inc."],
})]).candidates.find((item) => item.ticker === "AAPL");
assert.equal(awardedAmountBeforeContract?.eventFamily, "contract_award");
assert.equal(awardedAmountBeforeContract?.eventMagnitude.metrics.find((item) => item.kind === "contract_value")?.value, 100_000_000);

const smallContract = build([receipt({
  title: "Apple wins contract, a five-year award valued at $5 million",
  summary: "The committed contract was awarded to Apple.",
  symbolHints: ["AAPL"],
  companyHints: ["Apple Inc."],
})]).candidates.find((item) => item.ticker === "AAPL");
assert.ok(smallContract);
smallContract.eventMagnitude.relativeToCompany = {
  metric: "annual_revenue",
  eventValue: 5_000_000,
  eventMetricSourceReceiptId: smallContract.eventMagnitude.metrics[0].sourceReceiptId,
  companyValue: 1_000_000_000,
  ratioPercent: 0.5,
  sourceUrl: "https://data.sec.gov/example",
};
smallContract.eventMagnitude.status = "relative_to_company";
analysis.reassessCandidateAfterFundamentals(smallContract, new Date("2026-07-22T13:00:00.000Z"));
assert.equal(smallContract.gateChecks.eventMagnitudeActionable, false);
assert.equal(smallContract.gatePassed, false);

const pricedDilution = build([receipt({
  title: "Freedom Holding Corp. priced a primary share offering with dilution of 20%",
  summary: "The company completed the primary offering.",
  symbolHints: ["FRHC"],
  companyHints: ["Freedom Holding Corp."],
})]).candidates.find((item) => item.ticker === "FRHC");
assert.equal(pricedDilution?.gateChecks.eventMagnitudeActionable, true);
assert.equal(pricedDilution?.gatePassed, true);
assert.equal(pricedDilution?.eventMagnitude.metrics.find((item) => item.kind === "dilution_percent")?.promotionEvidenceVerified, true);

const proposedPrimaryOffering = build([receipt({
  title: "Freedom Holding announces proposed primary offering of 20 million new shares",
  summary: "The company plans to issue the shares if the offering is priced later.",
  symbolHints: ["FRHC"],
  companyHints: ["Freedom Holding Corp."],
})]).candidates.find((item) => item.ticker === "FRHC");
assert.ok(proposedPrimaryOffering);
assert.equal(proposedPrimaryOffering.eventFamily, "financing_proposal");
const proposedSharesMetric = proposedPrimaryOffering.eventMagnitude.metrics.find((item) => item.kind === "offering_shares");
assert.ok(proposedSharesMetric);
assert.equal(proposedSharesMetric.eventStatus, "proposed");
proposedPrimaryOffering.eventMagnitude.relativeToCompany = {
  metric: "shares_outstanding",
  eventValue: proposedSharesMetric.value,
  eventMetricSourceReceiptId: proposedSharesMetric.sourceReceiptId,
  companyValue: 100_000_000,
  ratioPercent: 20,
  sourceUrl: "https://data.sec.gov/example",
};
proposedPrimaryOffering.eventMagnitude.status = "relative_to_company";
analysis.reassessCandidateAfterFundamentals(proposedPrimaryOffering, new Date("2026-07-22T13:00:00.000Z"));
assert.equal(proposedPrimaryOffering.gateChecks.eventMagnitudeActionable, true);
assert.equal(proposedPrimaryOffering.gatePassed, true);

for (const [id, title] of [
  ["plans-offer", "Freedom Holding plans to offer 20 million new shares in a proposed public offering"],
  ["plans-issue", "Freedom Holding plans to issue 20 million new shares through a proposed public offering"],
  ["announces-sell", "Freedom Holding announces plans to sell 20 million new shares in a public offering"],
]) {
  const actionBeforeOffering = build([receipt({
    title,
    summary: "Final price terms will be determined later.",
    symbolHints: ["FRHC"],
    companyHints: ["Freedom Holding Corp."],
  })]).candidates.find((item) => item.ticker === "FRHC");
  assert.ok(actionBeforeOffering, id);
  assert.equal(actionBeforeOffering.eventFamily, "financing_proposal", id);
  assert.equal(actionBeforeOffering.gatePassed, true, id);
}

for (const [id, owner] of [
  ["selling-stockholders", "Selling stockholders"],
  ["existing-shareholders", "Existing shareholders"],
  ["certain-shareholders", "Certain shareholders"],
]) {
  const secondarySale = build([receipt({
    title: `${owner} plan to sell 20 million shares in a proposed public offering`,
    summary: "The company will not receive any proceeds from the sale.",
    symbolHints: ["FRHC"],
    companyHints: ["Freedom Holding Corp."],
  })]);
  assert.equal(secondarySale.candidates.some((item) => item.eventFamily === "financing_proposal"), false, id);
}

for (const [id, ownerAction] of [
  ["major-shareholder-plans", "A major shareholder plans"],
  ["shareholder-intends", "A shareholder intends"],
  ["stockholder-seeks", "A stockholder seeks"],
]) {
  const inflectedHolderSale = build([receipt({
    title: `${ownerAction} to sell 5 million shares in a proposed public offering`,
    summary: "Final price terms have not been disclosed.",
    symbolHints: ["FRHC"],
    companyHints: ["Freedom Holding Corp."],
  })]);
  assert.equal(inflectedHolderSale.candidates.some((item) => item.eventFamily === "financing_proposal"), false, id);
}

for (const [id, ownerAction] of [
  ["shareholder-proposes", "A shareholder proposes"],
  ["major-stockholder-proposes", "A major stockholder proposes"],
  ["shareholder-announces-plans", "A shareholder announces plans"],
]) {
  const holderProposalVerb = build([receipt({
    title: `${ownerAction} to sell 5 million shares in a public offering`,
    summary: "Final price terms have not been disclosed.",
    symbolHints: ["FRHC"],
    companyHints: ["Freedom Holding Corp."],
  })]);
  assert.equal(holderProposalVerb.candidates.some((item) => item.eventFamily === "financing_proposal"), false, id);
}

const issuerProposalAfterShareholderApproval = build([receipt({
  title: "Shareholders approve Freedom Holding plans to sell 20 million new shares in a proposed public offering",
  summary: "The company expects to receive the net proceeds.",
  symbolHints: ["FRHC"],
  companyHints: ["Freedom Holding Corp."],
})]).candidates.find((item) => item.ticker === "FRHC");
assert.ok(issuerProposalAfterShareholderApproval);
assert.equal(issuerProposalAfterShareholderApproval.eventFamily, "financing_proposal");
assert.equal(issuerProposalAfterShareholderApproval.gatePassed, true);

const holderSaleOfPreviouslyIssuedShares = build([receipt({
  title: "Selling stockholders plan to sell 20 million newly issued shares in a proposed public offering",
  summary: "The selling stockholders will receive the proceeds.",
  symbolHints: ["FRHC"],
  companyHints: ["Freedom Holding Corp."],
})]);
assert.equal(holderSaleOfPreviouslyIssuedShares.candidates.some((item) => item.eventFamily === "financing_proposal"), false);

const negatedIssuerSupplyWithHolderSale = build([receipt({
  title: "Freedom Holding confirms no new shares will be issued; existing shareholders plan to sell 20 million shares in a proposed public offering",
  summary: "The company will receive no proceeds from the shares sold by existing shareholders.",
  symbolHints: ["FRHC"],
  companyHints: ["Freedom Holding Corp."],
})]);
assert.equal(negatedIssuerSupplyWithHolderSale.candidates.some((item) => item.eventFamily === "financing_proposal"), false);

const activeNegatedIssuerSupplyWithHolderSale = build([receipt({
  title: "Freedom Holding will issue no new shares; existing shareholders plan to sell 20 million shares in a proposed public offering",
  summary: "The company will receive no proceeds from the shares sold by existing shareholders.",
  symbolHints: ["FRHC"],
  companyHints: ["Freedom Holding Corp."],
})]);
assert.equal(activeNegatedIssuerSupplyWithHolderSale.candidates.some((item) => item.eventFamily === "financing_proposal"), false);

const holderAssignedNewShares = build([receipt({
  title: "Freedom Holding announces proposed offering of 20 million new shares to be sold by existing shareholders",
  summary: "The company will not receive proceeds from shares sold by existing shareholders.",
  symbolHints: ["FRHC"],
  companyHints: ["Freedom Holding Corp."],
})]);
assert.equal(holderAssignedNewShares.candidates.some((item) => item.eventFamily === "financing_proposal"), false);

for (const [id, proceedsLanguage] of [
  ["warrant-exercise-proceeds", "The company expects to receive proceeds upon exercise of outstanding warrants but will not receive proceeds from shares sold by selling stockholders."],
  ["conditional-warrant-proceeds", "The company will receive proceeds only if warrants are exercised and will not receive proceeds from the offered shares."],
]) {
  const holderSaleWithUnrelatedProceeds = build([receipt({
    title: "Selling stockholders plan to sell 5 million shares in a proposed public offering",
    summary: proceedsLanguage,
    symbolHints: ["FRHC"],
    companyHints: ["Freedom Holding Corp."],
  })]);
  assert.equal(holderSaleWithUnrelatedProceeds.candidates.some((item) => item.eventFamily === "financing_proposal"), false, id);
}

for (const [id, summary] of [
  ["receive-no-proceeds", "The company will receive no proceeds from the offering."],
  ["not-any-of-proceeds", "The company will not receive any of the proceeds from the offering."],
]) {
  const noIssuerProceeds = build([receipt({
    title: "Freedom Holding announces proposed public offering of 20 million common shares",
    summary,
    symbolHints: ["FRHC"],
    companyHints: ["Freedom Holding Corp."],
  })]);
  assert.equal(noIssuerProceeds.candidates.some((item) => item.eventFamily === "financing_proposal"), false, id);
}

const issuerShareSale = build([receipt({
  title: "Freedom Holding plans to sell 20 million newly issued shares in a proposed public offering",
  summary: "The company expects to receive the net proceeds; final price terms will be determined later.",
  symbolHints: ["FRHC"],
  companyHints: ["Freedom Holding Corp."],
})]).candidates.find((item) => item.ticker === "FRHC");
assert.ok(issuerShareSale);
assert.equal(issuerShareSale.eventFamily, "financing_proposal");
assert.equal(issuerShareSale.gatePassed, true);

for (const [id, title, summary] of [
  [
    "mixed-issuer-and-selling-stockholders",
    "Freedom Holding plans to issue 20 million new shares and selling stockholders plan to sell 5 million shares in a proposed public offering",
    "The company expects to receive proceeds from the issuer tranche but not from the holder tranche.",
  ],
  [
    "mixed-new-and-existing-shares",
    "Freedom Holding announces proposed offering of 20 million new shares plus 5 million shares by existing shareholders",
    "The company will not receive any proceeds from the shares sold by existing shareholders.",
  ],
]) {
  const mixedGenericOffering = build([receipt({
    title,
    summary,
    symbolHints: ["FRHC"],
    companyHints: ["Freedom Holding Corp."],
  })]).candidates.find((item) => item.ticker === "FRHC");
  assert.ok(mixedGenericOffering, id);
  assert.equal(mixedGenericOffering.eventFamily, "financing_proposal", id);
  assert.equal(mixedGenericOffering.gatePassed, true, id);
}

const proposedDebtOffering = build([receipt({
  title: "Freedom Holding announces proposed public offering of senior notes",
  summary: "The company plans to offer $500 million of senior notes.",
  symbolHints: ["FRHC"],
  companyHints: ["Freedom Holding Corp."],
})]).candidates.find((item) => item.ticker === "FRHC");
assert.ok(proposedDebtOffering);
assert.notEqual(proposedDebtOffering.eventFamily, "financing_proposal");
assert.equal(proposedDebtOffering.gatePassed, false);

for (const [id, title, summary] of [
  ["shares-fall-notes", "Freedom Holding shares fall after company announces proposed public offering of senior notes", "The company plans to offer $500 million of senior notes."],
  ["unspecified-equity-investors", "Freedom Holding announces proposed public offering", "Equity investors are evaluating the company."],
  ["unspecified-shares-fell", "Freedom Holding announces proposed public offering", "Shares fell after the announcement; terms were not disclosed."],
  ["unspecified-common-stock-investors", "Freedom Holding announces proposed public offering", "Common stock investors are evaluating the company."],
  ["comma-reaction", "Freedom Holding announces proposed public offering, sending shares lower", "Terms and securities to be offered have not yet been disclosed."],
]) {
  const contextualEquityDebt = build([receipt({
    title,
    summary,
    symbolHints: ["FRHC"],
    companyHints: ["Freedom Holding Corp."],
  })]);
  assert.equal(contextualEquityDebt.candidates.some((item) => item.eventFamily === "financing_proposal"), false, id);
}

const preliminaryProspectus = build([receipt({
  title: "424B5 - Freedom Holding Corp. (Filer)",
  summary: [
    "Official SEC 424B5 filing by Freedom Holding Corp.",
    "We are offering shares of our common stock and accompanying pre-funded warrants.",
    "The combined public offering price for each share and accompanying warrant is $ .",
    "Our common stock has $0.001 par value and its last reported sale price was $1.03.",
    "The warrant exercise price will be $ .",
    "In April, 12.5 million shares were issued and sold in an earlier offering at $1.40.",
  ].join(" "),
  url: "https://www.sec.gov/Archives/edgar/data/1000000/000100000026000001/preliminary-424b5-index.html",
  publisher: "U.S. Securities and Exchange Commission",
  channel: "sec_current_filings",
  symbolHints: ["FRHC"],
  companyHints: ["Freedom Holding Corp."],
  rawEventType: "424B5",
})]).candidates.find((item) => item.ticker === "FRHC");
assert.ok(preliminaryProspectus);
assert.equal(preliminaryProspectus.eventFamily, "financing_proposal");
assert.equal(preliminaryProspectus.gateChecks.eventMagnitudeActionable, true);
assert.equal(preliminaryProspectus.gatePassed, true);

const blankCurrentPriceWithHistoricalPrice = build([receipt({
  title: "424B5 - Freedom Holding Corp. (Filer)",
  summary: "We are offering shares of our common stock. The combined public offering price is $ . In April, the public offering price was $1.40 per share.",
  url: "https://www.sec.gov/Archives/edgar/data/1000000/000100000026000010/blank-current-price-424b5-index.html",
  publisher: "U.S. Securities and Exchange Commission",
  channel: "sec_current_filings",
  symbolHints: ["FRHC"],
  companyHints: ["Freedom Holding Corp."],
  rawEventType: "424B5",
})]).candidates.find((item) => item.ticker === "FRHC");
assert.ok(blankCurrentPriceWithHistoricalPrice);
assert.equal(blankCurrentPriceWithHistoricalPrice.eventFamily, "financing_proposal");

const undeterminedCurrentPriceWithHistoricalPrice = build([receipt({
  title: "424B5 - Freedom Holding Corp. (Filer)",
  summary: "We are offering shares of our common stock. We have commenced a public offering expected to cause dilution of 20%. The public offering price remains to be determined. In April, the public offering price was $1.40 per share.",
  url: "https://www.sec.gov/Archives/edgar/data/1000000/000100000026000012/undetermined-current-price-424b5-index.html",
  publisher: "U.S. Securities and Exchange Commission",
  channel: "sec_current_filings",
  symbolHints: ["FRHC"],
  companyHints: ["Freedom Holding Corp."],
  rawEventType: "424B5",
})]).candidates.find((item) => item.ticker === "FRHC");
assert.ok(undeterminedCurrentPriceWithHistoricalPrice);
assert.equal(undeterminedCurrentPriceWithHistoricalPrice.eventFamily, "financing_proposal");

const fixedPriceProspectus = build([receipt({
  title: "424B5 - Freedom Holding Corp. (Filer)",
  summary: "We are offering 21,052,632 shares of common stock. The combined public offering price is $0.95 per share. The company has priced this public offering.",
  url: "https://www.sec.gov/Archives/edgar/data/1000000/000100000026000002/fixed-424b5-index.html",
  publisher: "U.S. Securities and Exchange Commission",
  channel: "sec_current_filings",
  symbolHints: ["FRHC"],
  companyHints: ["Freedom Holding Corp."],
  rawEventType: "424B5",
})]).candidates.find((item) => item.ticker === "FRHC");
assert.ok(fixedPriceProspectus);
assert.equal(fixedPriceProspectus.eventFamily, "financing_dilution");

const priceRangeProspectus = build([receipt({
  title: "424B5 - Freedom Holding Corp. (Filer)",
  summary: "We are offering shares of our common stock. The public offering price is expected to be in a range between $0.90 and $1.10 per share.",
  url: "https://www.sec.gov/Archives/edgar/data/1000000/000100000026000005/range-424b5-index.html",
  publisher: "U.S. Securities and Exchange Commission",
  channel: "sec_current_filings",
  symbolHints: ["FRHC"],
  companyHints: ["Freedom Holding Corp."],
  rawEventType: "424B5",
})]).candidates.find((item) => item.ticker === "FRHC");
assert.ok(priceRangeProspectus);
assert.equal(priceRangeProspectus.eventFamily, "financing_proposal");

const formulaPriceProspectus = build([receipt({
  title: "424B5 - Freedom Holding Corp. (Filer)",
  summary: "We are offering shares of our common stock. The public offering price equals 90% of VWAP, currently $0.95 per share.",
  url: "https://www.sec.gov/Archives/edgar/data/1000000/000100000026000006/formula-424b5-index.html",
  publisher: "U.S. Securities and Exchange Commission",
  channel: "sec_current_filings",
  symbolHints: ["FRHC"],
  companyHints: ["Freedom Holding Corp."],
  rawEventType: "424B5",
})]).candidates.find((item) => item.ticker === "FRHC");
assert.ok(formulaPriceProspectus);
assert.equal(formulaPriceProspectus.eventFamily, "financing_proposal");

const pricedStatusProspectus = build([receipt({
  title: "424B5 - Freedom Holding Corp. (Filer)",
  summary: "We are offering 20 million shares of our common stock. We have priced a public offering; settlement is expected shortly.",
  url: "https://www.sec.gov/Archives/edgar/data/1000000/000100000026000007/priced-status-424b5-index.html",
  publisher: "U.S. Securities and Exchange Commission",
  channel: "sec_current_filings",
  symbolHints: ["FRHC"],
  companyHints: ["Freedom Holding Corp."],
  rawEventType: "424B5",
})]).candidates.find((item) => item.ticker === "FRHC");
assert.ok(pricedStatusProspectus);
assert.equal(pricedStatusProspectus.eventFamily, "financing_dilution");

const commencedUnpricedProspectus = build([receipt({
  title: "424B5 - Freedom Holding Corp. (Filer)",
  summary: "We are offering shares of our common stock. We have commenced a public offering, but its final pricing has not been fixed.",
  url: "https://www.sec.gov/Archives/edgar/data/1000000/000100000026000008/commenced-424b5-index.html",
  publisher: "U.S. Securities and Exchange Commission",
  channel: "sec_current_filings",
  symbolHints: ["FRHC"],
  companyHints: ["Freedom Holding Corp."],
  rawEventType: "424B5",
})]).candidates.find((item) => item.ticker === "FRHC");
assert.ok(commencedUnpricedProspectus);
assert.equal(commencedUnpricedProspectus.eventFamily, "financing_proposal");

const commencedUnpricedUnitsProspectus = build([receipt({
  title: "424B5 - Freedom Holding Corp. (Filer)",
  summary: "We are offering 5,000,000 units, each consisting of one share of common stock and one pre-funded warrant. We have commenced a public offering expected to cause dilution of 20%. The public offering price remains to be determined.",
  url: "https://www.sec.gov/Archives/edgar/data/1000000/000100000026000015/units-424b5-index.html",
  publisher: "U.S. Securities and Exchange Commission",
  channel: "sec_current_filings",
  symbolHints: ["FRHC"],
  companyHints: ["Freedom Holding Corp."],
  rawEventType: "424B5",
})]).candidates.find((item) => item.ticker === "FRHC");
assert.ok(commencedUnpricedUnitsProspectus);
assert.equal(commencedUnpricedUnitsProspectus.eventFamily, "financing_proposal");

const convertibleDebtProspectus = build([receipt({
  title: "424B5 - Freedom Holding Corp. (Filer)",
  summary: "We are offering $500 million aggregate principal amount of convertible senior notes in a proposed public offering. The notes may later be converted into shares of common stock.",
  url: "https://www.sec.gov/Archives/edgar/data/1000000/000100000026000013/convertible-notes-424b5-index.html",
  publisher: "U.S. Securities and Exchange Commission",
  channel: "sec_current_filings",
  symbolHints: ["FRHC"],
  companyHints: ["Freedom Holding Corp."],
  rawEventType: "424B5",
})]);
assert.equal(convertibleDebtProspectus.candidates.some((item) => item.eventFamily === "financing_proposal"), false);

for (const [id, offeredNotes] of [
  ["equity-linked", "equity-linked senior notes"],
  ["common-stock-linked", "common stock-linked senior notes"],
]) {
  const linkedDebtProspectus = build([receipt({
    title: "424B5 - Freedom Holding Corp. (Filer)",
    summary: `We are offering $500 million of ${offeredNotes} in a proposed public offering. The notes are unsecured debt obligations and may later reference shares of common stock.`,
    url: `https://www.sec.gov/Archives/edgar/data/1000000/000100000026000014/${id}-notes-424b5-index.html`,
    publisher: "U.S. Securities and Exchange Commission",
    channel: "sec_current_filings",
    symbolHints: ["FRHC"],
    companyHints: ["Freedom Holding Corp."],
    rawEventType: "424B5",
  })]);
  assert.equal(linkedDebtProspectus.candidates.some((item) => item.eventFamily === "financing_proposal"), false, id);
}

const mixedPrimaryAndResaleProspectus = build([receipt({
  title: "424B3 - Freedom Holding Corp. (Filer)",
  summary: "We are offering shares of our common stock at a public offering price of $ . Selling stockholders may also resell shares, and we will not receive proceeds from their shares.",
  url: "https://www.sec.gov/Archives/edgar/data/1000000/000100000026000004/mixed-424b3-index.html",
  publisher: "U.S. Securities and Exchange Commission",
  channel: "sec_current_filings",
  symbolHints: ["FRHC"],
  companyHints: ["Freedom Holding Corp."],
  rawEventType: "424B3",
})]).candidates.find((item) => item.ticker === "FRHC");
assert.ok(mixedPrimaryAndResaleProspectus);
assert.equal(mixedPrimaryAndResaleProspectus.eventFamily, "financing_proposal");

const sellingStockholderResale = build([receipt({
  title: "424B3 - Freedom Holding Corp. (Filer)",
  summary: "This prospectus relates solely to the resale of common stock by selling stockholders. Freedom Holding will not receive any proceeds and is not offering securities.",
  url: "https://www.sec.gov/Archives/edgar/data/1000000/000100000026000003/resale-424b3-index.html",
  publisher: "U.S. Securities and Exchange Commission",
  channel: "sec_current_filings",
  symbolHints: ["FRHC"],
  companyHints: ["Freedom Holding Corp."],
  rawEventType: "424B3",
})]);
assert.equal(sellingStockholderResale.candidates.some((item) => item.eventFamily === "financing_proposal"), false);

const negatedSellingStockholderResale = build([receipt({
  title: "424B3 - Freedom Holding Corp. (Filer)",
  summary: "None of the shares are being offered by us. Common stock may be resold solely by the selling stockholders.",
  url: "https://www.sec.gov/Archives/edgar/data/1000000/000100000026000009/negated-resale-424b3-index.html",
  publisher: "U.S. Securities and Exchange Commission",
  channel: "sec_current_filings",
  symbolHints: ["FRHC"],
  companyHints: ["Freedom Holding Corp."],
  rawEventType: "424B3",
})]);
assert.equal(negatedSellingStockholderResale.candidates.some((item) => item.eventFamily === "financing_proposal"), false);

for (const [id, summary] of [
  ["issuer-no-shares", "We are offering no shares of common stock. Common stock may be resold solely by selling stockholders."],
  ["no-common-stock", "No common stock is being offered by us. Common stock may be resold solely by selling stockholders."],
  ["none-common-shares", "None of the common shares are being offered by us. Common shares may be resold solely by selling stockholders."],
]) {
  const negatedResale = build([receipt({
    title: "424B3 - Freedom Holding Corp. (Filer)",
    summary,
    url: `https://www.sec.gov/Archives/edgar/data/1000000/000100000026000011/${id}-424b3-index.html`,
    publisher: "U.S. Securities and Exchange Commission",
    channel: "sec_current_filings",
    symbolHints: ["FRHC"],
    companyHints: ["Freedom Holding Corp."],
    rawEventType: "424B3",
  })]);
  assert.equal(negatedResale.candidates.some((item) => item.eventFamily === "financing_proposal"), false, id);
}

const nonSecUnpricedOffering = build([receipt({
  title: "Freedom Holding public offering",
  summary: "We are offering shares of common stock, but final price terms are not stated.",
  symbolHints: ["FRHC"],
  companyHints: ["Freedom Holding Corp."],
})]).candidates.find((item) => item.ticker === "FRHC");
assert.ok(nonSecUnpricedOffering);
assert.equal(nonSecUnpricedOffering.eventFamily, "financing_dilution");

const negativeFdaAdvisoryVote = build([receipt({
  title: "FDA advisory panel votes 9-3 against evidence of effectiveness for Capricor therapy",
  summary: "The advisory committee concluded that the available evidence does not support effectiveness. The FDA has not made its final decision.",
  url: "https://www.sec.gov/Archives/edgar/data/example/capr-8k.htm",
  publisher: "Capricor Therapeutics",
  channel: "sec_current_filings",
  symbolHints: ["CAPR"],
  companyHints: ["Capricor Therapeutics Inc."],
  rawEventType: "8-K",
})]);
const fdaWatch = negativeFdaAdvisoryVote.candidates.find((item) => item.ticker === "CAPR");
assert.equal(fdaWatch?.eventFamily, "regulatory_advisory");
assert.equal(fdaWatch?.direction, "downside");
assert.equal(fdaWatch?.gatePassed, true);

const unsupportedDilutionNumber = build([
  receipt({
    title: "Freedom Holding Corp. prices a primary offering",
    summary: "The issuer completed the primary offering without disclosing a dilution percentage here.",
    symbolHints: ["FRHC"],
    companyHints: ["Freedom Holding Corp."],
    rawEventType: "frhc-offering-unsupported",
  }),
  receipt({
    title: "Blog estimates Freedom Holding priced offering dilution at 20%",
    summary: "The blog claims the company completed a primary offering with dilution of 20%.",
    publisher: "Single Blog",
    url: "https://blog.example/frhc-dilution",
    channel: "google_news_rss",
    official: false,
    primarySource: false,
    symbolHints: ["FRHC"],
    companyHints: ["Freedom Holding Corp."],
    rawEventType: "frhc-offering-unsupported",
  }),
]).candidates.find((item) => item.ticker === "FRHC");
assert.equal(unsupportedDilutionNumber?.eventMagnitude.metrics.find((item) => item.kind === "dilution_percent")?.promotionEvidenceVerified, false);
assert.equal(unsupportedDilutionNumber?.gateChecks.eventMagnitudeActionable, false);
assert.equal(unsupportedDilutionNumber?.gatePassed, false);

const independentlyCorroboratedDilution = build([
  receipt({
    title: "Freedom Holding priced primary offering with dilution of 20%",
    summary: "The completed primary offering issued new shares.",
    publisher: "Independent Capital Desk",
    url: "https://capital.example/frhc-offering",
    channel: "google_news_rss",
    official: false,
    primarySource: false,
    symbolHints: ["FRHC"],
    companyHints: ["Freedom Holding Corp."],
    rawEventType: "frhc-offering-corroborated",
  }),
  receipt({
    title: "Completed Freedom Holding share sale creates 20% dilution",
    summary: "Freedom Holding priced the primary offering and completed it.",
    publisher: "Independent Markets Desk",
    url: "https://markets.example/frhc-offering",
    channel: "marketaux",
    official: false,
    primarySource: false,
    symbolHints: ["FRHC"],
    companyHints: ["Freedom Holding Corp."],
    rawEventType: "frhc-offering-corroborated",
  }),
]).candidates.find((item) => item.ticker === "FRHC");
assert.equal(independentlyCorroboratedDilution?.eventMagnitude.metrics.find((item) => item.kind === "dilution_percent")?.corroboratingPublishers, 2);
assert.equal(independentlyCorroboratedDilution?.gateChecks.eventMagnitudeActionable, true);
assert.equal(independentlyCorroboratedDilution?.gatePassed, true);

const pricedAfterShelf = build([
  receipt({
    title: "Freedom Holding files a shelf offering",
    summary: "The company may offer shares later.",
    publishedAt: "2026-07-22T10:00:00.000Z",
    symbolHints: ["FRHC"],
    companyHints: ["Freedom Holding Corp."],
    rawEventType: "frhc-offering-progression",
  }),
  receipt({
    title: "Freedom Holding prices primary offering with dilution of 20%",
    summary: "The company completed the primary offering.",
    publishedAt: "2026-07-22T12:30:00.000Z",
    symbolHints: ["FRHC"],
    companyHints: ["Freedom Holding Corp."],
    rawEventType: "frhc-offering-progression",
  }),
]).candidates.find((item) => item.ticker === "FRHC");
assert.equal(pricedAfterShelf?.gateChecks.eventMagnitudeActionable, true);
assert.equal(pricedAfterShelf?.gatePassed, true);

const pricedAfterProposed = build([
  receipt({
    title: "Freedom Holding announces proposed primary offering",
    summary: "The company plans to issue shares if the offering is priced later.",
    publishedAt: "2026-07-22T10:00:00.000Z",
    symbolHints: ["FRHC"],
    companyHints: ["Freedom Holding Corp."],
    rawEventType: "frhc-proposed-to-priced",
  }),
  receipt({
    title: "Freedom Holding prices primary offering with dilution of 20%",
    summary: "The company completed the primary offering.",
    publishedAt: "2026-07-22T12:30:00.000Z",
    symbolHints: ["FRHC"],
    companyHints: ["Freedom Holding Corp."],
    rawEventType: "frhc-proposed-to-priced",
  }),
]).candidates.find((item) => item.ticker === "FRHC");
assert.equal(pricedAfterProposed?.gateChecks.eventMagnitudeActionable, true);
assert.equal(pricedAfterProposed?.gatePassed, true);

const shelfAfterPriced = build([
  receipt({
    title: "Freedom Holding prices primary offering with dilution of 20%",
    summary: "The company completed the primary offering.",
    publishedAt: "2026-07-22T10:00:00.000Z",
    symbolHints: ["FRHC"],
    companyHints: ["Freedom Holding Corp."],
    rawEventType: "frhc-offering-reversed",
  }),
  receipt({
    title: "Freedom Holding files a new shelf offering",
    summary: "The company may offer shares later.",
    publishedAt: "2026-07-22T12:30:00.000Z",
    symbolHints: ["FRHC"],
    companyHints: ["Freedom Holding Corp."],
    rawEventType: "frhc-offering-reversed",
  }),
]).candidates.find((item) => item.ticker === "FRHC");
assert.equal(shelfAfterPriced?.gateChecks.eventMagnitudeActionable, false);
assert.equal(shelfAfterPriced?.gatePassed, false);

const vagueGuidance = build([receipt({
  title: "Apple raises guidance",
  symbolHints: ["AAPL"],
  companyHints: ["Apple Inc."],
})]).candidates.find((item) => item.ticker === "AAPL");
assert.equal(vagueGuidance?.gateChecks.eventMagnitudeActionable, false);
assert.equal(vagueGuidance?.gatePassed, false);

const measuredGuidance = build([receipt({
  title: "Apple raises guidance by 6%",
  symbolHints: ["AAPL"],
  companyHints: ["Apple Inc."],
})]).candidates.find((item) => item.ticker === "AAPL");
assert.equal(measuredGuidance?.gateChecks.eventMagnitudeActionable, true);
assert.equal(measuredGuidance?.gatePassed, true);

const investigation = build([receipt({
  title: "Government opens investigation into Apple",
  symbolHints: ["AAPL"],
  companyHints: ["Apple Inc."],
})]).candidates.find((item) => item.ticker === "AAPL");
assert.equal(investigation?.gateChecks.eventMagnitudeActionable, false);
assert.equal(investigation?.gatePassed, false);

const possibleFraudCharges = build([receipt({
  title: "Government opens investigation into possible fraud charges against Apple",
  symbolHints: ["AAPL"],
  companyHints: ["Apple Inc."],
})]).candidates.find((item) => item.ticker === "AAPL");
assert.equal(possibleFraudCharges?.gateChecks.eventMagnitudeActionable, false);
assert.equal(possibleFraudCharges?.gatePassed, false);

const possiblePenalty = build([receipt({
  title: "Regulator is considering a possible penalty of $100 million for Apple",
  symbolHints: ["AAPL"],
  companyHints: ["Apple Inc."],
})]).candidates.find((item) => item.ticker === "AAPL");
assert.equal(possiblePenalty?.eventMagnitude.metrics.find((item) => item.kind === "fine_value")?.eventStatus, "proposed");
assert.equal(possiblePenalty?.gateChecks.eventMagnitudeActionable, false);
assert.equal(possiblePenalty?.gatePassed, false);

const possibleRecall = build([receipt({
  title: "FDA opens investigation into a possible Class I recall for Apple",
  symbolHints: ["AAPL"],
  companyHints: ["Apple Inc."],
})]).candidates.find((item) => item.ticker === "AAPL");
assert.equal(possibleRecall?.gateChecks.eventMagnitudeActionable, false);
assert.equal(possibleRecall?.gatePassed, false);

const consideringClinicalHold = build([receipt({
  title: "FDA is considering a clinical hold for Apple trial",
  symbolHints: ["AAPL"],
  companyHints: ["Apple Inc."],
})]).candidates.find((item) => item.ticker === "AAPL");
assert.equal(consideringClinicalHold?.gateChecks.eventMagnitudeActionable, false);
assert.equal(consideringClinicalHold?.gatePassed, false);

const finalCharge = build([receipt({
  title: "SEC charges Apple in a final enforcement action",
  symbolHints: ["AAPL"],
  companyHints: ["Apple Inc."],
})]).candidates.find((item) => item.ticker === "AAPL");
assert.equal(finalCharge?.gateChecks.eventMagnitudeActionable, true);
assert.equal(finalCharge?.gatePassed, true);

const chargedAfterInvestigationText = build([receipt({
  title: "SEC charged Apple after its investigation",
  symbolHints: ["AAPL"],
  companyHints: ["Apple Inc."],
})]).candidates.find((item) => item.ticker === "AAPL");
assert.equal(chargedAfterInvestigationText?.gateChecks.eventMagnitudeActionable, true);
assert.equal(chargedAfterInvestigationText?.gatePassed, true);

const issuedFinalOrder = build([receipt({
  title: "Regulator issued final enforcement order against Apple",
  symbolHints: ["AAPL"],
  companyHints: ["Apple Inc."],
})]).candidates.find((item) => item.ticker === "AAPL");
assert.equal(issuedFinalOrder?.gateChecks.eventMagnitudeActionable, true);
assert.equal(issuedFinalOrder?.gatePassed, true);

const issuedClassOneRecall = build([receipt({
  title: "FDA issued a Class I recall for Apple product",
  symbolHints: ["AAPL"],
  companyHints: ["Apple Inc."],
})]).candidates.find((item) => item.ticker === "AAPL");
assert.equal(issuedClassOneRecall?.gateChecks.eventMagnitudeActionable, true);
assert.equal(issuedClassOneRecall?.gatePassed, true);

const placedClinicalHold = build([receipt({
  title: "FDA placed Apple trial on clinical hold",
  symbolHints: ["AAPL"],
  companyHints: ["Apple Inc."],
})]).candidates.find((item) => item.ticker === "AAPL");
assert.equal(placedClinicalHold?.gateChecks.eventMagnitudeActionable, true);
assert.equal(placedClinicalHold?.gatePassed, true);

const chargesAfterInvestigation = build([
  receipt({
    title: "Government opens investigation into Apple",
    publishedAt: "2026-07-22T10:00:00.000Z",
    symbolHints: ["AAPL"],
    companyHints: ["Apple Inc."],
    rawEventType: "apple-enforcement-progression",
  }),
  receipt({
    title: "SEC charges Apple in a filed enforcement action",
    publishedAt: "2026-07-22T12:30:00.000Z",
    symbolHints: ["AAPL"],
    companyHints: ["Apple Inc."],
    rawEventType: "apple-enforcement-progression",
  }),
]).candidates.find((item) => item.ticker === "AAPL");
assert.equal(chargesAfterInvestigation?.gateChecks.eventMagnitudeActionable, true);
assert.equal(chargesAfterInvestigation?.gatePassed, true);

const investigationAfterCharges = build([
  receipt({
    title: "SEC charges Apple in a filed enforcement action",
    publishedAt: "2026-07-22T10:00:00.000Z",
    symbolHints: ["AAPL"],
    companyHints: ["Apple Inc."],
    rawEventType: "apple-enforcement-reversed",
  }),
  receipt({
    title: "Government opens a new investigation into Apple",
    publishedAt: "2026-07-22T12:30:00.000Z",
    symbolHints: ["AAPL"],
    companyHints: ["Apple Inc."],
    rawEventType: "apple-enforcement-reversed",
  }),
]).candidates.find((item) => item.ticker === "AAPL");
assert.equal(investigationAfterCharges?.gateChecks.eventMagnitudeActionable, false);
assert.equal(investigationAfterCharges?.gatePassed, false);

const corroboratedChargesAfterPrimaryInvestigation = build([
  receipt({
    title: "Government opens investigation into Apple",
    publishedAt: "2026-07-22T10:00:00.000Z",
    symbolHints: ["AAPL"],
    companyHints: ["Apple Inc."],
    rawEventType: "apple-enforcement-corroborated",
  }),
  receipt({
    title: "SEC charges Apple in a filed enforcement action",
    publisher: "Independent Legal Desk",
    url: "https://legal.example/apple-charges",
    channel: "google_news_rss",
    official: false,
    primarySource: false,
    publishedAt: "2026-07-22T12:00:00.000Z",
    symbolHints: ["AAPL"],
    companyHints: ["Apple Inc."],
    rawEventType: "apple-enforcement-corroborated",
  }),
  receipt({
    title: "SEC charges Apple; enforcement filing published",
    publisher: "Independent Markets Desk",
    url: "https://markets.example/apple-charges",
    channel: "marketaux",
    official: false,
    primarySource: false,
    publishedAt: "2026-07-22T12:10:00.000Z",
    symbolHints: ["AAPL"],
    companyHints: ["Apple Inc."],
    rawEventType: "apple-enforcement-corroborated",
  }),
]).candidates.find((item) => item.ticker === "AAPL");
assert.equal(corroboratedChargesAfterPrimaryInvestigation?.gateChecks.eventMagnitudeActionable, true);
assert.equal(corroboratedChargesAfterPrimaryInvestigation?.gatePassed, true);

const unverifiedChargeAfterPrimaryInvestigation = build([
  receipt({
    title: "Government opens investigation into Apple",
    publishedAt: "2026-07-22T10:00:00.000Z",
    symbolHints: ["AAPL"],
    companyHints: ["Apple Inc."],
    rawEventType: "apple-enforcement-unverified",
  }),
  receipt({
    title: "Single publisher says SEC charges Apple",
    publisher: "Single Legal Blog",
    url: "https://single-blog.example/apple-charges",
    channel: "google_news_rss",
    official: false,
    primarySource: false,
    publishedAt: "2026-07-22T12:00:00.000Z",
    symbolHints: ["AAPL"],
    companyHints: ["Apple Inc."],
    rawEventType: "apple-enforcement-unverified",
  }),
]).candidates.find((item) => item.ticker === "AAPL");
assert.equal(unverifiedChargeAfterPrimaryInvestigation?.gateChecks.eventMagnitudeActionable, false);
assert.equal(unverifiedChargeAfterPrimaryInvestigation?.gatePassed, false);

const trivialFine = build([receipt({
  title: "Apple receives final fine $10 thousand",
  summary: "The regulator issued the final monetary penalty.",
  symbolHints: ["AAPL"],
  companyHints: ["Apple Inc."],
})]).candidates.find((item) => item.ticker === "AAPL");
assert.ok(trivialFine);
const trivialFineMetric = trivialFine.eventMagnitude.metrics.find((item) => item.kind === "fine_value");
assert.ok(trivialFineMetric);
trivialFine.eventMagnitude.relativeToCompany = {
  metric: "annual_revenue",
  eventValue: trivialFineMetric.value,
  eventMetricSourceReceiptId: trivialFineMetric.sourceReceiptId,
  companyValue: 1_000_000_000,
  ratioPercent: 0.001,
  sourceUrl: "https://data.sec.gov/example",
};
trivialFine.eventMagnitude.status = "relative_to_company";
analysis.reassessCandidateAfterFundamentals(trivialFine, new Date("2026-07-22T13:00:00.000Z"));
assert.equal(trivialFine.gateChecks.eventMagnitudeActionable, false);
assert.equal(trivialFine.gatePassed, false);

const materialFine = build([receipt({
  title: "Apple receives final fine $20 million",
  summary: "The regulator issued the final monetary penalty.",
  symbolHints: ["AAPL"],
  companyHints: ["Apple Inc."],
})]).candidates.find((item) => item.ticker === "AAPL");
assert.ok(materialFine);
const materialFineMetric = materialFine.eventMagnitude.metrics.find((item) => item.kind === "fine_value");
assert.ok(materialFineMetric);
materialFine.eventMagnitude.relativeToCompany = {
  metric: "annual_revenue",
  eventValue: materialFineMetric.value,
  eventMetricSourceReceiptId: materialFineMetric.sourceReceiptId,
  companyValue: 1_000_000_000,
  ratioPercent: 2,
  sourceUrl: "https://data.sec.gov/example",
};
materialFine.eventMagnitude.status = "relative_to_company";
analysis.reassessCandidateAfterFundamentals(materialFine, new Date("2026-07-22T13:00:00.000Z"));
assert.equal(materialFine.gateChecks.eventMagnitudeActionable, true);
assert.equal(materialFine.gatePassed, true);

const exactIntelIssuer = build([receipt({
  title: "Intel launches a new semiconductor processor",
})]);
assert.equal(exactIntelIssuer.candidates.some((item) => item.ticker === "INTC" && item.relationship === "direct" && item.eventFamily === "product_launch"), true);

const exactSingleTokenBrand = build([receipt({
  title: "Apple launches a new product platform",
})]);
assert.equal(exactSingleTokenBrand.candidates.some((item) => item.ticker === "AAPL" && item.relationship === "direct" && item.eventFamily === "product_launch"), true);

const overflowEntries = Array.from({ length: 101 }, (_, index) => {
  const ticker = `Q${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}`;
  return entry(ticker, `Issuer ${index} Technologies`, [`Issuer ${index}`]);
});
const overflowReceipts = overflowEntries.map((equity, index) => receipt({
  title: `Government opens investigation ${index} into ${equity.name}`,
  url: `https://official.example/investigation-${index}`,
  symbolHints: [equity.ticker],
  companyHints: [equity.name],
  rawEventType: `investigation-${index}`,
}));
const overflowResult = analysis.buildImpactCandidates(overflowReceipts, {
  ...universe,
  entries: overflowEntries,
  coverage: { ...universe.coverage, nasdaqRows: 101, eligibleEquities: 101 },
}, macro, new Date("2026-07-22T13:00:00.000Z"), []);
assert.equal(overflowResult.findingAuditLedger.length, 101);
assert.equal(overflowResult.candidates.length, 100);
const retainedTickers = new Set(overflowResult.candidates.map((item) => item.ticker));
const archivedOnlyFinding = overflowResult.findingAuditLedger.find((item) => !retainedTickers.has(item.ticker));
assert.ok(archivedOnlyFinding);
const archivedProof = overflowResult.findingReceiptProofDictionary[archivedOnlyFinding.receiptIds[0]];
assert.equal(archivedProof.title, archivedOnlyFinding.eventHeadline);
assert.equal(archivedProof.publisher, "Official Source");
assert.match(archivedProof.url, /^https:\/\/official\.example\/investigation-/);

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
  genericSectorBasketCannotQualify: true,
  companySpecificKnockOnCanQualifyWithoutHistory: true,
  exactTickerAndCompanyStillMapped: true,
  secCikPreventsMentionedCompanyFanout: true,
  secLeadEventOutranksIncidentalLegalAndTradeLanguage: true,
  unknownSecCikFailsClosed: true,
  companyRelativeContractScaleRequired: true,
  materialContractCanQualifyBeforePriceMove: true,
  immaterialContractRejected: true,
  pricedPrimaryDilutionMeasured: true,
  unpricedPrimarySecProspectusBecomesWatchStage: true,
  blankCurrentPriceCannotUseHistoricalPrice: true,
  undeterminedCurrentPriceCannotUseHistoricalPrice: true,
  debtAndConvertibleNoteOfferingsCannotBecomeProposal: true,
  contextualEquityWordsCannotRetypeDebtOrUnknownOfferings: true,
  actionBeforeOfferingEquityProposalsRemainWatchStage: true,
  secondaryOwnersCannotBecomeIssuerProposal: true,
  inflectedHolderSaleVerbsCannotBecomeIssuerProposal: true,
  holderProposalVerbsCannotBecomeIssuerProposal: true,
  shareholderApprovalCannotRetypeIssuerProposal: true,
  holderNewShareWordingCannotCreateIssuerTranche: true,
  negatedNewSharesCannotCreateIssuerTranche: true,
  activeNegatedIssuanceCannotCreateIssuerTranche: true,
  holderAssignedNewSharesCannotCreateIssuerTranche: true,
  unrelatedWarrantProceedsCannotCreateIssuerTranche: true,
  issuerNoProceedsCannotBecomeProposal: true,
  issuerNewShareSaleRemainsWatchStage: true,
  mixedIssuerAndHolderOfferingKeepsIssuerWatch: true,
  fixedPriceProspectusRemainsDilution: true,
  priceRangeAndFormulaProspectusesRemainWatchStage: true,
  pricedStatusProspectusRemainsDilution: true,
  commencedUnpricedProspectusRemainsWatchStage: true,
  commencedUnpricedEquityUnitsRemainWatchStage: true,
  mixedPrimaryAndSecondaryProspectusKeepsPrimaryWatch: true,
  secondaryOnlyAndNegatedProspectusesCannotBecomeProposal: true,
  nonSecOfferingDoesNotGainSecFallback: true,
  vagueGuidanceRejected: true,
  measuredGuidanceAccepted: true,
  investigationNotTreatedAsFinalEnforcement: true,
  exactIntelIssuerStillMapped: true,
  exactSingleTokenBrandStillMapped: true,
}, null, 2));
