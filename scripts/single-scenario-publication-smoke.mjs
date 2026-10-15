import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {loadTsModule} from './helpers/load-typescript-module.mjs';
import {inSimpleAlertPilot} from './helpers/simple-alert-pilot-fixture.mjs';
import {terminalHarness} from './terminal-review-runner-smoke.mjs';
let networkAttempts=0;
const blocked=()=>{networkAttempts++;throw new Error('real_network_forbidden');};
globalThis.fetch=http.request=http.get=https.request=https.get=net.Socket.prototype.connect=blocked;
const engine=loadTsModule('@/lib/opportunity-engine/us-value-investing-engine');
const {hardenUsValueCompanyAnalysis}=loadTsModule('@/lib/opportunity-engine/us-value-investing-safety');
const policy=loadTsModule('@/lib/equity-signal/single-valuation-scenario');
const watch=loadTsModule('@/lib/opportunity-engine/pr262-pilot-watch-valuation');
const checks=[];
function row(identity,state,changes={}) {
 const fields={name:identity.ticker,description:identity.company,exchange:'NASDAQ',country:'United States',currency:'USD',type:'stock',typespecs:['common'],is_primary:true,
  close:state.price,change:0,volume:500000,relative_volume_10d_calc:1,market_cap_basic:20000000,sector:'Technology',industry:'Software',price_earnings_ttm:10,price_book_ratio:null,price_sales_ratio:2,enterprise_value_ebitda_ttm:9,total_revenue:10000000,net_income:2000000,free_cash_flow:null,earnings_per_share_diluted_ttm:2,total_revenue_yoy_growth_ttm:15,total_revenue_yoy_growth_fy:12,net_income_yoy_growth_ttm:18,earnings_per_share_diluted_yoy_growth_ttm:16,gross_margin:65,operating_margin:24,net_margin:20,debt_to_equity:.5,current_ratio:2,return_on_equity:25,return_on_assets:12,...changes,...state.rowChanges};
 return {s:'NASDAQ:AIOT',d:engine.US_VALUE_SCANNER_COLUMNS.map(k=>fields[k]??null)};
}
function harness(options={}){
 const {changes={},mutateAnalysis,...rest}=options;
 const h=terminalHarness({realValuationHardener:true,...rest,analysisFactory:({identity,state})=>{
  const raw=row(identity,state,changes), value=engine.analyzeUsValueScannerRow({row:raw,ticker:identity.ticker,tradingViewSymbol:raw.s,receivedAt:state.now.toISOString()});
  assert.ok(value,'Actual scanner parser accepts the synthetic provider row');
  const analysis=hardenUsValueCompanyAnalysis(value);
  if(analysis.fairValue.methods.length===1){assert.equal(analysis.decision.seriousSignal,false);assert.equal(analysis.decision.userAlertEligible,false);assert.ok(["research_only","quality_price_watchlist"].includes(analysis.decision.tier));}
  return mutateAnalysis?mutateAnalysis(analysis,state):analysis;
 }});h.state.price=20;return h;
}
function delivery(h){return loadTsModule('@/lib/notifications/serious-signal-delivery',{
 '@/lib/r2-warehouse':h.storage,'@/lib/opportunity-engine/pr262-storage':{pr262StorageKey:h.key},
 '@/lib/opportunity-engine/pr262-terminal-reviews':h.modules.journal,
 '@/lib/opportunity-engine/company-profile-cache':{readCompanyProfiles:async()=>new Map()},
});}
function mutateFacts(body,fn){for(const concept of Object.values(body.facts['us-gaap']))for(const rows of Object.values(concept.units))for(const fact of rows)fn(fact);return body;}
await inSimpleAlertPilot(async()=>{
 process.env.SWING_UP_PR262_EXTERNAL_NOTIFICATIONS_ENABLED='false';
 const h=harness();
 const raw=row(h.identity,h.state);
 const selected=watch.pilotWatchValuationThresholds([raw],{...h.identity,tradingViewSymbol:'NASDAQ:AIOT'},h.state.now);
 assert.ok(selected?.buyBelowPrice>h.state.price,'Existing single watch snapshot can discover a research case without extra provider calls');
 assert.equal(watch.pilotWatchValuationThresholds([{...raw,s:'NASDAQ:WRONG'}],{...h.identity,tradingViewSymbol:'NASDAQ:AIOT'},h.state.now),null);
 const {report,result}=await h.runJob(), candidate=report.selectedCandidate;
 assert.equal(report.status,'serious_buy',JSON.stringify(report.blockers));assert.ok(result.outboxKey);
 assert.equal(candidate.transmissionConfidence,69);assert.equal(candidate.singleScenarioEvidence.analysis.scores.fairValueConfidence,69);
 assert.equal(candidate.gateChecks.valuationConfidence,undefined,'No false generic-confidence approval');
 assert.equal(candidate.singleScenarioEvidence.annualCalculation.providerTtmReconciled,false);
 assert.equal(candidate.singleScenarioEvidence.annualCalculation.base,candidate.valuationRange.baseValue);
 assert.equal(candidate.receipts[0].official,false,'The scanner is not relabelled official');
 assert.equal(h.state.roleCalls,4);assert.equal(report.committee.agentsFailed,0);assert.equal(h.journal.decisions[0].publicationGatePassed,true);
 assert.ok(h.prompts.some(p=>JSON.stringify(p).includes('not a normalized or verified TTM claim')));
 const stored=h.objects.get(result.outboxKey), original=structuredClone(stored), d=delivery(h);
 for(const [name,change] of [
  ['missing route',c=>{delete c.singleScenarioEvidence;}],
  ['forged route with raised confidence',c=>{c.singleScenarioEvidence={};c.transmissionConfidence=75;}],
  ['generic bank FCF applicability',c=>{c.sector='Finance';c.industry='Regional Banks';c.singleScenarioEvidence.analysis.sector=c.sector;c.singleScenarioEvidence.analysis.industry=c.industry;}],
  ['wrong issuer',c=>{c.fundamentals.issuerCik='0000000999';}],
  ['wrong issuer source',c=>{c.fundamentals.items[0].sourceUrl='https://data.sec.gov/api/xbrl/companyfacts/CIK0000000999.json';c.fundamentals.sourceUrl='https://data.sec.gov/api/xbrl/companyfacts/CIK0000000999.json';}],
  ['missing equity',c=>{c.fundamentals.items=c.fundamentals.items.filter(f=>f.metric!=='equity');}],
  ['wrong same-value interim period',c=>{c.fundamentals.items.find(f=>f.metric==='diluted_eps').periodStart='2025-10-01';}],
  ['coherently changed annual period',c=>{for(const f of c.fundamentals.items){f.periodEnd='2025-11-30';if(f.periodStart)f.periodStart='2024-12-01';}}],
  ['wrong units',c=>{c.fundamentals.items.find(f=>f.metric==='diluted_eps_annual').unit='USD';}],
  ['stale facts',c=>{for(const f of c.fundamentals.items)f.periodEnd='2020-12-31';}],
  ['unsupported normalization',c=>{c.valuationRange.methods[0].assumption='Normalized unsupported earnings';}],
  ['arbitrary endpoints',c=>{c.valuationRange.conservativeValue=.01;c.valuationRange.optimisticValue=9999;}],
  ['extreme model value',c=>{c.quote.price=1;}],
  ['false completeness',c=>{c.eventTruth=100;}],
  ['weak uncapped quality',c=>{c.singleScenarioEvidence.analysis.scores.businessQuality=0;c.singleScenarioEvidence.analysis.scores.risk=100;}],
  ['invalid confidence',c=>{c.transmissionConfidence=NaN;}],
  ['missing materiality',c=>{delete c.materiality;}],
  ['invalid mapping',c=>{c.mappingConfidence='NaN';}],
  ['missing independence',c=>{delete c.evidenceIndependence;}],
  ['rumour',c=>{c.rumour=true;}],
  ['contradiction',c=>{c.contradictionPenalty=50;}],
  ['invalid penalty',c=>{c.pricedInPenalty=NaN;}],
  ['stale quote',c=>{c.quote.observedAt='2026-09-01T15:00:00Z';}],
 ]){
  const altered=structuredClone(original);change(altered.value.candidate);h.objects.set(result.outboxKey,altered);
  await assert.rejects(()=>d.deliverSeriousSignalOutbox(result.outboxKey,{now:h.state.now}),undefined,name);checks.push(name);
 }
 h.objects.set(result.outboxKey,structuredClone(original));
 for(const [name,change] of [
  ['coherently omitted valuation reviewer',v=>{const s=v.committee.output.modelUsageSummary;s.reviewPlan.agentIds=s.reviewPlan.agentIds.filter(id=>id!=='valuation_dcf_agent');s.roleDiagnostics=s.roleDiagnostics.filter(r=>r.agentId!=='valuation_dcf_agent');v.committee.agentsCompleted=3;v.authority.fullCommitteeAgentsCompleted=3;}],
  ['failed reviewer',v=>{v.committee.agentsFailed=1;}],['negative Final Judge',v=>{v.committee.finalJudge.verdict='negative';}],['low Final Judge',v=>{v.committee.finalJudge.confidence=79;}],
  ['post-review scenario changed',v=>{v.candidate.singleScenarioEvidence.analysis.scores.balanceSheet=88;}],
 ]){const altered=structuredClone(original);change(altered.value);h.objects.set(result.outboxKey,altered);await assert.rejects(()=>d.deliverSeriousSignalOutbox(result.outboxKey,{now:h.state.now}),undefined,name);checks.push(name);}
 h.objects.set(result.outboxKey,structuredClone(original));
 const beforeLate=structuredClone(h.objects);
 const late=new Date(h.state.now.getTime()+20*60000);
 await assert.rejects(()=>d.deliverSeriousSignalOutbox(result.outboxKey,{now:late}),/quote_stale/);
 assert.equal([...h.objects.keys()].filter(k=>k.includes('/receipts/')).length,0);
 h.objects.clear();for(const[k,v]of beforeLate)h.objects.set(k,v);
 const sent=await d.deliverSeriousSignalOutbox(result.outboxKey,{now:h.state.now});assert.equal(sent.deliveryStatus,'delivered',JSON.stringify(sent));
 const receipts=[...h.objects].filter(([k])=>k.includes('/receipts/'));assert.equal(receipts.length,1);
 const duplicate=await d.deliverSeriousSignalOutbox(result.outboxKey,{now:late});assert.equal(duplicate.deliveryStatus,'delivered');assert.deepEqual([...h.objects].filter(([k])=>k.includes('/receipts/')),receipts);
 const status=await d.getSeriousSignalStatus({now:h.state.now,hours:48});assert.equal(status.summary.currentlyEligible,1);assert.match(status.alerts[0].singleScenarioNotice,/69\/100/);assert.match(status.alerts[0].singleScenarioNotice,/not a forecast/);
 const lateStatus=await d.getSeriousSignalStatus({now:late,hours:48});assert.equal(lateStatus.summary.currentlyEligible,0);
 const calls=h.state.roleCalls;h.advance(60000);const replay=await h.runJob();assert.equal(replay.report.openAiCalled,false);assert.equal(h.state.roleCalls,calls);assert.equal(h.journal.decisions.length,1);
 checks.push('raw scanner EPS through review outbox receipt, duplicate and stale current-status safeguards');
 // Source metadata edits must not inherit a completed approval, even if the
 // model is updated to match: publication packet changes, paid history does not.
 const packet=loadTsModule('@/lib/equity-signal/terminal-review-evidence');
 const changed=structuredClone(candidate);changed.singleScenarioEvidence.analysis.scores.balanceSheet=88;
 assert.notEqual(packet.terminalPublicationPacketKey(changed),packet.terminalPublicationPacketKey(candidate));
 const fcf=harness({changes:{free_cash_flow:1900000,earnings_per_share_diluted_ttm:null}});
 const fcfRun=await fcf.runJob();assert.ok(fcfRun.result.outboxKey,JSON.stringify(fcfRun.report?.blockers));assert.equal(fcfRun.report.selectedCandidate.transmissionConfidence,69);
 assert.equal(fcfRun.report.selectedCandidate.valuationRange.methods[0].method,'owner_earnings_fcf');checks.push('raw scanner annual FCF positive');
 const impossible=[
 ['missing EPS fact',{factsTransform:b=>{delete b.facts['us-gaap'].EarningsPerShareDiluted;return b;}}],
 ['wrong response issuer',{factsTransform:b=>({...b,cik:999})}],
 ['same-value wrong annual/current period',{factsTransform:b=>{b.facts['us-gaap'].EarningsPerShareDiluted.units['USD/shares'].push({val:2,start:'2026-01-01',end:'2026-06-30',filed:'2026-08-01',form:'10-Q',accn:'0001774170-26-000002'});return b;}}],
 ['stale annual source',{factsTransform:b=>mutateFacts(b,f=>{f.end='2023-12-31';if(f.start)f.start='2023-01-01';f.filed='2024-02-20';})}],
 ['absurd yield',{changes:{free_cash_flow:1900000,earnings_per_share_diluted_ttm:null},mutateAnalysis:a=>{a.fairValue.methods[0].singleScenario.parameter=.000001;return a;}}],
 ['weak single-scenario non-method evidence',{changes:{net_margin:1,return_on_equity:1,return_on_assets:1,debt_to_equity:5,current_ratio:.5,operating_margin:1}}],
 ];
 for(const[name,options]of impossible){const n=harness(options);const r=await n.runJob();assert.equal(r.result.outboxKey??null,null,name);assert.equal(n.state.roleCalls,0,name);assert.equal(n.state.moneyCalls,0,name);checks.push(`${name}: zero paid admission`);}
 for(const mode of ['quote','documents','source','negative_review','failed_review']){const n=harness();if(mode==='quote')n.state.quoteReady=false;if(mode==='documents')n.state.filingMode='capped';if(mode==='source')n.state.sourceComplete=false;if(mode==='negative_review')n.state.verdict='negative';if(mode==='failed_review')n.state.failRole='valuation_dcf_agent';const r=mode==='source'?{report:await n.runRunner(),result:{}}:await n.runJob();assert.equal(r.result.outboxKey??null,null,mode);assert.equal(r.report.seriousSignalFound,false,mode);if(['quote','documents','source'].includes(mode))assert.equal(n.state.roleCalls,0,mode);checks.push(mode);}
 assert.equal(policy.singleScenarioEvidenceQuality({...candidate.singleScenarioEvidence.analysis,scores:{...candidate.singleScenarioEvidence.analysis.scores,businessQuality:0,risk:100}}),false);
});
assert.equal(networkAttempts,0);
console.log(JSON.stringify({status:'PASS',checks:checks.length,networkAttempts,results:checks}));
