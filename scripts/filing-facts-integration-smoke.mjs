import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { loadTsModule } from './helpers/load-typescript-module.mjs';
import { filingFixtureManifest, filingFixture } from './helpers/filing-facts-fixture.mjs';
import { companyProfileFixture } from './helpers/company-profile-fixture.mjs';
import { terminalHarness } from './terminal-review-runner-smoke.mjs';
import { inSimpleAlertPilot } from './helpers/simple-alert-pilot-fixture.mjs';
let networkAttempts=0;
const blocked=()=>{networkAttempts++;throw Error('real_network_forbidden');};
globalThis.fetch=http.request=http.get=https.request=https.get=net.Socket.prototype.connect=blocked;
const promptTools=loadTsModule('@/lib/ai-committee/prompt-input');
function decodePrompt(prompt) {
 const expand=x=>{
  if(Array.isArray(x))return x.map(expand);
  if(!x||typeof x!=='object')return x;
  if(x.verbatimValueRef)return prompt.sharedEvidenceValues[x.verbatimValueRef];
  if(x.verbatimTextRef)return prompt.sharedEvidenceTexts[x.verbatimTextRef];
  if(x.verbatimTextParts)return x.verbatimTextParts.map(expand).join('');
  const record=(keys,values)=>Object.fromEntries(prompt.sharedEvidenceKeys[keys].map((k,i)=>[k,expand(values[i])]));
  if(x.verbatimRecord)return record(x.verbatimRecord[0],x.verbatimRecord.slice(1));
  if(x.verbatimRecordList)return x.verbatimRecordList.items.map(row=>Array.isArray(row)?record(x.verbatimRecordList.fields,row):expand(row));
  return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,expand(v)]));
 }; return expand(prompt.evidencePack);
}
const observations=[];
await inSimpleAlertPilot(async()=>{
 for(const fixture of filingFixtureManifest.sources.filter(f=>f.source.form==='10-Q')) {
  const source=fixture.source, body=filingFixture(fixture), prompts=[], promptBytes=[];
  const h=terminalHarness({observeProviderInput:input=>{
   assert.equal(input.maximumPromptBytes,60000);
   assert.equal(promptTools.committeePromptPreflight({...input,model:'gpt-6-luna'}),undefined);
   const schema=input.responseSchema?{type:'json_schema',json_schema:{...input.responseSchema,strict:true}}:undefined;
   promptBytes.push(promptTools.committeePromptInputBytes(input.messages,schema));
   prompts.push(decodePrompt(JSON.parse(input.messages[1].content)));
  }});
  Object.assign(h.identity,{ticker:source.cik==='0001647639'?'UPST':'INOD',company:source.cik==='0001647639'?'Upstart Holdings, Inc.':'Innodata Inc.',cik:source.cik});
  h.state.now=new Date('2026-10-15T05:00:00Z');h.state.model='gpt-6-luna';h.newEvent();
  const overrides={'@/lib/r2-warehouse':h.storage,'@/lib/opportunity-engine/pr262-storage':{pr262StorageKey:h.key}};
  const financial=loadTsModule('@/lib/equity-signal/financial-evidence',overrides);
  const budgetModule=loadTsModule('@/lib/opportunity-engine/pr262-sensor-fetch-budget',overrides);
  // Synthetic index/annual transport tests source-selection plumbing only.
  // The entire quarterly response is the authenticated, unmodified SEC fixture.
  const annualUrl=`https://www.sec.gov/Archives/edgar/data/${Number(source.cik)}/000000000026000001/annual.htm`;
  const index={cik:Number(source.cik),filings:{recent:{form:['10-Q/A','10-Q','10-K'],filingDate:['2026-08-07',source.filedAt,'2026-02-20'],accessionNumber:['0001647639-26-000066',source.accession,'0000000000-26-000001'],primaryDocument:[source.url.split('/').at(-1),source.url.split('/').at(-1),'annual.htm'],reportDate:[source.reportingPeriod,source.reportingPeriod,'2025-12-31']}}};
  const annual=`<html>${'Synthetic annual introduction. '.repeat(100)}<p>Operating segments: synthetic annual source.</p><p>Major customers: synthetic annual source.</p></html>`;
  const reads=[];let mode='complete';
  const rawFetch=async(url,options)=>{
   assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.ok(options.signal);
   reads.push(String(url));
   if(String(url).includes('/submissions/'))return Response.json(index);
   if(String(url)===annualUrl)return new Response(annual);
   assert.equal(String(url),source.url,'No extra fallback, exhibit or amendment source calls');
   if(mode==='identity')return new Response(body.replace('http://www.xbrl.org/2003/iso4217','https://invalid.example'));
   if(mode==='206')return new Response(body,{status:206});
   if(mode==='cap')return new Response(body+' '.repeat(5_000_001));
   if(mode==='interrupted') {let sent=false;return new Response(new ReadableStream({pull(c){if(sent)c.error(Error('fixture_interrupted'));else{sent=true;c.enqueue(new TextEncoder().encode(body.slice(0,10000)));}}}));}
   return new Response(body);
  };
  const realNow=Date.now;Date.now=()=>h.state.now.getTime();
  try {
   const runCollect=async()=>{
    const budget=await budgetModule.createPr262SensorBudgetedFetch({now:h.state.now,fetchImpl:rawFetch});
    const result=await financial.collectFinancialDocuments(source.cik,budget.fetchImpl,h.state.now);
    return {result,budget:budget.summary()};
   };
   const first=await runCollect();assert.equal(reads.length,3);assert.equal(first.result.documents.length,2);
   const doc=first.result.documents.find(d=>d.url===source.url);assert.equal(doc.factExtraction.status,'extracted');assert.equal(financial.financialDocumentCompleteness(doc),'complete');
   assert.equal(doc.factExtraction.sourceHash,fixture.sha256);
   const denialBudget=await budgetModule.createPr262SensorBudgetedFetch({now:h.state.now,fetchImpl:rawFetch});
   await assert.rejects(()=>denialBudget.fetchImpl(source.url),/pr262_sensor_budget_guard/);
   assert.equal(reads.length,3,'Actual provider cadence denial must not reach transport');
   const report=await h.runRunner({persist:true,resolveCompanyProfile:async()=>companyProfileFixture(h.identity,h.state.now),collectFinancialDocuments:async()=> (await runCollect()).result});
   assert.ok(prompts.length>0,JSON.stringify({status:report.status,blockers:report.blockers,committee:report.committee}));assert.equal(reads.length,3,'Runner cache hit must not request sources');
   for(const pack of prompts) assert.deepEqual(pack.financialDiligence.documents.documents.find(d=>d.url===source.url).factExtraction,doc.factExtraction,'Every model sees all typed values and provenance unchanged');
   const cachedBytes=Buffer.byteLength(JSON.stringify(first.result));
   // Pure metadata repair eligibility must not change substantive legacy keys.
   const legacy=structuredClone(first.result);for(const d of legacy.documents.filter(d=>d.form==='10-Q')){delete d.factExtraction;delete d.transportProof;}
   const key=h.key(`research-evidence/financial-documents/${source.cik}.json`);
   h.objects.set(key,{value:legacy,etag:'legacy-fixture'});
   const before=reads.length;h.state.now=new Date(h.state.now.getTime()+1000);
   assert.equal((await runCollect()).result.cached,true);assert.equal(reads.length,before);
   h.state.now=new Date(h.state.now.getTime()+6*3600000);
   const refreshed=(await runCollect()).result;assert.equal(reads.length-before,2,'Due repair uses existing index and quarterly slots only');
   const refreshedDoc=refreshed.documents.find(d=>d.url===source.url);
   assert.deepEqual(refreshedDoc.factExtraction.facts,doc.factExtraction.facts);assert.equal(refreshedDoc.digest,doc.digest);
   const roleCalls=h.state.roleCalls, budgetCalls=h.state.moneyCalls;
   const replay=await h.runRunner({resolveCompanyProfile:async()=>companyProfileFixture(h.identity,h.state.now),collectFinancialDocuments:async()=> (await runCollect()).result});
   assert.equal(replay.openAiCalled,false,'Parser metadata alone must not reopen completed Committee review');
   assert.equal(h.state.roleCalls,roleCalls);assert.equal(h.state.moneyCalls,budgetCalls);
   for(const invalid of ['tampered_proof','blocked_status']) {
    const old=structuredClone(refreshed);old.checkedAt=h.state.now.toISOString();old.nextCheckAt=h.state.now.toISOString();
    const q=old.documents.find(d=>d.url===source.url);
    if(invalid==='tampered_proof')q.factExtraction.facts[0].value++;else q.factExtraction.status='blocked';
    h.objects.set(key,{value:old,etag:invalid});h.state.now=new Date(h.state.now.getTime()+6*3600000);
    const count=reads.length,repaired=(await runCollect()).result;
    assert.equal(reads.length-count,2);assert.deepEqual(repaired.documents.find(d=>d.url===source.url).factExtraction.facts,doc.factExtraction.facts);
   }
   // A failed due repair preserves the earlier document exactly.
   for(const failure of ['206','cap','interrupted','identity']) {
    mode=failure;const old=structuredClone(legacy);old.checkedAt=h.state.now.toISOString();old.nextCheckAt=h.state.now.toISOString();
    h.objects.set(key,{value:old,etag:`legacy-${failure}`});h.state.now=new Date(h.state.now.getTime()+6*3600000);
    const failed=(await runCollect()).result;
    assert.deepEqual(failed.documents.find(d=>d.url===source.url),old.documents.find(d=>d.url===source.url));
    assert.equal(financial.financialDocumentsReady(failed),false);assert.ok(failed.failures.length);
   }
   h.objects.delete(key);h.state.now=new Date(h.state.now.getTime()+6*3600000);mode='identity';
   const freshInvalid=(await runCollect()).result;
   assert.ok(!freshInvalid.documents.some(d=>d.url===source.url),'Invalid fresh identity must not mint a complete numeric/document claim');
   assert.equal(financial.financialDocumentsReady(freshInvalid),false);assert.ok(freshInvalid.failures.length);
   const tampered=structuredClone(first.result);tampered.documents.find(d=>d.url===source.url).factExtraction.facts[0].value++;
   assert.equal(financial.financialDocumentsEvidenceView(tampered).documents.find(d=>d.url===source.url).factExtraction.facts.length,0);
   observations.push({cik:source.cik,rawQuarterlyBytes:fixture.rawBytes,typedFacts:doc.factExtraction.facts.length,initialRequests:3,dueVersionRepairRequests:2,metadataOnlyPaidReopen:false,modelPrompts:prompts.length,maximumActualPromptBytes:Math.max(...promptBytes),cacheBytes:cachedBytes,allProvenanceReachedEachModel:true,providerReplies:'local stubs, no paid calls'});
  } finally {Date.now=realNow;}
 }
});
assert.equal(networkAttempts,0);
console.log(JSON.stringify({observations,networkAttempts},null,2));
