import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadTsModule } from './helpers/load-typescript-module.mjs';
import { data as fixture, ref, html as synthetic } from './helpers/company-profile-revenue-note-fixture.mjs';
const { extractFinancialNoteCustomerEvidence: extract, verifiedFinancialNoteCustomerEvidence: verify } = loadTsModule('@/lib/company-profile-financial-customer-source');
const data = { ...fixture, evidence: { directPayment: { quote: fixture.quotes.directPayment } } };
const html = process.env.PGY_PROFILE_FIXTURE ? fs.readFileSync(process.env.PGY_PROFILE_FIXTURE, 'utf8') : synthetic;
let passed=0;
function test(name,fn){try{fn();passed++;console.log('PASS '+name);}catch(e){console.error('FAIL '+name);throw e;}}
function reject(name,from,to){test(name,()=>{assert.ok(html.includes(from),'mutation target exists');const changed=html.replace(from,to);assert.notEqual(changed,html);assert.equal(extract({...ref,html:changed}),null);});}
const proof=extract({...ref,html});
test('PGY-shaped source exact full paragraph with agent and net qualifications',()=>{assert.ok(proof);assert.equal(proof.quote,data.evidence.directPayment.quote);assert.equal(proof.section,'financial_notes_revenue_contracts');assert.equal(proof.taxonomy,'us-gaap:RevenueFromContractWithCustomerTextBlock');assert.equal(proof.reportPeriod,'2025-12-31');assert.equal(proof.sourceFiledAt,'2026-03-02');assert.ok(Object.isFrozen(proof));assert.equal(Object.keys(proof).length,9);});
for(const [name,from,to] of [
 ['nested policy wrapper nil one','id="f-601-4"','id="f-601-4" xsi:nil="1"'],
 ['nested policy wrapper nil alias','id="f-601-4"','id="f-601-4" xmlns:n="http://www.w3.org/2001/XMLSchema-instance" n:nil="true"'],
 ['later nested policy wrapper hidden','id="f-601-5"','id="f-601-5" style="display:none"'],
 ['later nested policy wrapper nil','id="f-601-5"','id="f-601-5" xsi:nil="true"'],
 ['root taxonomy policy duplicate cannot stand in','name="us-gaap:RevenueFromContractWithCustomerTextBlock"','name="us-gaap:RevenueFromContractWithCustomerPolicyTextBlock"'],
 ['root wrong context','name="us-gaap:RevenueFromContractWithCustomerTextBlock" id="f-649"','name="us-gaap:RevenueFromContractWithCustomerTextBlock" contextRef="c-2" id="f-649"'],
 ['root missing chain','id="f-649" continuedAt="f-649-1"','id="f-649"'],
 ['root points to policy chain','id="f-649" continuedAt="f-649-1"','id="f-649" continuedAt="f-601-4"'],
 ['missing continuation target','id="f-649-2"','id="absent-revenue-continuation"'],
 ['duplicate continuation id','id="f-649-3"','id="f-649-2"'],
 ['cycle to prior continuation','id="f-649-2" continuedAt="f-649-3"','id="f-649-2" continuedAt="f-649-1"'],
 ['cycle to root','id="f-649-3"','id="f-649-3" continuedAt="f-649"'],
 ['chain truncated after quote','id="f-649-1" continuedAt="f-649-2"','id="f-649-1"'],
 ['extra unresolved final chain target','id="f-649-3"','id="f-649-3" continuedAt="missing-end"'],
 ['hidden first continuation','id="f-649-1"','id="f-649-1" style="display:none"'],
 ['hidden final continuation','id="f-649-3"','id="f-649-3" style="visibility:hidden"'],
 ['nil continuation arbitrary alias','id="f-649-2"','id="f-649-2" xmlns:n="http://www.w3.org/2001/XMLSchema-instance" n:nil="1"'],
 ['continuation declares other context','id="f-649-1"','id="f-649-1" contextRef="c-2"'],
 ['continuation wrong element','<ix:continuation id="f-649-1"','<div id="f-649-1"'],
 ['heading outside note','NOTE 4 - ','OTHER COMPANY - '],
 ['root escaped flag invalid','id="f-649" continuedAt="f-649-1" escape="true"','id="f-649" continuedAt="f-649-1" escape="false"'],
 ['root nil alternate prefix','id="f-649"','id="f-649" xmlns:n="http://www.w3.org/2001/XMLSchema-instance" n:nil="true"'],
 ['root nil lexical one','id="f-649"','id="f-649" xsi:nil="1"'],
 ['wrong source date fact duplicate','id="f-38"><ix:nonNumeric','id="f-38" xsi:nil="true"><ix:nonNumeric'],
 ['payer direction reversed','payment is received monthly from the Financing Vehicles','payment is paid monthly to the Financing Vehicles'],
 ['hypothetical fee relation','payment is received monthly from the Financing Vehicles','payment may be received monthly from the Financing Vehicles'],
 ['suppliers instead of paying vehicles','payment is received monthly from the Financing Vehicles','payment is received monthly from third-party suppliers'],
 ['investor class cannot replace vehicle counterparties','payment is received monthly from the Financing Vehicles','payment is received monthly from investors in the Financing Vehicles'],
 ['agent qualifier cannot be dropped','These duties have been considered to be agent responsibilities and does not include acting as a loan servicer. ',''],
 ['loan servicer disclaimer cannot be reversed','does not include acting as a loan servicer','includes acting as a loan servicer'],
 ['net qualification cannot be dropped',' Accordingly, servicing fees are recorded on a net basis.',''],
 ['net qualification cannot be changed','servicing fees are recorded on a net basis','servicing fees are recorded on a gross basis'],
 ['trailing unrelated-issuer disclaimer','Accordingly, servicing fees are recorded on a net basis.','Accordingly, servicing fees are recorded on a net basis. This classification applies solely to another issuer.'],
 ['supporting managed relationship wrong entity','Financing Vehicles managed or administered by the Company','Financing Vehicles managed or administered by Another Company'],
 ['principal relationship wrong entity','ultimately responsible to the Financing Vehicles','not responsible to the Financing Vehicles'],
 ['customer agreements missing','These fees are the result of agreements with customers','These fees are not the result of agreements with customers'],
 ['other unrelated contract heading','>Contract Fees</span>','>Unrelated segment fees</span>'],
 ['cross paragraph full quote','These duties have been considered','</span></div><div><span>These duties have been considered'],
 ['hidden payment content','Servicing fees for the Financing Vehicles','<span style="opacity:.0">Servicing fees</span> for the Financing Vehicles'],
 ['nil payment inline','Servicing fees for the Financing Vehicles','<span xmlns:n="http://www.w3.org/2001/XMLSchema-instance" n:nil="true">Servicing fees</span> for the Financing Vehicles'],
 ['completed note still requires final document closure','</body></html>','</body>'],
 ]) reject(name,from,to);
