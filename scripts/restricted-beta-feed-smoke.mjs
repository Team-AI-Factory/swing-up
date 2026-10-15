import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { inSimpleAlertPilot } from "./helpers/simple-alert-pilot-fixture.mjs";

const nativeRequire = createRequire(import.meta.url);
const { NextRequest } = nativeRequire("next/server");
const savedEnvironment = { ...process.env };
Object.assign(process.env, {
  SWING_UP_SIMPLE_PILOT_ENABLED: "false",
  SWING_UP_SERIOUS_SIGNAL_READ_TOKEN: "fixture-read-only",
  SWING_UP_PR262_SENSOR_TOKEN: "fixture-sensor-only",
  SWING_UP_INTERNAL_API_TOKEN: "fixture-master",
});
let reads = 0;
let failRead = false;
const emptyWatchlist = {
  ok: true, sanitized: true, provisionalResearchOnly: false,
  foundation: { available: true, complete: false, sourceCheckedAt: null, coverage: null },
  livePricing: { available: false },
  summary: { buyResearch: 0, sellResearch: 0, watchOutResearch: 0, priceWatch: 0, specialistModelApplied: 0 },
  candidates: [], truncated: false,
};
const readWatchlist = async () => { reads++; if (failRead) throw Error("fixture read failure"); return emptyWatchlist; };
const overrides = {
  "@/lib/opportunity-engine/valuation-watchlist-feed": { getValuationWatchlistStatus: readWatchlist },
  "@/lib/opportunity-engine/pr262-research-evidence": {
    readResearchAlerts: async () => { reads++; return []; },
    readEvidenceQuality: async () => { reads++; return { available: false }; },
    isResearchAlertCurrent: () => true,
  },
  "@/lib/restricted-research-watch": { assembleRestrictedResearchWatch: () => [] },
  "@/lib/public-signals": { assemblePublicSignals: () => [] },
  "@/lib/notifications/serious-signal-delivery": { getSeriousSignalStatus: async () => { reads++; return { ok: true, alerts: [] }; } },
};
const publicPaths = ["signals", "valuation-watchlist"].map(name => `/api/public/${name}`);
const internalPaths = ["serious-signal-status", "valuation-watchlist-status"].map(name => `/api/internal/${name}`);
try {
  for (const path of [...publicPaths, ...internalPaths]) {
    const { GET } = loadTsModule(`@/app${path}/route`, overrides);
    await inSimpleAlertPilot(async () => {
      for (const headers of [{}, { authorization: "Bearer wrong" }, { "x-swing-up-pr262-sensor-token": "fixture-sensor-only" }]) {
        const before = reads;
        const denied = await GET(new NextRequest(`http://localhost${path}`, { headers }));
        assert.equal(denied.status, 404, `${path} rejects missing/wrong-scope credentials`);
        assert.deepEqual(await denied.json(), { ok: false, error: "not_found" });
        assert.match(denied.headers.get("cache-control"), /no-store/);
        assert.equal(reads, before, "Authentication must precede data reads");
      }
      for (const headers of [{ "x-swing-up-serious-signal-read-token": "fixture-read-only" }, { authorization: "Bearer fixture-read-only" }]) {
        const allowed = await GET(new NextRequest(`http://localhost${path}`, { headers }));
        assert.equal(allowed.status, 200);
        assert.equal((await allowed.json()).ok, true);
        assert.equal(allowed.headers.get("cache-control"), "private, no-store");
      }
      if (publicPaths.includes(path)) {
        failRead = true;
        const failed = await GET(new NextRequest(`http://localhost${path}`, { headers: { "x-swing-up-serious-signal-read-token": "fixture-read-only" } }));
        assert.equal(failed.status, 503);
        assert.match(failed.headers.get("cache-control"), /no-store/);
        failRead = false;
      }
    });
    if (publicPaths.includes(path)) {
      const ordinary = await GET(new NextRequest(`http://localhost${path}`));
      assert.equal(ordinary.status, 200, "Nonpilot public feed compatibility");
      assert.equal(ordinary.headers.get("cache-control"), "public, max-age=30, stale-while-revalidate=60");
    }
  }
} finally {
  for (const key of Object.keys(process.env)) if (!(key in savedEnvironment)) delete process.env[key];
  Object.assign(process.env, savedEnvironment);
}

