import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";
const nodeRequire = createRequire(import.meta.url);
const cache = new Map();
function load(file, overrides = {}) {
  if (cache.has(file)) return cache.get(file).exports;
  const cjsModule = { exports: {} }; cache.set(file, cjsModule);
  const output = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function("require", "module", "exports", output)((name) => overrides[name] ?? (name.startsWith("@/") ? load(resolve(name.slice(2) + ".ts")) : nodeRequire(name)), cjsModule, cjsModule.exports);
  return cjsModule.exports;
}
const research = load(resolve("lib/growth/research.ts"));
const validation = load(resolve("lib/growth/validation.ts"));
const auth = load(resolve("lib/internal-api-auth.ts"));
const now = new Date("2026-09-14T16:01:00Z");
const business = "We develop and provide business software for managing inventory and orders.";
const customers = "Our customers include retailers and distributors.";
const companyProfile = { version: 1, status: "verified", ticker: "TEST", company: "Test Company", cik: "0000001234", business, customers,
  description: `${business} ${customers}`, sourceType: "sec_annual_filing", sourceUrl: "https://www.sec.gov/Archives/edgar/data/1234/000000123426000001/example.htm",
  sourceFiledAt: "2026-09-01T00:00:00Z", verifiedAt: now.toISOString() };
const candidate = {
  ticker: "TEST", company: "Test Company", cik: companyProfile.cik, companyProfile, currency: "USD", action: "buy_research", currentPrice: 40,
  fairValue: { conservative: 50, base: 60, optimistic: 70 },
  scores: { fairValueConfidence: 84, evidence: 90, risk: 30 },
  observedAt: "2026-09-14T02:00:00Z", priceObservedAt: "2026-09-14T16:00:00Z", livePriceFresh: true,
  fundamentals: { revenueGrowthTtmPercent: 8.2, netMarginPercent: 5.1 }, valuationMethods: [], links: [],
};
assert.equal(research.candidateProblem(candidate, now), null);
const snapshot = research.makeSnapshot(candidate, now);
assert.equal(snapshot.companyDoes, companyProfile.description);
assert.deepEqual(snapshot.companyProfile, companyProfile);
assert.ok(snapshot.sources.some(source => source.url === companyProfile.sourceUrl));
assert.ok(research.candidateProblem({ ...candidate, companyProfile: undefined }, now));
assert.ok(research.candidateProblem({ ...candidate, companyProfile: { ...companyProfile, ticker: "OTHER" } }, now));
assert.throws(() => research.makeSnapshot({ ...candidate, companyProfile: undefined }, now), /Verified company profile/);
assert.equal(research.publicResearchSnapshot({ ...snapshot, companyProfile: undefined }, now), null, "Legacy snapshots without verified provenance stay private");
assert.equal(research.publicResearchSnapshot({ ...snapshot, companyProfile: { ...companyProfile, sourceUrl: "https://example.com/profile" } }, now), null);
assert.equal(research.publicResearchSnapshot({ ...snapshot, companyDoes: "Unverified old description" }, now).companyDoes, companyProfile.description);
assert.equal(research.publicResearchSnapshot(snapshot, new Date(now.getTime() + 31 * 86400000)), null);
assert.match(snapshot.expected, /50.0% rise/);
assert.equal(snapshot.eventAt, null);
assert.equal(snapshot.horizon, null);
assert.equal(snapshot.userAlertEligible, false);
assert.equal(snapshot.committeeApproved, false);
assert.match(snapshot.why, /no new news catalyst has been verified/);
assert.ok(research.candidateProblem({ ...candidate, currency: null }, now));
assert.ok(research.candidateProblem({ ...candidate, priceObservedAt: "2026-09-14T12:00:00Z" }, now));
assert.ok(research.candidateProblem({ ...candidate, priceObservedAt: "2026-09-15T12:00:00Z" }, now));
assert.ok(research.candidateProblem({ ...candidate, observedAt: "2026-09-01T12:00:00Z" }, now));
assert.ok(research.candidateProblem({ ...candidate, currentPrice: 61 }, now));
assert.ok(research.candidateProblem({ ...candidate, fairValue: { ...candidate.fairValue, base: null } }, now));
assert.ok(research.candidateProblem({ ...candidate, scores: { ...candidate.scores, fairValueConfidence: 101 } }, now));
const captions = research.CHANNELS.map((channel) => research.captionFor(snapshot, channel, "cmtest12345678901234567890", "https://swing-up-production.up.railway.app", now));
assert.throws(() => research.captionFor({ ...snapshot, companyProfile: undefined }, "facebook", "cmtest12345678901234567890", "https://swing-up-production.up.railway.app", now), /Verified company profile/);
assert.match(captions[0], /Our customers include retailers and distributors/);
assert.ok(captions[1].length <= 2200);
assert.match(captions[1], /link in our bio/);
assert.match(captions[0], /News event timestamp: not established/);
assert.match(captions[0], /not the probability of profit/);
const legacySnapshot = { ...snapshot, companyProfile: undefined };
const verifiedResearch = { ...research, publicResearchSnapshot: value => research.publicResearchSnapshot(value, now) };
const publicRecords = load(resolve("lib/growth/public-records.ts"), {
  "@/lib/db/client": { prisma: { socialSignal: { findMany: async () => [{ id: "legacy", snapshot: legacySnapshot }, { id: "verified", snapshot }] } } },
  "@/lib/growth/research": verifiedResearch,
});
assert.deepEqual((await publicRecords.latestResearch()).rows.map(row => row.id), ["verified"], "Public history hides legacy profiles");
let storedSnapshot = legacySnapshot;
let imageRenders = 0;
const imageRoute = load(resolve("app/api/public/social-image/[id]/route.tsx"), {
  "@/lib/db/client": { prisma: { socialSignal: { findUnique: async () => ({ snapshot: storedSnapshot }) } } },
  "@/lib/growth/research": verifiedResearch,
  "next/og": { ImageResponse: class extends Response { constructor(_body, options) { super("card", { headers: options.headers }); imageRenders++; } } },
});
const cardParams = { params: Promise.resolve({ id: "cmtest12345678901234567890" }) };
assert.equal((await imageRoute.GET(new Request("https://swingup.test/card"), cardParams)).status, 404);
assert.equal(imageRenders, 0, "An unverified snapshot never reaches image rendering");
storedSnapshot = snapshot;
const publicCard = await imageRoute.GET(new Request("https://swingup.test/card"), cardParams);
assert.equal(publicCard.status, 200);
assert.equal(publicCard.headers.get("cache-control"), "no-store");
assert.equal(imageRenders, 1);
const slots = research.slotsForDay(now);
assert.equal(slots.length * research.CHANNELS.length, 9);
assert.deepEqual(slots.map((slot) => slot.at.toISOString()), ["2026-09-14T02:00:00.000Z", "2026-09-14T10:00:00.000Z", "2026-09-14T16:00:00.000Z"]);
assert.notEqual(research.slotsForDay(new Date("2026-09-15T00:00:00Z"))[0].key, slots[0].key);
const form = { email: "  PERSON@example.com ", consent: true, planIntent: "paid_pilot", source: "facebook", content: "cmtest" };
assert.equal(validation.validateSignup(form).email, "person@example.com");
assert.throws(() => validation.validateSignup({ ...form, consent: false }));
assert.throws(() => validation.validateSignup({ ...form, website: "spam" }));
assert.throws(() => validation.validateSignup({ ...form, planIntent: "charged" }));
assert.equal(validation.attribution({ source: "https://evil.invalid", content: "<script>" }).source, "direct");
assert.equal(validation.sameOrigin(new Request("https://swingup.test/api/early-access", { headers: { origin: "https://evil.invalid" } })), false);
assert.equal(validation.sameOrigin(new Request("https://swingup.test/api/early-access", { headers: { origin: "https://swingup.test" } })), true);
assert.equal(auth.requiredInternalApiScope("/api/internal/growth", "GET"), "serious_signal_read");
assert.equal(auth.internalApiScopeAuthorized(new Headers(), "serious_signal_read", {}), false);
assert.equal(auth.internalApiScopeAuthorized(new Headers({ authorization: "Bearer reader" }), "automation", { SWING_UP_SERIOUS_SIGNAL_READ_TOKEN: "reader", SWING_UP_AUTOMATION_TOKEN: "writer" }), false);
const buffer = load(resolve("lib/growth/buffer.ts"));
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => { throw new Error("connection reset after possible acceptance"); };
  await assert.rejects(buffer.publishBufferImage("facebook", "research", "https://swingup.test/card.png"), (error) => error.uncertain === true);
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { createPost: { __typename: "InvalidInputError", message: "invalid" } } }), { status: 200 });
  await assert.rejects(buffer.publishBufferImage("facebook", "research", "https://swingup.test/card.png"), (error) => error.uncertain === false);
  globalThis.fetch = async (_url, options) => {
    const input = JSON.parse(options.body).variables.input;
    assert.equal(input.schedulingType, "automatic"); assert.equal(input.assets[0].image.url, "https://swingup.test/card.png");
    return new Response(JSON.stringify({ data: { createPost: { __typename: "PostActionSuccess", post: { id: "provider-1", status: "buffer", externalLink: null } } } }));
  };
  const accepted = await buffer.publishBufferImage("instagram", "research", "https://swingup.test/card.png");
  assert.equal(buffer.deliveryState(accepted), "scheduled", "Provider acceptance is not confirmed publication");
  assert.equal(buffer.deliveryState({ status: "sent" }), "published");
  assert.equal(buffer.deliveryState({ status: "needs_approval" }), "held");
} finally { globalThis.fetch = originalFetch; }
console.log(JSON.stringify({ ok: true, checks: ["verified profile required for creation and captions", "legacy profiles hidden from public history and cards", "financial-data freshness and authority", "conditional scenario arithmetic", "nine daily channel slots", "platform copy limits", "consent and attribution validation", "private report authorization", "ambiguous publication recovery contract"], captionLengths: captions.map((caption) => caption.length) }, null, 2));
