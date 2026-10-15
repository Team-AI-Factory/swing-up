import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const nativeRequire = createRequire(import.meta.url);
globalThis.fetch = () => { throw new Error("Live fetch forbidden in rendered-label test"); };
function loadComponent(path, states) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const result = { exports: {} }; let index = 0;
  const require = name => name === "react" ? { ...nativeRequire("react"),
    useState: () => [states[index++], () => {}], useEffect: () => {}, useCallback: value => value, useRef: value => ({ current: value }) }
    : ["@/components/CompanyFacts", "@/components/SignalPriceOutlook", "@/components/PublicSignalFeed"].includes(name)
      ? { CompanyFacts: () => null, SignalPriceOutlook: () => null, PublicSignalFeed: () => null }
      : name.startsWith("@/") ? loadTsModule(name) : nativeRequire(name);
  new Function("require", "module", "exports", code)(require, result, result.exports);
  return result.exports;
}
const item = { id: "synthetic", anchor: "synthetic", ticker: "AIOT", company: "Synthetic company", action: "buy",
  industry: "Software", committeeApproved: false, createdAt: "2026-10-05T15:00:00Z", priceObservedAt: "2026-10-05T15:00:00Z",
  confidence: 0, confidenceBasis: "historical_committee_review", scores: {}, links: [], sources: [],
  explanation: { whatHappened: "Synthetic event", whyItMatters: "Synthetic", whatCouldHappen: "Synthetic", whatCouldGoWrong: "Synthetic", missingInformation: [] } };
for (const [status, expected, currentlyApproved = false] of [["approved", "Committee approved", true], ["approved", "Positive review · final checks pending"],
  ["approved_pending_checks", "Positive review · final checks pending"], ["rejected", "Committee rejected"],
  ["needs_more_data", null], ["awaiting_review", "Awaiting Committee review"]]) {
  const value = { ...item, committeeStatus: status, committeeApproved: currentlyApproved };
  const publicComponent = loadComponent("components/PublicSignalFeed.tsx", [[], 20, null, null, [value], "", "all"]);
  const publicHtml = renderToStaticMarkup(publicComponent.PublicSignalFeed({}));
  assert.ok(publicHtml.includes(expected ?? "Collecting more information"), `${status}: public label`);
  assert.ok(publicHtml.includes("Historical Committee confidence: 0/100"), "Genuine historical zero survives held badge");
  const watchlist = { candidates: [value], summary: {}, foundation: {}, livePricing: {} };
  const seriousComponent = loadComponent("app/serious-signals/SeriousSignalFeed.tsx", ["", "", null, watchlist, false, false, null, null]);
  const seriousHtml = renderToStaticMarkup(seriousComponent.SeriousSignalFeed({}));
  assert.ok(seriousHtml.includes(expected ?? "Committee requests more information"), `${status}: serious feed label`);
  if (status === "approved") {
    assert.ok(!publicHtml.includes("Awaiting Committee review"));
    assert.ok(!seriousHtml.includes("Awaiting Committee review"));
  }
}
const historicalFeed = { ok: true, generatedAt: item.createdAt, window: { hours: 48, from: item.createdAt, to: item.createdAt },
  summary: { total: 1, buy: 1, sell: 0, watchOut: 0, delivered: 1, deliveryAttentionNeeded: 0 },
  truncated: false, sanitized: true, sensor: { verifiedLive: false, coverageVerified: false, owner: null,
    lastScanAt: null, ageMinutes: null, reason: "fixture", coverageReason: "fixture" }, emptyResultVerified: false,
  alerts: [{ ...item, alertType: "buy", price: 10, finalJudgeConfidence: 88, publicationEligible: false,
    publicationHoldReason: "Whole-text transport completeness is unknown.", evidence: [],
    committee: { completed: 4, planned: 4, failed: 0, recommendation: "approve" }, delivery: { status: "delivered" } }] };
const historicalComponent = loadComponent("app/serious-signals/SeriousSignalFeed.tsx", ["synthetic-read-token", "", historicalFeed, null, false, false, null, null]);
const historicalHtml = renderToStaticMarkup(historicalComponent.SeriousSignalFeed({}));
assert.ok(historicalHtml.includes("HISTORICAL APPROVAL · CURRENT CHECKS PENDING"));
assert.ok(historicalHtml.includes("Judge 88/100"));
assert.ok(historicalHtml.includes("All 4 selected reviewers completed their checks."));
assert.ok(historicalHtml.includes("The displayed review and scenarios are historical."));
assert.ok(!historicalHtml.includes(">SERIOUS BUY<"));
console.log("PASS: actual public/serious feed rendering preserves held historical approval, rejection, needs-more-data, never-reviewed labels and genuine zero confidence.");
