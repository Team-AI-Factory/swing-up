import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadTsModule } from './helpers/load-typescript-module.mjs';
const { extractFinancialNoteCustomerEvidence: extract, verifiedFinancialNoteCustomerEvidence: verify } = loadTsModule('@/lib/company-profile-financial-customer-source');
const meta = {"identity": {"ticker": "HSAI", "company": "Hesai Group", "cik": "0001861737"}, "form": "20-F", "sourceUrl": "https://www.sec.gov/Archives/edgar/data/1861737/000110465926048025/hsai-20251231x20f.htm", "filedAt": "2026-04-24"};
const authentic = process.env.HSAI_PROFILE_FIXTURE ? fs.readFileSync(process.env.HSAI_PROFILE_FIXTURE, 'utf8') : null;
const expected = "Accounts receivable mainly consists of amounts due from the Group\u2019s customers, which are recorded net of allowance for credit losses. The Group manages customers by six pools \u2014 domestic PRC OEM customers, domestic PRC other customers, overseas OEM customers, overseas other customers, customers facing operational difficulties and other special customers.";
const ref = { identity: meta.identity, form: meta.form, sourceUrl: meta.sourceUrl, filedAt: meta.filedAt, now: new Date('2026-10-03T00:00:00Z') };
const html = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:dei="http://xbrl.sec.gov/dei/2025" xmlns:us-gaap="http://fasb.org/us-gaap/2025"><body><div style="display:none"><ix:header><ix:hidden><ix:nonNumeric name="dei:EntityCentralIndexKey" contextRef="c1">0001861737</ix:nonNumeric><ix:nonNumeric name="dei:DocumentFiscalPeriodFocus" contextRef="c1">FY</ix:nonNumeric></ix:hidden><ix:resources><xbrli:context id="c1"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0001861737</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context></ix:resources></ix:header></div><ix:nonNumeric name="dei:DocumentType" contextRef="c1">20-F</ix:nonNumeric><ix:nonNumeric name="dei:DocumentPeriodEndDate" contextRef="c1">2025-12-31</ix:nonNumeric><ix:nonNumeric name="us-gaap:TradeAndOtherAccountsReceivablePolicy" contextRef="c1" escape="true"><p>Accounts receivable, net</p><p>${expected}</p></ix:nonNumeric></body></html>`;
let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`PASS ${name}`); } catch (error) { console.error(`FAIL ${name}`); throw error; } }
function reject(name, changed, reference = ref) { test(name, () => assert.equal(extract({...reference,html:changed}), null)); }
if (authentic) test('authentic HSAI exact frozen proof', () => { const p=extract({...ref,html:authentic}); assert.ok(p); assert.equal(p.quote,expected); assert.equal(p.reportPeriod,'2025-12-31'); assert.equal(p.sourceFiledAt,'2026-04-24'); assert.equal(p.section,'financial_notes_accounts_receivable'); assert.equal(p.cik,'0001861737'); assert.ok(Object.isFrozen(p)); assert.equal(Object.keys(p).length,9); });
const proof=extract({...ref,html});
test('minimal same-filing annual proof',()=>assert.ok(proof));
test('preserve nested inline markup and actual whitespace',()=>assert.equal(extract({...ref,html:html.replace('amounts due','<b>amounts</b>\n due')})?.quote,expected));
test('real month-name nested DEI date',()=>assert.ok(extract({...ref,html:html.replace('>2025-12-31</ix:nonNumeric>','><b>December 31</b>, <span>2025</span></ix:nonNumeric>')})));
test('10-K same annual structure supported',()=>assert.ok(extract({...ref,form:'10-K',html:html.replace('>20-F<','>10-K<')})));
for(const [name,from,to] of [
 ['wrong DEI issuer','>0001861737</ix:nonNumeric>','>0001883085</ix:nonNumeric>'],
 ['foreign context issuer','>0001861737</xbrli:identifier>','>0001883085</xbrli:identifier>'],
 ['foreign context scheme','http://www.sec.gov/CIK','http://example.org/CIK'],
 ['context geography/segment','</xbrli:identifier>','</xbrli:identifier><xbrli:segment>Foreign business</xbrli:segment>'],
 ['context scenario','</xbrli:period>','</xbrli:period><xbrli:scenario>Segment</xbrli:scenario>'],
 ['quarterly context','2025-01-01','2025-10-01'],
 ['duration too long','2025-01-01','2023-01-01'],
 ['instant context','<xbrli:startDate>2025-01-01</xbrli:startDate>',''],
 ['context end mismatch','<xbrli:endDate>2025-12-31','<xbrli:endDate>2024-12-31'],
 ['wrong report date','>2025-12-31</ix:nonNumeric>','>2024-12-31</ix:nonNumeric>'],
 ['impossible report date','>2025-12-31</ix:nonNumeric>','>2025-02-29</ix:nonNumeric>'],
 ['wrong fiscal period','>FY<','>Q4<'],
 ['wrong form','>20-F<','>6-K<'],
 ['spoof DEI namespace','http://xbrl.sec.gov/dei/2025','http://evil.example/dei/2025'],
 ['spoof US GAAP namespace','http://fasb.org/us-gaap/2025','http://evil.example/us-gaap/2025'],
 ['spoof instance namespace','http://www.xbrl.org/2003/instance','http://evil.example/instance'],
 ['spoof inline namespace','http://www.xbrl.org/2013/inlineXBRL','http://evil.example/inlineXBRL'],
 ['wrong taxonomy','us-gaap:TradeAndOtherAccountsReceivablePolicy','us-gaap:RevenueRecognitionPolicyTextBlock'],
 ['rebound local taxonomy prefix','name="us-gaap:TradeAndOtherAccountsReceivablePolicy"','xmlns:us-gaap="http://evil.example/2025" name="us-gaap:TradeAndOtherAccountsReceivablePolicy"'],
 ['wrong context reference','name="us-gaap:TradeAndOtherAccountsReceivablePolicy" contextRef="c1"','name="us-gaap:TradeAndOtherAccountsReceivablePolicy" contextRef="other"'],
 ['wrong DEI context','name="dei:DocumentType" contextRef="c1"','name="dei:DocumentType" contextRef="other"'],
 ['duplicate attrs','contextRef="c1" escape="true"','contextRef="c1" contextRef="other" escape="true"'],
 ['continuation unsupported AR','escape="true"','escape="true" continuedAt="elsewhere"'],
 ['missing escaped text block','escape="true"','escape="false"'],
 ['not standalone heading','Accounts receivable, net</p>','Accounts receivable, net explanation</p>'],
 ['heading outside block','escape="true"><p>Accounts receivable, net</p>','escape="true">'],
 ['adjacency broken by paragraph','<p>'+expected,'<p>Unrelated business segment</p><p>'+expected],
 ['preceding antecedent crossing','<p>'+expected,'<p>Another company manages a different business. '+expected],
 ['cross paragraph quote','credit losses. The Group','credit losses.</p><p>The Group'],
 ['Group replaced by other entity','The Group manages','Other Group manages'],
 ['hypothetical pools','The Group manages','The Group may manage'],
 ['potential customers','Group’s customers','Group’s potential customers'],
 ['supplier payables','Group’s customers','Group’s suppliers'],
 ['shareholder statement','Group’s customers','Group’s shareholders'],
 ['product users only','amounts due from','products used by'],
 ['due TO instead of FROM','amounts due from','amounts due to'],
 ['only geography','domestic PRC OEM customers','domestic PRC customers'],
 ['no actual OEM counterparties','overseas OEM customers','overseas product users'],
 ['nested block crossing','<p>'+expected,'<p><div>'+expected+'</div>'],
 ['hidden note','escape="true"','escape="true" style="display:none"'],
 ['hidden heading','<p>Accounts receivable','<p style="visibility:hidden">Accounts receivable'],
 ['hidden quote','<p>'+expected,'<p hidden="hidden">'+expected],
 ['opacity zero','<p>'+expected,'<p style="opacity:0">'+expected],
 ['clipped quote','<p>'+expected,'<p style="clip-path:inset(100%)">'+expected],
 ['font zero','<p>'+expected,'<p style="font-size:0pt">'+expected],
 ['CSS escaping','<p>'+expected,'<p style="display:n\\6fne">'+expected],
 ['hidden inserted text','amounts due','amounts <span style="display:none">not</span>due'],
 ['unknown class visibility','<p>'+expected,'<p class="decoy">'+expected],
 ['stylesheet decoy','<body>','<body><style>p {display:none}</style>'],
 ['external stylesheet','<body>','<body><link rel="stylesheet" href="hidden.css"/>'],
 ['metadata outside ix hidden','<ix:hidden>','<ix:other>'],
 ['unclosed document','</body></html>',''],
 ['truncated note','</p></ix:nonNumeric></body></html>',''],
 ]) reject(name,html.replace(from,to));
const block = html.slice(html.indexOf('<ix:nonNumeric name="us-gaap:'), html.lastIndexOf('</body>'));
reject('note commented out',html.replace(block,`<!--${block}-->`));
reject('note script decoy',html.replace(block,`<script>${block}</script>`));
reject('note template decoy',html.replace(block,`<template>${block}</template>`));
reject('note wrapped in hidden ancestor',html.replace(block,`<div style="display:none">${block}</div>`));
reject('duplicate required fact',html.replace('</body>','<ix:nonNumeric name="dei:DocumentType" contextRef="c1">20-F</ix:nonNumeric></body>'));
reject('duplicate note',html.replace('</body>',block+'</body>'));
reject('duplicate context id',html.replace('</ix:resources>','<xbrli:context id="c1"/></ix:resources>'));
reject('missing distinct FY fact',html.replace('name="dei:DocumentFiscalPeriodFocus"','name="dei:DocumentType"'));
reject('DTD entity expansion',html.replace('<html','<!DOCTYPE html [<!ENTITY evil "bad">]><html'));
reject('annual-report flag false',html.replace('</body>','<ix:nonNumeric name="dei:DocumentAnnualReport" contextRef="c1">false</ix:nonNumeric></body>'));
reject('registration flag true',html.replace('</body>','<ix:nonNumeric name="dei:DocumentRegistrationStatement" contextRef="c1">true</ix:nonNumeric></body>'));
for(const [name,patch] of [
 ['metadata wrong CIK',{identity:{cik:'1883085'}}],['metadata nonannual',{form:'6-K'}],['metadata amendment',{form:'20-F/A'}],
 ['metadata wrong form',{form:'10-K'}],['SEC host spoof',{sourceUrl:meta.sourceUrl.replace('www.sec.gov','www.sec.gov.evil.example')}],
 ['query rejected',{sourceUrl:meta.sourceUrl+'?doc=1'}],['fragment rejected',{sourceUrl:meta.sourceUrl+'#x'}],
 ['userinfo rejected',{sourceUrl:meta.sourceUrl.replace('https://','https://a@')}],['HTTP rejected',{sourceUrl:meta.sourceUrl.replace('https:','http:')}],
 ['encoded path rejected',{sourceUrl:meta.sourceUrl.replace('hsai','%68sai')}],['dot traversal rejected',{sourceUrl:meta.sourceUrl.replace('/hsai','/../hsai')}],
 ['CIK prefix rejected',{sourceUrl:meta.sourceUrl.replace('/1861737/','/18617370/')}],['bad date',{filedAt:'2026-02-30'}],
 ['future filed',{now:new Date('2026-04-23T23:59:59Z')}],['filed before period',{filedAt:'2025-12-01'}],['invalid clock',{now:new Date('bad')}],
 ]) reject(name,html,{...ref,...patch});
test('private cache original date/report period immutable round trip',()=>{const value=verify(JSON.parse(JSON.stringify(proof)),{...ref,now:new Date('2027-12-01T00:00:00Z')});assert.deepEqual(value,proof);assert.ok(Object.isFrozen(value));assert.equal('verifiedAt' in value,false);});
for(const [name,patch] of [['Business relabel',{section:'business'}],['wrong issuer',{cik:'0001883085'}],['wrong source URL',{sourceUrl:meta.sourceUrl+'x'}],['new file date',{sourceFiledAt:'2026-04-25'}],['unversioned',{version:undefined}],['wrong taxonomy',{taxonomy:'us-gaap:Foo'}],['future period',{reportPeriod:'2027-12-31'}],['bad quote',{quote:expected.replace('OEM','user')}],['new verification clock',{verifiedAt:'2026-10-03'}]]) test(`cache rejects ${name}`,()=>assert.equal(verify({...proof,...patch},ref),null));
test('cache rejected against different filing reference',()=>assert.equal(verify(proof,{...ref,filedAt:'2026-04-25'}),null));

for(const [name,from,to] of [
 ['nil XBRL context','<xbrli:context id="c1">','<xbrli:context id="c1" xmlns:n="http://www.w3.org/2001/XMLSchema-instance" n:nil="1">'],
 ['nil XBRL entity','<xbrli:entity>','<xbrli:entity xmlns:n="http://www.w3.org/2001/XMLSchema-instance" n:nil="true">'],
 ['nil XBRL period date','<xbrli:startDate>','<xbrli:startDate xmlns:n="http://www.w3.org/2001/XMLSchema-instance" n:nil="true">'],
 ['nil note true arbitrary XMLSchema prefix','escape="true"','escape="true" xmlns:n="http://www.w3.org/2001/XMLSchema-instance" n:nil="true"'],
 ['nil note lexical one','escape="true"','escape="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:nil="1"'],
 ['nil metadata lexical one','name="dei:DocumentType"','name="dei:DocumentType" xmlns:n="http://www.w3.org/2001/XMLSchema-instance" n:nil="1"'],
 ['nil note invalid foreign namespace','escape="true"','escape="true" xmlns:xsi="urn:unrelated" xsi:nil="true"'],
 ['metadata text hidden in nested span','>20-F<','><span style="display:none">20-F</span><'],
 ['negative opacity clamped hidden','escape="true"','escape="true" style="opacity:-1"'],
 ['transform zero scale hidden','escape="true"','escape="true" style="transform:scale(0)"'],
 ['computed zero font size','escape="true"','escape="true" style="font-size:calc(0px)"'],
 ['filter opacity hidden','escape="true"','escape="true" style="filter:opacity(0)"'],
 ['CSS variable visibility','escape="true"','escape="true" style="display:var(--hidden)"'],
 ['font shorthand hidden','escape="true"','escape="true" style="font:0/0 serif"'],
 ['zero-width clipped narrative','escape="true"','escape="true" style="width:0;overflow:hidden"'],
 ['offscreen absolute narrative','escape="true"','escape="true" style="position:absolute;left:-99999px"'],
 ['decimal-zero opacity','escape="true"','escape="true" style="opacity:.0"'],
 ['decimal-zero font size','escape="true"','escape="true" style="font-size:0.0px"'],
 ['percentage-zero opacity','escape="true"','escape="true" style="opacity:0.00%"'],
 ['tail repudiates first sentences',expected,expected+' The quoted classification above belongs solely to another issuer and does not describe the Group.'],
 ['tail note repudiates first sentences','</p></ix:nonNumeric></body>','</p><p>The customer classification belongs to another issuer.</p></ix:nonNumeric></body>'],
 ]) reject(name,html.replace(from,to));
reject('closed details excludes narrative',html.replace(block,`<details><summary>Other issuer</summary>${block}</details>`));
reject('blockquote excludes quoted other issuer',html.replace(block,`<blockquote cite="other-issuer">${block}</blockquote>`));
reject('inline quotation excludes other issuer',html.replace(block,`<q>${block}</q>`));
test('12M input cap cannot expand transport budget',()=>assert.equal(extract({...ref,html:html+' '.repeat(12_000_001)}),null));
if (authentic) test('all partial 128k stream chunks rejected before tree parsing',()=>{for(let end=128000;end<authentic.length;end+=128000)assert.equal(extract({...ref,html:authentic.slice(0,end)}),null);});
console.log(`\n${passed} tests passed`);
