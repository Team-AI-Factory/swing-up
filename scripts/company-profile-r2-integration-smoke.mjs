import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const savedEnv = { ...process.env }, savedFetch = globalThis.fetch, savedWarn = console.warn, savedInfo = console.info;
Object.assign(process.env, { R2_ENDPOINT: "https://profile-storage.invalid", R2_BUCKET: "test-only", R2_ACCESS_KEY_ID: "fixture-key", R2_SECRET_ACCESS_KEY: "fixture-secret", R2_REGION: "auto", SWING_UP_SIMPLE_PILOT_ENABLED: "false", SWING_UP_R2_WRITE_PREFIX: "production/pr262/" });
const pause = { setTimeout: async (_ms, value, options = {}) => { options.signal?.throwIfAborted(); return value; } };
const r2 = loadTsModule("@/lib/r2-warehouse", { "@/lib/db/client": { prisma: {} }, "@/lib/redact-secrets": { redactSecrets: value => value }, "node:timers/promises": pause });
const key = "production/pr262/research-evidence/company-profiles-v1.json";
const identity = { ticker: "TEST", company: "Test Software", cik: "0000000001" };
const now = new Date("2026-10-06T12:00:00Z");
try {
  console.warn = console.info = () => {};
  for (const mode of ["transport_recovers", "transport_persistent", "http_persistent", "same_row_winner", "other_row_winner", "committed_ack_lost"]) {
    let body = null, etag = 0, puts = 0, sourceReads = 0;
    const set = value => { body = r2.encodeVersionedJsonForR2(key, value).body; etag++; };
    const winner = { ...identity, updatedAt: now.toISOString(), nextAttemptAt: now.toISOString(), profile: null, verificationHistoryKnown: true, error: "winner_history_preserved" };
    const other = { ticker: "OTHER", company: "Other Software", cik: "0000000002", profile: null };
    globalThis.fetch = async (url, init) => {
      assert.equal(new URL(url).hostname, "profile-storage.invalid");
      init.signal?.throwIfAborted();
      if (init.method === "GET") return body ? new Response(body, { headers: { etag: `"${etag}"` } }) : new Response(null, { status: 404 });
      assert.equal(init.method, "PUT"); puts++;
      assert.ok(init.headers["if-match"] || init.headers["if-none-match"]);
      if (mode === "transport_persistent" || (mode === "transport_recovers" && puts === 1)) throw new TypeError("fetch failed");
      if (mode === "http_persistent") return new Response(null, { status: 502 });
      if (puts === 1 && ["same_row_winner", "other_row_winner"].includes(mode)) {
        set({ version: 1, entries: [mode === "same_row_winner" ? winner : other] });
        return new Response(null, { status: 502 });
      }
      if (init.headers["if-match"] && init.headers["if-match"] !== `"${etag}"`) return new Response(null, { status: 412 });
      if (init.headers["if-none-match"] && body) return new Response(null, { status: 412 });
      body = Buffer.from(init.body); etag++;
      if (puts === 1 && mode === "committed_ack_lost") return new Response(null, { status: 502 });
      return new Response(null, { status: 200, headers: { etag: `"${etag}"` } });
    };
    const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", { "@/lib/r2-warehouse": r2, "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: relative => `production/pr262/${relative}` }, "node:timers/promises": pause });
    const ensure = () => cache.ensureCompanyProfile(identity, async () => { sourceReads++; return Response.json({ cik: 1, tickers: ["TEST"], filings: { recent: { form: [], filingDate: [], accessionNumber: [], primaryDocument: [] } } }); }, now);
    if (mode.endsWith("persistent")) {
      await assert.rejects(ensure, error => error.storageDomain === "r2_state" && /r2_state_write_(?:transport_failed|http_502)/.test(error.message));
      assert.equal(puts, 4, "Actual underlying PUT count stays within the profile helper's four-attempt budget");
      assert.equal(sourceReads, 0);
    } else if (mode === "same_row_winner") {
      await assert.rejects(ensure, /company_profile_cache_superseded/);
      assert.equal(puts, 1); assert.equal(sourceReads, 0);
      assert.deepEqual(JSON.parse(r2.decodeVersionedR2Text(body)).entries, [winner]);
    } else {
      assert.equal(await ensure(), null);
      assert.equal(sourceReads, 1, "Storage retries cannot repeat source collection");
      assert.equal(puts, mode === "committed_ack_lost" ? 2 : 3);
      if (mode === "other_row_winner") assert.deepEqual(JSON.parse(r2.decodeVersionedR2Text(body)).entries.find(row => row.ticker === "OTHER"), other);
    }
  }
  console.log("Real profile cache and R2 integration: transport retry, four-PUT ceiling, committed acknowledgment loss, same-row winner preservation and unrelated-row rebase passed.");
} finally {
  globalThis.fetch = savedFetch; console.warn = savedWarn; console.info = savedInfo;
  for (const name of Object.keys(process.env)) if (!(name in savedEnv)) delete process.env[name];
  Object.assign(process.env, savedEnv);
}
