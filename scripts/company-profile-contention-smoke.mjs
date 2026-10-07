import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";

const now = new Date("2026-10-07T00:00:00Z");
const key = "research-evidence/company-profiles-v1.json";
const identities = ["ALPHA", "BRAVO", "CHARLIE", "DELTA", "ECHO"].map((ticker, index) => ({ ticker,
  company: `${ticker} Software`, cik: String(index + 1).padStart(10, "0") }));
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const storageFailure = error => error.storageDomain === "r2_state" && error.storageOperation === "write";

function harness({ seed = [], beforePut, source, beforeRead } = {}) {
  const objects = new Map();
  if (seed.length) objects.set(key, { version: 1, entries: clone(seed) });
  const writes = [], requests = [], waits = [];
  let revision = 1, activePuts = 0, maxActivePuts = 0, conflicts = 0, profileReads = 0;
  const entries = () => objects.get(key)?.entries ?? [];
  const current = identity => entries().find(row => row.ticker === identity.ticker && row.cik === identity.cik);
  const replace = rows => { objects.set(key, { version: 1, entries: clone(rows) }); revision++; };
  const storage = {
    readVersionedTextFromR2: async (path, options = {}) => {
      options.signal?.throwIfAborted();
      if (path === key) {
        profileReads++;
        await beforeRead?.({ options, profileReads, writes, current, replace });
      }
      options.signal?.throwIfAborted();
      return objects.has(path) ? { found: true, text: JSON.stringify(objects.get(path)), etag: String(revision) }
        : { found: false, text: null, etag: null };
    },
    writeVersionedJsonToR2: async (path, value, options = {}) => {
      options.signal?.throwIfAborted();
      if (path !== key) { objects.set(path, clone(value)); return { written: true, conflict: false, etag: "source" }; }
      assert.ok(options.signal);
      assert.equal(options.maxAttempts, 1);
      assert.ok(options.expectedEtag || options.createOnly);
      const row = value.entries[0], stage = row.profile ? "verified" : row.error ? "failed" : "admission";
      const attempt = writes.filter(write => write.row.ticker === row.ticker && write.stage === stage).length + 1;
      const put = { row: clone(row), stage, attempt, options };
      writes.push(put); activePuts++; maxActivePuts = Math.max(maxActivePuts, activePuts);
      const commit = () => {
        options.signal.throwIfAborted();
        if ((options.createOnly && objects.has(key)) || (options.expectedEtag && options.expectedEtag !== String(revision))) {
          conflicts++; return { written: false, conflict: true };
        }
        replace(value.entries); return { written: true, conflict: false, etag: String(revision) };
      };
      try {
        // Remote PUTs can overlap, and the server compares the ETag at commit.
        await nextTurn();
        return await beforePut?.({ ...put, writes, current, replace, commit, entries }) ?? commit();
      } finally { activePuts--; }
    },
  };
  const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", {
    "@/lib/r2-warehouse": storage,
    "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: path => path },
    "node:timers/promises": { setTimeout: async (ms, value, options = {}) => {
      waits.push(ms); options.signal?.throwIfAborted(); await nextTurn(); options.signal?.throwIfAborted(); return value;
    } },
  });
  const ensure = (identity, options = {}) => cache.ensureCompanyProfile(identity, async (url, init) => {
    requests.push({ ticker: identity.ticker, url: String(url) });
    assert.ok(current(identity), "The issuer's admission must be durable before source work");
    if (source) await source({ identity, url: String(url), init });
    init.signal?.throwIfAborted();
    const fixture = companyProfileFixture(identity, now);
    if (String(url).includes("submissions")) return Response.json({ cik: Number(identity.cik), tickers: [identity.ticker],
      sicDescription: "Software", filings: { recent: { form: ["10-K"], filingDate: [fixture.sourceFiledAt],
        accessionNumber: ["0000000001-26-000001"], primaryDocument: ["annual.htm"] } } });
    return new Response(`<h2>Item 1. Business</h2><p>${fixture.business}</p><p>${"The company maintains regional facilities and provides ongoing implementation support for its software. ".repeat(8)}</p><h3>Customers</h3><p>${fixture.customers}</p><h2>Item 1A. Risk Factors</h2>`);
  }, now, options);
  return { ensure, writes, requests, waits, entries, current, replace, get maxActivePuts() { return maxActivePuts; },
    get conflicts() { return conflicts; }, get profileReads() { return profileReads; } };
}

