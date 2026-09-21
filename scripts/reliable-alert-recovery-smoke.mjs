import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { retryFoundationRequest } from "./helpers/retry-foundation-request.mjs";

const { usQuoteFreshness, usEquitySession } = loadTsModule("@/lib/equity-signal/us-market-calendar");
const check = (quote, now, usable, basis) => {
  const result = usQuoteFreshness(quote, new Date(now));
  assert.equal(result.usable, usable, `${quote} at ${now}`);
  if (basis) assert.equal(result.basis, basis);
};
check("2026-09-18T20:00:00Z", "2026-09-20T12:00:00Z", true, "last_completed_session");
check("2026-09-17T20:00:00Z", "2026-09-20T12:00:00Z", false);
check("2026-09-18T14:00:00Z", "2026-09-20T12:00:00Z", false, "last_completed_session");
check("2026-09-18T20:00:00Z", "2026-09-21T07:59:00Z", true);
check("2026-09-18T20:00:00Z", "2026-09-21T08:00:00Z", false, "live_or_delayed");
check("2026-09-21T14:00:00Z", "2026-09-21T14:14:00Z", true);
check("2026-09-21T14:00:00Z", "2026-09-21T14:16:00Z", false);
check("2026-11-27T18:00:00Z", "2026-11-29T12:00:00Z", true);
check("2026-12-24T18:00:00Z", "2026-12-25T15:00:00Z", true);
check("2026-03-06T21:00:00Z", "2026-03-09T07:59:00Z", true);
check("2026-03-06T21:00:00Z", "2026-03-09T08:00:00Z", false);
check("2026-07-02T20:00:00Z", "2026-07-03T15:00:00Z", true);
check("2026-09-21T14:30:00Z", "2026-09-21T14:00:00Z", false);
assert.equal(usEquitySession("2026-04-03"), null);
assert.equal(usEquitySession("2026-11-27").regularCloseMinute, 780);
assert.ok(usEquitySession("2027-12-31"), "The NYSE does not observe Saturday New Year on Friday.");

let requests = 0, pauses = [];
const resumed = await retryFoundationRequest(async () => new Response(null, { status: ++requests < 3 ? 503 : 200 }), { pause: async ms => pauses.push(ms) });
assert.equal(resumed.status, 200);
assert.deepEqual(pauses, [2000, 4000]);
requests = 0;
const denied = await retryFoundationRequest(async () => { requests++; return new Response(null, { status: 403 }); }, { pause: async () => assert.fail("Do not retry access denial.") });
assert.equal(denied.status, 403);
assert.equal(requests, 1);
requests = 0;
await assert.rejects(() => retryFoundationRequest(async () => { requests++; throw new Error("network_down"); }, { pause: async () => {} }), /network_down/);
assert.equal(requests, 3, "Automatic recovery must be bounded.");

const saved = { admin: process.env.OPENAI_ADMIN_KEY, id: process.env.SWING_UP_OPENAI_COMMITTEE_API_KEY_ID };
const billing = loadTsModule("@/lib/ai-committee/billing-audit", {
  "@/lib/r2-warehouse": { readVersionedTextFromR2: async () => ({ found: false }), writeVersionedJsonToR2: async () => ({ written: true }) },
});
try {
  delete process.env.OPENAI_ADMIN_KEY;
  delete process.env.SWING_UP_OPENAI_COMMITTEE_API_KEY_ID;
  assert.equal((await billing.readOpenAiBillingAudit()).status, "access_not_configured");
  process.env.OPENAI_ADMIN_KEY = "billing-test-secret";
  process.env.SWING_UP_OPENAI_COMMITTEE_API_KEY_ID = "key_test_committee";
  let calls = 0;
  const billed = await billing.readOpenAiBillingAudit(new Date("2026-09-21T12:00:00Z"), async (url, init) => {
    calls++;
    assert.equal(url.hostname, "api.openai.com");
    assert.equal(url.pathname, "/v1/organization/costs");
    assert.equal(url.searchParams.get("api_key_ids"), "key_test_committee");
    assert.equal(init.headers.Authorization, "Bearer billing-test-secret");
    assert.equal(url.searchParams.get("page"), calls === 1 ? null : "next");
    return Response.json({ data: [{ start_time: 1790035200, end_time: 1790121600, results: [{ api_key_id: "key_test_committee", amount: { currency: "usd", value: 0.025 } }] }], has_more: calls === 1, next_page: calls === 1 ? "next" : null });
  });
  assert.equal(billed.reportedCostUsd, 0.05);
  assert.equal(billed.invoiceVerified, false);
  assert.doesNotMatch(JSON.stringify(billed), /billing-test-secret/);
  const otherKey = await billing.readOpenAiBillingAudit(new Date(), async () => Response.json({ data: [{ start_time: 1, end_time: 2, results: [{ api_key_id: "unrelated", amount: { currency: "usd", value: 18 } }] }], has_more: false }));
  assert.equal(otherKey.status, "unavailable", "Unrelated account charges cannot become Committee charges.");
} finally {
  if (saved.admin === undefined) delete process.env.OPENAI_ADMIN_KEY; else process.env.OPENAI_ADMIN_KEY = saved.admin;
  if (saved.id === undefined) delete process.env.SWING_UP_OPENAI_COMMITTEE_API_KEY_ID; else process.env.SWING_UP_OPENAI_COMMITTEE_API_KEY_ID = saved.id;
}
console.log("Session-aware prices, bounded foundation recovery and scoped official billing audit passed.");
