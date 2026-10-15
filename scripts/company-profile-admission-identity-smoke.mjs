import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// No network, live R2, provider calls or external changes. To demonstrate the
// original defect, supply --baseline-root followed by an unchanged checkout.
const baselineAt = process.argv.indexOf("--baseline-root");
const baseline = baselineAt >= 0;
const sourceRoot = baseline ? resolve(process.argv[baselineAt + 1]) : process.cwd();
const { loadTsModule } = await import(pathToFileURL(resolve(sourceRoot, "scripts/helpers/load-typescript-module.mjs")));
const { companyProfileFixture } = await import(pathToFileURL(resolve(sourceRoot, "scripts/helpers/company-profile-fixture.mjs")));
const now = new Date("2026-10-11T12:00:00.000Z");
const identity = { ticker: "TEST", company: "Current Software", cik: "0000000001" };
const oldIdentity = { ...identity, company: "Former Software" };
const fixture = companyProfileFixture(identity, now);
const key = "research-evidence/company-profiles-v1.json";
const listing = { ...identity, name: identity.company, securityType: "common_stock", exchange: "Nasdaq", sourceNames: ["SEC company_tickers_exchange"] };
const seedRow = extra => ({ ...identity, updatedAt: "2026-10-01T00:00:00.000Z", nextAttemptAt: "2026-10-01T01:00:00.000Z", profile: null, parserRevision: COMPANY_PROFILE_PARSER_REVISION, ...extra });
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const failClosed = error => error.storageDomain === "r2_state" && error.storageOperation === "write";
const { redactSecrets } = loadTsModule("@/lib/redact-secrets");
const { COMPANY_PROFILE_PARSER_REVISION, verifiedCompanyProfile, profileCik } = loadTsModule("@/lib/company-profile");
const html = `<h2>Item 1. Business</h2><p>${fixture.business}</p><p>${"The company maintains regional facilities and provides ongoing implementation support for its software. ".repeat(8)}</p><h3>Customers</h3><p>${fixture.customers}</p><h2>Item 1A. Risk Factors</h2>`;

function harness({ seed = [], onRead, onFetch, sourceFailure } = {}) {
  const objects = new Map([[key, { version: 1, entries: clone(seed) }]]);
  let revision = 1, profileReads = 0;
  const writes = [], requests = [], paths = [], logs = [];
  const rows = () => objects.get(key).entries;
  const current = () => rows().find(row => row.ticker === identity.ticker && profileCik(row.cik) === identity.cik);
  const replace = next => { objects.set(key, { version: 1, entries: clone(next) }); revision++; };
  const context = () => ({ rows, current, replace, objects, writes, requests, profileReads });
  const storage = {
    readVersionedTextFromR2: async (path, options = {}) => {
      options.signal?.throwIfAborted();
      paths.push(path);
      if (path === key) { profileReads++; await onRead?.(context()); }
      const value = objects.get(path);
      return { found: value !== undefined, text: value === undefined ? null : JSON.stringify(value), etag: value === undefined ? null : String(revision) };
    },
    writeVersionedJsonToR2: async (path, value, options = {}) => {
      options.signal?.throwIfAborted();
      if (path === key) {
        assert.ok(options.signal, "Every profile PUT remains bounded");
        assert.equal(options.maxAttempts, 1);
        assert.ok(options.expectedEtag || options.createOnly, "Every profile PUT remains conditional");
      }
      writes.push({ path, value: clone(value), options });
      if ((options.expectedEtag && options.expectedEtag !== String(revision)) || (options.createOnly && objects.has(path))) {
        return { written: false, conflict: true };
      }
      objects.set(path, clone(redactSecrets(value)));
      revision++;
      return { written: true, conflict: false, etag: String(revision) };
    },
  };
  const overrides = {
    "@/lib/r2-warehouse": storage,
    "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: path => path },
    "@/lib/simple-alert-pilot-scope": { pilotCompanies: () => [] },
  };
  const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", overrides);
  const builder = loadTsModule("@/lib/simple-alert-profile-builder", { ...overrides, "@/lib/opportunity-engine/company-profile-cache": cache });
  const profileWrites = () => writes.filter(write => write.path === key);
  const ensure = async (at = now) => {
    const previousWarn = console.warn, previousInfo = console.info;
    console.warn = message => { if (String(message).startsWith("[company-profile-storage] ")) logs.push(JSON.parse(message.slice(message.indexOf("{")))); };
    console.info = () => {};
    try {
      return await cache.ensureCompanyProfile(identity, async url => {
        const path = String(url);
        requests.push(path);
        assert.ok(profileWrites().length, "Durable admission precedes every source request");
        assert.equal(current().profile, null, "Admission clears unverified profiles before source work");
        assert.ok(Date.parse(current().nextAttemptAt) > Date.parse(current().updatedAt));
        await onFetch?.({ ...context(), path });
        if (sourceFailure) throw new Error(sourceFailure);
        if (path.includes("submissions")) return Response.json({ cik: 1, tickers: ["TEST"], sicDescription: "Software", filings: { recent: {
          form: ["10-K"], filingDate: [fixture.sourceFiledAt], accessionNumber: ["0000000001-26-000001"], primaryDocument: ["annual.htm"],
        } } });
        assert.equal(path, fixture.sourceUrl, "A renamed issuer does not fetch the old name's saved filing");
        const response = new Response(html);
        Object.defineProperty(response, "url", { value: path });
        return response;
      }, at);
    } finally { console.warn = previousWarn; console.info = previousInfo; }
  };
  const plan = () => builder.profileBatchPlan([listing], rows(), now, 100);
  const counts = () => ({ daily: plan().newlyVerifiedToday, run: builder.firstVerifiedCompaniesThisRun(seed, rows(), now) });
  return { ensure, current, rows, logs, paths, writes, requests, profileWrites, plan, counts, get profileReads() { return profileReads; } };
}