// Manual deadlines keep queue and in-flight timeout checks deterministic.
async function withDeadlines(run) {
  const original = AbortSignal.timeout, deadlines = [];
  AbortSignal.timeout = ms => {
    const controller = new AbortController(); deadlines.push({ ms, controller }); return controller.signal;
  };
  try { await run({ deadlines, expire: (ms, index = 0) => {
    const timer = deadlines.filter(item => item.ms === ms)[index];
    assert.ok(timer, `Expected ${ms}ms transaction deadline ${index}`);
    timer.controller.abort(new DOMException(`Store deadline ${ms}`, "TimeoutError"));
    return timer.controller.signal.reason;
  } }); } finally { AbortSignal.timeout = original; }
}
const blockedUntilAbort = signal => new Promise((resolve, reject) => {
  signal.throwIfAborted();
  signal.addEventListener("abort", () => reject(signal.reason), { once: true });
});
const [alpha, bravo, charlie, delta, echo] = identities;
const savedInfo = console.info;
console.info = () => {};
try {
  const h = harness();
  const results = await Promise.all([h.ensure(alpha), h.ensure(bravo)]);
  assert.ok(results.every(Boolean));
  if (process.argv.includes("--characterize")) {
    console.log(JSON.stringify({ maxActivePuts: h.maxActivePuts, conflicts: h.conflicts,
      writes: h.writes.map(write => `${write.row.ticker}:${write.stage}:${write.attempt}`) }));
  } else {
    assert.equal(h.maxActivePuts, 1, "Same-process profile PUTs must be serialized");
    assert.equal(h.conflicts, 0);
    assert.equal(h.writes.length, 4);
    assert.equal(h.entries().length, 2);
    for (const identity of [alpha, bravo]) {
      assert.equal(h.current(identity).firstVerifiedAt, now.toISOString());
      assert.equal(h.current(identity).verificationHistoryKnown, true);
    }

    // The lock ends before source work. Both sources can wait in parallel;
    // refreshing them preserves known and unknown historical verification.
    const sourceGate = deferred(), bothSources = deferred(), sourceIssuers = new Set();
    const oldRows = [alpha, bravo].map((identity, index) => ({ ...identity,
      profile: { ...companyProfileFixture(identity, now), customers: "Unknown", description: "Invalid old profile" },
      updatedAt: "2026-10-01T00:00:00Z", nextAttemptAt: now.toISOString(), verificationHistoryKnown: true,
      ...(index === 0 ? { firstVerifiedAt: "2026-09-01T00:00:00Z" } : {}) }));
    const unrelated = { ...echo, updatedAt: "2026-09-01T00:00:00Z", profile: null,
      firstVerifiedAt: "2026-08-01T00:00:00Z", verificationHistoryKnown: true };
    const history = harness({ seed: [...oldRows, unrelated], source: async ({ identity, url }) => {
      if (!url.includes("submissions")) return;
      sourceIssuers.add(identity.ticker); if (sourceIssuers.size === 2) bothSources.resolve();
      await sourceGate.promise;
    } });
    const historyResult = Promise.all([history.ensure(alpha), history.ensure(bravo)]);
    await bothSources.promise;
    assert.equal(history.writes.length, 2, "Both admissions complete while source work waits");
    sourceGate.resolve(); assert.ok((await historyResult).every(Boolean));
    assert.equal(history.maxActivePuts, 1); assert.equal(history.conflicts, 0);
    assert.equal(history.current(alpha).firstVerifiedAt, oldRows[0].firstVerifiedAt);
    assert.equal(history.current(bravo).firstVerifiedAt, undefined);
    assert.equal(history.current(bravo).verificationHistoryKnown, true);
    assert.deepEqual(history.current(echo), unrelated);

    // Cancelling an admission waiting behind another writer issues no PUT or
    // source request, removes only its queue slot, and preserves FIFO order.
    for (const usePersistence of [false, true]) {
      const entered = deferred(), gate = deferred(), work = new AbortController();
      const queued = harness({ beforePut: async ({ row, stage }) => {
        if (row.ticker === alpha.ticker && stage === "admission") { entered.resolve(); await gate.promise; }
      } });
      const first = queued.ensure(alpha); await entered.promise;
      const cancelled = queued.ensure(bravo, { signal: work.signal,
        ...(usePersistence ? { persistenceSignal: new AbortController().signal } : {}) });
      const third = queued.ensure(charlie), fourth = queued.ensure(delta);
      await nextTurn(); work.abort(new DOMException("Work cutoff", "TimeoutError"));
      assert.equal(await cancelled, null);
      assert.equal(queued.writes.length, 1, "Cancelling a waiter must not release the current holder");
      assert.equal(queued.requests.length, 0);
      gate.resolve(); assert.ok((await Promise.all([first, third, fourth])).every(Boolean));
      assert.equal(queued.maxActivePuts, 1);
      assert.deepEqual(queued.writes.filter(write => write.stage === "admission").map(write => write.row.ticker), [alpha.ticker, charlie.ticker, delta.ticker]);
      assert.equal(queued.current(bravo), undefined);
    }

    // Independent queue timeout/persistence expiry must stay a storage error
    // even when a work abort follows. The cancelled slot must not leak a lock.
    for (const mode of ["store_timeout", "persistence"]) await withDeadlines(async ({ expire }) => {
      const entered = deferred(), gate = deferred(), work = new AbortController(), persistence = new AbortController();
      const queued = harness({ beforePut: async ({ row, stage }) => {
        if (row.ticker === alpha.ticker && stage === "admission") { entered.resolve(); await gate.promise; }
      } });
      const first = queued.ensure(alpha); await entered.promise;
      const second = queued.ensure(bravo, { signal: work.signal, persistenceSignal: persistence.signal });
      const rejected = assert.rejects(second, error => storageFailure(error) && error.cause === reason && !error.safeRoleDeferral);
      const third = queued.ensure(charlie); await nextTurn();
      const reason = mode === "store_timeout" ? expire(15_000, 1) : new DOMException("Persistence cutoff", "TimeoutError");
      if (mode === "persistence") persistence.abort(reason);
      work.abort(new DOMException("Coincident work cutoff", "TimeoutError"));
      await rejected; assert.equal(queued.writes.length, 1);
      gate.resolve(); assert.ok((await Promise.all([first, third])).every(Boolean));
      assert.equal(queued.maxActivePuts, 1); assert.equal(queued.current(bravo), undefined);
    });

    // A permanent failure inside the critical section releases the next writer.
    const failureEntered = deferred(), failureGate = deferred();
    const failing = harness({ beforePut: async ({ row }) => {
      if (row.ticker === alpha.ticker) { failureEntered.resolve(); await failureGate.promise; throw new Error("r2_state_write_http_403"); }
    } });
    const failure = failing.ensure(alpha), failureResult = assert.rejects(failure, error => storageFailure(error) && error.message === "r2_state_write_http_403");
    await failureEntered.promise; const survivor = failing.ensure(bravo); await nextTurn();
    failureGate.resolve(); await failureResult; assert.ok(await survivor);
    assert.equal(failing.maxActivePuts, 1); assert.equal(failing.requests.filter(row => row.ticker === alpha.ticker).length, 0);

    // A cross-process winner can change a queued caller's own row. Admission
    // must defer without failing the batch, issuing source I/O, or overwriting
    // the winner. The next pass re-reads the winner and applies its backoff.
    const winnerEntered = deferred(), winnerGate = deferred();
    const winner = { ...bravo, updatedAt: now.toISOString(), profile: null, verificationHistoryKnown: true,
      firstVerifiedAt: "2026-08-01T00:00:00Z", error: "external_writer" };
    const external = harness({ beforePut: async ({ row, stage, commit, replace, entries }) => {
      if (row.ticker !== alpha.ticker || stage !== "admission") return;
      winnerEntered.resolve(); await winnerGate.promise;
      const result = commit(); replace([...entries(), winner]); return result;
    } });
    const winnerFirst = external.ensure(alpha); await winnerEntered.promise;
    const winnerSecond = external.ensure(bravo);
    await nextTurn(); winnerGate.resolve(); assert.ok(await winnerFirst); assert.equal(await winnerSecond, null);
    assert.deepEqual(external.current(bravo), winner);
    assert.equal(external.writes.filter(write => write.row.ticker === bravo.ticker).length, 0);
    assert.equal(external.requests.filter(row => row.ticker === bravo.ticker).length, 0);

    // The critical section includes lost-acknowledgment reconciliation. A
    // queued writer cannot intervene between an ambiguous PUT and its readback.
    const readbackEntered = deferred(), readbackGate = deferred();
    let readbackHeld = false;
    const ambiguous = harness({ beforePut: ({ row, stage, commit }) => {
      if (row.ticker === alpha.ticker && stage === "admission") { commit(); throw new Error("r2_state_write_http_502"); }
    }, beforeRead: async ({ options, writes }) => {
      if (!readbackHeld && options.signal && writes.length === 1) {
        readbackHeld = true; readbackEntered.resolve(); await readbackGate.promise;
      }
    } });
    const ambiguousFirst = ambiguous.ensure(alpha); await readbackEntered.promise;
    const ambiguousSecond = ambiguous.ensure(bravo); await nextTurn();
    assert.equal(ambiguous.writes.length, 1); readbackGate.resolve();
    assert.ok((await Promise.all([ambiguousFirst, ambiguousSecond])).every(Boolean));
    assert.equal(ambiguous.writes.length, 4, "An applied intent receives no duplicate PUT");
    assert.equal(ambiguous.maxActivePuts, 1);

    // Exhausting the existing four-PUT limit also releases the next writer.
    const capped = harness({ beforePut: ({ row }) => row.ticker === alpha.ticker ? { written: false, conflict: true } : undefined });
    const capFirst = assert.rejects(capped.ensure(alpha), error => storageFailure(error) && error.message === "company_profile_cache_conflict");
    const capSecond = capped.ensure(bravo); await capFirst; assert.ok(await capSecond);
    assert.equal(capped.writes.filter(write => write.row.ticker === alpha.ticker).length, 4);
    assert.deepEqual(capped.waits, [100, 200, 400]); assert.equal(capped.maxActivePuts, 1);

    // An in-flight PUT retains the 15s cap. Cancellation releases the mutex
    // only after the operation rejects; the next caller keeps its own budget.
    await withDeadlines(async ({ expire, deadlines }) => {
      const entered = deferred();
      const timed = harness({ beforePut: async ({ row, options }) => {
        if (row.ticker === alpha.ticker) { entered.resolve(); await blockedUntilAbort(options.signal); }
      } });
      const first = assert.rejects(timed.ensure(alpha), error => storageFailure(error) && error.cause?.name === "TimeoutError");
      await entered.promise; const second = timed.ensure(bravo); await nextTurn();
      assert.equal(deadlines.filter(timer => timer.ms === 15_000).length, 2, "Queue time is inside each caller's original 15s deadline");
      expire(15_000); await first; assert.ok(await second);
      assert.equal(timed.writes.filter(write => write.row.ticker === alpha.ticker).length, 1);
      assert.equal(timed.maxActivePuts, 1);
    });

    // A final verified row waiting behind admission can outlive the work cutoff
    // with an independent persistence signal, just like an in-flight final PUT.
    await withDeadlines(async ({ deadlines }) => {
      const bravoEntered = deferred(), bravoGate = deferred(), work = new AbortController();
      const finalizing = harness({ beforePut: async ({ row, stage }) => {
        if (row.ticker === bravo.ticker && stage === "admission") { bravoEntered.resolve(); await bravoGate.promise; }
      }, source: async ({ identity, url }) => {
        if (identity.ticker === alpha.ticker && !url.includes("submissions")) await bravoEntered.promise;
      } });
      const first = finalizing.ensure(alpha, { signal: work.signal, persistenceSignal: new AbortController().signal });
      const second = finalizing.ensure(bravo); await bravoEntered.promise; await nextTurn();
      assert.equal(deadlines.filter(timer => timer.ms === 15_000).length, 3, "Alpha's finalization is queued");
      work.abort(new DOMException("Work cutoff", "TimeoutError")); await nextTurn();
      assert.equal(finalizing.writes.length, 2); bravoGate.resolve();
      assert.ok((await Promise.all([first, second])).every(Boolean));
      assert.ok(finalizing.current(alpha).profile); assert.equal(finalizing.current(alpha).error, undefined);
    });

    // Cleanup queue time consumes its five-second allowance; an expired waiter
    // never issues its one allowed PUT and never cancels the current writer.
    await withDeadlines(async ({ expire, deadlines }) => {
      const bravoEntered = deferred(), bravoGate = deferred(), work = new AbortController();
      const cleanup = harness({ beforePut: async ({ row, stage }) => {
        if (row.ticker === bravo.ticker && stage === "admission") { bravoEntered.resolve(); await bravoGate.promise; }
      }, source: async ({ identity, init }) => {
        if (identity.ticker !== alpha.ticker) return;
        await bravoEntered.promise; work.abort(new DOMException("Work cutoff", "TimeoutError")); init.signal.throwIfAborted();
      } });
      const first = assert.rejects(cleanup.ensure(alpha, { signal: work.signal, persistenceSignal: new AbortController().signal }),
        error => storageFailure(error) && error.cause?.message === "Store deadline 5000");
      const second = cleanup.ensure(bravo); await bravoEntered.promise; await nextTurn();
      assert.equal(deadlines.filter(timer => timer.ms === 5_000).length, 1);
      expire(5_000); await first;
      assert.equal(cleanup.writes.length, 2, "Expired cleanup has no PUT allowance left");
      bravoGate.resolve(); assert.ok(await second); assert.equal(cleanup.maxActivePuts, 1);
      assert.equal(cleanup.current(alpha).error, undefined);
    });

    // Cleanup still has only one PUT, and an in-flight cleanup still ends at 5s.
    for (const mode of ["conflict", "timeout"]) await withDeadlines(async ({ expire }) => {
      const work = new AbortController(), entered = deferred();
      const cleanup = harness({ source: async ({ init }) => { work.abort(); init.signal.throwIfAborted(); },
        beforePut: async ({ stage, options }) => {
          if (stage !== "failed") return;
          entered.resolve();
          if (mode === "timeout") await blockedUntilAbort(options.signal);
          return { written: false, conflict: true };
        } });
      const result = assert.rejects(cleanup.ensure(alpha, { signal: work.signal }), error => storageFailure(error)
        && (mode === "conflict" ? error.message === "company_profile_cache_conflict" : error.cause?.message === "Store deadline 5000"));
      await entered.promise; if (mode === "timeout") expire(5_000); await result;
      assert.equal(cleanup.writes.length, 2); assert.equal(cleanup.writes.filter(write => write.stage === "failed").length, 1);
      assert.equal(cleanup.requests.length, 1); assert.deepEqual(cleanup.waits, []);
    });
    console.log("PASS: real profile writers serialize read/CAS/readback, preserve parallel sources/history/FIFO, cancel bounded waits, release failed writers, defer to external winners, and retain four-PUT/15s and cleanup one-PUT/5s limits.");
  }
} finally { console.info = savedInfo; }
