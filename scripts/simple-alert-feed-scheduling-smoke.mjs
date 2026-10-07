import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTsModule } from './helpers/load-typescript-module.mjs';
const repo = new URL('../', import.meta.url);
const cohort = JSON.parse(readFileSync(new URL('config/simple-alert-pilot.json', repo))).companies;
const seeds = JSON.parse(readFileSync(new URL('config/simple-alert-issuer-sources.json', repo))).companies;
// First-item metadata from issuer RSS read on 2026-10-07. Descriptions and other items
// are omitted only in this fixture; runtime source handling is unchanged.
const pgyRss = readFileSync(new URL('./fixtures/pgy-rss-2026-10-07.xml', import.meta.url), 'utf8');
const RealDate = Date, realTimeout = AbortSignal.timeout, realAny = AbortSignal.any;
const start = RealDate.parse('2026-10-07T04:18:28.639Z');
let clock = start;
class TestDate extends RealDate { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
const deadlines = new WeakMap();
AbortSignal.timeout = ms => { const signal = new AbortController().signal; deadlines.set(signal, clock + ms); return signal; };
AbortSignal.any = signals => { const signal = realAny(signals); deadlines.set(signal, Math.min(...signals.map(value => deadlines.get(value) ?? Infinity))); return signal; };
globalThis.Date = TestDate;
function step(ms, signal) {
  signal?.throwIfAborted();
  const deadline = deadlines.get(signal) ?? Infinity;
  if (clock + ms >= deadline) { clock = deadline; throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); }
  clock += ms;
}
async function scenario({ secTotalMs = 13000, feedMs = 6534, rootMs = 4152, nestedMs = 4800, rootStatus = 200, nested = true, outerMs = 51740, registryMs = 0, secLastMs = null } = {}) {
  clock = start;
  const now = new Date(start - 8258);
  const future = new Date(start + 3600000).toISOString();
  let persisted = null;
  const registry = { version: 1, updatedAt: now.toISOString(), lastDiscoveryCycleAt: '2026-10-07T00:00:00Z', entries: cohort.map((row, index) => {
    const seed = seeds.find(seed => seed.cik === row.cik);
    return { ...row, investorWebsite: seed.investorWebsite, feedUrl: seed.feedUrl,
      discoveredAt: now.toISOString(), lastDiscoveryAt: '2026-10-06T00:00:00Z', lastCheckedAt: row.ticker === 'PGY' ? '2026-10-07T03:16:00Z' : null, lastSuccessAt: row.ticker === 'PGY' ? '2026-10-07T01:34:15.345Z' : null,
      nextCheckAt: ['AI','PGY'].includes(row.ticker) ? null : future, error: ['AI','PGY'].includes(row.ticker) ? 'direct_feed_timeout' : null, consecutiveFailures: row.ticker === 'PGY' ? 3 : 0,
      sec: { sourceUrl: `https://data.sec.gov/submissions/CIK${row.cik}.json`, nextCheckAt: index < 13 ? null : future,
        lastCheckedAt: null, lastSuccessAt: null, snapshotFetchedAt: null, snapshotOrigin: null, error: null } };
  }) };
  const calls = [];
  let secRequests = 0;
  const monitor = loadTsModule('@/lib/opportunity-engine/pr262-direct-announcements', {
    '@/lib/simple-alert-pilot-runtime': { isSimpleAlertPilot: () => true },
    '@/lib/simple-alert-pilot-scope': { pilotCompanies: () => cohort },
    '@/lib/opportunity-engine/pr262-storage': { pr262StorageKey: relative => 'test/' + relative },
    'node:dns/promises': { lookup: async () => [{address:'93.184.216.34',family:4}] },
    'node:timers/promises': { setTimeout: async (ms, _, options) => step(ms, options?.signal) },
    '@/lib/r2-warehouse': {
      readVersionedTextFromR2: async (_, options) => { step(registryMs, options?.signal); return {found:true,text:JSON.stringify(registry),etag:'read'}; },
      writeVersionedJsonToR2: async (_, value) => { persisted = structuredClone(value); return {written:true,conflict:false,etag:'write'}; }
    }
  });
  const result = await monitor.runPr262DirectAnnouncementMonitor({exposure:cohort, now, ...(outerMs === null ? {} : {deadlineAtMs:start + outerMs}),
    fetchImpl: async (request, init) => {
      const url = String(request), began = clock, deadline = deadlines.get(init.signal);
      calls.push({url, startedMs:began-start, effectiveNetworkAllowanceMs:deadline-began});
      const company = cohort.find(row => url === `https://data.sec.gov/submissions/CIK${row.cik}.json`);
      if (company) { secRequests++; step(secLastMs === null ? secTotalMs / 13 : secRequests === 13 ? secLastMs : (secTotalMs - secLastMs) / 12, init.signal); return Response.json({cik:Number(company.cik),tickers:[company.ticker],filings:{recent:{accessionNumber:[],form:[],filingDate:[],primaryDocument:[]},files:[]}}); }
      if (url === 'https://ir.c3.ai/') { step(rootMs, init.signal); return new Response(nested ? '<html><body><a href="/news/a">News a</a><a href="/news/b">News b</a></body></html>' : '<html>No feed</html>', {status: rootStatus}); }
      if (url.startsWith('https://ir.c3.ai/news/')) { step(nestedMs, init.signal); return new Response('<html>Mock news page without a linked feed</html>'); }
      if (url === 'https://investor.pagaya.com/rss/news-releases.xml') { step(feedMs, init.signal); return new Response(pgyRss, {headers: {'content-type':'application/rss+xml; charset=utf-8'}}); }
      throw new Error('Unexpected mock source: ' + url);
    }});
  assert.ok(result.secCheckAttempts <= 13);
  assert.equal(result.secCheckSuccesses,result.secCheckAttempts);
  assert.equal(result.sourcePreparationFailures,0);
  assert.equal(result.registryPersistence.written,true);
  assert.ok(clock <= start + (outerMs ?? 50000));
  for (let i=1; i<calls.length; i++) assert.ok(calls[i].startedMs-calls[i-1].startedMs >= 999.9, 'All requests retain sequential one-second pacing');
  return {secTotalMs, events:result.events, directWorkBudgetMs:result.directWorkBudgetMs, elapsedMs:clock-start, attempts:result.attemptCount, failures:result.failureCount,
    secChecks:result.secCheckAttempts, feedDeferred:result.feedDeferred, discoveryDeferred:result.discoveryDeferred, feedSuccesses:result.feedSuccesses, discoverySuccesses:result.discoverySuccesses, sourcePreparationFailures:result.sourcePreparationFailures, lastDiscoveryCycleAt:persisted.lastDiscoveryCycleAt,
    discoveryFailures:result.discoveryFailures, feedFailures:result.feedFailures, sourceCollectionDeadlineReached:result.sourceCollectionDeadlineReached,
    calls:calls.filter(row => !row.url.includes('data.sec.gov')), rows:persisted.entries.filter(row => ['AI','PGY'].includes(row.ticker)).map(row => ({ticker:row.ticker,error:row.error,lastSuccessAt:row.lastSuccessAt,nextCheckAt:row.nextCheckAt,lastCheckedAt:row.lastCheckedAt,lastDiscoveryAt:row.lastDiscoveryAt,consecutiveFailures:row.consecutiveFailures}))};
}
try {
  const busy = await scenario({secTotalMs:37674,outerMs:50000});
  assert.equal(busy.secChecks,13);
  assert.equal(busy.attempts,13);
  assert.equal(busy.failures,0);
  assert.equal(busy.feedDeferred,1);
  assert.equal(busy.discoveryDeferred,1);
  assert.equal(busy.calls.length,0);
  assert.equal(busy.lastDiscoveryCycleAt,'2026-10-07T00:00:00Z');
  for (const row of busy.rows) {
    assert.equal(row.lastCheckedAt,row.ticker === 'PGY' ? '2026-10-07T03:16:00Z' : null);
    assert.equal(row.lastSuccessAt,row.ticker === 'PGY' ? '2026-10-07T01:34:15.345Z' : null);
    assert.equal(row.lastDiscoveryAt,'2026-10-06T00:00:00Z');
    assert.equal(row.nextCheckAt,null);
    assert.equal(row.error,'direct_feed_timeout');
  }
  assert.equal(busy.rows.find(row => row.ticker === 'PGY').consecutiveFailures,3);
  const observedSlack = await scenario({secTotalMs:37674});
  assert.equal(observedSlack.directWorkBudgetMs,46740);
  assert.equal(observedSlack.secChecks,13);
  assert.equal(observedSlack.feedSuccesses,1);
  assert.equal(observedSlack.discoveryDeferred,1);
  assert.equal(observedSlack.failures,0);
  assert.equal(observedSlack.calls.length,1);
  assert.equal(observedSlack.calls[0].effectiveNetworkAllowanceMs,8000);
  assert.ok(observedSlack.events.some(event => event.ticker === 'PGY' && event.observedAt === '2026-10-06T12:30:00.000Z'), 'Source-derived publication dates and exact issuer mapping survive the valid read');
  assert.ok(observedSlack.elapsedMs < 46740, 'PGY completes with the full 5s registry reserve intact');
  const slowFeedWithSlack = await scenario({secTotalMs:37674,feedMs:Infinity});
  assert.equal(slowFeedWithSlack.secChecks,13);
  assert.equal(slowFeedWithSlack.attempts,14);
  assert.equal(slowFeedWithSlack.feedFailures,1);
  assert.equal(slowFeedWithSlack.calls[0].effectiveNetworkAllowanceMs,8000);
  assert.equal(slowFeedWithSlack.discoveryDeferred,1);
  const standalone = await scenario({secTotalMs:37674,outerMs:null});
  assert.equal(standalone.directWorkBudgetMs,45000);
  assert.equal(standalone.feedDeferred,1);
  assert.equal(standalone.calls.length,0);
  const unboundedCaller = await scenario({secTotalMs:37674,outerMs:Infinity});
  assert.equal(unboundedCaller.directWorkBudgetMs,45000);
  assert.equal(unboundedCaller.feedDeferred,1);
  const excessiveCaller = await scenario({outerMs:120000});
  assert.equal(excessiveCaller.directWorkBudgetMs,55000, 'A malformed longer caller deadline cannot exceed the defensive 60s envelope minus registry reserve');
  const pacingDoesNotFit = await scenario({secTotalMs:37000,secLastMs:50,outerMs:50000});
  assert.equal(pacingDoesNotFit.feedDeferred,1);
  assert.equal(pacingDoesNotFit.calls.length,0, 'An apparent 8s remainder cannot admit a feed whose initial pacing consumes 950ms');
  const discoveryPacingDoesNotFit = await scenario({secTotalMs:24950,feedMs:50,outerMs:50000});
  assert.equal(discoveryPacingDoesNotFit.feedSuccesses,1);
  assert.equal(discoveryPacingDoesNotFit.discoveryDeferred,1);
  assert.equal(discoveryPacingDoesNotFit.calls.length,1, 'An apparent 20s remainder cannot admit a chain whose initial pacing consumes 950ms');
  const feedFits = await scenario({secTotalMs:35000});
  assert.equal(feedFits.secChecks,13);
  assert.equal(feedFits.feedSuccesses,1);
  assert.equal(feedFits.discoveryDeferred,1);
  assert.equal(feedFits.calls.length,1);
  assert.equal(feedFits.calls[0].effectiveNetworkAllowanceMs,8000);
  assert.equal(feedFits.rows.find(row => row.ticker === 'PGY').consecutiveFailures,0);
  const complete = await scenario();
  assert.equal(complete.secChecks,13);
  assert.equal(complete.feedSuccesses,1);
  assert.equal(complete.discoverySuccesses,1);
  assert.equal(complete.failures,0);
  assert.equal(complete.calls.length,4);
  assert.ok(complete.calls[0].url.includes('pagaya'));
  assert.deepEqual(complete.calls.map(row=>row.effectiveNetworkAllowanceMs),[8000,8000,5000,5000]);
  const fastPages = await scenario({feedMs:50,rootMs:50,nestedMs:50});
  assert.equal(fastPages.failures,0);
  assert.deepEqual(fastPages.calls.map(row=>row.effectiveNetworkAllowanceMs),[8000,8000,5000,5000]);
  const slowFeed = await scenario({secTotalMs:35000,feedMs:Infinity});
  assert.equal(slowFeed.feedFailures,1);
  assert.equal(slowFeed.failures,1);
  assert.equal(slowFeed.attempts,14);
  assert.equal(slowFeed.rows.find(row=>row.ticker==='PGY').consecutiveFailures,4);
  const feedUsesFinalSlice = await scenario({secTotalMs:13000,outerMs:26000,feedMs:Infinity});
  assert.equal(feedUsesFinalSlice.attempts,14);
  assert.equal(feedUsesFinalSlice.feedFailures,1);
  assert.equal(feedUsesFinalSlice.discoveryDeferred,1, 'Discovery due after a final feed timeout must still be counted as unstarted');
  assert.equal(feedUsesFinalSlice.calls.length,1);
  const slowRoot = await scenario({rootMs:Infinity});
  assert.equal(slowRoot.discoveryFailures,1);
  assert.equal(slowRoot.failures,1);
  assert.equal(slowRoot.calls.length,2);
  for (const rootStatus of [403,429]) {
    const refused=await scenario({rootStatus});
    assert.equal(refused.discoveryFailures,1);
    assert.equal(refused.calls.length,2);
    assert.equal(refused.rows.find(row=>row.ticker==='AI').error,'direct_feed_http_'+rootStatus);
  }
  const late = await scenario({secTotalMs:13000,outerMs:25000});
  assert.equal(late.secChecks,13);
  assert.equal(late.feedDeferred,1);
  assert.equal(late.discoveryDeferred,1);
  assert.equal(late.calls.length,0);
  const preparation=await scenario({secTotalMs:35000,registryMs:3000,outerMs:50000});
  assert.equal(preparation.secChecks,13);
  assert.equal(preparation.feedDeferred,1);
  assert.equal(preparation.discoveryDeferred,1);
  const report={passed:true, isolated:true, externalCalls:0, busy, observedSlack, slowFeedWithSlack, standalone, unboundedCaller, excessiveCaller, pacingDoesNotFit, discoveryPacingDoesNotFit, feedFits, complete, fastPages, slowFeed, feedUsesFinalSlice, slowRoot, late, preparation};
  console.log(JSON.stringify(report,null,2));
} finally { globalThis.Date=RealDate; AbortSignal.timeout=realTimeout; AbortSignal.any=realAny; }