const defects = [
  ["stationary renamed issuer", { company: oldIdentity.company }],
  ["unpadded legacy CIK", { cik: "1" }],
  ["redacted legacy metadata", { error: "Bearer ABCDEFGHIJKLMNOPQRSTUVWXYZ" }],
];
for (const [name, extra] of defects) {
  const h = harness({ seed: [seedRow(extra)] });
  if (baseline) {
    for (let pass = 0; pass < 3; pass++) {
      assert.equal(h.plan().due.length, 1);
      assert.equal(await h.ensure(), null);
    }
    assert.equal(h.profileWrites().length, 0);
    assert.equal(h.requests.length, 0);
    assert.equal(h.logs.length, 3);
    assert.ok(h.logs.every(log => log.stage === "admission" && log.phase === "read" && log.writes === 0
      && log.cause === "company_profile_cache_superseded" && !log.transactionDeadline && !log.workDeadline
      && !log.persistenceDeadline && log.settlement === "not_attempted"));
    console.log(`BASELINE DEFECT: ${name}; unchanged storage, repeated zero-write deferrals`);
  } else {
    const profile = await h.ensure();
    assert.ok(verifiedCompanyProfile(profile, identity, now), name);
    assert.equal(h.profileWrites().length, 2, name);
    assert.equal(h.requests.length, 2, name);
    assert.equal(h.rows().length, 1, "Canonical CIK migration does not duplicate a row");
    assert.equal(h.current().cik, identity.cik);
    assert.equal(h.current().company, identity.company);
    assert.equal(h.logs.length, 0);
    assert.deepEqual(h.counts(), { daily: 1, run: 1 });
    await h.ensure();
    assert.equal(h.profileWrites().length, 2, "Second call reuses the valid profile");
    assert.equal(h.requests.length, 2);
    console.log(`PASS: ${name}`);
  }
}

