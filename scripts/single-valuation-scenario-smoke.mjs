import assert from 'node:assert/strict';
import { loadTsModule } from './helpers/load-typescript-module.mjs';
import { inSimpleAlertPilot } from './helpers/simple-alert-pilot-fixture.mjs';
const { singleValuationScenarioSupported } = loadTsModule('@/lib/equity-signal/single-valuation-scenario');
const { buildValuationCandidate, reassessValuationCandidate } = loadTsModule('@/lib/equity-signal/valuation-candidate');
const now = new Date('2026-10-15T00:00:00Z');
const sourceUrl = 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json';
const facts = [ ['shares_outstanding', 100], ['equity', 1000], ['net_income', 200], ['net_income_annual',200], ['diluted_eps', 2], ['diluted_eps_annual', 2] ].map(([metric,value]) => ({metric,value,concept:metric,accession:'0000000001-26-000001',form:'10-K',unit:metric.startsWith('diluted_eps')?'USD/shares':metric==='shares_outstanding'?'shares':'USD',periodStart: '2025-01-01',periodEnd:'2025-12-31',filedAt:'2026-02-20',sourceUrl}));
const analysis = { ticker:'TEST',company:'Test Company',sector:'Technology',industry:'Software',currency:'USD',observedAt:now.toISOString(),currentPrice:20, scores:{fairValueConfidence:90,evidenceCompleteness:90,risk:20,businessQuality:85,balanceSheet:80},fairValue:{methods:[{method:'earnings_power',value:40,assumption:'Reported earnings valued at a conservative 20.0x multiple based on quality and growth.',singleScenario:{version:'engine-sensitivity-v1',inputBasis:'reported_eps',parameter:20,lowFactor:0.8,highFactor:1.2}}],conservativeValue:32,baseValue:40,optimisticValue:48} };
const candidate = { cik:'0000000001',quote:{price:20},fundamentals:{available:true,issuerCik:'0000000001',sourceUrl,items:facts,fiscalPeriodEnd:'2025-12-31'} };
assert.equal(singleValuationScenarioSupported(analysis,candidate,now),true);
for (const modified of [{...analysis,fairValue:{...analysis.fairValue,conservativeValue:0.01,optimisticValue:9999}},{ ...analysis,fairValue:{...analysis.fairValue,baseValue:44} },{ ...analysis,fairValue:{...analysis.fairValue,methods:[{method:'provider_target',value:40,assumption:'Analyst target'}]} },{...analysis,fairValue:{...analysis.fairValue,methods:[{...analysis.fairValue.methods[0],assumption:''}]}}]) assert.equal(singleValuationScenarioSupported(modified,candidate,now),false);
for (const fundamentals of [{...candidate.fundamentals,sourceUrl:'https://wrong.example'}, {...candidate.fundamentals,items:facts.filter(x=>x.metric!=='equity')},{...candidate.fundamentals,items:facts.map(x=>x.metric==='diluted_eps_annual'?{...x,value:3}:x)},{...candidate.fundamentals,items:facts.map(x=>({...x,periodEnd:'2020-12-31'}))}]) assert.equal(singleValuationScenarioSupported(analysis,{...candidate,fundamentals},now),false);
const fcfFacts = [...facts, ...[['operating_cash_flow',300],['capital_expenditure',100],['operating_cash_flow_annual',300],['capital_expenditure_annual',100]].map(([metric,value])=>({...facts[2],metric,value}))];
const fcfMethod = {method:'owner_earnings_fcf',value:40,assumption:'Reported free cash flow valued at a 5.0% required free-cash-flow yield.',singleScenario:{version:'engine-sensitivity-v1',inputBasis:'reported_fcf',parameter:0.05,lowFactor:0.8,highFactor:1.2}};
const fcfAnalysis = {...analysis,fairValue:{...analysis.fairValue,methods:[fcfMethod]}};
const fcfCandidate = {...candidate,fundamentals:{...candidate.fundamentals,items:fcfFacts}};
assert.equal(singleValuationScenarioSupported(fcfAnalysis,fcfCandidate,now),true);
for(const invalid of [
 {...fcfAnalysis,sector:'Finance',industry:'Regional Banks'},
 {...fcfAnalysis,industry:'Credit services'},
 {...fcfAnalysis,fairValue:{...fcfAnalysis.fairValue,methods:[{...fcfMethod,assumption:fcfMethod.assumption+' Evidence missing and unreconciled.'}]}},
 {...fcfAnalysis,fairValue:{...fcfAnalysis.fairValue,methods:[{...fcfMethod,singleScenario:{...fcfMethod.singleScenario,parameter:0.000001}}],baseValue:2000000,conservativeValue:1600000,optimisticValue:2400000}},
 {...analysis,fairValue:{...analysis.fairValue,methods:[{...analysis.fairValue.methods[0],singleScenario:undefined}]}},
 {...analysis,sector:null},
]) assert.equal(singleValuationScenarioSupported(invalid,fcfCandidate,now),false);
assert.equal(singleValuationScenarioSupported(analysis,{...candidate,quote:{price:1}},now),false,'Extreme valuation remains blocked');
const receipt = {url:sourceUrl};
assert.equal(buildValuationCandidate(analysis,candidate.cik,receipt,now).gateChecks.independentValuationMethods,false);
await inSimpleAlertPilot(async()=>{
 const built=buildValuationCandidate(analysis,candidate.cik,receipt,now);
 assert.equal(built.gateChecks.singleReproducibleScenario,false,'No shortcut before primary facts');
 const checked=reassessValuationCandidate({...built,...candidate},now,analysis);
 assert.equal(checked.gateChecks.singleReproducibleScenario,true);
 assert.equal(checked.gatePassed,true);
 const missing=reassessValuationCandidate({...built,...candidate,fundamentals:{...candidate.fundamentals,items:[]}},now,analysis);
 assert.equal(missing.gatePassed,false);
 const staleQuote=reassessValuationCandidate({...built,...candidate,quote:null},now,analysis);
 assert.equal(staleQuote.gatePassed,false);
});
console.log('PASS single-method range: primary-fact reproduction, explicit assumption, dates, source, missing facts, quote and nonpilot two-method boundary');


const invalidStart = {...candidate, fundamentals:{...candidate.fundamentals, items:facts.map(f=>({...f,periodStart:'2025-02-30',periodEnd:'2026-03-02',filedAt:'2026-04-01'}))}};
assert.equal(singleValuationScenarioSupported(analysis,invalidStart,now),false,'Invalid calendar start is not normalized into a valid annual period');
