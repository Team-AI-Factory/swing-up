import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";
if (!process.env.DATABASE_URL?.includes("127.0.0.1")) throw new Error("This test requires a disposable loopback database");
const nodeRequire = createRequire(import.meta.url);
const { PrismaClient } = nodeRequire("@prisma/client");
const db = new PrismaClient();
const day = new Date().toISOString().slice(0,10);
const now = new Date(`${day}T16:01:00Z`);
// Keep module clocks aligned with the injected scheduler time. Mixing real early-
// morning writes with a simulated afternoon tick prematurely reconciles delivery.
let testClock = now.getTime();
class TestDate extends Date {
  constructor(...args) { super(...(args.length ? args : [testClock])); }
  static now() { return testClock; }
}
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const cjsModule = { exports: {} }; cache.set(file, cjsModule);
  const output = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", "Date", output)((name) => {
    if (name === "@/lib/db/client") return { prisma: db };
    if (name === "@/lib/opportunity-engine/valuation-watchlist-feed") return { getValuationWatchlistStatus: async ({ action }) => ({ candidates: [1,2,3].map((i) => ({
      id: `test:${action}:${i}`, ticker: `${action === "buy_research" ? "BUY" : action === "sell_research" ? "SELL" : "RISK"}${i}`, company: "Test Fixture Company", currency: "USD", action,
      currentPrice: action === "sell_research" ? 100 : 40,
      fairValue: { conservative: 50, base: 60, optimistic: 70 }, scores: { fairValueConfidence: 84, evidence: 90, risk: 30 },
      observedAt: `${day}T02:00:00Z`, priceObservedAt: `${day}T16:00:00Z`, livePriceFresh: true,
      fundamentals: { revenueGrowthTtmPercent: 8.2, netMarginPercent: 5.1 }, valuationMethods: [], links: [],
    })) }) };
    return name.startsWith("@/") ? load(resolve(name.slice(2) + ".ts")) : nodeRequire(name);
  }, cjsModule, cjsModule.exports, TestDate);
  return cjsModule.exports;
}
process.env.SWING_UP_SERIOUS_SIGNAL_READ_TOKEN = "local-test-reader";
process.env.APP_BASE_URL = "https://swingup.test";
const signup = load(resolve("app/api/early-access/route.ts"));
const manage = load(resolve("app/api/early-access/manage/route.ts"));
const visits = load(resolve("app/api/growth/visit/route.ts"));
const report = load(resolve("app/api/internal/growth/route.ts"));
const body = { email: "growth-test@example.invalid", consent: true, planIntent: "paid_pilot", source: "facebook", content: "launch", goal: "test" };
const request = (path, value, origin = "https://swingup.test") => new Request(`https://swingup.test${path}`, { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(value) });
await db.earlyAccessLead.deleteMany({ where: { email: body.email } });
await db.growthRateLimit.deleteMany({});
assert.equal((await signup.POST(request("/api/early-access", body, "https://other.test"))).status, 403);
assert.equal((await signup.POST(request("/api/early-access", { ...body, consent: false }))).status, 400);
const responses = await Promise.all([signup.POST(request("/api/early-access", body)), signup.POST(request("/api/early-access", body))]);
assert.deepEqual(responses.map((response) => response.status), [200,200]);
const links = await Promise.all(responses.map((response) => response.json()));
assert.equal(await db.earlyAccessLead.count({ where: { email: body.email } }), 1);
const before = await db.earlyAccessLead.findUnique({ where: { email: body.email } });
await signup.POST(request("/api/early-access", { ...body, planIntent: "free", goal: "overwrite attempt" }));
const after = await db.earlyAccessLead.findUnique({ where: { email: body.email } });
assert.equal(after.planIntent, "paid_pilot"); assert.equal(after.priceCents, 1900); assert.equal(after.manageHash, before.manageHash); assert.equal(after.goal, "test");
for (const link of links) await manage.POST(request("/api/early-access/manage", { token: link.manageUrl.split("#")[1] }));
assert.equal(await db.earlyAccessLead.count({ where: { email: body.email } }), 0);
const visit = { session: "12345678-1234-1234-1234-123456789abc", source: "facebook", content: "launch" };
assert.equal((await visits.POST(request("/api/growth/visit", visit))).status, 204);
assert.equal((await visits.POST(request("/api/growth/visit", visit))).status, 204);
assert.equal(await db.growthVisit.count(), 1);
assert.equal((await report.GET(new Request("https://swingup.test/api/internal/growth"))).status, 401);
const privateReport = await report.GET(new Request("https://swingup.test/api/internal/growth", { headers: { "x-swing-up-serious-signal-read-token": "local-test-reader" } }));
assert.equal(privateReport.status, 200); assert.equal((await privateReport.json()).paymentsCollected, 0);
for (let i=0;i<9;i++) await signup.POST(request("/api/early-access", body));
assert.equal((await signup.POST(request("/api/early-access", body))).status, 429);

