import { readFileSync } from "node:fs";
// Synthetic XHTML/continuation envelope with independently recorded source
// paragraphs. No actual filing is fetched or treated as network data in tests.
export const data = JSON.parse(readFileSync(new URL("../fixtures/company-profile-revenue-note.json", import.meta.url)));
export const ref = { identity: data.identity, form: data.form, sourceUrl: data.sourceUrl, filedAt: data.filingDate, now: new Date("2026-10-03T00:00:00Z") };
const xml = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const paragraphs = [data.quotes.customerAgreementAndPrincipal, data.quotes.serviceResponsibility, "Network AI Fees",
  "Network AI fees, comprised of AI integration fees and capital markets execution fees, totaled $0 in this synthetic layout fixture.",
  "Contract Fees", data.quotes.contractTerms,
  "Performance fees are earned when certain Fund Financing Vehicles exceed contractual return thresholds.", data.quotes.directPayment];
export const html = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:dei="http://xbrl.sec.gov/dei/2025" xmlns:us-gaap="http://fasb.org/us-gaap/2025" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><body><div style="display:none"><ix:header><ix:hidden><ix:nonNumeric name="dei:EntityCentralIndexKey" contextRef="c-1">0001883085</ix:nonNumeric><ix:nonNumeric name="dei:DocumentFiscalPeriodFocus" contextRef="c-1">FY</ix:nonNumeric></ix:hidden><ix:resources><xbrli:context id="c-1"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0001883085</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context></ix:resources></ix:header></div><ix:nonNumeric name="dei:DocumentType" contextRef="c-1">10-K</ix:nonNumeric><ix:nonNumeric name="dei:DocumentPeriodEndDate" contextRef="c-1" id="f-38"><ix:nonNumeric name="dei:CurrentFiscalYearEndDate" contextRef="c-1">December&#160;31</ix:nonNumeric>, 2025</ix:nonNumeric>
<div>NOTE 4 - <ix:nonNumeric contextRef="c-1" name="us-gaap:RevenueFromContractWithCustomerTextBlock" id="f-649" continuedAt="f-649-1" escape="true">REVENUE</ix:nonNumeric></div>
<ix:continuation id="f-649-1" continuedAt="f-649-2"><ix:continuation id="f-601-4" continuedAt="f-601-5">${paragraphs.map(p => `<div><span>${xml(p)}</span></div>`).join("")}</ix:continuation></ix:continuation>
<ix:continuation id="f-649-2" continuedAt="f-649-3"><ix:continuation id="f-601-5"><div>Total Revenue From Fees</div><div>The Company determines its contracts generally do not include a significant financing component. Neutral fixture continuation.</div></ix:continuation></ix:continuation>
<ix:continuation id="f-649-3"><div>The timing of the revenue recognition may differ from the timing of payment from customers.</div></ix:continuation></body></html>`;