if (!baseline) {
  // Different raw metadata changes must not collapse under redaction during CAS.
  for (const mode of ["same_time_name", "history_only", "redaction_equivalent"]) {
    const prior = seedRow({ error: "Bearer ABCDEFGHIJKLMNOPQRSTUVWXYZ" });
    let winner;
    const h = harness({ seed: [prior], onRead: ({ profileReads, current, replace }) => {
      if (profileReads !== 2) return;
      winner = { ...current(), ...(mode === "same_time_name" ? { company: "Concurrent Company" }
        : mode === "history_only" ? { verificationHistoryKnown: true } : { error: "Bearer ZYXWVUTSRQPONMLKJIHGFEDCBA" }) };
      replace([winner]);
    } });
    assert.equal(await h.ensure(), null);
    assert.equal(h.requests.length, 0);
    assert.equal(h.writes.length, 0);
    assert.deepEqual(h.rows(), [winner]);
    assert.equal(h.logs.at(-1).cause, "company_profile_cache_superseded");
  }
  console.log("PASS: same-time name/history changes and redaction-equivalent competing metadata preserve the winner");

  for (const earlyReturn of ["due", "cached", "backoff"]) {
    const extra = earlyReturn === "cached" ? { profile: fixture } : earlyReturn === "backoff" ? { nextAttemptAt: "2026-10-12T12:00:00.000Z" } : {};
    const rows = [seedRow(extra), seedRow({ ...extra, cik: "1" })];
    const h = harness({ seed: rows });
    await assert.rejects(h.ensure, /company_profile_cache_state_invalid/);
    assert.equal(h.writes.length, 0);
    assert.equal(h.requests.length, 0);
    assert.deepEqual(h.rows(), rows);
  }
  console.log("PASS: duplicate canonical rows fail closed before due/cache/backoff branches");

  const differentIssuer = seedRow({ cik: "0000000002", company: "Other Issuer", verificationHistoryKnown: true, nextAttemptAt: "2026-10-12T12:00:00.000Z" });
  const other = harness({ seed: [differentIssuer] });
  assert.ok(await other.ensure());
  assert.deepEqual(other.rows().find(row => row.cik === differentIssuer.cik), differentIssuer);
  assert.equal(other.rows().length, 2);
  assert.deepEqual(other.counts(), { daily: 1, run: 1 });
  console.log("PASS: same ticker with a different CIK remains a separate issuer");

  for (const company of [identity.company, oldIdentity.company]) {
    const deferred = seedRow({ company, error: "provider_budget_deferred", nextAttemptAt: "2026-10-12T12:00:00.000Z" });
    const h = harness({ seed: [deferred] });
    assert.equal(await h.ensure(), null);
    assert.equal(h.profileReads, 1);
    assert.equal(h.writes.length, 0);
    assert.equal(h.requests.length, 0);
    assert.deepEqual(h.rows(), [deferred]);
  }
  console.log("PASS: provider backoff survives changed display names");

  for (const firstVerifiedAt of [undefined, "2026-10-10T12:00:00.000Z", "2026-10-11T11:00:00.000Z"]) {
    const oldProfile = companyProfileFixture(oldIdentity, now);
    const prior = seedRow({ company: oldIdentity.company, profile: oldProfile, firstVerifiedAt,
      nextAttemptAt: "2026-11-10T12:00:00.000Z", filing: { url: fixture.sourceUrl.replace("annual.htm", "old-name.htm"),
        form: "10-K", filedAt: fixture.sourceFiledAt, industry: "Old sector", checkedAt: now.toISOString() }, cachedParserRevision: 7 });
    const h = harness({ seed: [prior] });
    assert.ok(await h.ensure(), "Invalid prior success bypasses its stale refresh date");
    assert.equal(h.current().verificationHistoryKnown, true);
    assert.equal(h.current().firstVerifiedAt, firstVerifiedAt, "Known dates survive; unknown history is not dated today");
    assert.equal(h.requests[0], `https://data.sec.gov/submissions/CIK${identity.cik}.json`);
    assert.ok(h.paths.every(path => !path.includes("old-name")), "No saved source association from the old name is read");
    assert.equal(h.profileWrites()[0].value.entries[0].filing, undefined);
    assert.equal(h.profileWrites()[0].value.entries[0].cachedParserRevision, undefined);
    assert.deepEqual(h.counts(), { daily: firstVerifiedAt?.startsWith("2026-10-11") ? 1 : 0, run: 0 });
  }
  console.log("PASS: renamed legacy successes retain known/unknown history and force fresh filing metadata");

  const mismatchedEnvelope = harness({ seed: [seedRow({ company: oldIdentity.company, profile: fixture })] });
  assert.ok(await mismatchedEnvelope.ensure());
  assert.equal(mismatchedEnvelope.current().company, identity.company, "Stale envelope identity must be repaired even if inner profile matches");
  assert.equal(mismatchedEnvelope.profileWrites().length, 2);
  assert.equal(mismatchedEnvelope.plan().due.length, 0, "Planner stops selecting the repaired envelope");
  console.log("PASS: current-name inner profile cannot strand a stale-name outer row");

  const failingLegacy = seedRow({ company: oldIdentity.company, profile: companyProfileFixture(oldIdentity, now) });
  const failure = harness({ seed: [failingLegacy], sourceFailure: "provider_budget_deferred; next_retry_at=2026-10-12T12:00:00.000Z" });
  assert.equal(await failure.ensure(), null);
  assert.equal(failure.current().verificationHistoryKnown, true);
  assert.equal(failure.current().firstVerifiedAt, undefined);
  assert.equal(failure.current().nextAttemptAt, "2026-10-12T12:00:00.000Z");
  await failure.ensure(new Date(now.getTime() + 60000));
  assert.equal(failure.requests.length, 1);
  assert.equal(failure.profileWrites().length, 2);
  console.log("PASS: failed rename repair persists unknown history and provider backoff");

  let finalWinner;
  const finalRace = harness({ onFetch: ({ path, current, replace }) => {
    if (path.includes("submissions")) return;
    finalWinner = { ...current(), verificationHistoryKnown: true };
    replace([finalWinner]);
  } });
  await assert.rejects(finalRace.ensure, error => failClosed(error) && error.message === "company_profile_cache_superseded");
  assert.equal(finalRace.profileWrites().length, 1, "Finalization cannot overwrite a same-time winner");
  assert.deepEqual(finalRace.rows(), [finalWinner]);
  console.log("PASS: post-source same-row supersession still fails closed");

  console.log("Profile admission identity regression passed with synthetic storage and source I/O only.");
}