// Exercise real component handlers/effects without a browser, network or new test dependencies.
function componentModule(file, overrides) {
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const result = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    if (name in overrides) return overrides[name];
    if (name.startsWith("@/lib/")) return loadTsModule(name);
    return nativeRequire(name);
  }, result, result.exports);
  return result.exports;
}
function harness(file, exportName, props) {
  const slots = []; let cursor = 0; let pendingEffects = []; let tree;
  const changed = (old, next) => !old || old.length !== next.length || old.some((value, index) => value !== next[index]);
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(callback, deps) { const index = cursor++; if (!slots[index] || changed(slots[index].deps, deps)) slots[index] = { callback, deps }; return slots[index].callback; },
    useEffect(callback, deps) { const index = cursor++; if (!slots[index] || changed(slots[index].deps, deps)) { slots[index]?.cleanup?.(); slots[index] = { deps }; pendingEffects.push(() => { slots[index].cleanup = callback(); }); } },
  };
  const Component = componentModule(file, {
    react: hooks,
    "@/components/CompanyFacts": { CompanyFacts: () => null },
    "@/components/SignalPriceOutlook": { SignalPriceOutlook: () => null },
    "@/components/PublicSignalFeed": { PublicSignalFeed: () => null },
  })[exportName];
  return {
    render() { cursor = 0; tree = Component(props); return tree; },
    effects() { const effects = pendingEffects; pendingEffects = []; effects.forEach(run => run()); },
    html() { this.render(); return renderToStaticMarkup(tree); },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
function findElement(tree, predicate) {
  if (!tree || typeof tree !== "object") return null;
  if (Array.isArray(tree)) return tree.map(item => findElement(item, predicate)).find(Boolean);
  if (predicate(tree)) return tree;
  return findElement(tree.props?.children, predicate);
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
const publicBody = { ok: true, sanitized: true, alerts: [], researchWatch: [] };
const calls = [], timers = new Map(), session = new Map();
let timerId = 0;
const fakeSetInterval = callback => { timers.set(++timerId, callback); return timerId; };
const fakeClearInterval = id => timers.delete(id);
const liveFeed = {
  ok: true, sanitized: true, generatedAt: "2026-10-15T04:00:00Z",
  window: { from: "2026-10-13T04:00:00Z" }, alerts: [], summary: { total: 0, buy: 0, sell: 0, watchOut: 0, delivered: 0, deliveryAttentionNeeded: 0 },
  sensor: { verifiedLive: true, coverageVerified: true, owner: "railway" }, emptyResultVerified: true,
};
let delayResponses = false, rejectClientKey = false; const pending = [];
globalThis.fetch = async (url, options) => {
  calls.push({ url, options });
  if (rejectClientKey) return { ok: false, status: 404, json: async () => ({ ok: false, error: "not_found" }) };
  const body = url.includes("valuation-watchlist") ? emptyWatchlist : url.includes("public/signals") ? publicBody : liveFeed;
  if (delayResponses) await new Promise(resolve => pending.push(resolve));
  return { ok: true, status: 200, json: async () => body };
};
globalThis.window = { sessionStorage: { getItem: key => session.get(key), setItem: (key, value) => session.set(key, value), removeItem: key => session.delete(key) }, setInterval: fakeSetInterval, clearInterval: fakeClearInterval };
globalThis.setInterval = fakeSetInterval;
globalThis.clearInterval = fakeClearInterval;
try {
  const ui = harness("app/serious-signals/SeriousSignalFeed.tsx", "SeriousSignalFeed", { restrictedBeta: true });
  assert.match(ui.html(), /Connect the restricted beta feed/);
  ui.effects(); await tick();
  assert.equal(calls.length, 0, "Pilot mount without a key must not fetch any feed");
  assert.equal(timers.size, 0, "Pilot mount without a key must not poll");
  findElement(ui.render(), element => element.type === "input").props.onChange({ target: { value: "fixture-read-only" } });
  findElement(ui.render(), element => element.type === "form").props.onSubmit({ preventDefault() {} });
  await tick(); ui.render(); ui.effects();
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ options }) => options.headers["x-swing-up-serious-signal-read-token"] === "fixture-read-only" && options.cache === "no-store"));
  assert.match(ui.html(), /No qualifying Serious Alert yet in the latest 48 hours/);
  liveFeed.emptyResultVerified = false;
  for (const callback of timers.values()) callback();
  await tick();
  assert.doesNotMatch(ui.html(), /No qualifying Serious Alert yet/);
  assert.match(ui.html(), /critical source or baseline coverage is incomplete/);
  liveFeed.alerts.push({ id: "live", ticker: "LIVE", industry: "Software", price: null, alertType: "buy", publicationEligible: true, finalJudgeConfidence: 90, delivery: { status: "pending", channels: { webFeed: "pending" } }, createdAt: "2026-10-15T04:00:00Z", committee: { completed: 4 }, evidence: [] });
  assert.match(ui.html(), /APPROVAL RECORD · WEB DELIVERY UNVERIFIED/);
  assert.doesNotMatch(ui.html(), /SERIOUS BUY/);
  liveFeed.alerts[0].delivery.channels.webFeed = "sent";
  assert.match(ui.html(), /SERIOUS BUY/);
  liveFeed.alerts[0].publicationEligible = false;
  assert.match(ui.html(), /HISTORICAL APPROVAL · CURRENT CHECKS PENDING/);
  assert.doesNotMatch(ui.html(), /SERIOUS BUY/);
  delayResponses = true;
  findElement(ui.render(), element => element.type === "button" && element.props.children === "Refresh now").props.onClick();
  findElement(ui.render(), element => element.type === "button" && element.props.children === "Lock feed").props.onClick();
  ui.render(); ui.effects();
  pending.splice(0).forEach(resolve => resolve()); await tick();
  assert.match(ui.html(), /Connect the restricted beta feed/);
  assert.doesNotMatch(ui.html(), /Verified alerts · 48h/);
  assert.equal(session.size, 0, "Lock clears the existing session token");
  assert.equal(timers.size, 0, "Lock stops pilot polling");
  ui.dispose(); delayResponses = false;

  const before = calls.length;
  const research = harness("components/PublicSignalFeed.tsx", "PublicSignalFeed", { restrictedBeta: true });
  research.render(); research.effects(); await tick();
  assert.equal(calls.length, before, "Research component itself refuses unauthenticated pilot fetches");
  research.dispose();
  publicBody.alerts.push({ id: "reviewed", ticker: "TEST", company: "Fixture Company", action: "buy", industry: "Software", committeeApproved: true, committeeStatus: "approved", createdAt: "2026-10-15T04:00:00Z", priceObservedAt: "2026-10-14T04:00:00Z", explanation: { companyDoes: "Example", whatHappened: "Disclosure", whyItMatters: "Unconfirmed scale", whatCouldHappen: "Unknown", whatCouldGoWrong: "Evidence gaps", missingInformation: ["Verified financial figures are missing."] }, sources: [] });
  publicBody.researchWatch.push({ id: "parked", ticker: "PARK", company: "Parked Fixture", label: "RESEARCH WATCH", status: "parked", missingInformation: ["A usable current quote is missing."], sourceDates: { eventObservedAt: "2026-10-13T04:00:00Z", companyFilingDate: null }, sources: [{ label: "Issuer disclosure", url: "https://example.com/disclosure", publishedAt: "2026-10-12T04:00:00Z" }], updatedAt: "2026-10-15T04:00:00Z", committeeApproved: false, currentPrice: null, targets: null });
  const authenticated = harness("components/PublicSignalFeed.tsx", "PublicSignalFeed", { restrictedBeta: true, readToken: "fixture-read-only" });
  authenticated.render(); authenticated.effects(); await tick();
  assert.equal(calls.at(-1).options.headers["x-swing-up-serious-signal-read-token"], "fixture-read-only");
  assert.match(authenticated.html(), /Research Watch/);
  assert.match(authenticated.html(), /Investment accuracy is not yet established/);
  assert.match(authenticated.html(), /Verified financial figures are missing/);
  assert.match(authenticated.html(), /Historical price snapshot/);
  assert.match(authenticated.html(), /delivery unverified here/);
  assert.doesNotMatch(authenticated.html(), /SERIOUS SIGNAL/);
  assert.match(authenticated.html(), /RESEARCH WATCH · PARKED/);
  assert.match(authenticated.html(), /A usable current quote is missing/);
  assert.match(authenticated.html(), /Company filing date:/);
  assert.match(authenticated.html(), /Issuer disclosure/);
  rejectClientKey = true;
  for (const callback of timers.values()) callback();
  await tick();
  assert.match(authenticated.html(), /Research Watch is unavailable/);
  assert.doesNotMatch(authenticated.html(), /Parked Fixture|Fixture Company|Issuer disclosure/);
  authenticated.dispose();
} finally {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
  globalThis.setInterval = originalSetInterval; globalThis.clearInterval = originalClearInterval;
}

for (const file of ["app/serious-signals/page.tsx", "app/alerts/page.tsx", "app/dashboard/page.tsx"]) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  assert.match(source, /isSimpleAlertPilot/);
  assert.match(source, /restrictedBeta/);
  assert.match(source, /force-dynamic/, "Pilot shell selection must use runtime mode");
}
const uiSource = readFileSync(new URL("../app/serious-signals/SeriousSignalFeed.tsx", import.meta.url), "utf8");
assert.match(uiSource, /item\.blockers\.join/);
assert.match(uiSource, /Source checked:/);
assert.match(uiSource, /Historical price snapshot; stale or unverified for action/);
assert.doesNotMatch(uiSource, /localStorage/);
console.log(JSON.stringify({ ok: true, pilotRoutesAuthenticateBeforeReads: true, pilotResponsesNeverCached: true, nonpilotPublicCompatibility: true, noUnauthenticatedPilotFetchOrPoll: true, existingSessionKeyOnly: true, lockIgnoresInflightData: true, honestEmptyResultAndResearchLabels: true }, null, 2));
