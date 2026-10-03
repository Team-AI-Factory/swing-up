import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const require = createRequire(resolve(process.env.PROFILE_TEST_REPO_ROOT ?? process.cwd(), "package.json"));
const ts = require("typescript");
const code = ts.transpileModule(readFileSync(new URL("../lib/company-profile-annual-source.ts", import.meta.url),"utf8"), {
  compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
const loaded = {exports:{}};
new Function("module","exports",code)(loaded,loaded.exports);
const {resolve40FAnnualInformationForm: resolveAif, annualInformationFormBusinessText: section, secAnnualFilingIndexUrl: indexUrl, isAnnualInformationFormDocument: validAif} = loaded.exports;
const base="https://www.sec.gov/Archives/edgar/data/1993344/000162828026022512/";
const url=base+"aaue-20251231.htm";
const aif=base+"a991-alliedx2026aif.htm";
const filing={url,form:"40-F",filedAt:"2026-04-01"};
const fact=(name,value,format="")=>`<ix:nonNumeric name="dei:${name}" ${format?`format="${format}"`:""}>${value}</ix:nonNumeric>`;
const declared=`<tr><td>99.1</td><td><a href="a991-alliedx2026aif.htm">Annual Information Form for the year ended December 31, 2025</a></td></tr>`;
const annualHtml=fact("DocumentType","40-F")+fact("EntityCentralIndexKey","0001993344")
  +fact("DocumentAnnualReport","&#9746;","ixt:fixed-true")+fact("DocumentRegistrationStatement","&#9744;","ixt:fixed-false")
  +fact("AnnualInformationForm","&#9746;","ixt:fixed-true")+`<table>${declared}</table>`;
const indexed=`<tr><td>3</td><td>EX-99.1</td><td><a href="/Archives/edgar/data/1993344/000162828026022512/a991-alliedx2026aif.htm">a991-alliedx2026aif.htm</a></td><td>EX-99.1</td><td>1000</td></tr>`;
const indexHtml=`<h1>Form 40-F</h1><div>SEC Accession No. 0001628280-26-022512</div><div>Filing Date</div><div>2026-04-01</div><span>CIK: 0001993344</span><table>
<tr><td>1</td><td>40-F</td><td><a href="/ix?doc=/Archives/edgar/data/1993344/000162828026022512/aaue-20251231.htm">aaue-20251231.htm</a></td><td>40-F</td><td>2000</td></tr>${indexed}</table>`;
const input={cik:"0001993344",filing,annualHtml,indexHtml};
const expected={url:aif,form:"40-F",filedAt:"2026-04-01",cik:"0001993344",accessionNumber:"0001628280-26-022512",annualFilingUrl:url,annualFilingIndexUrl:base+"0001628280-26-022512-index.html"};
assert.deepEqual(resolveAif(input),expected);
assert.deepEqual(resolveAif({...input,cik:"1993344"}),expected,"CIK normalization preserves authenticated identity");
assert.equal(indexUrl(url,input.cik),expected.annualFilingIndexUrl);
let rejects=0;
const reject=(change,label)=>{assert.equal(resolveAif({...input,...change}),null,label);rejects++;};
for(const bad of [url.replace("1993344","1993345"),url.replace("www.sec.gov","evil.example"),url.replace("https:","http:"),url+"?copy=1",url+"#part",url.replace("https://","https://user@"),url.replace("aaue-20251231.htm","../aaue-20251231.htm")])reject({filing:{...filing,url:bad}},"invalid primary provenance");
reject({cik:"0"},"zero CIK");
reject({filing:{...filing,form:"20-F"}},"not a 40-F");
for(const date of ["2026-03-31","2026-02-30","invalid"])reject({filing:{...filing,filedAt:date}},"exact SEC filing date required");
for(const [from,to]of [["0001628280-26-022512","0001628280-26-022513"],["2026-04-01","2026-04-02"],["CIK: 0001993344","CIK: 0001993345"]])reject({indexHtml:indexHtml.replace(from,to)},"index metadata mismatch");
reject({indexHtml:indexHtml.replace(indexed,"")},"index must list exhibit");
reject({indexHtml:indexHtml.replace(indexed,indexed+indexed)},"ambiguous duplicate exhibit");
reject({annualHtml:annualHtml.replace(declared,"")},"no arbitrary EX-99.1 inference");
reject({annualHtml:annualHtml.replace(declared,declared+declared)},"ambiguous exhibit description");
reject({annualHtml:annualHtml.replace("Annual Information Form for","Management Discussion and Analysis for")},"financial and MD&A exhibits are not AIF");
reject({annualHtml:annualHtml.replace('name="dei:DocumentAnnualReport"','name="dei:Other"')},"must prove annual, not initial registration");
reject({annualHtml:annualHtml.replace('name="dei:DocumentAnnualReport" format="ixt:fixed-true"','name="dei:DocumentAnnualReport" format="ixt:fixed-false"')},"false annual flag");
reject({annualHtml:annualHtml.replace('name="dei:DocumentRegistrationStatement" format="ixt:fixed-false">&#9744;','name="dei:DocumentRegistrationStatement" format="ixt:fixed-true">&#9746;')},"registration rejected");
reject({annualHtml:annualHtml.replace("0001993344","0001993345")},"cover issuer mismatch");
for(const href of ["https://evil.example/aif.htm","/Archives/edgar/data/1993345/000162828026022512/aif.htm","/Archives/edgar/data/1993344/000162828026022513/aif.htm","../aif.htm","aif.pdf","aif.htm?copy=1","aif.htm#part","//www.sec.gov/Archives/edgar/data/1993344/000162828026022512/aif.htm"]){
 reject({annualHtml:annualHtml.replace('href="a991-alliedx2026aif.htm"',`href="${href}"`)},"exhibit URL cannot escape exact accession");
 reject({indexHtml:indexHtml.replace('href="/Archives/edgar/data/1993344/000162828026022512/a991-alliedx2026aif.htm"',`href="${href}"`)},"index exhibit URL cannot escape exact accession");
}
// Synthetic prose: tests section boundaries without copying issuer narrative.
const prose="The Company produces precision instruments and calibration equipment for industrial laboratories. ".repeat(7);
const customer="Our customers include industrial laboratories and research institutions.";
const body=`<h1>ANNUAL INFORMATION FORM</h1><table><tr><td>DESCRIPTION OF THE BUSINESS</td><td>20</td></tr><tr><td>Risk Factors</td><td>33</td></tr></table><h2>DESCRIPTION OF THE <span>BUS</span><span>INESS</span></h2><p>${prose}</p><p>${customer}</p><h2>Risk Factors</h2><p>RISK-ONLY BUYER DECOY</p><h2>FINANCIAL STATEMENTS</h2><p>FINANCIAL-ONLY DECOY</p>`;
assert.equal(validAif(body),true,"raw source has AIF title and business section");
assert.equal(validAif(body.replace("ANNUAL INFORMATION FORM","ANNUAL FINANCIAL STATEMENTS")),false,"business heading alone does not prove AIF document type");
assert.equal(validAif("DESCRIPTION OF THE BUSINESS\n"+prose),false,"cached section is not a raw authenticated AIF");
assert.equal(validAif(`<h1>ANNUAL INFORMATION FORM</h1><p>Cover only</p>`),false,"title alone is insufficient");
const extracted=section(body);
assert.ok(extracted.includes(customer));assert.ok(extracted.includes("precision instruments"));assert.doesNotMatch(extracted,/DECOY|Risk Factors|FINANCIAL STATEMENTS/);
assert.equal(section(`<table><tr><td>DESCRIPTION OF THE BUSINESS</td><td>20</td></tr><tr><td>Risk Factors</td><td>33</td></tr></table>`),"","TOC-only cannot become business");
assert.equal(section("DESCRIPTION OF THE\nBUSINESS\n"+prose),"","do not join separate block headings to fabricate section");
assert.equal(section("DESCRIPTION OF THE BUSINESS\nShort.\nRisk Factors\n"+prose),"","minimum section length applies before risk boundary");
assert.equal(section("Item 1. Business\n"+prose),"","10-K heading does not activate AIF support");
assert.equal(section("DESCRIPTION OF THE BUSINESS\n"+extracted),extracted,"exact cached AIF section replays without new sources");
console.log(JSON.stringify({kind:"company_profile_annual_source_smoke",syntheticProvenanceRejects:rejects,sectionChecks:10,status:"passed"}));
// Optional exact raw-file replay. Fixture files are not fetched by this test.
const fixtures=process.env.COMPANY_PROFILE_AIF_FIXTURES;
if(fixtures){const paths=["0001628280-26-022512-index.html","aaue-20251231.htm","a991-alliedx2026aif.htm"].map(name=>resolve(fixtures,name));for(const path of paths)assert.ok(existsSync(path),`missing exact fixture ${path}`);
 assert.deepEqual(resolveAif({...input,indexHtml:readFileSync(paths[0],"utf8"),annualHtml:readFileSync(paths[1],"utf8")}),expected);
 assert.equal(validAif(readFileSync(paths[2],"utf8")),true);
 const actual=section(readFileSync(paths[2],"utf8"));assert.ok(actual.length>40000&&actual.length<50000);assert.match(actual,/gold doré/);assert.doesNotMatch(actual,/^Risk Factors\s*$/im);
 assert.equal(section("DESCRIPTION OF THE BUSINESS\n"+actual),actual);
 console.log(JSON.stringify({kind:"company_profile_annual_source_exact_aauc",sectionChars:actual.length,status:"passed"}));}