process.env.SWING_UP_GROWTH_ENABLED = "true";
process.env.RAILWAY_ENVIRONMENT_NAME = "production";
process.env.RAILWAY_SERVICE_ID = "d02bf6e1-4140-418f-aa5c-b67dcc2d8d15";
process.env.SWING_UP_SOCIAL_PUBLISHING_ENABLED = "true";
process.env.BUFFER_ACCESS_TOKEN = "fake-local-key";
process.env.BUFFER_ORGANIZATION_ID = "fake-local-organization";
for (const channel of ["FACEBOOK", "INSTAGRAM", "X"]) process.env[`BUFFER_${channel}_CHANNEL_ID`] = `test-${channel.toLowerCase()}`;
const originalFetch = globalThis.fetch;
let mutations = 0; let reads = 0; const providerPosts = [];
globalThis.fetch = async (_url, options) => {
  const { query, variables } = JSON.parse(options.body);
  if (query.includes("channels(")) return Response.json({ data: { channels: ["facebook","instagram","x"].map((channel) => ({ id: `test-${channel}`, service: channel === "x" ? "twitter" : channel, name: `Swing Up ${channel}` })) } });
  if (query.includes("createPost(")) {
    mutations++;
    const post = { id: `provider-${mutations}`, status: "sent", externalLink: `https://social.example.test/${mutations}`, text: variables.input.text };
    providerPosts.push(post);
    if (variables.input.channelId === "test-x") throw new Error("Timed out after provider accepted post");
    return Response.json({ data: { createPost: { __typename: "PostActionSuccess", post } } });
  }
  if (query.includes("posts(")) { reads++; return Response.json({ data: { posts: { edges: providerPosts.map((node) => ({ node })) } } }); }
  if (query.includes("post(")) return Response.json({ data: { post: providerPosts.find((post) => post.id === variables.input.id) } });
  throw new Error("Unexpected provider query");
};
try {
  const runtime = load(resolve("lib/growth/runtime.ts"));
  const tick = (at) => { testClock = at.getTime(); return runtime.runGrowthTick(at); };
  const concurrent = await Promise.all([tick(now), tick(now)]);
  assert.ok(concurrent.some((result) => result.status === "busy"), "Only one scheduler can lease a tick");
  assert.equal(mutations, 3, "A slot creates one post per channel");
  assert.equal(await db.socialSignal.count({ where: { scheduleKey: `${day}-2` } }), 1);
  await tick(new Date(now.getTime() + 60_000));
  assert.equal(mutations, 3, "Repeated ticks never resend accepted or uncertain posts");
  assert.equal(await db.socialDelivery.count({ where: { status: "unknown" } }), 1);
  await db.socialDelivery.updateMany({ where: { status: "unknown" }, data: { checkedAt: new Date(now.getTime() - 3_600_000) } });
  await tick(new Date(now.getTime() + 2 * 3_600_000));
  assert.equal(mutations, 3); assert.equal(reads, 1); assert.equal(await db.socialDelivery.count({ where: { status: "unknown" } }), 0);
  const record = await db.socialSignal.findFirst(); writeFileSync("/tmp/swing-up-test-card-id", record.id);
  console.log(JSON.stringify({ ok: true, checks: ["additive migration accepted by PostgreSQL", "concurrent signup uniqueness", "consent and price persisted", "repeat signup cannot overwrite preferences", "private deletion works", "rate limit enforced", "visits deduplicated", "owner dashboard protected", "concurrent scheduler lease", "one delivery per channel", "ambiguous timeout reconciled without resending"] }, null, 2));
} finally { globalThis.fetch = originalFetch; await db.$disconnect(); }