test('PGY original provenance cache revalidation',()=>assert.deepEqual(verify(JSON.parse(JSON.stringify(proof)),{...ref,now:new Date('2027-10-01T00:00:00Z')}),proof));
test('PGY cannot be revalidated as AR section',()=>assert.equal(verify({...proof,section:'financial_notes_accounts_receivable'},ref),null));
test('PGY cannot be revalidated against policy taxonomy',()=>assert.equal(verify({...proof,taxonomy:'us-gaap:RevenueFromContractWithCustomerPolicyTextBlock'},ref),null));
test('PGY cannot drop loan-servicer qualification on cache replay',()=>assert.equal(verify({...proof,quote:proof.quote.split(' These duties')[0]},ref),null));
test('cache cannot rewrite corroborating annual period',()=>assert.equal(verify({...proof,reportPeriod:'2024-12-31'},ref),null));
test('context and repeated DEI dates cannot shift dated corroboration to another year',()=>{
  const shifted=html.replaceAll('December&#160;31</ix:nonNumeric>, 2025</ix:nonNumeric>','December&#160;31</ix:nonNumeric>, 2024</ix:nonNumeric>')
    .replace('<xbrli:context id="c-1"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0001883085</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate>',
      '<xbrli:context id="c-1"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0001883085</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2024-01-01</xbrli:startDate><xbrli:endDate>2024-12-31</xbrli:endDate>');
  assert.notEqual(shifted,html);assert.equal(extract({...ref,html:shifted}),null);
});
console.log(`\n${passed} PGY tests passed`);
